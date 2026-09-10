import { _decorator, Component, Node, ResolutionPolicy, view } from 'cc';
import { ActivityScreen } from './ActivityScreen';
import { AssetStore } from './AssetStore';
import { CatCollectionScreen } from './CatCollectionScreen';
import { CatDetailScreen } from './CatDetailScreen';
import { DailyTaskScreen } from './DailyTaskScreen';
import { GameScreen, buildGameScreenImagePaths } from './GameScreen';
import { HomeScreen, buildHomeScreenImagePaths } from './HomeScreen';
import { PlayerStore } from './PlayerStore';
import { LEVELS_PER_THEME } from './TownContent';
import { ShopScreen } from './ShopScreen';
import { TownScreen } from './TownScreen';
import { CatId } from './PlayerTypes';
import { LevelSystem } from './level/LevelSystem';
import { LevelDefinition } from './level/LevelTypes';
import { LoadingScreen } from './LoadingScreen';
import { AudioManager } from './AudioManager';
import { LeaderboardService } from './LeaderboardService';
import { RankScreen } from './RankScreen';
import { RewardedAdService } from './RewardedAdService';
import { Toast } from './Toast';
import { MomentScreen } from './MomentScreen';
import { AdventureScreen, THEME_INFO } from './AdventureScreen';

const { ccclass, property } = _decorator;

// 超萌挑战：首页入口的固定单关，对标"羊了个羊第二关"——
// spike 压力原型把牌量压到普通关一半左右（约 45~55 张）配满额 15 种元素、6～7 层深堆，
// 收集槽缩到 5 格（额外槽位道具可 +1）；fullTrayPressure 贴满压力规划：
// 最优路径长期骑在 4/5 满槽边缘、无放松段，并按残酷度挑选候选；
// 每日首次通关发大额金币，同日重复通关只发普通过关金币；
// 不发星星、不写入难度自适应（避免挑战连败触发普通关的救援难度）。
const CHALLENGE_LEVEL_NUMBER = 100;
const CHALLENGE_SEED = 987654321;
const CHALLENGE_TARGET_DIFFICULTY = 100;
const CHALLENGE_TRAY_SLOTS = 5;
const CHALLENGE_COIN_REWARD = 2000;
const CHALLENGE_REPEAT_COIN_REWARD = 50;

@ccclass('Main')
export class Main extends Component {
  @property({ tooltip: '微信小游戏激励视频广告位 ID；编辑器预览会自动模拟广告完成' })
  rewardedAdUnitId = '';

  private static instance: Main | null = null;
  private root!: Node;
  private readonly assets = new AssetStore();
  private readonly levelSystem = new LevelSystem();
  private readonly playerStore = new PlayerStore();
  private readonly leaderboard = new LeaderboardService();
  private audio!: AudioManager;
  private rewardedAd!: RewardedAdService;
  private homeScreen!: HomeScreen;
  private townScreen!: TownScreen;
  private catCollectionScreen!: CatCollectionScreen;
  private catDetailScreen!: CatDetailScreen;
  private dailyTaskScreen!: DailyTaskScreen;
  private shopScreen!: ShopScreen;
  private activityScreen!: ActivityScreen;
  private momentScreen!: MomentScreen;
  private adventureScreen!: AdventureScreen;
  private rankScreen!: RankScreen;
  private gameScreen: GameScreen | null = null;
  private loadingScreen: LoadingScreen | null = null;
  private currentLevelDefinition: LevelDefinition | null = null;
  private nextLevelDefinition: LevelDefinition | null = null;
  private nextLevelPrepareToken = 0;
  private nextLevelPreparing = false;
  private readonly nextLevelReadyWaiters: Array<(definition: LevelDefinition) => void> = [];
  private challengeLevelDefinition: LevelDefinition | null = null;
  private challengePrepareToken = 0;
  private challengePreparing = false;
  private startingGame = false;
  private readonly loadedScreens = new Set<object>();
  private readonly readyScreens = new Set<object>();
  private readonly screenLoadWaiters = new Map<object, Array<() => void>>();

  onLoad() {
    // Protect startup when a stale scene cache contains duplicate Main components.
    if (Main.instance) {
      this.enabled = false;
      return;
    }
    Main.instance = this;
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    this.playerStore.load();
    this.levelSystem.seedRuns(this.playerStore.getRecentRuns());
    this.root = new Node('CatTownRoot');
    this.node.addChild(this.root);
    this.audio = new AudioManager(this.node);
    this.audio.load();
    this.rewardedAd = new RewardedAdService(this.rewardedAdUnitId);

    // 加载页先亮起来，进度条走完前必须把首页和当前关卡都准备好。
    this.loadingScreen = new LoadingScreen(this.root, this.assets, {
      onFinish: () => this.enterHome(),
    });
    this.loadingScreen.loadAndCreate(() => this.beginPrimaryLoad());
  }

  private createScreens() {
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
      challengeCoinReward: CHALLENGE_COIN_REWARD,
      isChallengeRewardClaimed: () => this.playerStore.isChallengeRewardClaimed(),
      onOpenTown: () => this.openTown(),
      onOpenCatCollection: () => this.openCatCollection(),
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
        return claimable + (chestReady ? 1 : 0);
      },
      // 首页章节横幅：关卡号与主题内通关数实时取主线进度（每通一关都会变化），
      // 主题名按关卡所在冒险主题（每 20 关一章）；回首页 setActive 时统一刷新
      getChapterInfo: () => {
        const level = this.playerStore.getLevel();
        const index = Math.min(THEME_INFO.length - 1, Math.floor((level - 1) / LEVELS_PER_THEME));
        const clearedInTheme = Math.max(
          0,
          Math.min(LEVELS_PER_THEME, level - 1 - index * LEVELS_PER_THEME),
        );
        return {
          level,
          name: THEME_INFO[index].name,
          clearedInTheme,
          levelsPerTheme: LEVELS_PER_THEME,
        };
      },
    });

    this.townScreen = new TownScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getStars: () => this.playerStore.getStars(),
      getCoins: () => this.playerStore.getCoins(),
      getBuildings: () => this.playerStore.getBuildingViews(),
      onBuild: id => this.playerStore.buildBuildingStage(id),
      onReturnHome: () => this.returnHome(),
    });

    this.catCollectionScreen = new CatCollectionScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCats: () => this.playerStore.getState().cats,
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      onOpenCat: id => this.openCatDetail(id),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });

    this.catDetailScreen = new CatDetailScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCoins: () => this.playerStore.getCoins(),
      getCat: id => this.playerStore.getCat(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      onInteract: (id, interaction) => this.playerStore.interactWithCat(id, interaction),
      onUpgrade: id => this.playerStore.upgradeCat(id),
      onEquip: id => this.playerStore.equipCat(id),
      onReturnCollection: () => this.returnToCatCollection(),
    });

    this.dailyTaskScreen = new DailyTaskScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getDateKey: () => this.playerStore.getDailyDateKey(),
      getTasks: () => this.playerStore.getTasks(),
      isChestReady: () => this.playerStore.isDailyChestReady(),
      isChestClaimed: () => this.playerStore.isDailyChestClaimed(),
      onClaimTask: id => this.playerStore.claimTask(id),
      onClaimChest: () => this.playerStore.claimDailyChest(),
      onStartGame: () => this.startGame(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });

    this.shopScreen = new ShopScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getCoins: () => this.playerStore.getCoins(),
      getItemCount: id => this.playerStore.getItemCount(id),
      onBuyItem: id => this.playerStore.buyItem(id),
      getShopItemStatus: id => this.playerStore.getShopItemStatus(id),
      onClaimItemByAd: id => this.playerStore.claimItemByAd(id),
      onWatchAd: () => this.rewardedAd.watch(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });

    this.activityScreen = new ActivityScreen(this.root, this.assets, {
      getActivity: () => this.playerStore.getActivitySnapshot(),
      onClaimTask: id => this.playerStore.claimActivityTask(id),
      onClaimReward: id => this.playerStore.claimActivityReward(id),
      onStartGame: () => this.startGame(),
      onPlaySound: effect => this.audio.playEffect(effect),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });

    this.momentScreen = new MomentScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      getMoments: () => this.playerStore.getMoments(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });

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

    this.rankScreen = new RankScreen(this.root, this.assets, {
      onPlaySound: effect => this.audio.playEffect(effect),
      fetchEntries: tab => this.leaderboard.fetchBoard(
        tab,
        this.playerStore.getUserId(),
        tab === 'challenge' ? this.playerStore.getDailyDateKey() : undefined,
      ),
      onInvite: () => this.leaderboard.invite(),
      onReturnHome: () => this.returnHomeFromExtraPage(),
    });
  }

  private beginPrimaryLoad() {
    if (!this.node.isValid) return;
    this.createScreens();
    this.loadingScreen?.bringToFront();

    const level = this.playerStore.getLevel();
    const primaryPaths = Array.from(new Set([
      ...buildHomeScreenImagePaths(),
      ...buildGameScreenImagePaths(level),
    ]));

    let imagesReady = false;
    let profileReady = this.playerStore.hasProfile();
    let levelReady = false;
    let levelFailed = false;
    let homeReady = false;
    let homeLoading = false;
    let gameReady = false;
    let finished = false;

    const updateProgress = () => {
      let progress = 0;
      if (imagesReady) progress += 0.6;
      if (profileReady) progress += 0.1;
      if (homeReady) progress += 0.15;
      if (gameReady || levelFailed) progress += 0.15;
      this.loadingScreen?.setProgress(progress);
    };

    const maybeFinish = () => {
      if (finished || !profileReady || !homeReady || !(gameReady || levelFailed)) return;
      finished = true;
      this.preloadSecondaryScreens();
      this.loadingScreen?.finish();
    };

    const maybeCreatePages = () => {
      if (!this.node.isValid) return;
      if (imagesReady && !homeReady && !homeLoading) {
        homeLoading = true;
        this.loadScreen(this.homeScreen, () => {
          homeReady = true;
          this.loadingScreen?.bringToFront();
          updateProgress();
          maybeFinish();
        });
      }
      if (imagesReady && levelReady && !gameReady && !this.gameScreen) {
        this.openGame(() => {
          gameReady = true;
          this.loadingScreen?.bringToFront();
          updateProgress();
          maybeFinish();
        }, true);
        this.loadingScreen?.bringToFront();
      }
      if (imagesReady && levelFailed) {
        updateProgress();
        maybeFinish();
      }
    };

    this.ensureRemoteProfile().then(() => {
      if (!this.node.isValid) return;
      profileReady = true;
      updateProgress();
      maybeFinish();
    });

    this.assets.loadImages(
      primaryPaths,
      () => {
        if (!this.node.isValid) return;
        imagesReady = true;
        updateProgress();
        maybeCreatePages();
      },
      (loaded, total) => {
        const imageShare = total > 0 ? loaded / total : 1;
        this.loadingScreen?.setProgress(imageShare * 0.6);
      },
    );

    this.levelSystem.nextLevelAsync(level, this.seedForLevel(level)).then(definition => {
      if (!this.node.isValid) return;
      this.currentLevelDefinition = definition;
      levelReady = true;
      maybeCreatePages();
    }).catch(error => {
      console.error('[CatWorld] Failed to prepare level', error);
      if (!this.node.isValid) return;
      levelFailed = true;
      maybeCreatePages();
    });
  }

  private enterHome() {
    this.homeScreen.setActive(true);
    this.loadingScreen?.destroy();
    this.loadingScreen = null;
  }

  // 首页和关卡就绪后立刻按入口优先级预建其余页面，不再等用户点菜单才拉远程图。
  // 设置/玩法介绍 → 小镇 → 商店 → 冒险 → 每日任务 → 排行榜 → 猫咪社/详情 → 活动 → 点滴。
  private preloadSecondaryScreens() {
    this.homeScreen.preloadOverlays();
    if (!this.challengeLevelDefinition && !this.challengePreparing) {
      this.prepareChallengeLevel();
    }
    this.preloadScreenQueue([
      this.townScreen,
      this.shopScreen,
      this.adventureScreen,
      this.dailyTaskScreen,
      this.rankScreen,
      this.catCollectionScreen,
      this.catDetailScreen,
      this.activityScreen,
      this.momentScreen,
    ], 0);
  }

  private preloadScreenQueue(
    screens: Array<{ loadAndCreate: (onReady?: () => void) => void }>,
    index: number,
  ) {
    if (!this.node.isValid || index >= screens.length) return;
    const screen = screens[index];
    const continueNext = () => this.preloadScreenQueue(screens, index + 1);
    if (this.readyScreens.has(screen)) {
      continueNext();
      return;
    }
    this.loadScreen(screen, continueNext);
  }

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
    screen.loadAndCreate(() => {
      if (!this.node.isValid) return;
      this.readyScreens.add(screen);
      this.loadingScreen?.bringToFront();
      const waiters = this.screenLoadWaiters.get(screen) || [];
      this.screenLoadWaiters.delete(screen);
      waiters.forEach(waiter => waiter());
    });
    return this.readyScreens.has(screen);
  }

  private startGame() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.hideExtraPages();
    const level = this.playerStore.getLevel();

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

    this.pauseChallengePreparation();
    this.levelSystem.nextLevelAsync(level, this.seedForLevel(level)).then(levelDefinition => {
      if (!this.node.isValid) return;
      this.currentLevelDefinition = levelDefinition;
      playPreparedGame();
    }).catch(error => {
      console.error('[CatWorld] Failed to prepare level', error);
      this.startingGame = false;
      this.homeScreen.setActive(true);
    });
  }

  private openGame(onReady?: () => void, deferStart = false) {
    this.gameScreen?.destroy();
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level: this.playerStore.getLevel(),
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
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      onPerformance: run => {
        const expLevelBefore = this.playerStore.getExperienceInfo().level;
        this.levelSystem.recordPerformance(run);
        this.playerStore.recordRun(run);
        const expLevelAfter = this.playerStore.getExperienceInfo().level;
        if (expLevelAfter > expLevelBefore) {
          Toast.show(this.root, `恭喜！玩家等级提升至 Lv.${expLevelAfter}`);
        }
      },
      onNextLevel: () => this.nextLevel(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayLevel(),
      onWatchAd: () => this.rewardedAd.watch(),
      deferStart,
    });
    this.gameScreen.loadAndCreate(onReady);
  }

  // 超萌挑战：固定种子的单一超高难度关卡；重试时只换元素排布，难度曲线不变
  private startChallenge() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.hideExtraPages();
    this.openChallengeGame(() => {
      this.homeScreen.setActive(false);
      this.startingGame = false;
    });
    if (!this.challengeLevelDefinition && !this.challengePreparing) {
      this.prepareChallengeLevel();
    }
  }

  private challengeGenerationOptions(seed = CHALLENGE_SEED) {
    return {
      level: CHALLENGE_LEVEL_NUMBER,
      seed,
      targetDifficulty: CHALLENGE_TARGET_DIFFICULTY,
      role: 'spike' as const,
      slotCapacity: CHALLENGE_TRAY_SLOTS,
      fullTrayPressure: true,
    };
  }

  private prepareChallengeLevel(seed = CHALLENGE_SEED) {
    const token = ++this.challengePrepareToken;
    this.challengePreparing = true;
    this.levelSystem.generator.generateAsync(this.challengeGenerationOptions(seed)).then(definition => {
      if (!this.node.isValid || token !== this.challengePrepareToken) return;
      this.challengePreparing = false;
      this.challengeLevelDefinition = definition;
      this.gameScreen?.applyLevelDefinition(definition);
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

  private openChallengeGame(onReady?: () => void) {
    this.gameScreen?.destroy();
    // 大奖每日限领一次：当天已领过就按普通过关金币发放
    const challengeCoinReward = this.playerStore.isChallengeRewardClaimed()
      ? CHALLENGE_REPEAT_COIN_REWARD
      : CHALLENGE_COIN_REWARD;
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level: CHALLENGE_LEVEL_NUMBER,
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
        this.submitChallengeRank(durationMs);
      },
      getItemCount: id => this.playerStore.getItemCount(id),
      onConsumeItem: id => this.playerStore.consumeItem(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      onPerformance: () => {},
      onNextLevel: () => this.returnHomeFromGame(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayChallenge(),
      onWatchAd: () => this.rewardedAd.watch(),
    });
    this.gameScreen.loadAndCreate(onReady);
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
    this.openEndlessGame(() => {
      this.homeScreen.setActive(false);
      this.startingGame = false;
    });
  }

  private openEndlessGame(onReady?: () => void) {
    this.gameScreen?.destroy();
    const endlessSeed = (Date.now() ^ 0x45e21a9b) | 0;
    this.gameScreen = new GameScreen(this.root, this.assets, {
      level: this.playerStore.getLevel(),
      theme: -1,
      endless: {
        seed: endlessSeed,
        bestEliminated: this.playerStore.getEndlessProgress().bestEliminated,
        onFinish: result => {
          const recorded = this.playerStore.recordEndlessRun(result);
          this.submitEndlessRank(result.eliminated, result.durationMs);
          return recorded;
        },
      },
      getCoins: () => this.playerStore.getCoins(),
      onCoinsChanged: coins => this.playerStore.setCoins(coins),
      onStarsGranted: () => {},
      getItemCount: id => this.playerStore.getItemCount(id),
      onConsumeItem: id => this.playerStore.consumeItem(id),
      getEquippedCat: () => this.playerStore.getEquippedCat(),
      getGamePetPosition: () => this.playerStore.getGamePetPosition(),
      onGamePetPositionChanged: position => this.playerStore.setGamePetPosition(position),
      getCatSkillState: id => this.playerStore.getCatSkillState(id),
      onCatSkillFired: id => this.playerStore.fireCatSkill(id),
      onCatSkillCharge: (id, charge) => this.playerStore.setCatSkillCharge(id, charge),
      onCatSkillItem: id => this.playerStore.addReward({ items: { [id]: 1 } }),
      onPlaySound: effect => this.audio.playEffect(effect),
      onVibrate: () => this.audio.vibrate(),
      onPerformance: () => {},
      onNextLevel: () => this.returnHomeFromGame(),
      onReturnHome: () => this.returnHomeFromGame(),
      onReplay: () => this.replayEndless(),
      onWatchAd: () => this.rewardedAd.watch(),
    });
    this.gameScreen.loadAndCreate(onReady);
  }

  private replayEndless() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.openEndlessGame(() => {
      this.startingGame = false;
    });
  }

  private replayChallenge() {
    if (this.startingGame) return;
    this.startingGame = true;
    this.challengeLevelDefinition = null;
    this.openChallengeGame(() => {
      this.startingGame = false;
    });
    this.prepareChallengeLevel((CHALLENGE_SEED ^ Date.now()) | 0);
  }

  private openCatCollection() {
    if (!this.loadScreen(this.catCollectionScreen, () => this.openCatCollection())) return;
    this.closeGameAndTown();
    this.adventureScreen.setActive(false);
    this.homeScreen.setActive(false);
    this.catDetailScreen.setActive(false);
    this.dailyTaskScreen.setActive(false);
    this.shopScreen.setActive(false);
    this.activityScreen.setActive(false);
    this.momentScreen.setActive(false);
    this.catCollectionScreen.setActive(true);
  }

  private openCatDetail(id: CatId) {
    if (!this.loadScreen(this.catDetailScreen, () => this.openCatDetail(id))) return;
    this.catCollectionScreen.setActive(false);
    this.catDetailScreen.setCat(id);
    this.catDetailScreen.setActive(true);
  }

  private returnToCatCollection() {
    this.catDetailScreen.setActive(false);
    this.catCollectionScreen.setActive(true);
  }

  private openDailyTasks() {
    if (!this.loadScreen(this.dailyTaskScreen, () => this.openDailyTasks())) return;
    this.closeGameAndTown();
    this.adventureScreen.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen.setActive(false);
    this.catDetailScreen.setActive(false);
    this.shopScreen.setActive(false);
    this.activityScreen.setActive(false);
    this.momentScreen.setActive(false);
    this.dailyTaskScreen.setActive(true);
  }

  private openShop() {
    if (!this.loadScreen(this.shopScreen, () => this.openShop())) return;
    this.closeGameAndTown();
    this.adventureScreen.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen.setActive(false);
    this.catDetailScreen.setActive(false);
    this.dailyTaskScreen.setActive(false);
    this.activityScreen.setActive(false);
    this.momentScreen.setActive(false);
    this.shopScreen.setActive(true);
  }

  private openActivity() {
    if (!this.loadScreen(this.activityScreen, () => this.openActivity())) return;
    this.closeGameAndTown();
    this.adventureScreen.setActive(false);
    this.homeScreen.setActive(false);
    this.catCollectionScreen.setActive(false);
    this.catDetailScreen.setActive(false);
    this.dailyTaskScreen.setActive(false);
    this.shopScreen.setActive(false);
    this.momentScreen.setActive(false);
    this.activityScreen.setActive(true);
  }

  private openMoments() {
    if (!this.loadScreen(this.momentScreen, () => this.openMoments())) return;
    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.momentScreen.setActive(true);
  }

  private openAdventure() {
    if (!this.loadScreen(this.adventureScreen, () => this.openAdventure())) return;
    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.adventureScreen.setActive(true);
  }

  private openRank() {
    if (!this.loadScreen(this.rankScreen, () => this.openRank())) return;
    this.closeGameAndTown();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.rankScreen.setActive(true);
  }

  private returnHomeFromExtraPage() {
    this.hideExtraPages();
    this.homeScreen.setActive(true);
  }

  private returnHomeFromGame() {
    this.startingGame = false;
    this.gameScreen?.destroy();
    this.gameScreen = null;
    this.hideExtraPages();
    this.homeScreen.setActive(true);
    this.resumeChallengePreparation();
  }

  private closeGameAndTown() {
    this.discardActiveGame();
    this.townScreen.setActive(false);
  }

  private discardActiveGame() {
    if (!this.gameScreen?.hasStartedPlay()) return;
    this.startingGame = false;
    this.gameScreen.destroy();
    this.gameScreen = null;
  }

  private hideExtraPages() {
    this.catCollectionScreen.setActive(false);
    this.catDetailScreen.setActive(false);
    this.dailyTaskScreen.setActive(false);
    this.shopScreen.setActive(false);
    this.activityScreen.setActive(false);
    this.momentScreen.setActive(false);
    this.adventureScreen.setActive(false);
    this.rankScreen.setActive(false);
    this.townScreen.setActive(false);
  }

  onDestroy() {
    if (Main.instance === this) Main.instance = null;
    this.screenLoadWaiters.clear();
    this.readyScreens.clear();
    this.loadingScreen?.destroy();
    this.loadingScreen = null;
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
    if (!this.readyScreens.has(this.townScreen)) {
      this.homeScreen.toast('小镇正在准备，马上带你进去');
    }
    if (!this.loadScreen(this.townScreen, () => this.openTown())) return;
    this.discardActiveGame();
    this.hideExtraPages();
    this.homeScreen.setActive(false);
    this.townScreen.setActive(true);
  }

  private returnHome() {
    this.townScreen.setActive(false);
    this.homeScreen.setActive(true);
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

    if (this.nextLevelDefinition) {
      playPrepared(this.nextLevelDefinition);
      return;
    }

    this.prepareNextMainLevel(level, definition => playPrepared(definition), true);
  }

  private advanceMainLevelAfterWin() {
    const clearedLevel = this.playerStore.getLevel();
    this.playerStore.setLevel(clearedLevel + 1);
    this.submitLevelRank();
    this.prepareNextMainLevel(this.playerStore.getLevel());
  }

  private prepareNextMainLevel(
    level: number,
    onReady?: (definition: LevelDefinition) => void,
    showFailureToast = false,
  ) {
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

  private ensureRemoteProfile() {
    if (this.playerStore.hasProfile()) {
      return Promise.resolve();
    }
    return this.leaderboard.ensureProfile(
      this.playerStore.getUserId(),
      this.playerStore.getUserName(),
    ).then(profile => {
      if (!this.node.isValid) return;
      this.playerStore.setProfile(profile.userId, profile.name);
    }).catch(error => {
      console.error('[CatWorld] Failed to generate player profile', error);
    });
  }

  private submitLevelRank() {
    const userId = this.playerStore.getUserId();
    if (!userId) return;
    this.leaderboard.submitLevel(
      userId,
      Math.max(1, this.playerStore.getLevel() - 1),
      this.playerStore.getTotalStarsEarned(),
    );
  }

  private submitEndlessRank(clearCount: number, durationMs: number) {
    const userId = this.playerStore.getUserId();
    if (!userId || clearCount <= 0) return;
    this.leaderboard.submitEndless(userId, clearCount, durationMs);
  }

  private submitChallengeRank(durationMs: number) {
    const userId = this.playerStore.getUserId();
    if (!userId || durationMs <= 0) return;
    this.leaderboard.submitChallenge(userId, durationMs, this.playerStore.getDailyDateKey());
  }

  private pauseNextLevelPreparation() {
    if (!this.nextLevelPreparing) return;
    this.nextLevelPrepareToken += 1;
    this.nextLevelPreparing = false;
    this.levelSystem.generator.cancelAsync();
  }

  private pauseChallengePreparation() {
    if (!this.challengePreparing) return;
    this.challengePrepareToken += 1;
    this.challengePreparing = false;
    this.levelSystem.generator.cancelAsync();
  }

  private resumeChallengePreparation() {
    if (this.nextLevelPreparing || this.challengeLevelDefinition || this.challengePreparing) return;
    this.prepareChallengeLevel();
  }
}
