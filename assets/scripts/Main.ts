import { _decorator, Camera, Color, Component, Node, ResolutionPolicy, UITransform, view } from 'cc';
import { PREVIEW } from 'cc/env';
import { ActivityScreen } from './ActivityScreen';
import { AssetStore } from './AssetStore';
import { CatCollectionScreen } from './CatCollectionScreen';
import { CatDetailScreen } from './CatDetailScreen';
import { DailyTaskScreen } from './DailyTaskScreen';
import { GameScreen, buildGameScreenImagePaths } from './GameScreen';
import { HomeScreen, buildHomeScreenImagePaths } from './HomeScreen';
import { PlayerStore } from './PlayerStore';
import { ProfileCoordinator } from './ProfileCoordinator';
import { isCampaignComplete, LEVELS_PER_THEME, MAX_MAIN_LEVEL, themeIndexForLevel } from './TownContent';
import { ShopScreen } from './ShopScreen';
import { TownScreen } from './TownScreen';
import { CatId, BuildingId, TownDailyTaskId } from './PlayerTypes';
import { LevelSystem } from './level/LevelSystem';
import { LevelDefinition } from './level/LevelTypes';
import { LoadingScreen } from './LoadingScreen';
import { AudioManager } from './AudioManager';
import { LeaderboardService } from './LeaderboardService';
import { RankScreen } from './RankScreen';
import { REWARDED_AD_ENABLED, RewardedAdService, TAP_REWARDED_AD_UNIT_ID } from './RewardedAdService';
import { Toast } from './Toast';
import { MomentScreen } from './MomentScreen';
import { AdventureScreen, THEME_INFO } from './AdventureScreen';
import { LoadingOverlay } from './LoadingOverlay';
import { AdScene, Analytics, AnalyticsPageId } from './Analytics';
import { SharePromoter } from './SharePromoter';

const { ccclass, property } = _decorator;

// 超萌挑战：首页入口的固定单关，对标"羊了个羊第二关"——
// 固定 69 张 / 15 种 / 8 层深堆，收集槽缩到 5 格（额外槽位道具可 +1）；
// fullTrayPressure 贴满压力规划：最优路径长期骑在 4/5 满槽边缘、无放松段，
// 同种牌按层距打散，并按残酷度挑选候选；
// 每日首次通关发大额金币，同日重复通关只发少量金币；
// 不发星星、不写入难度自适应（避免挑战连败触发普通关的救援难度）；
// 每次进关换新种子，只保持高压配置，避免记住卡牌位置。
const CHALLENGE_GENERATOR_LEVEL = 100;
const CHALLENGE_TARGET_DIFFICULTY = 100;
const CHALLENGE_TRAY_SLOTS = 5;
const CHALLENGE_COIN_REWARD = 3000;
const CHALLENGE_REPEAT_COIN_REWARD = 80;

@ccclass('Main')
export class Main extends Component {
  @property({ tooltip: '微信小游戏激励视频广告位 ID；H5 / 预览使用 TapTap 广告位 1067058' })
  rewardedAdUnitId = '';

  private static instance: Main | null = null;
  private root!: Node;
  private readonly assets = new AssetStore();
  private readonly levelSystem = new LevelSystem();
  private readonly playerStore = new PlayerStore();
  private readonly leaderboard = new LeaderboardService();
  private readonly analytics = new Analytics();
  private launchedAt = 0;
  private audio!: AudioManager;
  private rewardedAd!: RewardedAdService;
  /** 远程 profile 单飞协调器（在 onLoad 装配）。 */
  private profile!: ProfileCoordinator;
  /** 分享适配层（在 onLoad 装配）。 */
  private sharePromoter!: SharePromoter;
  private homeScreen!: HomeScreen;
  private townScreen: TownScreen | null = null;
  private catCollectionScreen: CatCollectionScreen | null = null;
  private catDetailScreen: CatDetailScreen | null = null;
  private dailyTaskScreen: DailyTaskScreen | null = null;
  private shopScreen: ShopScreen | null = null;
  private activityScreen: ActivityScreen | null = null;
  private momentScreen: MomentScreen | null = null;
  private adventureScreen: AdventureScreen | null = null;
  private rankScreen: RankScreen | null = null;
  private preparingLevel = false;
  private gameScreen: GameScreen | null = null;
  private loadingScreen: LoadingScreen | null = null;
  private loadingOverlay: LoadingOverlay | null = null;
  private currentLevelDefinition: LevelDefinition | null = null;
  private nextLevelDefinition: LevelDefinition | null = null;
  private nextLevelPrepareToken = 0;
  private nextLevelPreparing = false;
  private readonly nextLevelReadyWaiters: Array<(definition: LevelDefinition) => void> = [];
  private challengeLevelDefinition: LevelDefinition | null = null;
  private challengePrepareToken = 0;
  private challengePreparing = false;
  // 备用挑战关卡：当前关卡交付后立刻在后台预生成一份，
  // 让「再玩一次」/ 回到首页再进挑战都能直接换牌，不必等一次完整生成。
  private challengeSpareDefinition: LevelDefinition | null = null;
  private challengeSpareToken = 0;
  private challengeSparePreparing = false;
  private startingGame = false;
  /** 首页本地资源是否存在加载失败（用于进首页后的可见提示）。 */
  private homeLoadFailed = false;
  private readonly loadedScreens = new Set<object>();
  private readonly readyScreens = new Set<object>();
  private readonly screenLoadWaiters = new Map<object, Array<() => void>>();
  /** 预览环境的冷页面首次打开观测：页面构造名 → 首次就绪时间戳。 */
  private readonly screenFirstReadyAt = new Map<string, number>();
  // 结算页「去建设」跳转暂存的目标建筑 id，由 TownScreen.setActive 一次性消费
  private townFocusBuildingId: BuildingId | null = null;
  // 二级页面的常驻上限与最近使用顺序。超出上限时淘汰最久未用的页面：
  // 先停页面自身的定时器/补间并销毁 UI（Screen.destroy），再清 Main 的加载/就绪记录，
  // 最后按归属释放独占图片（AssetStore.releaseOwner）。
  // 首页始终常驻；二级页面全部按需创建，就绪后进入这个 LRU 列表。
  private static readonly RESIDENT_SCREEN_LIMIT = 2;
  private readonly residentScreens: object[] = [];
  /** 当前关卡资源的预热归属：关卡图片不再无 owner 永久常驻（见 preloadGameResources）。 */
  private readonly levelPreloadOwner = { role: 'main-level-preload' };
  private preloadedLevel = 0;

  onLoad() {
    // Protect startup when a stale scene cache contains duplicate Main components.
    if (Main.instance) {
      this.enabled = false;
      return;
    }
    Main.instance = this;
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    this.launchedAt = Date.now();
    this.playerStore.load();
    // 埋点上下文只带匿名身份：金币、星星、关卡、猫咪等本机存档状态不再随事件上传。
    this.analytics.setContext(() => ({
      userId: this.playerStore.getUserId(),
    }));
    this.playerStore.bindAnalytics(this.analytics);
    if (this.playerStore.hasProfile()) this.analytics.setUserId(this.playerStore.getUserId());
    this.profile = new ProfileCoordinator({
      playerStore: this.playerStore,
      leaderboard: this.leaderboard,
      analytics: this.analytics,
      isAlive: () => this.node.isValid,
    });
    this.sharePromoter = new SharePromoter({
      analytics: this.analytics,
      leaderboard: this.leaderboard,
      playerStore: this.playerStore,
      getRoot: () => this.root,
      refreshGameInventory: () => this.gameScreen?.refreshInventoryHud(),
    });
    this.analytics.track('app_launch', {
      is_new_user: !this.playerStore.hasProfile() && this.playerStore.getLevel() === 1 && this.playerStore.getTotalStarsEarned() === 0,
      has_profile: this.playerStore.hasProfile(),
    });
    this.levelSystem.seedRuns(this.playerStore.getRecentRuns());
    this.root = new Node('CatTownRoot');
    this.node.addChild(this.root);
    const rootSize = view.getVisibleSize();
    this.root.addComponent(UITransform).setContentSize(rootSize.width, rootSize.height);
    // 相机清屏色对齐启动屏奶油底色：HTML 启动屏撤掉后、加载页画出前的任何一帧
    // 都显示品牌暖色，弱网下不会闪黑屏（默认清屏色是黑色）。
    const camera = this.node.getChildByName('Camera')?.getComponent(Camera);
    if (camera) camera.clearColor = new Color(255, 247, 216, 255);
    this.audio = new AudioManager(this.node);
    // 音频延迟加载，不阻塞首屏
    // this.audio.load();
    this.rewardedAd = new RewardedAdService(
      REWARDED_AD_ENABLED ? TAP_REWARDED_AD_UNIT_ID : this.rewardedAdUnitId,
    );

    // 加载页先亮起来，进度条走完前必须把首页和当前关卡都准备好。
    this.loadingScreen = new LoadingScreen(this.root, this.assets, {
      onFinish: () => this.enterHome(),
    });
    this.loadingScreen.loadAndCreate(() => this.beginPrimaryLoad());
  }

  // 激励视频入口总控：preview / H5 开放 TapTap 广告；微信渠道关闭时注入 undefined，
  // 结算复活/双倍、首页金币广告、商店广告领道具会各自隐藏入口。
  private buildWatchAdHandler() {
    if (!REWARDED_AD_ENABLED) return undefined;
    return (scene: AdScene = 'home_coins') => this.analytics.trackRewardedAd(scene, () => this.rewardedAd.watch());
  }

  private trackPage(pageId: AnalyticsPageId) {
    this.analytics.pageView(pageId);
  }

  // 只创建首页，其他页面延迟到用户访问时创建
  private createHomeScreen() {
    this.homeScreen = new HomeScreen(this.root, this.assets, {
      getExperienceInfo: () => this.playerStore.getExperienceInfo(),
      getPlayerName: () => this.playerStore.getUserName(),
      getCoins: () => this.playerStore.getCoins(),
      getMusicEnabled: () => this.audio.getMusicEnabled(),
      getSoundEnabled: () => this.audio.getSoundEnabled(),
      getVibrationEnabled: () => this.audio.getVibrationEnabled(),
      onMusicChanged: enabled => this.audio.setMusicEnabled(enabled),
      onSoundChanged: enabled => this.audio.setSoundEnabled(enabled),
      onVibrationChanged: enabled => this.audio.setVibrationEnabled(enabled),
      onPlaySound: effect => this.audio.playEffect(effect),
      onStartGame: () => this.startGame(),
      onStartEndless: () => this.startEndless(),
      isEndlessUnlocked: () => this.playerStore.isEndlessUnlocked(),
      onStartChallenge: () => this.startChallenge(),
      isChallengeUnlocked: () => this.playerStore.isChallengeUnlocked(),
      challengeCoinReward: CHALLENGE_COIN_REWARD,
      isChallengeRewardClaimed: () => this.playerStore.isChallengeRewardClaimed(),
      shouldShowCatTrialOffer: () => this.playerStore.shouldShowCatTrialOffer(),
      onCatTrialOfferShown: () => this.playerStore.markCatTrialOfferShown(),
      onStartCatTrial: () => this.startCatTrial(),
      getCatTrialStatus: () => this.playerStore.getCatTrialStatus(),
      shouldShowChallengeUnlockNotice: () => this.playerStore.shouldShowChallengeUnlockNotice(),
      onChallengeUnlockNoticeShown: () => this.playerStore.markChallengeUnlockNoticeShown(),
      onOpenTown: () => this.openTown(),
      // 气泡条件 =「从未建设过」或「星星已够点亮下一格」（小节点机制的建设提醒）
      shouldShowTownBuildHint: () =>
        this.playerStore.shouldShowTownBuildHint() || this.playerStore.canLightNextBuildingCell(),
      shouldShowFirstTownGuide: () => this.playerStore.shouldShowFirstTownGuide(),
      onFirstTownGuideDone: () => this.playerStore.markFirstTownGuideDone(),
      onOpenCatCollection: () => this.openCatCollection(),
      shouldShowCatEquipHint: () => this.playerStore.shouldShowCatEquipHint(),
      onOpenDailyTasks: () => this.openDailyTasks(),
      onOpenShop: () => this.openShop(),
      onOpenLeaderboard: () => this.openRank(),
      onOpenMoments: () => this.openMoments(),
      onOpenAdventure: () => this.openAdventure(),
      getActivity: () => this.playerStore.getActivitySnapshot(),
      onOpenActivity: () => this.openActivity(),
      getDailyTaskBadgeCount: () => {
        const tasks = this.playerStore.getTasks();
        const claimable = tasks.filter(task => task.completed && !task.claimed).length;
        const chestReady = this.playerStore.isDailyChestReady() && !this.playerStore.isDailyChestClaimed();
        const journeyReady = this.playerStore.isCatJourneyClaimable();
        return claimable + (chestReady ? 1 : 0) + (journeyReady ? 1 : 0);
      },
      // 首页章节横幅：关卡号与主题内通关数实时取主线进度（每通一关都会变化），
      // 主题名按关卡所在冒险主题（每 20 关一章）；回首页 setActive 时统一刷新
      onTrack: (name, props) => this.analytics.track(name, props),
      getChapterInfo: () => {
        const rawLevel = this.playerStore.getLevel();
        const complete = isCampaignComplete(rawLevel);
        const index = themeIndexForLevel(rawLevel, THEME_INFO.length);
        const displayLevel = complete ? MAX_MAIN_LEVEL : rawLevel;
        const clearedInTheme = complete
          ? LEVELS_PER_THEME
          : Math.max(0, Math.min(LEVELS_PER_THEME, displayLevel - 1 - index * LEVELS_PER_THEME));
        return {
          level: displayLevel,
          name: THEME_INFO[index].name,
          clearedInTheme,
          levelsPerTheme: LEVELS_PER_THEME,
          campaignComplete: complete,
        };
      },
      onShareForCoins: () => this.sharePromoter.shareForCoins(),
      canShareForCoins: () => this.playerStore.canClaimCoinByShare(),
      onAddCoins: amount => this.playerStore.addReward({ coins: amount }),
    });
  }

  // 按需创建小镇页面
  private createTownScreen() {
    if (this.townScreen) return;
    this.townScreen = new TownScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getStars: () => this.playerStore.getStars(),
      getCoins: () => this.playerStore.getCoins(),
      getBuildings: () => this.playerStore.getBuildingViews(),
      onLightCell: id => this.playerStore.lightBuildingCell(id),
      shouldShowCellGuide: () => this.playerStore.shouldShowTownBuildHint(),
      onOpenCatCollection: () => this.openCatCollection(),
      consumeFocusBuilding: () => this.consumeTownFocus(),
      getTownDaily: () => this.playerStore.getTownDailySnapshot(),
      onClaimTownDaily: () => this.playerStore.claimTownDaily(),
      onTownDailyAction: (taskId: TownDailyTaskId, buildingId?: BuildingId) => {
        if (!buildingId) return;
        if (taskId === 'enter_building') this.playerStore.markTownBuildingEntered(buildingId);
        if (taskId === 'view_dialogue') this.playerStore.markTownDialogueViewed(buildingId);
      },
      getShareOffer: type => this.sharePromoter.buildShareOffer(
        type,
        type === 'cat_unlock' ? '分享解锁成果 · 领金币×30' : '分享小镇进度 · 领金币×30',
      ),
      onShare: type => this.sharePromoter.shareCard(type),
      onStartGame: () => {
        this.townScreen?.setActive(false);
        this.startGame();
      },
      onReturnHome: () => this.returnHome(),
    });
  }

  // 按需创建猫咪社页面
  private createCatCollectionScreen() {
    if (this.catCollectionScreen) return;
    this.catCollectionScreen = new CatCollectionScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCats: () => this.playerStore.getState().cats,
      getEquippedCat: () => this.playerStore.getEquippedCat(false),
      getCatTrialStatus: () => this.playerStore.getCatTrialStatus(),
      onOpenCat: id => this.openCatDetail(id),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建猫咪详情页面
  private createCatDetailScreen() {
    if (this.catDetailScreen) return;
    this.catDetailScreen = new CatDetailScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCoins: () => this.playerStore.getCoins(),
      getCat: id => this.playerStore.getCat(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(false),
      getCatTrialStatus: () => this.playerStore.getCatTrialStatus(),
      onInteract: (id, interaction) => this.playerStore.interactWithCat(id, interaction),
      onUpgrade: id => this.playerStore.upgradeCat(id),
      onEquip: id => this.playerStore.equipCat(id),
      onReturnCollection: () => this.returnToCatCollection(),
    });
  }

  // 按需创建每日任务页面
  private createDailyTaskScreen() {
    if (this.dailyTaskScreen) return;
    this.dailyTaskScreen = new DailyTaskScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getDateKey: () => this.playerStore.getDailyDateKey(),
      getTasks: () => this.playerStore.getTasks(),
      isChestReady: () => this.playerStore.isDailyChestReady(),
      isChestClaimed: () => this.playerStore.isDailyChestClaimed(),
      onClaimTask: id => this.playerStore.claimTask(id),
      onClaimChest: () => this.playerStore.claimDailyChest(),
      getCatJourney: () => this.playerStore.getCatJourneySnapshot(),
      onClaimCatJourney: () => this.playerStore.claimCatJourney(),
      onJourneyOpened: () => this.analytics.track('journey_open'),
      getShareOffer: () => this.sharePromoter.buildShareOffer('journey_complete', '分享旅程完成 · 领金币×30'),
      onShare: type => this.sharePromoter.shareCard(type),
      onStartGame: () => this.startGame(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建商店页面
  private createShopScreen() {
    if (this.shopScreen) return;
    this.shopScreen = new ShopScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCoins: () => this.playerStore.getCoins(),
      getItemCount: id => this.playerStore.getItemCount(id),
      onBuyItem: id => this.playerStore.buyItem(id),
      getShopItemStatus: id => this.playerStore.getShopItemStatus(id),
      onClaimItemByAd: id => this.playerStore.claimItemByAd(id),
      onWatchAd: this.buildWatchAdHandler(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建活动页面
  private createActivityScreen() {
    if (this.activityScreen) return;
    this.activityScreen = new ActivityScreen(this.root, this.assets, {
      getActivity: () => this.playerStore.getActivitySnapshot(),
      onClaimTask: id => this.playerStore.claimActivityTask(id),
      onClaimReward: id => this.playerStore.claimActivityReward(id),
      onStartGame: () => this.startGame(),
      onPlaySound: effect => this.audio.playEffect(effect),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建点滴页面
  private createMomentScreen() {
    if (this.momentScreen) return;
    this.momentScreen = new MomentScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getMoments: () => this.playerStore.getMoments(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建冒险页面
  private createAdventureScreen() {
    if (this.adventureScreen) return;
    this.adventureScreen = new AdventureScreen(this.root, this.assets, {
      getLevel: () => this.playerStore.getLevel(),
      getLevelStar: level => this.playerStore.getLevelStar(level),
      getTotalStars: () => this.playerStore.getTotalStarsEarned(),
      getCoins: () => this.playerStore.getCoins(),
      onPlaySound: effect => this.audio.playEffect(effect),
      onStartGame: () => this.startGame(),
      onOpenShop: () => this.openShop(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  // 按需创建排行榜页面
  private createRankScreen() {
    if (this.rankScreen) return;
    this.rankScreen = new RankScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      // 排行榜入口补齐身份（A-3）：没有/生成失败时先走单飞生成，失败让页面
      // 展示「网络暂不可用，可重试」，而不是把身份缺失渲染成空榜。
      fetchEntries: tab => this.profile.ensure().then(() => this.leaderboard.fetchBoard(
        tab,
        this.playerStore.getUserId(),
        tab === 'challenge' ? this.playerStore.getDailyDateKey() : undefined,
      )),
      onInvite: () => this.leaderboard.invite(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  private beginPrimaryLoad() {
    if (!this.node.isValid) return;
    // ✅ 阶段1：只创建首页，不创建其他页面
    this.createHomeScreen();
    this.loadingScreen?.bringToFront();

    // 远程 profile 完全后台化：失败/超时不阻塞首屏、不占加载进度，
    // 排行榜入口会通过同一条单飞请求显式重试（见 ProfileCoordinator.ensure）。
    this.profile.ensure().catch(() => {
      // 失败日志已在协调器内输出，后台路径静默即可。
    });

    // ✅ 只加载首页资源，游戏资源延迟到后台加载。
    // 首屏完成条件只看本地：首页图片就绪 + 首页 UI 创建成功（A-1），
    // 加载进度 0–100% 只反映本地首页任务。
    const homeOnlyPaths = buildHomeScreenImagePaths();

    let imagesReady = false;
    let homeReady = false;
    let finished = false;

    const updateProgress = () => {
      let progress = 0;
      if (imagesReady) progress += 0.8;
      if (homeReady) progress += 0.2;
      this.loadingScreen?.setProgress(progress);
    };

    const maybeFinish = () => {
      if (finished || !imagesReady || !homeReady) return;
      finished = true;
      this.loadingScreen?.finish();
    };

    this.assets.loadImages(
      homeOnlyPaths,
      () => {
        if (!this.node.isValid) return;
        // 记录本地首页资源是否有加载失败，进首页后给出可见提示（A-1）。
        this.homeLoadFailed = this.assets.takeLoadFailures().length > 0;
        imagesReady = true;
        updateProgress();

        this.loadScreen(this.homeScreen, () => {
          homeReady = true;
          updateProgress();
          maybeFinish();
        });
      },
      (loaded, total) => {
        const imageShare = total > 0 ? loaded / total : 1;
        this.loadingScreen?.setProgress(imageShare * 0.8);
      },
    );
  }

  private enterHome() {
    this.analytics.track('loading_finish', {
      duration_ms: Math.max(0, Date.now() - this.launchedAt),
    });
    this.homeScreen.setActive(true);
    this.trackPage('home');
    this.loadingScreen?.destroy();
    this.loadingScreen = null;
    if (this.homeLoadFailed) {
      this.homeLoadFailed = false;
      Toast.show(this.root, '部分资源加载失败，界面可能不完整，重启小游戏可恢复');
    }

    // ✅ 阶段2：首页显示后，启动后台预加载
    this.startBackgroundPreload();
  }

  // 后台预加载其他资源和页面
  private startBackgroundPreload() {
    if (!this.node.isValid) return;

    const level = this.playerStore.getLevel();

    // 延迟800ms后加载音频，避免阻塞首页交互
    setTimeout(() => {
      if (this.node.isValid) {
        this.audio.load();
      }
    }, 800);

    // 延迟500ms后开始预加载游戏资源
    setTimeout(() => {
      if (!this.node.isValid) return;
      this.preloadGameResources(level);
    }, 500);
  }

  // 预加载当前关卡的游戏资源（C-2）：以 levelPreloadOwner 归属加载，
  // 不再无 owner 地把关卡图片标记为永久常驻；换关卡预热时先释放上一份。
  // GameScreen 打开时仍会以自己为 owner 再登记一次，对局期间图片不会被误释放。
  private preloadGameResources(level: number) {
    const gamePaths = buildGameScreenImagePaths(level);
    this.assets.releaseOwner(this.levelPreloadOwner);
    this.preloadedLevel = level;

    this.assets.loadImagesFor(this.levelPreloadOwner, gamePaths, () => {
      if (!this.node.isValid) return;

      // 游戏资源加载完成后，准备当前关卡
      this.prepareCurrentLevel();

      // 关卡资源就绪后，预热首页自身浮层与超萌挑战关卡（不再预载九个菜单页面）
      setTimeout(() => {
        if (this.node.isValid) {
          this.preloadSecondaryScreens();
        }
      }, 500);
    });
  }

  // 延迟准备当前关卡
  private prepareCurrentLevel() {
    if (this.currentLevelDefinition || this.preparingLevel) return;
    if (isCampaignComplete(this.playerStore.getLevel())) return;

    this.preparingLevel = true;
    const level = this.playerStore.getLevel();

    this.levelSystem.nextLevelAsync(level, this.seedForLevel(level))
      .then(definition => {
        if (!this.node.isValid) return;
        this.currentLevelDefinition = definition;
        this.preparingLevel = false;
      })
      .catch(error => {
        console.error('[CatWorld] Failed to preload level', error);
        this.preparingLevel = false;
      });
  }

  // 关卡资源就绪后，只预热首页自身浮层（设置/玩法介绍）与超萌挑战关卡。
  // 九个二级菜单页面一律改为首次点击时按需创建（C-1），
  // 就绪后进入 RESIDENT_SCREEN_LIMIT 的 LRU 管理，不再后台 pin 常驻。
  private preloadSecondaryScreens() {
    this.homeScreen.preloadOverlays();
    if (this.playerStore.isChallengeUnlocked() && !this.challengeLevelDefinition && !this.challengePreparing) {
      this.prepareChallengeLevel();
    }
  }

  // 按需加载页面：重复点击复用同一条加载请求；就绪后按 LRU 记录归属。
  // 迟到的资源回调不得复活已淘汰的页面（loadedScreens 已被 releaseScreen 清除时直接忽略）。
  private loadScreen(
    screen: { loadAndCreate: (onReady?: () => void) => void },
    onReady?: () => void,
  ) {
    if (this.readyScreens.has(screen)) return true;
    if (onReady) {
      const waiters = this.screenLoadWaiters.get(screen) || [];
      waiters.push(onReady);
      this.screenLoadWaiters.set(screen, waiters);
    }
    if (this.loadedScreens.has(screen)) return false;
    this.loadedScreens.add(screen);
    const startedAt = Date.now();
    screen.loadAndCreate(() => {
      if (!this.node.isValid) return;
      // 页面在等待加载期间被淘汰/销毁时，迟到回调不能把它标记为就绪
      if (!this.loadedScreens.has(screen)) return;
      this.readyScreens.add(screen);
      if (screen !== this.homeScreen) this.touchResidentScreen(screen);
      this.loadingScreen?.bringToFront();
      this.logColdOpen(screen, startedAt);
      const waiters = this.screenLoadWaiters.get(screen) || [];
      this.screenLoadWaiters.delete(screen);
      waiters.forEach(waiter => waiter());
    });
    return this.readyScreens.has(screen);
  }

  // 预览环境观测（C-3）：冷页面首次打开耗时与当前缓存 SpriteFrame 数量，
  // 仅在编辑器预览渠道输出，不进入线上包日志。
  private logColdOpen(screen: object, startedAt: number) {
    if (!PREVIEW) return;
    const name = (screen as { constructor?: { name?: string } }).constructor?.name ?? 'Screen';
    const isFirst = !this.screenFirstReadyAt.has(name);
    if (!isFirst) return;
    this.screenFirstReadyAt.set(name, Date.now());
    console.log(`[CatWorld][Preview] ${name} 首次就绪 ${Date.now() - startedAt}ms，缓存 SpriteFrame ${this.assets.cachedFrameCount()} 张`);
  }

  // 记录页面为「最近使用」，超出常驻上限就淘汰最久未用的那个。
  // 只有真正访问过且就绪的页面会进入列表；正在加载中的页面不在其中，不会被淘汰。
  private touchResidentScreen(screen: object) {
    if (screen === this.homeScreen) return;
    const index = this.residentScreens.indexOf(screen);
    if (index >= 0) this.residentScreens.splice(index, 1);
    this.residentScreens.unshift(screen);
    while (this.residentScreens.length > Main.RESIDENT_SCREEN_LIMIT) {
      const victim = this.residentScreens.pop();
      if (victim) this.releaseScreen(victim);
    }
  }

  // 淘汰顺序（C-2）：先销毁页面 UI（Screen.destroy 内部停定时器/补间）并清掉 Main
  // 的引用与加载/就绪记录，再按 owner 释放独占图片。共用素材（首页或其他页面
  // 仍引用的图）由 AssetStore 的引用计数保护，不会被误删。
  private releaseScreen(screen: object) {
    if (screen === this.homeScreen) return;
    const destroy = (screen as { destroy?: () => void }).destroy;
    if (typeof destroy === 'function') destroy.call(screen);
    this.clearScreenField(screen);
    this.readyScreens.delete(screen);
    this.loadedScreens.delete(screen);
    this.screenLoadWaiters.delete(screen);
    this.assets.releaseOwner(screen);
  }

  // 淘汰时必须把 Main 持有的引用置空，否则 createXxxScreen() 会因字段非空而不再重建页面。
  private clearScreenField(screen: object) {
    if (this.townScreen === screen) this.townScreen = null;
    else if (this.catCollectionScreen === screen) this.catCollectionScreen = null;
    else if (this.catDetailScreen === screen) this.catDetailScreen = null;
    else if (this.dailyTaskScreen === screen) this.dailyTaskScreen = null;
    else if (this.shopScreen === screen) this.shopScreen = null;
    else if (this.activityScreen === screen) this.activityScreen = null;
    else if (this.momentScreen === screen) this.momentScreen = null;
    else if (this.adventureScreen === screen) this.adventureScreen = null;
    else if (this.rankScreen === screen) this.rankScreen = null;
  }

  // 激活二级页面的统一入口：先把该页面刷到 LRU 头部（可能顺手淘汰更早的隐藏页面），
  // 再显示。重复进入已就绪页面时 loadScreen 不会刷新 LRU，若不在这里补一次 touch，
  // 「当前可见页」可能仍排在队尾，被下一个新页面的就绪回调淘汰释放掉正在使用的资源。
  private showScreen(screen: { setActive: (active: boolean) => void }) {
    this.touchResidentScreen(screen);
    screen.setActive(true);
  }

  private startGame() {
    if (this.startingGame) return;
    if (isCampaignComplete(this.playerStore.getLevel())) {
      Toast.show(this.root, '新主题即将到来');
      return;
    }
    this.startingGame = true;
    this.hideExtraPages();
    this.analytics.track('level_enter_click', {
      mode: 'main',
      level: this.playerStore.getLevel(),
    });
    const level = this.playerStore.getLevel();

    // 通关后直接回小镇（不点“下一关”）时，存档关卡已 +1，而 currentLevelDefinition
    // 还是刚打完的那关：优先顶上预生成的下一关，对不上就作废重生成，
    // 避免拿旧棋盘重打新关卡号。
    if (this.currentLevelDefinition && this.currentLevelDefinition.level !== level) {
      this.currentLevelDefinition = this.nextLevelDefinition?.level === level
        ? this.nextLevelDefinition
        : null;
      this.nextLevelDefinition = null;
    }

    const playPreparedGame = () => {
      if (!this.node.isValid) return;
      if (this.gameScreen?.matchesPreparedLevel(level)) {
        this.homeScreen.setActive(false);
        this.gameScreen.startPlay();
        this.startingGame = false;
        return;
      }
      this.openGame(() => {
        this.homeScreen.setActive(false);
        this.startingGame = false;
      });
    };

    if (this.currentLevelDefinition) {
      playPreparedGame();
      return;
    }

    // 显示加载动画
    this.loadingOverlay = new LoadingOverlay(this.root);
    this.loadingOverlay.show('关卡准备中...');

    this.pauseChallengePreparation();
    this.levelSystem.nextLevelAsync(level, this.seedForLevel(level)).then(levelDefinition => {
      if (!this.node.isValid) return;
      this.currentLevelDefinition = levelDefinition;

      // 隐藏加载动画，进入游戏
      this.loadingOverlay?.hide(() => {
        this.loadingOverlay = null;
        playPreparedGame();
      });
    }).catch(error => {
      console.error('[CatWorld] Failed to prepare level', error);
      this.startingGame = false;

      // 隐藏加载动画，显示错误提示
      this.loadingOverlay?.hide(() => {
        this.loadingOverlay = null;
        this.homeScreen.setActive(true);
        this.homeScreen.toast('关卡准备失败，请稍后再试');
      });
    });
  }

  private openGame(onReady?: () => void, deferStart = false) {
    const level = this.playerStore.getLevel();
    const previous = this.gameScreen;
    previous?.destroy();
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level,
      levelDefinition: this.currentLevelDefinition || undefined,
      getCoins: () => this.playerStore.getCoins(),
      onCoinsChanged: coins => this.playerStore.setCoins(coins),
      onStarsGranted: stars => {
        this.playerStore.addReward({ stars });
        this.playerStore.recordLevelStars(this.playerStore.getLevel(), stars);
        this.advanceMainLevelAfterWin();
      },
      getItemCount: id => this.playerStore.getItemCount(id),
      onConsumeItem: id => this.playerStore.consumeItem(id),
      onToolShareGet: id => this.sharePromoter.shareForTool(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      hasAnyUnlockedCat: () => this.playerStore.hasAnyUnlockedCat(),
      onMainRunStarted: () => {
        this.playerStore.consumeCatTrialGame();
      },
      getCatTrialStatus: () => this.playerStore.getCatTrialStatus(),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      getMusicEnabled: () => this.audio.getMusicEnabled(),
      getSoundEnabled: () => this.audio.getSoundEnabled(),
      getVibrationEnabled: () => this.audio.getVibrationEnabled(),
      onMusicChanged: enabled => this.audio.setMusicEnabled(enabled),
      onSoundChanged: enabled => this.audio.setSoundEnabled(enabled),
      onVibrationChanged: enabled => this.audio.setVibrationEnabled(enabled),
      onPerformance: run => {
        const expLevelBefore = this.playerStore.getExperienceInfo().level;
        this.levelSystem.recordPerformance(run);
        this.playerStore.recordRun(run);
        const expLevelAfter = this.playerStore.getExperienceInfo().level;
        if (expLevelAfter > expLevelBefore) {
          Toast.show(this.root, `恭喜！玩家等级提升至 Lv.${expLevelAfter}`);
        }
      },
      onAdFunnel: event => this.playerStore.recordAdFunnel(event),
      onNextLevel: () => this.nextLevel(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayLevel(),
      // 第 1 关对局内新手教学：仅主线第 1 关且未完成时开启（挑战/无尽不传不触发）
      tutorialEnabled: this.playerStore.getLevel() === 1 && !this.playerStore.isBoardTutorialDone(),
      onTutorialDone: () => this.playerStore.markBoardTutorialDone(),
      shouldShowCollectGoalHint: () => !this.playerStore.isCollectGoalHintDone(),
      onCollectGoalHintShown: () => this.playerStore.markCollectGoalHintDone(),
      getBuildTargetInfo: () => this.playerStore.getNextBuildableInfo(),
      onGoBuild: () => this.goBuildFromGame(),
      onDoubleRewardShare: () => this.sharePromoter.shareForDouble(),
      onReviveShare: () => this.sharePromoter.shareForRevive(),
      onTrack: (name, props) => this.analytics.track(name, props),
      getShareOffer: () => {
        if (level >= MAX_MAIN_LEVEL) {
          return this.sharePromoter.buildShareOffer('campaign_complete', '分享冒险完成 · 领金币×30');
        }
        if (level === 5) {
          return this.sharePromoter.buildShareOffer('level_win', '分享第 5 关通关 · 领金币×30');
        }
        return null;
      },
      onShare: type => this.sharePromoter.shareCard(type),
      deferStart,
    });
    this.gameScreen.loadAndCreate(() => {
      // 新对局资源以自己为 owner 就绪后，再释放旧对局的独占图片；
      // 同关卡共享的图片由引用计数保护不会销毁，重玩不产生整包重载。
      if (previous) this.assets.releaseOwner(previous);
      onReady?.();
    });
  }

  // 结算页「去建设」：记住目标建筑 → 关闭对局回首页 → 直开小镇并选中该建筑
  private goBuildFromGame() {
    const target = this.playerStore.getNextBuildableInfo();
    this.townFocusBuildingId = target?.buildingId ?? null;
    this.returnHomeFromGame();
    this.openTown();
  }

  private consumeTownFocus(): BuildingId | null {
    const id = this.townFocusBuildingId;
    this.townFocusBuildingId = null;
    return id;
  }

  private startCatTrial() {
    const result = this.playerStore.startCatTrial();
    if (!result.ok) {
      Toast.show(this.root, result.message);
      return;
    }
    Toast.show(this.root, '大橘已入住，接下来 3 局可以使用它的技能');
    this.homeScreen.setActive(true);
  }

  // 超萌挑战：固定高压配置，每次进关换新种子，避免记住卡牌位置。
  private startChallenge() {
    if (this.startingGame) return;
    if (!this.playerStore.isChallengeUnlocked()) {
      this.analytics.track('challenge_locked_click', {
        required_level: 6,
        current_level: this.playerStore.getLevel(),
      });
      Toast.show(this.root, '通关第 5 关解锁超萌挑战');
      return;
    }
    this.startingGame = true;
    this.hideExtraPages();
    this.analytics.track('level_enter_click', { mode: 'challenge', level: CHALLENGE_GENERATOR_LEVEL });

    // 如果超萌挑战关卡还未准备好，显示加载动画
    if (!this.challengeLevelDefinition) {
      this.loadingOverlay = new LoadingOverlay(this.root);
      this.loadingOverlay.show('超萌挑战准备中...');

      // 等待关卡准备完成
      const checkReady = () => {
        if (this.challengeLevelDefinition) {
          this.loadingOverlay?.hide(() => {
            this.loadingOverlay = null;
            this.openChallengeGame(() => {
              this.homeScreen.setActive(false);
              this.startingGame = false;
            });
          });
        } else {
          setTimeout(checkReady, 100);
        }
      };

      if (!this.challengePreparing) {
        this.prepareChallengeLevel();
      }
      checkReady();
    } else {
      this.openChallengeGame(() => {
        this.homeScreen.setActive(false);
        this.startingGame = false;
      });
    }
  }

  private nextChallengeSeed() {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
    return seed || 0x6d2b79f5;
  }

  private challengeGenerationOptions(seed: number) {
    return {
      level: CHALLENGE_GENERATOR_LEVEL,
      seed,
      targetDifficulty: CHALLENGE_TARGET_DIFFICULTY,
      role: 'spike' as const,
      slotCapacity: CHALLENGE_TRAY_SLOTS,
      fullTrayPressure: true,
    };
  }

  private prepareChallengeLevel(seed = this.nextChallengeSeed()) {
    if (!this.playerStore.isChallengeUnlocked()) return;
    const token = ++this.challengePrepareToken;
    this.challengePreparing = true;
    this.levelSystem.generator.generateAsync(this.challengeGenerationOptions(seed)).then(definition => {
      if (!this.node.isValid || token !== this.challengePrepareToken) return;
      this.challengePreparing = false;
      this.challengeLevelDefinition = definition;
      this.gameScreen?.applyLevelDefinition(definition);
      // 顺手预生成一份备用关卡，供「再玩一次」直接换牌，
      // 避免每次重玩都要等一次完整的 48 次候选搜索（实测 108ms，低端机 0.5~1.8s）。
      this.prepareChallengeSpare();
    }).catch(error => {
      if (error?.name === 'AsyncGenerationCancelledError') return;
      console.error('[CatWorld] Failed to prepare challenge level', error);
      if (!this.node.isValid || token !== this.challengePrepareToken) return;
      this.challengePreparing = false;
      if (this.gameScreen && !this.challengeLevelDefinition) {
        this.returnHomeFromGame();
        Toast.show(this.root, '超萌挑战准备失败，请稍后再试');
      }
    });
  }

  // 预生成一份超萌挑战备用关卡。每次都是新种子，保持「每次进关换元素排布、
  // 不让玩家记住卡牌位置」的既有设计；只是把这份等待提前到玩家还在玩的时候。
  private prepareChallengeSpare() {
    if (!this.node.isValid || this.challengeSpareDefinition || this.challengeSparePreparing) return;
    const token = ++this.challengeSpareToken;
    this.challengeSparePreparing = true;
    this.levelSystem.generator.generateAsync(this.challengeGenerationOptions(this.nextChallengeSeed()))
      .then(definition => {
        if (!this.node.isValid || token !== this.challengeSpareToken) return;
        this.challengeSparePreparing = false;
        this.challengeSpareDefinition = definition;
      })
      .catch(error => {
        if (error?.name === 'AsyncGenerationCancelledError') return;
        console.error('[CatWorld] Failed to prepare challenge spare', error);
        if (!this.node.isValid || token !== this.challengeSpareToken) return;
        this.challengeSparePreparing = false;
      });
  }

  private openChallengeGame(onReady?: () => void) {
    const previous = this.gameScreen;
    previous?.destroy();
    // 大奖每日限领一次：当天已领过就按普通过关金币发放
    const challengeCoinReward = this.playerStore.isChallengeRewardClaimed()
      ? CHALLENGE_REPEAT_COIN_REWARD
      : CHALLENGE_COIN_REWARD;
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level: CHALLENGE_GENERATOR_LEVEL,
      // 超萌挑战不属于任何主题，强制使用通用元素皮肤
      theme: -1,
      levelDefinition: this.challengeLevelDefinition || undefined,
      challenge: { coinReward: challengeCoinReward },
      traySlots: CHALLENGE_TRAY_SLOTS,
      getCoins: () => this.playerStore.getCoins(),
      onCoinsChanged: coins => this.playerStore.setCoins(coins),
      onStarsGranted: () => {},
      onChallengeWin: durationMs => {
        this.playerStore.markChallengeRewardClaimed();
        this.profile.submitChallenge(durationMs);
      },
      getItemCount: id => this.playerStore.getItemCount(id),
      onConsumeItem: id => this.playerStore.consumeItem(id),
      onToolShareGet: id => this.sharePromoter.shareForTool(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(false),
      hasAnyUnlockedCat: () => this.playerStore.hasAnyUnlockedCat(false),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      getMusicEnabled: () => this.audio.getMusicEnabled(),
      getSoundEnabled: () => this.audio.getSoundEnabled(),
      getVibrationEnabled: () => this.audio.getVibrationEnabled(),
      onMusicChanged: enabled => this.audio.setMusicEnabled(enabled),
      onSoundChanged: enabled => this.audio.setSoundEnabled(enabled),
      onVibrationChanged: enabled => this.audio.setVibrationEnabled(enabled),
      onPerformance: () => {},
      onNextLevel: () => this.returnHomeFromGame(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayChallenge(),
      onReviveShare: () => this.sharePromoter.shareForRevive(),
      onDoubleRewardShare: () => this.sharePromoter.shareForDouble(),
      onTrack: (name, props) => this.analytics.track(name, props),
      getShareOffer: () => this.sharePromoter.buildShareOffer('challenge_record', '分享挑战成果 · 领金币×30'),
      onShare: type => this.sharePromoter.shareCard(type),
    });
    this.gameScreen.loadAndCreate(() => {
      if (previous) this.assets.releaseOwner(previous);
      onReady?.();
    });
  }

  // 重试换一副元素排布（难度曲线不变）；压满模式要跑完全部尝试挑最残酷棋盘，
  // 改走异步避免卡住结算弹窗所在的 UI 线程
  private startEndless() {
    if (this.startingGame) return;
    if (!this.playerStore.isEndlessUnlocked()) {
      Toast.show(this.root, '先通关第 1 关再来挑战无尽');
      return;
    }
    this.startingGame = true;
    this.hideExtraPages();
    this.analytics.track('level_enter_click', { mode: 'endless' });
    this.openEndlessGame(() => {
      this.homeScreen.setActive(false);
      this.startingGame = false;
    });
  }

  private openEndlessGame(onReady?: () => void) {
    const previous = this.gameScreen;
    previous?.destroy();
    const endlessSeed = (Date.now() ^ 0x45e21a9b) | 0;
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level: this.playerStore.getLevel(),
      theme: -1,
      endless: {
        seed: endlessSeed,
        bestEliminated: this.playerStore.getEndlessProgress().bestEliminated,
        onFinish: result => {
          const recorded = this.playerStore.recordEndlessRun(result);
          this.profile.submitEndless(result.eliminated, result.durationMs);
          return recorded;
        },
      },
      getCoins: () => this.playerStore.getCoins(),
      onCoinsChanged: coins => this.playerStore.setCoins(coins),
      onStarsGranted: () => {},
      getItemCount: id => this.playerStore.getItemCount(id),
      onConsumeItem: id => this.playerStore.consumeItem(id),
      onToolShareGet: id => this.sharePromoter.shareForTool(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(false),
      hasAnyUnlockedCat: () => this.playerStore.hasAnyUnlockedCat(false),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      getMusicEnabled: () => this.audio.getMusicEnabled(),
      getSoundEnabled: () => this.audio.getSoundEnabled(),
      getVibrationEnabled: () => this.audio.getVibrationEnabled(),
      onMusicChanged: enabled => this.audio.setMusicEnabled(enabled),
      onSoundChanged: enabled => this.audio.setSoundEnabled(enabled),
      onVibrationChanged: enabled => this.audio.setVibrationEnabled(enabled),
      onPerformance: () => {},
      onNextLevel: () => this.returnHomeFromGame(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayEndless(),
      onDoubleRewardShare: () => this.sharePromoter.shareForDouble(),
      onTrack: (name, props) => this.analytics.track(name, props),
      getShareOffer: context => context?.isNewRecord
        ? this.sharePromoter.buildShareOffer('endless_record', '分享新纪录 · 领金币×30')
        : null,
      onShare: type => this.sharePromoter.shareCard(type),
    });
    this.gameScreen.loadAndCreate(() => {
      if (previous) this.assets.releaseOwner(previous);
      onReady?.();
    });
  }

  private replayEndless() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.openEndlessGame(() => {
      this.startingGame = false;
    });
  }

  // 重试只换元素排布：优先直接用后台预生成的备用关卡，实现秒换；
  // 备用还没好时退回原路径（进空棋盘并显示加载，等高压候选跑完再发牌）。
  private replayChallenge() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.pauseChallengePreparation();

    const spare = this.challengeSpareDefinition;
    if (spare) {
      this.challengeSpareDefinition = null;
      this.challengeLevelDefinition = spare;
      this.openChallengeGame(() => {
        this.startingGame = false;
      });
      this.prepareChallengeSpare();
      return;
    }

    this.challengeLevelDefinition = null;
    this.openChallengeGame(() => {
      this.startingGame = false;
    });
    this.prepareChallengeLevel();
  }

  private openCatCollection() {
    // 按需创建页面
    if (!this.catCollectionScreen) {
      this.createCatCollectionScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.catCollectionScreen!)) {
      // 防止重复创建loading
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('猫咪社准备中...');
      }
    }

    if (!this.loadScreen(this.catCollectionScreen!, () => {
      // 资源加载完成，隐藏加载动画，打开页面
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openCatCollection();
        });
      } else {
        this.openCatCollection();
      }
    })) return;

    // 资源已就绪，确保loading被清除，直接打开
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.adventureScreen?.setActive(false);
    this.homeScreen.setActive(false);
    this.catDetailScreen?.setActive(false);
    this.dailyTaskScreen?.setActive(false);
    this.shopScreen?.setActive(false);
    this.activityScreen?.setActive(false);
    this.momentScreen?.setActive(false);
    this.showScreen(this.catCollectionScreen!);
    this.trackPage('cats');
  }

  private openCatDetail(id: CatId) {
    // 按需创建页面
    if (!this.catDetailScreen) {
      this.createCatDetailScreen();
    }
    if (!this.loadScreen(this.catDetailScreen!, () => this.openCatDetail(id))) return;
    this.catCollectionScreen?.setActive(false);
    this.catDetailScreen!.setCat(id);
    this.showScreen(this.catDetailScreen!);
    this.trackPage('cat_detail');
  }

  private returnToCatCollection() {
    this.catDetailScreen?.setActive(false);
    this.catCollectionScreen?.setActive(true);
    this.trackPage('cats');
  }

  private openDailyTasks() {
    // 按需创建页面
    if (!this.dailyTaskScreen) {
      this.createDailyTaskScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.dailyTaskScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('每日任务准备中...');
      }
    }

    if (!this.loadScreen(this.dailyTaskScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openDailyTasks();
        });
      } else {
        this.openDailyTasks();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.adventureScreen?.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen?.setActive(false);
    this.catDetailScreen?.setActive(false);
    this.shopScreen?.setActive(false);
    this.activityScreen?.setActive(false);
    this.momentScreen?.setActive(false);
    this.showScreen(this.dailyTaskScreen!);
    this.trackPage('daily');
  }

  private openShop() {
    // 按需创建页面
    if (!this.shopScreen) {
      this.createShopScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.shopScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('商店准备中...');
      }
    }

    if (!this.loadScreen(this.shopScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openShop();
        });
      } else {
        this.openShop();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.adventureScreen?.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen?.setActive(false);
    this.catDetailScreen?.setActive(false);
    this.dailyTaskScreen?.setActive(false);
    this.activityScreen?.setActive(false);
    this.momentScreen?.setActive(false);
    this.showScreen(this.shopScreen!);
    this.trackPage('shop');
  }

  private openActivity() {
    // 按需创建页面
    if (!this.activityScreen) {
      this.createActivityScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.activityScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('活动页面准备中...');
      }
    }

    if (!this.loadScreen(this.activityScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openActivity();
        });
      } else {
        this.openActivity();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.adventureScreen?.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen?.setActive(false);
    this.catDetailScreen?.setActive(false);
    this.dailyTaskScreen?.setActive(false);
    this.shopScreen?.setActive(false);
    this.momentScreen?.setActive(false);
    this.showScreen(this.activityScreen!);
    this.trackPage('activity');
  }

  private openMoments() {
    // 按需创建页面
    if (!this.momentScreen) {
      this.createMomentScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.momentScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('点滴页面准备中...');
      }
    }

    if (!this.loadScreen(this.momentScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openMoments();
        });
      } else {
        this.openMoments();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.showScreen(this.momentScreen!);
    this.trackPage('moments');
  }

  private openAdventure() {
    // 按需创建页面
    if (!this.adventureScreen) {
      this.createAdventureScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.adventureScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('冒险页面准备中...');
      }
    }

    if (!this.loadScreen(this.adventureScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openAdventure();
        });
      } else {
        this.openAdventure();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.showScreen(this.adventureScreen!);
    this.trackPage('adventure');
  }

  private openRank() {
    // 按需创建页面
    if (!this.rankScreen) {
      this.createRankScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.rankScreen!)) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('排行榜准备中...');
      }
    }

    if (!this.loadScreen(this.rankScreen!, () => {
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openRank();
        });
      } else {
        this.openRank();
      }
    })) return;

    // 资源已就绪，确保loading被清除
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.showScreen(this.rankScreen!);
    this.trackPage('rank');
  }

  private returnHomeFromExtraPage() {
    this.hideExtraPages();
    this.homeScreen.setActive(true);
    this.trackPage('home');
  }

  private returnHomeFromGame() {
    this.startingGame = false;
    if (this.gameScreen) {
      this.gameScreen.destroy();
      // 离开对局即释放对局独占图片；当前关卡的预热资源（levelPreloadOwner）保留
      this.assets.releaseOwner(this.gameScreen);
      this.gameScreen = null;
    }
    // 有备用就直接顶上，回到首页后再进挑战无需等待生成；
    // resumeChallengePreparation() 会补一份新的备用。
    this.challengeLevelDefinition = this.challengeSpareDefinition;
    this.challengeSpareDefinition = null;
    this.hideExtraPages();
    this.homeScreen.setActive(true);
    this.trackPage('home');
    this.resumeChallengePreparation();
  }

  private closeGameAndTown() {
    this.discardActiveGame();
    this.townScreen?.setActive(false);
  }

  private discardActiveGame() {
    if (!this.gameScreen?.hasStartedPlay()) return;
    this.startingGame = false;
    this.gameScreen.destroy();
    this.assets.releaseOwner(this.gameScreen);
    this.gameScreen = null;
  }

  private hideExtraPages() {
    this.catCollectionScreen?.setActive(false);
    this.catDetailScreen?.setActive(false);
    this.dailyTaskScreen?.setActive(false);
    this.shopScreen?.setActive(false);
    this.activityScreen?.setActive(false);
    this.momentScreen?.setActive(false);
    this.adventureScreen?.setActive(false);
    this.rankScreen?.setActive(false);
    this.townScreen?.setActive(false);
  }

  onDestroy() {
    if (Main.instance === this) Main.instance = null;
    this.screenLoadWaiters.clear();
    this.readyScreens.clear();
    this.residentScreens.length = 0;
    this.loadingScreen?.destroy();
    this.loadingScreen = null;
    this.loadingOverlay?.destroy();
    this.loadingOverlay = null;
    this.gameScreen?.destroy();
    this.gameScreen = null;
    this.homeScreen?.destroy();
    this.townScreen?.destroy();
    this.catCollectionScreen?.destroy();
    this.catDetailScreen?.destroy();
    this.dailyTaskScreen?.destroy();
    this.shopScreen?.destroy();
    this.activityScreen?.destroy();
    this.momentScreen?.destroy();
    this.adventureScreen?.destroy();
    this.rankScreen?.destroy();
  }

  private openTown() {
    // 按需创建页面
    if (!this.townScreen) {
      this.createTownScreen();
    }

    // 如果资源还在加载中，显示加载动画
    if (!this.readyScreens.has(this.townScreen!)) {
      // 防止重复创建loading
      if (!this.loadingOverlay) {
        this.loadingOverlay = new LoadingOverlay(this.root);
        this.loadingOverlay.show('小镇准备中...');
      }
    }

    if (!this.loadScreen(this.townScreen!, () => {
      // 资源加载完成，隐藏加载动画，打开页面
      if (this.loadingOverlay) {
        this.loadingOverlay.hide(() => {
          this.loadingOverlay = null;
          this.openTown();
        });
      } else {
        this.openTown();
      }
    })) return;

    // 资源已就绪，确保loading被清除，直接打开
    if (this.loadingOverlay) {
      this.loadingOverlay.destroy();
      this.loadingOverlay = null;
    }

    this.discardActiveGame();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.showScreen(this.townScreen!);
    this.trackPage('town');
  }

  private returnHome() {
    this.townScreen?.setActive(false);
    this.homeScreen.setActive(true);
    this.trackPage('home');
  }

  private replayLevel() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.pauseChallengePreparation();
    const current = this.currentLevelDefinition;
    if (!current) {
      this.openGame(() => {
        this.startingGame = false;
      });
      return;
    }
    this.pauseNextLevelPreparation();
    this.levelSystem.retryLevelAsync(
      current,
      this.seedForLevel(current.level + Date.now()),
    ).then(definition => {
      if (!this.node.isValid) return;
      this.currentLevelDefinition = definition;
      if (!this.startingGame) return;
      this.openGame(() => {
        this.startingGame = false;
      });
    }).catch(error => {
      console.error('[CatWorld] Failed to retry level', error);
      this.startingGame = false;
      Toast.show(this.root, '关卡准备失败，请稍后再试');
    });
  }

  private nextLevel() {
    if (this.startingGame) return;
    if (isCampaignComplete(this.playerStore.getLevel())) {
      this.returnHomeFromGame();
      Toast.show(this.root, '新主题即将到来');
      return;
    }
    this.startingGame = true;
    this.pauseChallengePreparation();
    const level = this.playerStore.getLevel();
    const playPrepared = (definition: LevelDefinition) => {
      if (!this.node.isValid || !this.startingGame) return;
      this.currentLevelDefinition = definition;
      this.nextLevelDefinition = null;
      this.openGame(() => {
        this.startingGame = false;
      });
    };

    // 只消费与当前存档关卡一致的定义，防止过期的预生成结果把玩家带回旧关卡
    if (this.nextLevelDefinition?.level === level) {
      playPrepared(this.nextLevelDefinition);
      return;
    }
    this.nextLevelDefinition = null;

    this.prepareNextMainLevel(level, definition => playPrepared(definition), true);
  }

  private advanceMainLevelAfterWin() {
    const clearedLevel = this.playerStore.getLevel();
    this.playerStore.setLevel(clearedLevel + 1);
    this.profile.submitLevelBest();
    if (!isCampaignComplete(this.playerStore.getLevel())) {
      this.prepareNextMainLevel(this.playerStore.getLevel());
    }
  }

  private prepareNextMainLevel(
    level: number,
    onReady?: (definition: LevelDefinition) => void,
    showFailureToast = false,
  ) {
    if (isCampaignComplete(level)) {
      this.nextLevelDefinition = null;
      return;
    }
    if (this.nextLevelPreparing) {
      if (onReady) this.nextLevelReadyWaiters.push(onReady);
      return;
    }
    const token = ++this.nextLevelPrepareToken;
    this.nextLevelPreparing = true;
    this.levelSystem.nextLevelAsync(level, this.seedForLevel(level)).then(definition => {
      if (!this.node.isValid || token !== this.nextLevelPrepareToken) return;
      this.nextLevelPreparing = false;
      this.nextLevelDefinition = definition;
      const waiters = this.nextLevelReadyWaiters.splice(0);
      onReady?.(definition);
      waiters.forEach(waiter => waiter(definition));
    }).catch(error => {
      if (error?.name === 'AsyncGenerationCancelledError') return;
      console.error('[CatWorld] Failed to prepare next level', error);
      if (!this.node.isValid || token !== this.nextLevelPrepareToken) return;
      this.nextLevelPreparing = false;
      this.nextLevelDefinition = null;
      this.nextLevelReadyWaiters.length = 0;
      if (onReady) {
        this.startingGame = false;
        if (showFailureToast) Toast.show(this.root, '下一关准备失败，请稍后再试');
      }
    });
  }

  private seedForLevel(level: number) {
    return (0x4d595841 + Math.imul(level, 7919)) | 0;
  }

  private pauseNextLevelPreparation() {
    if (!this.nextLevelPreparing) return;
    this.nextLevelPrepareToken += 1;
    this.nextLevelPreparing = false;
    this.levelSystem.generator.cancelAsync();
  }

  private pauseChallengePreparation() {
    if (!this.challengePreparing && !this.challengeSparePreparing) return;
    this.challengePrepareToken += 1;
    this.challengeSpareToken += 1;
    this.challengePreparing = false;
    this.challengeSparePreparing = false;
    this.levelSystem.generator.cancelAsync();
  }

  private resumeChallengePreparation() {
    if (!this.playerStore.isChallengeUnlocked()) return;
    if (this.nextLevelPreparing || this.challengePreparing) return;
    if (!this.challengeLevelDefinition) {
      this.prepareChallengeLevel();
      return;
    }
    this.prepareChallengeSpare();
  }
}
