import { SettlementButton } from './SettlementButton';
import { ensureButtonControl } from './Theme';
import {
  BlockInputEvents,
  Button,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  Tween,
  tween,
  UITransform,
  UIOpacity,
  Vec3,
  view,
} from 'cc';
import { GameMode, TrackEventName, TrackProps } from './Analytics';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { BoardTutorial } from './BoardTutorial';
import { ComboTracker } from './ComboTracker';
import { getCatDefinition, getCatSkillChargeRequired, getCatSkillConfig } from './GameContent';
import { SettlementPopup } from './SettlementPopup';
import type { RewardActionMode } from './RewardedAdService';
import { Toast } from './Toast';
import { EndlessDirector } from './level/EndlessDirector';
import { LevelRules, LevelSolver } from './level/LevelSolver';
import { LevelDefinition, LevelGoal, PlayerRun, TileDefinition, TileGeometry } from './level/LevelTypes';
import { CatId, CatTrialStatus, GameRunCheckpoint, ItemId, ShareCardType, ShareOffer } from './PlayerTypes';
import { SettingsPopup } from './SettingsPopup';
import { BuildTargetInfo, MAX_MAIN_LEVEL, themeIndexForLevel } from './TownContent';
import { PerformanceManager } from './PerformanceManager';

type Tile = {
  node: Node;
  kind: number;
  row: number;
  col: number;
  layer: number;
  width: number;
  height: number;
  boardPosition: Vec3;
  boardAngle: number;
  active: boolean;
  inTray: boolean;
  // 子节点引用：每帧热路径（遮挡刷新、缩放、换肤）直接取用，
  // 避免重复的 getChildByName 字符串查找。
  card: Node;
  item: Node;
  blockedOverlay: Node;
  targetOverlay: Node;
  // 遮挡判定用的几何体。牌创建后 width/height/boardPosition/boardAngle 不再变化，
  // 缓存下来可省掉每次点击上万个临时对象分配（overlapsGeometry 只读不写）。
  geometry: TileGeometry;
};

type ActiveTool = 'hammer' | 'cat_skill' | null;

type ToolButtonView = {
  node: Node;
  button: Button;
  countLabel: Label;
  badgeNode: Node;
  badgeGraphics: Graphics;
  icon: Node;
  activeFrame: Node;
};

type CatSkillState = {
  readyAt: number;
  charge: number;
  level: number;
};

type CatSkillPanelView = {
  node: Node;
  button: Button;
  portrait: Node;
  lockMark: Node;
  cooldownOverlay: Node;
  cooldownLabel: Label;
  chargeLabel: Label;
};

// 通用元素皮肤（game/tiles/tile_7..21）：未配套主题时的默认皮肤，也是主题皮肤缺图时的回退
const GENERIC_ITEM_NAMES = ['小鱼', '毛线球', '猫爪', '铃铛', '玩具鼠', '猫罐头', '牛奶', '爱心', '饼干', '篮子', '蝴蝶结', '叶子', '羽毛', '骨头', '猫粮'];

// 主题专属元素皮肤：kind 序号与通用皮肤一一对应，目录内 tile_1..15（见 需求.md 5.2.1）。
// 主题 6+ 只换卡面，不对应新建筑。单张缺失时回退通用皮肤。素材在 assets/resources/game/tiles/<folder>/
const THEME_ITEM_SKINS: Array<{ folder: string; names: string[] } | null> = [
  { folder: 'grassland', names: ['雏菊', '四叶草', '蘑菇', '蒲公英', '瓢虫', '蝴蝶', '蜗牛', '蜜蜂', '胡萝卜', '麦穗', '风车', '橡果', '鸟蛋', '木栅栏', '小青蛙'] },
  { folder: 'valley', names: ['溪石', '溪鱼', '水车', '荷花', '蜂蜜罐', '木桥', '萤火虫', '枫叶', '草帽', '蓝莓', '铜铃', '野餐篮', '蜻蜓', '法棍', '水磨小屋'] },
  { folder: 'bay', names: ['贝壳', '海星', '灯塔', '锚', '帆船', '海鸥', '珍珠', '椰子', '泳圈', '珊瑚', '漂流瓶', '海盐冰淇淋', '望远镜', '木栈道', '月光'] },
  { folder: 'cloudtrail', names: ['云朵', '热气球', '登山杖', '野花', '松果', '羊驼', '木路牌', '水壶', '帐篷', '星罗盘', '披肩', '山雀', '石阶', '风铃', '彩虹'] },
  { folder: 'berry', names: ['草莓', '蓝莓挞', '蘑菇屋', '藤篮', '果酱瓶', '橡果帽', '蝴蝶结', '浆果汁', '野莓枝', '木勺', '格子布', '小鹿', '松针', '提灯', '浆果派'] },
  { folder: 'lantern', names: ['红灯笼', '糖葫芦', '围巾猫', '手炉', '雪梨汤', '纸伞', '铃铛摊', '麦芽糖', '窗花', '棉靴', '热奶茶', '灯谜条', '烤红薯', '绒手套', '牌坊'] },
  { folder: 'bamboo', names: ['竹叶', '茶杯', '石灯笼', '锦鲤', '团扇', '竹笛', '月亮门', '青团', '蒲团', '萤火', '砚台', '竹扫帚', '莲花灯', '木屐', '庭院猫'] },
  { folder: 'snowfield', names: ['雪花', '热可可', '雪靴', '星砂瓶', '绒帽', '雪橇', '冰晶', '暖炉', '雪猫', '北极星', '毛线帽', '冰灯', '雪松', '暖手包', '观星镜'] },
];
const GAME_ITEM_TILE_IDS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const TOOL_ELEMENT_IDS = [1, 2, 3, 4, 6, 7, 9, 10, 11];
const SETTLEMENT_ASSET_PATHS = [
  'popup/btn_orange',
  'popup/btn_green',
  'popup/btn_pink',
  'popup/btn_purple',
  'popup2/btn_red',
  'popup2/panel_result',
  'popup2/cat_win_wave',
  'popup2/cat_fail_lean',
  'popup2/ribbon_win2',
  'popup2/ribbon_fail2',
  'popup2/icon_toolbox',
];
const CAT_SKILL_ASSET_PATHS = [
  'game/cat_skill_badge',
  'cat_detail/icon_skill',
  'cats/cat_orange',
  'cats/cat_white',
  'cats/cat_black',
  'cats/cat_ragdoll',
  'cats/cat_aurora',
];

/**
 * 首局关键路径资源：棋盘、工具和结算弹窗都在加载页阶段准备好，
 * 用户进入关卡后不会再因远程图片请求出现黑屏。
 */
export function buildGameScreenImagePaths(level: number, theme?: number) {
  const themeIndex = theme === -1 ? -1 : (theme ?? themeIndexForLevel(level));
  const skin = themeIndex >= 0 ? THEME_ITEM_SKINS[themeIndex] ?? null : null;
  const themePaths = skin
    ? Array.from({ length: 15 }, (_, index) => `game/tiles/${skin.folder}/tile_${index + 1}`)
    : [];
  const tilePaths = [2, 3, 4, ...GAME_ITEM_TILE_IDS].map(
    tileId => `game/tiles/tile_${tileId}`,
  );
  const toolPaths = TOOL_ELEMENT_IDS.map(
    elementId => `game/tool/game_bottom_sheet_element_${elementId}`,
  );
  return [
    'home/home_bg',
    // 对局内设置入口复用首页齿轮图标
    'home_crops/hud_settings',
    'game/combo_x2',
    'game/combo_x3',
    'game/combo_x4',
    COMMON_UI_ASSETS.backButton,
    COMMON_UI_ASSETS.coinIcon,
    COMMON_UI_ASSETS.starIcon,
    ...tilePaths,
    ...themePaths,
    ...toolPaths,
    ...SETTLEMENT_ASSET_PATHS,
    ...CAT_SKILL_ASSET_PATHS,
  ];
}

export interface GameScreenOptions {
  checkpoint?: GameRunCheckpoint;
  onSaveRun?: () => void;
  level: number;
  /** 关卡主题序号（0 起，-1 强制通用皮肤）；缺省按关卡号推导（每主题 20 关）。超萌挑战传 -1 */
  theme?: number;
  levelDefinition?: LevelDefinition;
  /** 超萌挑战模式：赢了改发大额金币，不发星星；对局数据不计入难度自适应 */
  challenge?: { coinReward: number };
  /** 超萌挑战通关时回调（用于结算每日限领的大奖） */
  onChallengeWin?: (durationMs: number) => void;
  /** 无尽模式：棋盘永不空完，按消除卡片数结算；不推进主线，成绩上报无尽榜 */
  endless?: {
    seed: number;
    bestEliminated: number;
    onFinish: (result: {
      eliminated: number;
      durationMs: number;
      stage: number;
      matchCount: number;
    }) => { coins: number; isNewRecord: boolean; bestEliminated: number };
  };
  /** 收集槽基础格数（额外槽位道具 +1）；缺省 6 */
  traySlots?: number;
  getCoins: () => number;
  onCoinsChanged: (coins: number) => void;
  onStarsGranted: (stars: number) => void;
  getItemCount: (id: ItemId) => number;
  onConsumeItem: (id: ItemId) => boolean;
  /** 道具用完时点击格子 → 每日免费补给（Main 处理平台可用性与每日限领）；不传时空道具保持禁用 */
  onToolSupplyGet?: (id: ItemId) => void;
  getEquippedCat: () => CatId | null;
  /** 是否至少解锁了一只猫咪：技能入口区分「去装备」和「先解锁建筑」两种提示 */
  hasAnyUnlockedCat?: () => boolean;
  /** 临时猫咪试住：仅主线玩家第一次真正操作时消耗一局，挑战/无尽不传。 */
  onMainRunStarted?: () => void;
  /** 试住状态快照入口：主线开局时读取一次，驱动技能入口试住提示与结算埋点。 */
  getCatTrialStatus?: () => CatTrialStatus | null;
  /** 对局内设置弹窗的音频开关（Main 注入 AudioManager；缺省时弹窗按开启兜底） */
  getMusicEnabled?: () => boolean;
  getSoundEnabled?: () => boolean;
  getVibrationEnabled?: () => boolean;
  onMusicChanged?: (enabled: boolean) => void;
  onSoundChanged?: (enabled: boolean) => void;
  onVibrationChanged?: (enabled: boolean) => void;
  getCatSkillState: (id: CatId) => CatSkillState;
  onCatSkillFired: (id: CatId) => { readyAt: number; giftCoins: number };
  onCatSkillCharge: (id: CatId, charge: number) => void;
  onCatSkillItem: (id: ItemId) => void;
  onPlaySound: (effect: AudioEffect) => void;
  onVibrate: () => void;
  onPerformance: (run: PlayerRun) => void;
  onAdFunnel?: (event: {
    level: number;
    fail?: boolean;
    failHadPair?: boolean;
    failProgress?: number;
    adRevive?: boolean;
    freeRevive?: boolean;
    reviveWin?: boolean;
    doubleCoins?: boolean;
  }) => void;
  onNextLevel: () => void;
  onReturnHome: () => void;
  onReplay: () => void;
  /**
   * 第 1 关对局内新手教学开关：由 Main 按主线 level===1 且未完成计算；
   * 超萌挑战/无尽不传。教学在棋盘入场动画结束后开始，第一次三消时完成。
   */
  tutorialEnabled?: boolean;
  /** 教学完成（第一次三消）时写存档标记 */
  onTutorialDone?: () => void;
  /** 收集关首次提示是否已显示；缺省视为已显示，不再弹 */
  shouldShowCollectGoalHint?: () => boolean;
  onCollectGoalHintShown?: () => void;
  /** 主线成功结算的建设目标提示（小节点机制）；星够时结算页出现「去建设」入口。超萌挑战/无尽不传 */
  getBuildTargetInfo?: () => BuildTargetInfo | null;
  /** 点击「去建设」：关闭对局并跳转小镇 */
  onGoBuild?: () => void;
  /** 满足重要节点时显示的好友分享入口；展示成果由 Main 发起。 */
  getShareOffer?: (context?: { isNewRecord?: boolean }) => ShareOffer | null;
  onShare?: (type: ShareCardType) => void;
  /** 激励操作模式，由 Main 统一配置。 */
  rewardMode?: RewardActionMode;
  /** 失败结算复活：分享返回或视频完播后 resolve true。 */
  onReviveAd?: () => Promise<boolean>;
  /** 胜利/无尽结算追加金币：激励操作结束后 resolve true。 */
  onDoubleRewardAd?: () => Promise<boolean>;
  onTrack?: (name: TrackEventName, props?: TrackProps) => void;
  /**
   * 启动预创建：只搭好关卡 UI，等 startPlay() 再开始计时和显示。
   * 加载页用它在进度条走完前把关卡准备好，避免开打时再等远程图。
   */
  deferStart?: boolean;
}

export class GameScreen {
  private readonly baseTraySlots: number;
  private readonly trayFlightDuration = 0.32;
  private readonly trayReflowDuration = 0.16;
  private readonly traySlotWidth = 88;
  private readonly traySlotHeight = 94;
  private readonly traySlotSpacing = 88;
  private readonly trayFirstSlotX: number;
  private readonly gameItemTileIds = GAME_ITEM_TILE_IDS;
  private readonly themeIndex: number;
  private readonly itemNames: readonly string[];
  private readonly gameUI: Node;
  private options: GameScreenOptions;
  private readonly assets: AssetStore;
  private boardLayer!: Node;
  private boardTiles: Tile[] = [];
  private trayLayer!: Node;
  private trayFlightLayer!: Node;
  private trayTiles: Tile[] = [];
  private trayCapacity: number;
  private pendingTrayAnimations = 0;
  private trayLayoutVersion = 0;
  private extraTraySlot = false;
  private gameOver = false;
  private destroyed = false;
  private coins: number;
  private targetLabel!: Label;
  private collectGoalProgressLabel: Label | null = null;
  private collectGoalHud: Node | null = null;
  private collectedTotal = 0;
  private collectProgress = 0;
  private eliminatedCount = 0;
  private endlessDirector: EndlessDirector | null = null;
  private endlessStage = 0;
  private endlessHudLabel: Label | null = null;
  private endlessHudTimer: ReturnType<typeof setInterval> | null = null;
  private leaveConfirmNode: Node | null = null;
  private nextTileIndex = 0;
  private pausedAt = 0;
  private resumeOverlay: Node | null = null;
  private startedAt = Date.now();
  private created = false;
  private playStarted = false;
  private pendingStart = false;
  private boardIntroActive = false;
  private boardIntroSpawning = false;
  private boardIntroPending = 0;
  private awaitingLevelDefinition = false;
  private preparingHintNode: Node | null = null;
  private preparingHintLabel: Label | null = null;
  private preparingHintTimer: ReturnType<typeof setInterval> | null = null;
  private mistakes = 0;
  private decisionCount = 0;
  private nearFailureCount = 0;
  private matchCount = 0;
  private readonly comboTracker = new ComboTracker();
  private comboFeedbackNode: Node | null = null;
  private comboFeedbackLabel: Label | null = null;
  private comboBadgeSprite: Sprite | null = null;
  private comboFeedbackOpacity: UIOpacity | null = null;
  private comboFeedbackGlow: Graphics | null = null;
  private readonly comboParticles = new Set<Node>();
  private readonly comboParticleMotions = new Set<object>();
  private performanceReported = false;
  private checkpointReady = false;
  private reviveUsed = false;
  private doubleRewardUsed = false;
  private settlementWin = false;
  private settlementCoinReward = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly performanceManager = PerformanceManager.getInstance();
  private readonly tweenTargets = new Set<object>();
  private readonly toolButtonViews = new Map<ItemId, ToolButtonView>();
  private readonly usedTools = new Set<ItemId>();
  private extraSlotNode: Node | null = null;
  private activeTool: ActiveTool = null;
  // 装备猫咪的技能：充能进度跨局保留，技能只由玩家手动触发
  private equippedCatId: CatId | null = null;
  private catSkill: CatSkillState | null = null;
  private catSkillConfig: ReturnType<typeof getCatSkillConfig> | null = null;
  private catSkillPanel: CatSkillPanelView | null = null;
  private catSkillRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private catSkillUsed = false;
  // 棋盘清除类技能处于选择模式时剩余的可选目标数（大橘/白猫 1 个，极光猫 2 个）
  private catSkillPicksLeft = 0;
  private settlementPopup: SettlementPopup | null = null;
  private boardTutorial: BoardTutorial | null = null;
  private settingsPopup: SettingsPopup | null = null;
  private endlessRecorded = false;
  /** 开局时的试住快照：剩余次数（含本局）；null 表示本局与试住无关。 */
  private trialStartRemaining: number | null = null;
  /** 本局是否已经扣过试住次数（玩家第一次真正操作时扣）。 */
  private trialConsumedForRun = false;

  constructor(root: Node, assets: AssetStore, options: GameScreenOptions) {
    this.assets = assets;
    this.options = options;
    this.coins = options.getCoins();
    this.equippedCatId = options.getEquippedCat();
    // 槽位数可按玩法配置（超萌挑战用 5 槽），含额外槽位整体居中：6+1 槽时与原 -264 常量一致
    this.baseTraySlots = Math.max(4, Math.min(7, options.traySlots ?? 6));
    this.trayCapacity = this.baseTraySlots;
    this.trayFirstSlotX = -(this.baseTraySlots / 2) * this.traySlotSpacing;
    // 主题皮肤：显式传入优先（超萌挑战传 -1 强制通用皮肤），否则按关卡号推导
    this.themeIndex = options.theme === -1 ? -1 : (options.theme ?? themeIndexForLevel(options.level));
    this.itemNames = this.themeIndex >= 0
      ? THEME_ITEM_SKINS[this.themeIndex]?.names ?? GENERIC_ITEM_NAMES
      : GENERIC_ITEM_NAMES;
    if (options.endless) this.endlessDirector = new EndlessDirector(options.endless.seed, this.startedAt);
    if (this.equippedCatId) {
      this.catSkill = options.getCatSkillState(this.equippedCatId);
      this.catSkillConfig = getCatSkillConfig(this.equippedCatId);
    }
    this.gameUI = new Node('GameUI');
    root.addChild(this.gameUI);
    const visibleSize = view.getVisibleSize();
    this.gameUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.gameUI.active = false;
  }

  loadAndCreate(onReady?: () => void) {
    // 以对局自身为 owner 登记图片归属：对局销毁（Main.releaseScreen/离场）时
    // 页面离场后移除归属，再次访问时复用缓存，避免重建纹理。
    this.assets.loadImagesFor(this, buildGameScreenImagePaths(this.options.level, this.options.theme), () => {
      if (this.destroyed) return;
      this.create();
      if (!this.options.deferStart || this.pendingStart) this.startPlay();
      onReady?.();
    });
  }

  hasStartedPlay() {
    return this.playStarted;
  }

  // Main 在免费补给等异步流程发放道具后调用，立即刷新工具按钮数量
  refreshInventoryHud() {
    if (this.destroyed || !this.created) return;
    this.refreshToolButtons();
  }

  // 试住次数扣减：点牌 / 用道具 / 发动技能都算「真正开始操作」；
  // 每局最多扣一次，超萌挑战和无尽不经过这里。
  private consumeTrialIfNeeded() {
    if (this.trialConsumedForRun || this.options.challenge || this.options.endless) return;
    this.trialConsumedForRun = true;
    this.options.onMainRunStarted?.();
  }

  createCheckpoint(): GameRunCheckpoint | null | undefined {
    if (!this.playStarted || this.destroyed || this.boardIntroActive || !this.checkpointReady) return undefined;
    if (this.gameOver) return null;
    const geometry = (tile: Tile) => ({ ...tile.geometry, layer: tile.layer, kind: tile.kind });
    return {
      version: 1, mode: this.playMode(), level: this.options.level,
      definition: this.options.levelDefinition,
      endlessSeed: this.options.endless?.seed, endlessWave: this.endlessDirector?.getWaveIndex(),
      board: this.boardTiles.filter(tile => tile.active && !tile.inTray).map(geometry),
      tray: this.trayTiles.map(geometry),
      elapsedMs: Math.max(0, (this.pausedAt || Date.now()) - this.startedAt),
      extraSlot: this.extraTraySlot, usedTools: Array.from(this.usedTools),
      collectedTotal: this.collectedTotal, collectProgress: this.collectProgress,
      eliminatedCount: this.eliminatedCount, matchCount: this.matchCount,
      mistakes: this.mistakes, decisionCount: this.decisionCount, nearFailureCount: this.nearFailureCount,
      performanceReported: this.performanceReported,
      reviveUsed: this.reviveUsed, equippedCat: this.equippedCatId,
      catCharge: this.catSkill?.charge || 0, catSkillUsed: this.catSkillUsed,
      catSkillPicksLeft: this.catSkillPicksLeft, trialConsumed: this.trialConsumedForRun,
      trialStartRemaining: this.trialStartRemaining,
    };
  }

  private restoreCheckpoint(run: GameRunCheckpoint) {
    this.startedAt = Date.now() - run.elapsedMs;
    this.endlessDirector?.markStarted(this.startedAt);
    if (this.endlessDirector) this.endlessDirector.restoreWaveIndex(run.endlessWave);
    this.endlessStage = Math.max(0, (run.endlessWave || 1) - 1);
    this.equippedCatId = run.equippedCat;
    this.catSkillConfig = run.equippedCat ? getCatSkillConfig(run.equippedCat) : null;
    this.catSkill = run.equippedCat ? { ...this.options.getCatSkillState(run.equippedCat), charge: run.catCharge, readyAt: 0 } : null;
    this.collectedTotal = run.collectedTotal;
    this.collectProgress = run.collectProgress;
    this.eliminatedCount = run.eliminatedCount;
    this.matchCount = run.matchCount;
    this.mistakes = run.mistakes;
    this.decisionCount = run.decisionCount;
    this.nearFailureCount = run.nearFailureCount;
    this.reviveUsed = run.reviveUsed;
    this.performanceReported = run.performanceReported === true;
    this.catSkillUsed = run.catSkillUsed;
    this.catSkillPicksLeft = run.catSkillPicksLeft;
    this.activeTool = run.catSkillPicksLeft > 0 ? 'cat_skill' : null;
    this.trialConsumedForRun = run.trialConsumed;
    this.trialStartRemaining = run.trialStartRemaining;
    run.usedTools.forEach(id => this.usedTools.add(id));
    if (run.extraSlot) {
      this.extraTraySlot = true;
      this.trayCapacity = this.baseTraySlots + 1;
      const sprite = this.extraSlotNode?.getComponent(Sprite);
      const frame = this.assets.getFrame(this.toolPath(11));
      if (sprite && frame) sprite.spriteFrame = frame;
    }
    run.board.forEach(card => this.makeOpeningTile({ ...card, angle: card.rotation || 0 }));
    run.tray.forEach(card => {
      const tile = this.makeOpeningTile({ ...card, angle: card.rotation || 0 });
      tile.active = false;
      tile.inTray = true;
      tile.node.removeFromParent();
      this.trayLayer.addChild(tile.node);
      this.resizeTrayTile(tile);
      tile.node.setPosition(this.traySlotX(this.trayTiles.length), 0);
      this.trayTiles.push(tile);
    });
    this.checkpointReady = true;
    this.sortBoardTileNodes();
    this.refreshBoardTileStates();
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.updateTargetLabel();
    this.resolveTrayMatches();
    this.options.onSaveRun?.();
    this.toast('已接着上次的棋盘继续');
  }

  pauseForBackground() {
    if (!this.playStarted || this.destroyed || this.gameOver || this.pausedAt) return;
    this.pausedAt = Date.now();
    this.options.onSaveRun?.();
  }

  showResumePrompt() {
    if (!this.pausedAt || this.destroyed || this.gameOver || this.resumeOverlay) return;
    const overlay = new Node('ResumeOverlay');
    this.gameUI.addChild(overlay);
    this.resumeOverlay = overlay;
    const size = view.getVisibleSize();
    overlay.addComponent(UITransform).setContentSize(size.width, size.height);
    overlay.addComponent(BlockInputEvents);
    const graphics = overlay.addComponent(Graphics);
    graphics.fillColor = new Color(22, 18, 13, 190);
    graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    graphics.fill();
    this.label(overlay, '猫咪帮你守着棋盘呢', 0, 88, 30, new Color(255, 248, 226));
    const buttonNode = new Node('ContinueButton');
    overlay.addChild(buttonNode);
    buttonNode.addComponent(UITransform).setContentSize(360, 112);
    const buttonGraphics = buttonNode.addComponent(Graphics);
    buttonGraphics.fillColor = new Color(255, 224, 108);
    buttonGraphics.roundRect(-180, -56, 360, 112, 24);
    buttonGraphics.fill();
    SettlementButton.apply(buttonNode, 'primary', 360, 112);
    const continueLabel = this.label(buttonNode, '继续本局', 0, 0, 36, new Color(111, 62, 28));
    SettlementButton.styleLabel(continueLabel, 360, 112, 36);
    const button = buttonNode.addComponent(Button);
    ensureButtonControl(button);
    buttonNode.on(Button.EventType.CLICK, () => {
      const elapsed = Date.now() - this.pausedAt;
      this.startedAt += elapsed;
      this.endlessDirector?.markStarted(this.startedAt);
      this.pausedAt = 0;
      overlay.destroy();
      this.resumeOverlay = null;
    });
  }

  matchesPreparedLevel(level: number) {
    return !this.destroyed
      && !this.options.challenge
      && !this.options.endless
      && this.options.level === level
      && this.gameUI.isValid;
  }

  startPlay() {
    if (this.destroyed || this.playStarted || !this.gameUI.isValid) return;
    if (!this.created) {
      this.pendingStart = true;
      return;
    }
    this.pendingStart = false;
    this.playStarted = true;
    this.startedAt = Date.now();
    this.trackEvent('page_view', { page_id: 'game', ...this.levelTrackProps() });
    this.trackEvent(this.options.checkpoint ? 'level_resume' : 'level_start', this.levelTrackProps());
    // 无尽 HUD 的「坚持时长」走 director，把开打时刻同步过去，和结算 durationMs 对齐
    this.endlessDirector?.markStarted(this.startedAt);
    this.coins = this.options.getCoins();
    this.equippedCatId = this.options.getEquippedCat();
    if (this.equippedCatId) {
      this.catSkill = this.options.getCatSkillState(this.equippedCatId);
      this.catSkillConfig = getCatSkillConfig(this.equippedCatId);
    } else {
      this.catSkill = null;
      this.catSkillConfig = null;
    }
    // 开局快照试住状态：本局猫咪/技能已在上面读取（试住期间每局自动满充能）。
    // 次数不在这里扣——等玩家第一次真正点牌/用道具/发技能再扣，纯看棋盘退出不消耗。
    const trialStatus = this.options.getCatTrialStatus?.() ?? null;
    this.trialStartRemaining = trialStatus ? Math.max(1, trialStatus.remainingGames) : null;
    this.trialConsumedForRun = false;
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.gameUI.active = true;
    if (this.gameUI.parent) {
      this.gameUI.setSiblingIndex(this.gameUI.parent.children.length - 1);
    }
    this.startCatSkillRefresh();
    if (this.options.endless) this.startEndlessHud();
    if (this.options.checkpoint) {
      this.restoreCheckpoint(this.options.checkpoint);
      return;
    }
    this.maybeShowCollectGoalHint();
    if (this.options.levelDefinition || this.options.endless) {
      this.beginBoardIntro();
      return;
    }
    if (this.options.challenge) {
      this.awaitingLevelDefinition = true;
      this.boardIntroActive = true;
      this.refreshToolButtons();
      this.refreshCatSkillPanel();
      this.showPreparingHint();
    }
  }

  applyLevelDefinition(definition: LevelDefinition) {
    if (this.destroyed || this.gameOver || !this.options.challenge) return;
    this.options = {
      ...this.options,
      levelDefinition: definition,
    };
    if (!this.playStarted || !this.awaitingLevelDefinition) return;
    this.awaitingLevelDefinition = false;
    this.boardIntroActive = false;
    this.hidePreparingHint();
    // 加载等待不计入通关用时，与第一次开打时棋盘已就绪对齐。
    this.startedAt = Date.now();
    this.beginBoardIntro();
  }

  create() {
    if (this.created || this.destroyed) return;
    const visibleSize = view.getVisibleSize();
    this.image(this.gameUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);

    // A warm veil keeps the supplied scene readable beneath the cream UI.
    const veil = new Node('GameWarmVeil');
    this.gameUI.addChild(veil);
    veil.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const veilGraphics = veil.addComponent(Graphics);
    veilGraphics.fillColor = new Color(255, 235, 188, 112);
    veilGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    veilGraphics.fill();

    // Keep the header inside the safe area on the base 750x1334 canvas while
    // preserving the current spacing on taller device previews.
    const headerY = Math.min(590, visibleSize.height / 2 - 145);
    const back = new Node('GameBackButton');
    this.gameUI.addChild(back);
    back.setPosition(-316, headerY);
    back.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(back, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);

    const backButton = back.addComponent(Button);
    ensureButtonControl(backButton);
    backButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.requestLeave();
    });

    // 右上角设置入口：与首页设置按钮同一条微信胶囊避让线（belowWeChatCapsule），
    // 图标复用 home_crops/hud_settings；打开的是共享 SettingsPopup。
    const settingsEntry = new Node('GameSettingsButton');
    this.gameUI.addChild(settingsEntry);
    settingsEntry.setPosition(312, belowWeChatCapsule(visibleSize.height / 2, 88));
    settingsEntry.addComponent(UITransform).setContentSize(88, 88);
    this.image(settingsEntry, 'home_crops/hud_settings', 0, 0, 72, 72);
    const settingsButton = settingsEntry.addComponent(Button);
    ensureButtonControl(settingsButton);
    settingsButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.openSettings();
    });

    const levelBanner = this.image(this.gameUI, this.gamePath(3), -86, headerY, 260, 80);
    const levelTitle = this.label(
      levelBanner,
      this.options.endless ? '无尽模式' : this.options.challenge ? '超萌挑战' : `第 ${this.options.level} 关`,
      0,
      -3,
      30,
      new Color(111, 62, 28),
    );
    levelTitle.isBold = true;

    // 118 = banner half height 40 + 14.5 gap + goal half height 63.5, so the
    // tab stays clear of the level banner on every canvas height.
    const goal = this.image(this.gameUI, this.gamePath(4), 0, headerY - 118, 568, 127);
    if (this.options.endless) {
      const goalTitle = this.label(goal, '无尽挑战', 0, 35, 23, new Color(125, 75, 35));
      goalTitle.isBold = true;
      goalTitle.verticalAlign = Label.VerticalAlign.CENTER;
      goalTitle.lineHeight = 43;
      goalTitle.node.getComponent(UITransform)!.setContentSize(185, 43);
      this.endlessHudLabel = this.label(goal, '已消除 0 · 坚持 0:00', 0, -12, 22, new Color(112, 69, 40));
      this.endlessHudLabel.isBold = true;
    } else {
      const goalTitle = this.label(goal, '关卡目标', 0, 35, 23, new Color(125, 75, 35));
      goalTitle.isBold = true;
      goalTitle.verticalAlign = Label.VerticalAlign.CENTER;
      goalTitle.lineHeight = 43;
      goalTitle.node.getComponent(UITransform)!.setContentSize(185, 43);
      const collectGoal = this.levelCollectGoal();
      if (collectGoal) {
        // 底图左右各有爪印装饰：内容收在中间约 220px，避免和爪印重叠。
        this.collectGoalHud = new Node('CollectGoalHud');
        goal.addChild(this.collectGoalHud);
        this.collectGoalHud.setPosition(0, -12);
        this.collectGoalHud.addComponent(UITransform).setContentSize(220, 44);
        this.image(this.collectGoalHud, this.itemTilePath(collectGoal.kind), -78, 0, 36, 36);
        const nameText = this.label(
          this.collectGoalHud,
          this.itemNames[collectGoal.kind] || '指定元素',
          -18,
          0,
          22,
          new Color(112, 69, 40),
        );
        nameText.isBold = true;
        nameText.overflow = Label.Overflow.SHRINK;
        nameText.enableWrapText = false;
        nameText.verticalAlign = Label.VerticalAlign.CENTER;
        nameText.horizontalAlign = Label.HorizontalAlign.CENTER;
        nameText.node.getComponent(UITransform)!.setContentSize(72, 36);
        this.collectGoalProgressLabel = this.label(
          this.collectGoalHud,
          `0/${collectGoal.count}`,
          62,
          0,
          24,
          new Color(111, 62, 28),
        );
        this.collectGoalProgressLabel.isBold = true;
        this.collectGoalProgressLabel.overflow = Label.Overflow.SHRINK;
        this.collectGoalProgressLabel.enableWrapText = false;
        this.collectGoalProgressLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.collectGoalProgressLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.collectGoalProgressLabel.node.getComponent(UITransform)!.setContentSize(72, 36);
      } else {
        const collectText = this.label(goal, '收集全部元素', -38, -12, 21, new Color(112, 69, 40));
        collectText.isBold = true;
        const clearText = this.label(goal, '即可通关', 190, -12, 21, new Color(112, 69, 40));
        clearText.isBold = true;
      }
    }

    // Keep the progress value available to the game logic without adding a
    // second status bar that is not present in the supplied UI reference.
    this.targetLabel = this.label(this.gameUI, '', 0, 0, 1, Color.TRANSPARENT);
    this.targetLabel.node.active = false;

    // Tiles reach 233.5 above the layer origin (generator clamps y to
    // [-320, 180] plus half a card), so headerY - 425 keeps even the tallest
    // stack 10px below the goal panel bottom (headerY - 181.5).
    const boardY = headerY - 425;
    const boardGlow = this.addPanel('BoardGlow', 0, boardY - 120, 646, 650, new Color(255, 247, 222, 22), this.gameUI);
    boardGlow.setSiblingIndex(this.gameUI.children.length - 1);
    this.boardLayer = new Node('Board');
    this.gameUI.addChild(this.boardLayer);
    this.boardLayer.setPosition(0, boardY);

    this.trayLayer = new Node('Tray');
    this.gameUI.addChild(this.trayLayer);
    this.trayLayer.setPosition(0, -515);
    this.buildTray();
    this.buildComboFeedback();
    this.buildToolButton('hammer', '锤子', -252, -358, 1, () => this.useHammer());
    this.buildToolButton('dice', '骰子', -84, -358, 2, () => this.shuffle());
    this.buildToolButton('glove', '手套', 84, -358, 3, () => this.useGlove());
    this.buildToolButton('extra_slot', '增加槽位', 252, -358, 4, () => this.addTraySlot());
    this.trayFlightLayer = new Node('TrayFlight');
    this.gameUI.addChild(this.trayFlightLayer);
    this.trayFlightLayer.setPosition(this.trayLayer.position);

    // 技能入口固定在关卡标题和设置之间，独立热区不会覆盖任何棋盘牌。
    // 不采用旧档悬浮位置，避免旧位置继续遮住末牌造成「清空却不通关」错觉。
    this.buildCatSkillPanel(172, headerY);
    this.gameUI.active = false;
    this.created = true;
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.tweenTargets.forEach(target => Tween.stopAllByTarget(target));
    this.tweenTargets.clear();
    this.clearComboParticles();
    this.comboTracker.reset();
    if (this.comboFeedbackNode) {
      Tween.stopAllByTarget(this.comboFeedbackNode);
      this.comboFeedbackNode = null;
    }
    this.comboFeedbackLabel = null;
    this.comboBadgeSprite = null;
    this.comboFeedbackOpacity = null;
    this.comboFeedbackGlow = null;
    this.extraSlotNode = null;
    this.activeTool = null;
    this.boardIntroActive = false;
    this.boardIntroSpawning = false;
    this.boardIntroPending = 0;
    this.awaitingLevelDefinition = false;
    this.hidePreparingHint(true);
    if (this.catSkillRefreshTimer) clearInterval(this.catSkillRefreshTimer);
    this.catSkillRefreshTimer = null;
    if (this.endlessHudTimer) clearInterval(this.endlessHudTimer);
    this.endlessHudTimer = null;
    this.endlessHudLabel = null;
    this.leaveConfirmNode = null;
    this.endlessDirector = null;
    this.boardTutorial?.destroy();
    this.boardTutorial = null;
    this.settingsPopup = null;
    if (this.catSkillPanel) Tween.stopAllByTarget(this.catSkillPanel.node);
    this.catSkillPanel = null;
    this.settlementPopup = null;
    this.toolButtonViews.clear();
    if (this.gameUI.isValid) this.gameUI.destroy();
  }

  // 对局内设置：打开共享 SettingsPopup（遮罩自带 BlockInputEvents 挡住棋盘误触；
  // 无尽模式计时不暂停——回合制玩法无时限压力，开设置由玩家自己权衡）。
  private openSettings() {
    this.settingsPopup?.close();
    this.settingsPopup = SettingsPopup.open(this.gameUI, this.assets, {
      getMusicEnabled: () => this.options.getMusicEnabled?.() ?? true,
      getSoundEnabled: () => this.options.getSoundEnabled?.() ?? true,
      getVibrationEnabled: () => this.options.getVibrationEnabled?.() ?? true,
      onMusicChanged: enabled => this.options.onMusicChanged?.(enabled),
      onSoundChanged: enabled => this.options.onSoundChanged?.(enabled),
      onVibrationChanged: enabled => this.options.onVibrationChanged?.(enabled),
      onPlaySound: effect => this.options.onPlaySound(effect),
      onClose: () => { this.settingsPopup = null; },
    });
  }

  private addPanel(name: string, x: number, y: number, w: number, h: number, color: Color, parent: Node) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(w, h);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-w / 2, -h / 2, w, h, 22);
    graphics.fill();
    return node;
  }

  private label(parent: Node, text: string, x: number, y: number, size: number, color: Color) {
    const node = new Node('Label');
    parent.addChild(node);
    node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 8;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    return label;
  }

  private image(parent: Node, path: string, x: number, y: number, w: number, h: number) {
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    const frame = this.assets.getFrame(path);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
    }
    return node;
  }

  // 宠物位锁标：一只猫咪都没解锁时显示，传达「还不可用」，配合点击的教学提醒
  private buildCatLockMark(parent: Node) {
    const node = new Node('CatSkillLockMark');
    parent.addChild(node);
    node.setPosition(-44, 42);
    node.addComponent(UITransform).setContentSize(40, 44);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(120, 120, 120);
    graphics.strokeColor = new Color(255, 248, 226);
    graphics.lineWidth = 3;
    graphics.roundRect(-13, -12, 26, 23, 5);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = new Color(120, 120, 120);
    graphics.lineWidth = 5;
    graphics.arc(0, 5, 10, Math.PI, 0, false);
    graphics.stroke();
    graphics.fillColor = new Color(255, 229, 145);
    graphics.circle(0, -3, 3);
    graphics.fill();
    node.active = false;
    return node;
  }

  private buildCatSkillPanel(x: number, y: number) {
    const panel = this.addPanel('CatSkillPanel', x, y, 88, 88, new Color(255, 248, 226), this.gameUI);
    const portraitPath = this.equippedCatId
      ? getCatDefinition(this.equippedCatId).portraitPath
      : 'cats/cat_orange';
    const portrait = this.image(panel, portraitPath, 0, 12, 60, 60);
    const lockMark = this.buildCatLockMark(panel);
    lockMark.setPosition(-30, 28);
    lockMark.setScale(0.7, 0.7, 1);
    this.image(panel, 'game/cat_skill_badge', 30, 28, 24, 24);
    const cooldownOverlay = this.addPanel('CatSkillCooldownOverlay', 0, 0, 88, 88, new Color(48, 37, 28, 142), panel);
    cooldownOverlay.active = false;
    const cooldownLabel = this.label(panel, '', 0, 0, 22, new Color(255, 251, 238));
    cooldownLabel.isBold = true;
    cooldownLabel.node.getComponent(UITransform)!.setContentSize(88, 30);
    const chargeLabel = this.label(panel, '', 0, -28, 20, new Color(111, 62, 28));
    chargeLabel.isBold = true;
    chargeLabel.outlineWidth = 3;
    chargeLabel.outlineColor = new Color(255, 248, 226);
    chargeLabel.overflow = Label.Overflow.CLAMP;
    chargeLabel.enableWrapText = false;
    chargeLabel.node.getComponent(UITransform)!.setContentSize(152, 28);
    const button = panel.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.onCatSkillTap();
    });
    this.catSkillPanel = { node: panel, button, portrait, lockMark, cooldownOverlay, cooldownLabel, chargeLabel };
    this.refreshCatSkillPanel();
  }

  private startCatSkillRefresh() {
    this.refreshCatSkillPanel();
    if (!this.equippedCatId) return;
    this.catSkillRefreshTimer = setInterval(() => this.refreshCatSkillPanel(), 1000);
  }

  private refreshCatSkillPanel() {
    const panel = this.catSkillPanel;
    if (!panel) return;
    const catId = this.equippedCatId;
    const skill = this.catSkill;
    const portraitSprite = panel.portrait.getComponent(Sprite);
    const portraitFrame = this.assets.getFrame(catId ? getCatDefinition(catId).portraitPath : 'cats/cat_orange');
    if (portraitSprite && portraitFrame) portraitSprite.spriteFrame = portraitFrame;
    if (!catId || !skill || !this.catSkillConfig) {
      const anyUnlocked = this.options.hasAnyUnlockedCat?.() ?? false;
      if (portraitSprite) portraitSprite.color = new Color(154, 154, 154);
      panel.lockMark.active = !anyUnlocked;
      panel.chargeLabel.string = anyUnlocked ? '去上阵' : '待解锁';
      panel.cooldownLabel.string = '';
      panel.cooldownOverlay.active = false;
      panel.button.interactable = !this.gameOver && !this.boardIntroActive;
      return;
    }
    if (portraitSprite) portraitSprite.color = Color.WHITE;
    panel.lockMark.active = false;
    const required = getCatSkillChargeRequired(catId, skill.level);
    const charge = Math.min(required, Math.max(0, skill.charge));
    const cooldownRemaining = Math.max(0, skill.readyAt - Date.now());
    const canFire = !this.gameOver && !this.boardIntroActive && !this.catSkillUsed
      && charge >= required && cooldownRemaining === 0;
    const selecting = this.activeTool === 'cat_skill';
    const prefix = this.trialStartRemaining !== null ? '试住·' : '';
    panel.chargeLabel.string = prefix + (selecting ? '选目标' : this.catSkillUsed
      ? '已使用' : canFire ? '点我发动' : `${charge}/${required}`);
    panel.chargeLabel.color = canFire || selecting ? new Color(190, 59, 51) : new Color(111, 62, 28);
    panel.cooldownLabel.string = cooldownRemaining > 0 ? this.formatCatSkillRemaining(cooldownRemaining) : '';
    panel.cooldownOverlay.active = cooldownRemaining > 0 || this.catSkillUsed;
    panel.button.interactable = selecting || (!this.gameOver && !this.catSkillUsed && !this.boardIntroActive);
  }

  private formatCatSkillRemaining(milliseconds: number) {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private gamePath(tileId: number) {
    return `game/tiles/tile_${tileId}`;
  }

  /** 元素皮肤按主题取图；主题未配套或单张缺失时回退通用皮肤，保证不出现空卡片 */
  private itemTilePath(kind: number) {
    const skin = this.themeIndex >= 0 ? THEME_ITEM_SKINS[this.themeIndex] : undefined;
    if (skin) {
      const themed = `game/tiles/${skin.folder}/tile_${kind + 1}`;
      if (this.assets.getFrame(themed)) return themed;
    }
    return this.gamePath(this.gameItemTileIds[kind]);
  }

  private toolPath(elementId: number) {
    return `game/tool/game_bottom_sheet_element_${elementId}`;
  }

  private buildTray() {
    const firstSlotX = this.traySlotX(0);
    const lastSlotX = this.traySlotX(this.baseTraySlots);
    this.image(this.trayLayer, this.toolPath(6), firstSlotX - 72, 0, 72, 126);
    this.image(this.trayLayer, this.toolPath(7), lastSlotX + 72, 0, 72, 126);

    for (let index = 0; index < this.baseTraySlots; index += 1) {
      this.image(
        this.trayLayer,
        this.toolPath(9),
        this.traySlotX(index),
        0,
        this.traySlotWidth,
        this.traySlotHeight,
      );
    }
    this.extraSlotNode = this.image(
      this.trayLayer,
      this.toolPath(10),
      lastSlotX,
      0,
      this.traySlotWidth,
      this.traySlotHeight,
    );
  }

  private showPreparingHint() {
    if (this.destroyed || this.preparingHintNode?.isValid) return;

    const overlay = new Node('PreparingHint');
    this.gameUI.addChild(overlay);
    this.preparingHintNode = overlay;
    overlay.setPosition(0, this.boardLayer.position.y);
    overlay.addComponent(UITransform).setContentSize(420, 148);
    overlay.setScale(new Vec3(0.86, 0.86, 1));

    const shadow = overlay.addComponent(Graphics);
    shadow.fillColor = new Color(92, 54, 22, 80);
    shadow.ellipse(0, -62, 150, 16);
    shadow.fill();

    const panel = this.addPanel('PreparingPanel', 0, 0, 360, 120, new Color(255, 248, 226, 255), overlay);
    const panelGraphics = panel.getComponent(Graphics);
    if (panelGraphics) {
      panelGraphics.strokeColor = new Color(235, 205, 158);
      panelGraphics.lineWidth = 3;
      panelGraphics.roundRect(-180, -60, 360, 120, 24);
      panelGraphics.stroke();
    }

    const title = this.label(panel, '棋盘加载中', 0, 16, 28, new Color(111, 62, 28));
    title.isBold = true;
    this.preparingHintLabel = this.label(panel, '正在挑选高压关卡', 0, -22, 21, new Color(112, 69, 40));
    this.preparingHintLabel.isBold = true;

    const opacity = overlay.addComponent(UIOpacity);
    opacity.opacity = 0;
    this.tweenTargets.add(overlay);
    tween(overlay)
      .to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity)
      .to(0.18, { opacity: 255 }, { easing: 'sineOut' })
      .start();

    let dots = 0;
    this.preparingHintTimer = setInterval(() => {
      if (this.destroyed || !this.preparingHintLabel?.node.isValid) return;
      dots = (dots + 1) % 4;
      this.preparingHintLabel.string = `正在挑选高压关卡${'.'.repeat(dots)}`;
    }, 380);
  }

  private hidePreparingHint(immediate = false) {
    if (this.preparingHintTimer) {
      clearInterval(this.preparingHintTimer);
      this.preparingHintTimer = null;
    }
    this.preparingHintLabel = null;
    const overlay = this.preparingHintNode;
    this.preparingHintNode = null;
    if (!overlay?.isValid) return;

    Tween.stopAllByTarget(overlay);
    this.tweenTargets.delete(overlay);
    const opacity = overlay.getComponent(UIOpacity);
    if (immediate || !opacity) {
      overlay.destroy();
      return;
    }
    Tween.stopAllByTarget(opacity);
    tween(opacity)
      .to(0.16, { opacity: 0 }, { easing: 'sineIn' })
      .call(() => {
        if (overlay.isValid) overlay.destroy();
      })
      .start();
  }

  private beginBoardIntro() {
    if (this.destroyed || this.boardIntroActive || this.boardIntroSpawning) return;
    this.boardTiles = [];
    this.nextTileIndex = 0;
    this.boardIntroActive = true;
    this.boardIntroSpawning = true;
    this.boardIntroPending = 0;
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.updateTargetLabel();

    if (this.endlessDirector) {
      this.refillEndlessBoard(true);
      this.boardIntroSpawning = false;
      this.finishBoardIntroIfIdle();
      return;
    }

    const placements = this.collectOpeningPlacements();
    this.spawnOpeningPlacements(placements, 0);
  }

  private collectOpeningPlacements() {
    if (this.options.levelDefinition) {
      return this.options.levelDefinition.tiles.slice()
        .sort((a, b) => a.layer - b.layer || a.id - b.id)
        .map(tile => ({
          x: tile.x,
          y: tile.y,
          layer: tile.layer,
          width: tile.width,
          height: tile.height,
          angle: tile.rotation || 0,
          kind: tile.kind,
        }));
    }

    const placements: Array<TileGeometry & { layer: number; angle: number; kind: number }> = [];
    const addPile = (
      cx: number,
      cy: number,
      base: Array<[number, number]>,
      uppers: Array<Array<[number, number]>>,
    ) => {
      const place = (x: number, y: number, layer: number) => {
        placements.push({
          x: cx + x + this.rand(-4, 4),
          y: cy + y + this.rand(-4, 4),
          layer,
          width: 104,
          height: 107,
          angle: layer === 0 ? this.rand(-3, 3) : this.rand(6, 13) * (Math.random() < 0.5 ? -1 : 1),
          kind: 0,
        });
      };
      base.forEach(([x, y]) => place(x, y, 0));
      uppers.forEach((layerTiles, layerIndex) => layerTiles.forEach(([x, y]) => place(x, y, layerIndex + 1)));
    };

    const towerBase: Array<[number, number]> = [[-56, -112], [56, -112], [-56, 0], [56, 0], [-56, 112], [56, 112]];
    const clusterBase: Array<[number, number]> = [[-56, -56], [56, -56], [-56, 56], [56, 56]];
    addPile(-245, -20, towerBase, [[[-56, -56], [56, 56]], [[0, 0]]]);
    addPile(-15, -20, towerBase, [[[56, -56], [-56, 56]], [[0, 2]]]);
    addPile(215, -20, towerBase, [[[-56, -56], [56, 56]], [[-4, -2]]]);
    addPile(-195, -262, clusterBase, [[[-56, 0], [56, 0]]]);
    addPile(15, -262, clusterBase, [[[0, -56], [0, 56]]]);
    addPile(220, -262, clusterBase, [[[-56, 0], [56, 0]]]);

    const kinds: number[] = [];
    for (let kind = 0; kind < this.gameItemTileIds.length; kind++) {
      kinds.push(kind, kind, kind);
    }
    this.shuffleArray(kinds);
    placements.sort((a, b) => a.layer - b.layer);
    placements.forEach((placement, index) => {
      placement.kind = kinds[index] ?? 0;
    });
    return placements;
  }

  private spawnOpeningPlacements(
    placements: Array<TileGeometry & { layer: number; angle: number; kind: number }>,
    startIndex: number,
  ) {
    if (this.destroyed) return;
    if (startIndex >= placements.length) {
      this.boardIntroSpawning = false;
      this.finishBoardIntroIfIdle();
      return;
    }

    const batchSize = 8;
    const endIndex = Math.min(placements.length, startIndex + batchSize);
    for (let index = startIndex; index < endIndex; index += 1) {
      this.playOpeningTileEntrance(this.makeOpeningTile(placements[index]), index);
    }
    this.sortBoardTileNodes();
    this.updateTargetLabel();

    // 使用性能管理器的批次延迟
    const config = this.performanceManager.getConfig();
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) this.spawnOpeningPlacements(placements, endIndex);
    }, config.batchDelay);
    this.timers.add(timer);
  }

  private makeOpeningTile(placement: TileGeometry & { layer: number; angle: number; kind: number }) {
    const tile = this.makeTile(this.nextTileIndex++, placement, placement.kind);
    this.boardTiles.push(tile);
    return tile;
  }

  private playOpeningTileEntrance(tile: Tile, index: number) {
    if (!tile.node.isValid) return;
    const target = tile.boardPosition.clone();
    const start = this.openingEntryPosition(target, index);
    const opacity = tile.node.getComponent(UIOpacity) || tile.node.addComponent(UIOpacity);
    opacity.opacity = 0;
    tile.node.setPosition(start);
    tile.node.setScale(new Vec3(0.72, 0.72, 1));
    tile.node.angle = tile.boardAngle + (start.x < target.x ? -18 : 18);
    this.boardIntroPending += 1;

    // 根据设备性能调整动画时长
    const pm = this.performanceManager;
    const baseDelay = (index % 8) * 0.024;
    const moveDuration = pm.adjustDuration(0.52);
    const fadeDuration = pm.adjustDuration(0.28);

    tween(tile.node)
      .delay(baseDelay)
      .to(moveDuration, {
        position: target,
        scale: new Vec3(1, 1, 1),
        angle: tile.boardAngle,
      }, { easing: 'cubicOut' })
      .start();
    tween(opacity)
      .delay(baseDelay)
      .to(fadeDuration, { opacity: 255 }, { easing: 'sineOut' })
      .call(() => {
        if (this.destroyed) return;
        this.boardIntroPending = Math.max(0, this.boardIntroPending - 1);
        this.finishBoardIntroIfIdle();
      })
      .start();
  }

  private openingEntryPosition(target: Vec3, index: number) {
    const spread = 520 + (index % 5) * 28;
    const jitterX = this.rand(-40, 40);
    const jitterY = this.rand(-36, 36);
    switch (index % 4) {
      case 0: return new Vec3(-spread + jitterX, target.y + jitterY, 0);
      case 1: return new Vec3(spread + jitterX, target.y + jitterY, 0);
      case 2: return new Vec3(target.x + jitterX, spread * 0.72 + jitterY, 0);
      default: return new Vec3(target.x + jitterX, -spread * 0.72 + jitterY, 0);
    }
  }

  private finishBoardIntroIfIdle() {
    if (this.destroyed || this.boardIntroSpawning || this.boardIntroPending > 0) return;
    if (!this.boardIntroActive) return;
    this.boardIntroActive = false;
    this.checkpointReady = true;
    this.options.onSaveRun?.();
    this.refreshBoardTileStates();
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.updateTargetLabel();
    this.maybeBeginBoardTutorial();
  }

  // 第 1 关新手教学：主线第 1 关且未完成时，在棋盘入场动画结束后开始。
  // tutorialEnabled 由 Main 计算（level===1 && !boardTutorialDone），挑战/无尽不传。
  private maybeBeginBoardTutorial() {
    if (!this.options.tutorialEnabled || this.boardTutorial) return;
    if (this.options.endless || this.options.challenge) return;
    const visibleSize = view.getVisibleSize();
    const headerY = Math.min(590, visibleSize.height / 2 - 145);
    this.boardTutorial = new BoardTutorial({
      uiRoot: this.gameUI,
      bannerY: headerY - 225,
      celebrateY: -70,
      getExposedTiles: () => this.boardTiles
        .filter(tile => tile.active && !tile.inTray && tile.node.isValid && this.isTopTile(tile))
        .map(tile => ({ node: tile.node, kind: tile.kind })),
      onDone: () => {
        this.options.onTutorialDone?.();
        this.trackEvent('tutorial_done', { level: this.options.level, mode: this.playMode() });
      },
    });
    this.boardTutorial.begin();
  }

  private rand(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  private makeTile(index: number, placement: TileGeometry & { layer: number; angle?: number }, kind: number): Tile {
    const node = new Node(`Tile_${index}`);
    this.tweenTargets.add(node);
    this.boardLayer.addChild(node);
    node.setPosition(placement.x, placement.y);
    const angle = placement.angle || 0;
    node.angle = angle;
    node.setSiblingIndex(this.boardLayer.children.length - 1);
    node.addComponent(UITransform).setContentSize(placement.width, placement.height);
    const card = this.image(node, this.gamePath(2), 0, 0, placement.width, placement.height);
    card.name = 'Card';
    const item = this.image(node, this.itemTilePath(kind), 0, 5, 71, 71);
    item.name = 'Item';
    const blockedOverlay = new Node('BlockedOverlay');
    node.addChild(blockedOverlay);
    blockedOverlay.addComponent(UITransform).setContentSize(placement.width, placement.height);
    const overlayGraphics = blockedOverlay.addComponent(Graphics);
    overlayGraphics.fillColor = new Color(82, 82, 82, 112);
    overlayGraphics.roundRect(
      -placement.width / 2,
      -placement.height / 2,
      placement.width,
      placement.height,
      18,
    );
    overlayGraphics.fill();
    blockedOverlay.active = false;
    const targetOverlay = new Node('ToolTargetOverlay');
    node.addChild(targetOverlay);
    targetOverlay.addComponent(UITransform).setContentSize(placement.width, placement.height);
    const targetGraphics = targetOverlay.addComponent(Graphics);
    targetGraphics.strokeColor = new Color(255, 224, 108, 245);
    targetGraphics.lineWidth = 5;
    targetGraphics.roundRect(
      -placement.width / 2 + 5,
      -placement.height / 2 + 5,
      placement.width - 10,
      placement.height - 10,
      18,
    );
    targetGraphics.stroke();
    targetOverlay.active = false;
    const boardPosition = node.position.clone();
    const tile: Tile = {
      node,
      kind,
      row: index,
      col: 0,
      layer: placement.layer,
      width: placement.width,
      height: placement.height,
      boardPosition,
      boardAngle: angle,
      active: true,
      inTray: false,
      card,
      item,
      blockedOverlay,
      targetOverlay,
      geometry: {
        x: boardPosition.x,
        y: boardPosition.y,
        width: placement.width,
        height: placement.height,
        rotation: angle,
      },
    };
    node.on(Node.EventType.TOUCH_END, () => {
      this.onTileTap(tile);
      this.options.onSaveRun?.();
    });
    return tile;
  }

  private refreshBoardTileStates() {
    this.boardTiles.forEach(tile => {
      if (!tile.node.isValid) return;
      // 两个遮罩节点在 makeTile 里创建后就不再增删，直接引用即可，无需字符串查找。
      if (!tile.active || tile.inTray || this.boardIntroActive) {
        tile.blockedOverlay.active = false;
        tile.targetOverlay.active = false;
        return;
      }
      const top = this.isTopTile(tile);
      tile.blockedOverlay.active = !top;
      tile.targetOverlay.active = (this.activeTool === 'hammer' || this.activeTool === 'cat_skill') && top;
    });
    // 教学高亮是「当前暴露牌」的纯函数，棋盘任何变化（收集/道具/放回/补波）都在这里汇聚重算
    this.boardTutorial?.refreshHighlight();
  }

  private onTileTap(tile: Tile) {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    this.consumeTrialIfNeeded();
    if (tile.inTray) {
      this.onTrayTileTap(tile);
      return;
    }
    if (!tile.active) return;
    if (this.activeTool === 'hammer') {
      this.selectHammerTile(tile);
      return;
    }
    if (this.activeTool === 'cat_skill') {
      this.selectCatSkillTile(tile);
      return;
    }
    if (!this.isTopTile(tile)) {
      this.options.onPlaySound('click');
      this.mistakes += 1;
      this.toast('这个元素被遮挡了');
      this.shakeTile(tile);
      return;
    }
    // Reserve the slot as soon as the card is clicked. This keeps rapid taps
    // responsive without allowing an in-flight card to exceed the tray limit.
    if (this.trayTiles.length >= this.trayCapacity) {
      this.options.onPlaySound('click');
      this.toast('收集槽已满');
      return;
    }
    this.options.onPlaySound('collect');
    const availableCount = this.boardTiles.filter(candidate => candidate.active && this.isTopTile(candidate)).length;
    if (availableCount > 1) this.decisionCount += availableCount - 1;
    this.collectTile(tile);
  }

  private onTrayTileTap(tile: Tile) {
    if (!tile.inTray || this.gameOver) return;
    if (this.activeTool === 'hammer') {
      this.options.onPlaySound('click');
      this.toast('锤子只能移除棋盘上的元素');
      return;
    }
    if (this.activeTool === 'cat_skill') {
      this.options.onPlaySound('click');
      this.toast('宠物技能只能清除棋盘上的元素');
      return;
    }
  }

  private shakeTile(tile: Tile) {
    Tween.stopAllByTarget(tile.node);
    tween(tile.node)
      .to(0.05, { scale: new Vec3(1.05, 1.05, 1) })
      .to(0.08, { scale: new Vec3(1, 1, 1) })
      .start();
  }

  private isTopTile(tile: Tile) {
    return !this.boardTiles.some(other => {
      if (!other.active || other.layer <= tile.layer) return false;
      return LevelRules.overlapsGeometry(this.tileGeometry(tile), this.tileGeometry(other));
    });
  }

  // 牌创建时就把几何体算好缓存在 tile.geometry 上，遮挡判定直接复用，
  // 不再每次调用新建对象（牌创建后几何体不变）。
  private tileGeometry(tile: Tile): TileGeometry {
    return tile.geometry;
  }

  private collectTile(tile: Tile) {
    const startWorldPosition = tile.node.worldPosition.clone();
    tile.active = false;
    tile.inTray = true;
    Tween.stopAllByTarget(tile.node);
    tile.node.removeFromParent();
    this.trayFlightLayer.addChild(tile.node);
    this.refreshBoardTileStates();
    // Preserve the clicked card's screen position when moving it into the tray layer.
    tile.node.setWorldPosition(startWorldPosition);
    const startPosition = tile.node.position.clone();
    const slotIndex = this.trayTiles.length;
    const targetPosition = new Vec3(this.traySlotX(slotIndex), 0, 0);
    const startAngle = tile.node.angle;
    tile.node.setScale(new Vec3(1, 1, 1));
    this.trayTiles.push(tile);
    this.pendingTrayAnimations += 1;
    this.collectedTotal++;
    this.updateTargetLabel();
    this.registerCatProgress('collect');
    this.boardTutorial?.notifyTileCollected(tile.kind);
    this.animateTileToTray(tile, startPosition, targetPosition, startAngle);
  }

  private animateTileToTray(tile: Tile, startPosition: Vec3, targetPosition: Vec3, startAngle: number) {
    const horizontalDelta = targetPosition.x - startPosition.x;
    const verticalDelta = targetPosition.y - startPosition.y;
    const distance = Math.sqrt(horizontalDelta * horizontalDelta + verticalDelta * verticalDelta);

    // 动态调整抛物线高度，距离越远弧度越高
    const lift = Math.min(180, Math.max(100, distance * 0.25));

    // 优化贝塞尔曲线控制点，让轨迹更自然
    const controlStart = new Vec3(
      startPosition.x + horizontalDelta * 0.25,
      startPosition.y + lift * 1.1,
      0,
    );
    const controlEnd = new Vec3(
      targetPosition.x - horizontalDelta * 0.15,
      targetPosition.y + lift * 0.45,
      0,
    );

    const direction = horizontalDelta >= 0 ? 1 : -1;
    const motion = { ratio: 0 };
    const targetScale = new Vec3(
      this.traySlotWidth / tile.width,
      this.traySlotHeight / tile.height,
      1,
    );
    this.tweenTargets.add(motion);

    // 添加点击时的轻微缩放反馈
    tile.node.setScale(new Vec3(1.08, 1.08, 1));

    // 使用更丝滑的缓动函数组合
    tween(motion)
      .to(this.trayFlightDuration, { ratio: 1 }, {
        easing: 'sineInOut',  // 改用更柔和的缓动
        onUpdate: () => {
          const ratio = motion.ratio;
          const inverse = 1 - ratio;
          const inverseSquared = inverse * inverse;
          const inverseCubed = inverseSquared * inverse;
          const ratioSquared = ratio * ratio;
          const ratioCubed = ratioSquared * ratio;

          // 三次贝塞尔曲线，更平滑的路径
          const curveX = inverseCubed * startPosition.x
            + 3 * inverseSquared * ratio * controlStart.x
            + 3 * inverse * ratioSquared * controlEnd.x
            + ratioCubed * targetPosition.x;
          const curveY = inverseCubed * startPosition.y
            + 3 * inverseSquared * ratio * controlStart.y
            + 3 * inverse * ratioSquared * controlEnd.y
            + ratioCubed * targetPosition.y;

          // 优化缩放动画，添加弹性效果
          const scaleProgress = ratio < 0.5
            ? ratio * 2  // 前半段快速缩小
            : 1 + (ratio - 0.5) * 0.2;  // 后半段轻微放大
          const arc = Math.sin(Math.PI * ratio * 0.8);  // 减少震荡
          const scaleX = 1.08 + (targetScale.x - 1.08) * scaleProgress + 0.02 * arc;
          const scaleY = 1.08 + (targetScale.y - 1.08) * scaleProgress + 0.02 * arc;

          tile.node.setPosition(curveX, curveY, 0);
          tile.node.setScale(scaleX, scaleY, 1);

          // 优化旋转动画，更自然的翻转
          const rotationArc = Math.sin(Math.PI * ratio);
          tile.node.angle = startAngle * (1 - ratio) + direction * 8 * rotationArc;

          // 添加透明度渐变（可选，让动画更有层次）
          const opacity = tile.node.getComponent(UIOpacity);
          if (opacity) {
            // 在飞行过程中保持完全不透明，只在接近目标时微调
            opacity.opacity = 255;
          }
        },
      })
      .call(() => {
        this.tweenTargets.delete(motion);
        if (this.destroyed) return;
        if (!tile.node.isValid) {
          // 牌被技能等外部路径提前销毁：计数仍要回减并触发结算，
          // 否则 pendingTrayAnimations 卡死，三消与槽满判负从此失效。
          this.pendingTrayAnimations = Math.max(0, this.pendingTrayAnimations - 1);
          this.resolveTrayMatches();
          return;
        }
        tile.node.removeFromParent();
        this.trayLayer.addChild(tile.node);
        tile.node.setPosition(targetPosition);
        tile.node.angle = 0;
        this.resizeTrayTile(tile);
        tile.node.setScale(new Vec3(0.96, 0.96, 1));

        // 检测是否即将形成三连
        const willMatch = this.checkWillMatch(tile.kind);
        // 入槽即结束飞行计数；后续 reflow 会停止节点 tween，不能依赖
        // 落地缩放的回调减计数，否则快速点击会让消除与结算永久等待。
        this.pendingTrayAnimations = Math.max(0, this.pendingTrayAnimations - 1);

        if (willMatch) {
          // 形成三连：极简落地动画，立即触发消除
          tween(tile.node)
            .to(0.06, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'quadOut' })
            .to(0.04, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();

          // 不等动画完成，立即减少计数并触发消除
        } else {
          // 正常的弹性落地动画
          tween(tile.node)
            .to(0.12, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: new Vec3(0.98, 0.98, 1) }, { easing: 'sineOut' })
            .to(0.06, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();
        }
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (!this.destroyed) this.resolveTrayMatches();
        }, willMatch ? 60 : 260);
        this.timers.add(timer);
      })
      .start();
  }

  // 检测某个类型的卡片是否会形成三连
  private checkWillMatch(kind: number): boolean {
    let count = 0;
    for (const tile of this.trayTiles) {
      if (tile.kind === kind) {
        count++;
        if (count >= 2) return true;  // 已有2张，加上当前这张就是3张
      }
    }
    return false;
  }

  private resolveTrayMatches() {
    if (this.gameOver || this.pendingTrayAnimations > 0) return;
    const groups = new Map<number, Tile[]>();
    this.trayTiles.forEach(tile => {
      const group = groups.get(tile.kind) || [];
      group.push(tile);
      groups.set(tile.kind, group);
    });
    const group = Array.from(groups.values()).find(items => items.length >= 3);
    if (this.trayTiles.length >= this.trayCapacity - 1) this.nearFailureCount += 1;
    if (group) {
      this.options.onPlaySound('match');
      this.options.onVibrate();
      const removed = group.slice(0, 3);
      this.trayTiles = this.trayTiles.filter(tile => removed.indexOf(tile) === -1);
      this.matchCount += 1;
      this.boardTutorial?.notifyMatch();
      const combo = this.comboTracker.registerMatch();
      if (combo >= 2) this.showComboFeedback(combo);

      let pendingMatchAnimations = removed.length + 1;
      this.addEliminated(removed.length);
      const goalDone = this.registerCollectProgress(removed[0]?.kind, removed.length);
      this.addCoins(6);
      this.registerCatProgress('match');
      if (goalDone) {
        removed.forEach(tile => {
          Tween.stopAllByTarget(tile.node);
          tween(tile.node)
            .to(0.14, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
            .call(() => {
              if (tile.node.isValid) tile.node.destroy();
            })
            .start();
        });
        this.reflowTray();
        this.finish(true);
        return;
      }
      const continueAfterMatch = () => {
        pendingMatchAnimations -= 1;
        if (pendingMatchAnimations > 0 || this.destroyed || this.gameOver) return;
        this.refillEndlessBoard();
        if (this.boardIntroActive) return;
        if (this.boardTiles.some(tile => tile.active)) this.resolveTrayMatches();
        else if (this.options.endless) this.refillEndlessBoard(true);
        else this.finish(this.hasWonLevel());
      };
      removed.forEach(tile => {
        Tween.stopAllByTarget(tile.node);
        tween(tile.node)
          .to(0.14, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
          .call(() => {
            if (tile.node.isValid) tile.node.destroy();
            continueAfterMatch();
          })
          .start();
      });
      // Start the remaining cards' slide immediately. Waiting for the remove
      // tween to finish first makes the tray visibly pause before it closes.
      this.reflowTray(continueAfterMatch);
      return;
    }
    this.reflowTray();
    this.refillEndlessBoard();
    if (this.boardIntroActive) return;
    if (!this.boardTiles.some(tile => tile.active)) {
      if (this.options.endless) this.refillEndlessBoard(true);
      else this.finish(this.hasWonLevel());
    } else if (this.trayTiles.length >= this.trayCapacity) this.finish(false);
  }

  private buildComboFeedback() {
    const node = new Node('ComboFeedback');
    this.gameUI.addChild(node);
    node.setPosition(0, this.trayLayer.position.y + 285);
    node.addComponent(UITransform).setContentSize(560, 280);

    const glowNode = new Node('ComboGlow');
    node.addChild(glowNode);
    glowNode.addComponent(UITransform).setContentSize(420, 230);
    const glow = glowNode.addComponent(Graphics);
    glow.fillColor = new Color(255, 224, 108, 52);
    glow.roundRect(-200, -108, 400, 216, 84);
    glow.fill();

    // Each tier has baked-in art and text. The Label below stays hidden unless
    // the editor has not imported the matching image yet.
    const badgeNode = this.image(node, 'game/combo_x2', 0, 0, 360, 260);
    badgeNode.name = 'ComboBadge';
    this.comboBadgeSprite = badgeNode.getComponent(Sprite);
    const label = this.label(node, '', 0, 0, 32, new Color(255, 224, 108));
    label.isBold = true;
    label.outlineWidth = 5;
    label.outlineColor = new Color(255, 248, 226);
    label.node.getComponent(UITransform)!.setContentSize(540, 72);
    label.node.active = false;

    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = 0;
    node.setScale(new Vec3(0.8, 0.8, 1));
    this.tweenTargets.add(node);
    this.tweenTargets.add(opacity);
    this.comboFeedbackNode = node;
    this.comboFeedbackLabel = label;
    this.comboFeedbackOpacity = opacity;
    this.comboFeedbackGlow = glow;
  }

  private showComboFeedback(streak: number) {
    if (!this.comboFeedbackNode || !this.comboFeedbackLabel || !this.comboFeedbackOpacity) return;

    this.clearComboParticles();
    Tween.stopAllByTarget(this.comboFeedbackNode);
    Tween.stopAllByTarget(this.comboFeedbackOpacity);

    const strongestTier = streak >= 4;
    const color = strongestTier
      ? new Color(189, 42, 77)
      : streak === 3
        ? new Color(210, 68, 53)
        : new Color(185, 97, 23);
    const badgePath = strongestTier
      ? 'game/combo_x4'
      : streak === 3
        ? 'game/combo_x3'
        : 'game/combo_x2';
    const badgeFrame = this.assets.getFrame(badgePath);
    if (this.comboBadgeSprite && badgeFrame) {
      this.comboBadgeSprite.spriteFrame = badgeFrame;
      if (this.comboFeedbackLabel) this.comboFeedbackLabel.node.active = false;
    } else if (this.comboFeedbackLabel) {
      this.comboFeedbackLabel.node.active = true;
      this.comboFeedbackLabel.string = strongestTier
        ? `太爽了！连消 x${streak}`
        : `连消 x${streak}`;
      this.comboFeedbackLabel.color = color;
    }
    if (this.comboFeedbackGlow) {
      this.comboFeedbackGlow.clear();
      this.comboFeedbackGlow.fillColor = new Color(color.r, color.g, color.b, strongestTier ? 62 : 42);
      this.comboFeedbackGlow.roundRect(-200, -108, 400, 216, 84);
      this.comboFeedbackGlow.fill();
    }

    const particleCount = strongestTier ? 14 : streak === 3 ? 10 : 6;
    for (let index = 0; index < particleCount; index += 1) {
      this.createComboParticle(index, particleCount, color);
    }

    this.comboFeedbackNode.setScale(new Vec3(0.74, 0.74, 1));
    this.comboFeedbackNode.angle = -4;
    this.comboFeedbackOpacity.opacity = 0;
    tween(this.comboFeedbackNode)
      .to(0.2, { scale: new Vec3(1.12, 1.12, 1), angle: 3 }, { easing: 'backOut' })
      .to(0.14, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: 'sineOut' })
      .delay(0.62)
      .to(0.2, { scale: new Vec3(0.94, 0.94, 1), angle: -2 }, { easing: 'quadIn' })
      .start();
    tween(this.comboFeedbackOpacity)
      .to(0.1, { opacity: 255 })
      .delay(0.72)
      .to(0.24, { opacity: 0 }, { easing: 'quadIn' })
      .start();
  }

  private createComboParticle(index: number, total: number, color: Color) {
    if (!this.comboFeedbackNode) return;
    const particle = new Node(`ComboParticle_${index}`);
    this.comboFeedbackNode.addChild(particle);
    particle.addComponent(UITransform).setContentSize(18, 18);
    const graphics = particle.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.circle(0, 0, index % 2 === 0 ? 5 : 4);
    graphics.fill();
    this.comboParticles.add(particle);
    this.tweenTargets.add(particle);

    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const distance = 70 + (index % 3) * 16;
    const motion = { ratio: 0 };
    this.comboParticleMotions.add(motion);
    this.tweenTargets.add(motion);
    tween(motion)
      .to(0.58, { ratio: 1 }, {
        easing: 'quadOut',
        onUpdate: () => {
          const ratio = motion.ratio;
          particle.setPosition(
            Math.cos(angle) * distance * ratio,
            Math.sin(angle) * distance * ratio - 24 * ratio * ratio,
          );
          particle.setScale(new Vec3(1 - ratio * 0.45, 1 - ratio * 0.45, 1));
        },
      })
      .call(() => {
        this.comboParticleMotions.delete(motion);
        this.tweenTargets.delete(motion);
        this.comboParticles.delete(particle);
        this.tweenTargets.delete(particle);
        if (particle.isValid) particle.destroy();
      })
      .start();
  }

  private clearComboParticles() {
    this.comboParticleMotions.forEach(motion => {
      Tween.stopAllByTarget(motion);
      this.tweenTargets.delete(motion);
    });
    this.comboParticleMotions.clear();
    this.comboParticles.forEach(particle => {
      Tween.stopAllByTarget(particle);
      this.tweenTargets.delete(particle);
      if (particle.isValid) particle.destroy();
    });
    this.comboParticles.clear();
  }

  private reflowTray(onComplete?: () => void) {
    const layoutVersion = ++this.trayLayoutVersion;
    const tiles = this.trayTiles.slice();
    if (tiles.length === 0) {
      if (!this.destroyed) onComplete?.();
      return;
    }

    let remaining = tiles.length;
    const completeTile = () => {
      if (layoutVersion !== this.trayLayoutVersion) return;
      remaining -= 1;
      if (remaining === 0 && !this.destroyed) onComplete?.();
    };

    tiles.forEach((tile, index) => {
      if (!tile.node.isValid) {
        completeTile();
        return;
      }
      // A card can be reflowing when the player uses the glove. Stop its old
      // tween before changing parent or assigning the new slot position.
      Tween.stopAllByTarget(tile.node);
      const targetPosition = new Vec3(this.traySlotX(index), 0, 0);
      tween(tile.node)
        .to(this.trayReflowDuration, { position: targetPosition }, { easing: 'cubicOut' })
        .call(completeTile)
        .start();
    });
  }

  private resizeTrayTile(tile: Tile) {
    const node = tile.node;
    node.getComponent(UITransform)!.setContentSize(this.traySlotWidth, this.traySlotHeight);
    tile.card.active = true;
    tile.card.getComponent(UITransform)?.setContentSize(this.traySlotWidth, this.traySlotHeight);
    const cardSprite = tile.card.getComponent(Sprite);
    const trayCardFrame = this.assets.getFrame(this.gamePath(2));
    if (cardSprite && trayCardFrame) cardSprite.spriteFrame = trayCardFrame;
    tile.blockedOverlay.active = false;
    tile.item.setPosition(0, 4);
    tile.item.getComponent(UITransform)?.setContentSize(61, 61);
  }

  private resizeBoardTile(tile: Tile) {
    tile.node.getComponent(UITransform)!.setContentSize(tile.width, tile.height);
    tile.card.active = true;
    tile.card.getComponent(UITransform)?.setContentSize(tile.width, tile.height);
    const cardSprite = tile.card.getComponent(Sprite);
    const boardCardFrame = this.assets.getFrame(this.gamePath(2));
    if (cardSprite && boardCardFrame) cardSprite.spriteFrame = boardCardFrame;
    tile.item.setPosition(0, 5);
    tile.item.getComponent(UITransform)?.setContentSize(71, 71);
  }

  private traySlotX(index: number) {
    return this.trayFirstSlotX + index * this.traySlotSpacing;
  }

  private updateTargetLabel() {
    if (this.options.endless) {
      this.refreshEndlessHud();
      return;
    }
    const collectGoal = this.levelCollectGoal();
    if (collectGoal && this.collectGoalProgressLabel) {
      this.collectGoalProgressLabel.string = `${this.collectProgress}/${collectGoal.count}`;
    }
    if (this.targetLabel) {
      this.targetLabel.string = collectGoal
        ? `已收集 ${this.collectProgress} / ${collectGoal.count}`
        : `已收集 ${this.collectedTotal} / ${this.boardTiles.length || this.options.levelDefinition?.tiles.length || 45}`;
    }
  }

  private levelCollectGoal(): Extract<LevelGoal, { type: 'collect_kind' }> | null {
    if (this.options.challenge || this.options.endless) return null;
    return LevelRules.collectGoal(this.options.levelDefinition?.goal);
  }

  private hasCompletedCollectGoal() {
    const collectGoal = this.levelCollectGoal();
    return !!collectGoal && LevelRules.hasWon(collectGoal, 0, this.collectProgress);
  }

  private hasWonLevel() {
    if (this.options.endless) return false;
    return LevelRules.hasWon(
      this.levelCollectGoal() || undefined,
      this.boardTiles.filter(tile => tile.active).length,
      this.collectProgress,
    );
  }

  /** 三消计入收集进度；达标返回 true，调用方应立即胜利。 */
  private registerCollectProgress(kind: number | undefined, count: number) {
    const collectGoal = this.levelCollectGoal();
    if (!collectGoal || kind !== collectGoal.kind || count <= 0) return false;
    this.collectProgress += count;
    this.updateTargetLabel();
    if (this.collectGoalHud?.isValid) {
      Tween.stopAllByTarget(this.collectGoalHud);
      this.collectGoalHud.setScale(new Vec3(0.92, 0.92, 1));
      tween(this.collectGoalHud)
        .to(0.12, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'quadOut' })
        .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    }
    return this.hasCompletedCollectGoal();
  }

  private remainingCollectKindCount(kinds?: number[]) {
    const collectGoal = this.levelCollectGoal();
    if (!collectGoal) return 0;
    const source = kinds || this.boardTiles
      .filter(tile => tile.active && !tile.inTray)
      .map(tile => tile.kind);
    const boardCount = source.filter(kind => kind === collectGoal.kind).length;
    const trayCount = this.trayTiles.filter(tile => tile.kind === collectGoal.kind).length;
    return this.collectProgress + boardCount + trayCount;
  }

  private maybeShowCollectGoalHint() {
    const collectGoal = this.levelCollectGoal();
    if (!collectGoal) return;
    if (this.options.shouldShowCollectGoalHint && !this.options.shouldShowCollectGoalHint()) return;
    this.options.onCollectGoalHintShown?.();
    const name = this.itemNames[collectGoal.kind] || '指定元素';
    this.toast(`三消${name}即可过关，不必清空棋盘`);
  }

  private startEndlessHud() {
    this.refreshEndlessHud();
    this.endlessHudTimer = setInterval(() => {
      if (this.destroyed || this.gameOver) return;
      this.refreshEndlessHud();
    }, 1000);
  }

  private refreshEndlessHud() {
    if (!this.endlessHudLabel || !this.endlessDirector) return;
    const elapsed = this.endlessDirector.elapsedMs();
    this.endlessStage = this.endlessDirector.currentStage().stage;
    this.endlessHudLabel.string = `已消除 ${this.eliminatedCount} · 坚持 ${this.formatEndlessDuration(elapsed)}`;
  }

  private formatEndlessDuration(durationMs: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private addEliminated(count: number) {
    if (count <= 0) return;
    this.eliminatedCount += count;
    this.refreshEndlessHud();
  }

  private refillEndlessBoard(force = false) {
    if (!this.endlessDirector || this.destroyed || this.gameOver) return;
    if (this.pendingTrayAnimations > 0) return;
    if (this.boardIntroActive && !force) return;
    this.boardTiles = this.boardTiles.filter(tile =>
      tile.inTray || (tile.active && tile.node.isValid));
    const active = this.boardTiles.filter(tile => tile.active && !tile.inTray);
    let minLayer: number | null = null;
    let maxLayer: number | null = null;
    active.forEach(tile => {
      minLayer = minLayer === null ? tile.layer : Math.min(minLayer, tile.layer);
      maxLayer = maxLayer === null ? tile.layer : Math.max(maxLayer, tile.layer);
    });
    const trayCounts: number[] = [];
    this.trayTiles.forEach(tile => {
      trayCounts[tile.kind] = (trayCounts[tile.kind] || 0) + 1;
    });
    const wave = this.endlessDirector.nextWave({
      activeCount: active.length,
      minLayer,
      maxLayer,
      trayCounts,
      force,
    });
    if (!wave) return;
    this.spawnWaveTiles(wave.tiles);
    this.endlessStage = wave.stage;
    this.refreshBoardTileStates();
    this.refreshEndlessHud();
  }

  private spawnWaveTiles(tiles: TileDefinition[]) {
    const sorted = tiles.slice().sort((a, b) => a.layer - b.layer || a.id - b.id);
    const intro = this.boardIntroActive;
    if (intro) this.boardIntroSpawning = true;
    sorted.forEach((tile, index) => {
      const created = this.makeTile(this.nextTileIndex++, {
        x: tile.x,
        y: tile.y,
        layer: tile.layer,
        width: tile.width,
        height: tile.height,
        angle: tile.rotation || 0,
      }, tile.kind);
      this.boardTiles.push(created);
      if (intro) {
        this.playOpeningTileEntrance(created, index);
        return;
      }
      created.node.setPosition(tile.x, tile.y - 18);
      created.node.setScale(new Vec3(0.94, 0.94, 1));
      tween(created.node)
        .to(0.22, {
          position: new Vec3(tile.x, tile.y, 0),
          scale: new Vec3(1, 1, 1),
        }, { easing: 'cubicOut' })
        .start();
    });
    this.sortBoardTileNodes();
    if (intro) {
      this.boardIntroSpawning = false;
      this.finishBoardIntroIfIdle();
    }
  }

  private requestLeave() {
    if (this.gameOver) {
      this.options.onReturnHome();
      return;
    }
    if (this.boardIntroActive) {
      this.options.onReturnHome();
      return;
    }
    this.showLeaveConfirm();
  }

  private showLeaveConfirm() {
    if (this.leaveConfirmNode?.isValid) return;
    const overlay = new Node('LeaveConfirm');
    this.gameUI.addChild(overlay);
    this.leaveConfirmNode = overlay;
    const visibleSize = view.getVisibleSize();
    overlay.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    overlay.addComponent(BlockInputEvents);
    const backdrop = overlay.addComponent(Graphics);
    backdrop.fillColor = new Color(22, 18, 13, 190);
    backdrop.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdrop.fill();

    const panel = this.addPanel('LeavePanel', 0, 20, 580, 280, new Color(255, 248, 226, 255), overlay);
    const panelGraphics = panel.getComponent(Graphics);
    if (panelGraphics) {
      panelGraphics.strokeColor = new Color(235, 205, 158);
      panelGraphics.lineWidth = 3;
      panelGraphics.roundRect(-290, -140, 580, 280, 24);
      panelGraphics.stroke();
    }
    const title = this.label(panel, '确定离开吗？', 0, 78, 30, new Color(111, 62, 28));
    title.isBold = true;
    const messageText = this.options.endless ? '本局进度将结束并结算' : '返回后本局进度将丢失';
    const message = this.label(panel, messageText, 0, 28, 22, new Color(112, 69, 40));
    message.isBold = true;

    this.buildLeaveConfirmButton(panel, this.options.endless ? '继续挑战' : '继续游戏', -126, -72, new Color(139, 196, 74), () => {
      this.closeLeaveConfirm();
    });
    this.buildLeaveConfirmButton(
      panel,
      this.options.endless ? '结束并结算' : '返回首页',
      126,
      -72,
      new Color(241, 139, 47),
      () => {
        this.closeLeaveConfirm();
        if (this.options.endless) this.finish(false);
        else {
          this.trackEvent('level_home', { ...this.levelTrackProps(), mid_run: true });
          this.options.onReturnHome();
        }
      },
    );
  }

  private buildLeaveConfirmButton(
    parent: Node,
    text: string,
    x: number,
    y: number,
    fill: Color,
    onClick: () => void,
  ) {
    const node = new Node(`LeaveConfirm_${text}`);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(220, 88);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = fill;
    graphics.strokeColor = new Color(90, 61, 38, 80);
    graphics.lineWidth = 3;
    graphics.roundRect(-110, -36, 220, 72, 18);
    graphics.fill();
    graphics.stroke();
    SettlementButton.apply(node, x < 0 ? 'primary' : 'secondary', 220, 88);
    const label = this.label(node, text, 0, 0, 24, new Color(111, 62, 28));
    SettlementButton.styleLabel(label, 220, 88);
    label.isBold = true;
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onClick();
    });
  }

  private closeLeaveConfirm() {
    if (this.leaveConfirmNode?.isValid) this.leaveConfirmNode.destroy();
    this.leaveConfirmNode = null;
  }

  private finish(win: boolean) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.clearToolMode();
    // 把本局累计的技能充能写回存档，换猫/重开都不会丢进度
    if (this.equippedCatId && this.catSkill) {
      this.options.onCatSkillCharge(this.equippedCatId, this.catSkill.charge);
    }
    const failHadPair = !win && this.trayHasPair();
    const failProgress = this.failProgressPercent();
    if (!this.performanceReported && !this.options.endless) {
      this.performanceReported = true;
      this.options.onPerformance({
        won: win,
        level: this.options.level,
        remainingSlots: Math.max(0, this.trayCapacity - this.trayTiles.length),
        mistakes: this.mistakes,
        elapsedMs: (this.pausedAt || Date.now()) - this.startedAt,
        decisionCount: this.decisionCount,
        nearFailureCount: this.nearFailureCount,
        collectedElements: this.collectedTotal,
        matchCount: this.matchCount,
        role: this.options.levelDefinition?.role,
        failProgress: win ? undefined : failProgress,
        failHadPair: win ? undefined : failHadPair,
      });
    }
    if (!this.options.endless && !this.options.challenge) {
      if (!win && !this.reviveUsed) {
        this.options.onAdFunnel?.({
          level: this.options.level,
          fail: true,
          failHadPair,
          failProgress,
        });
      } else if (win && this.reviveUsed) {
        this.options.onAdFunnel?.({
          level: this.options.level,
          reviveWin: true,
        });
      }
    }
    this.closeLeaveConfirm();
    this.trackEvent('level_end', {
      ...this.levelTrackProps(),
      result: this.options.endless ? 'endless' : (win ? 'win' : 'fail'),
      duration_ms: (this.pausedAt || Date.now()) - this.startedAt,
      collected: this.collectedTotal,
      match_count: this.matchCount,
      remaining_slots: Math.max(0, this.trayCapacity - this.trayTiles.length),
      fail_had_pair: win ? null : failHadPair,
      fail_progress: win ? null : failProgress,
      revive_used: this.reviveUsed,
      used_items: Array.from(this.usedTools),
    });
    // 试住对局结算：有效对局结束上报结果；第 5 局结束再补 expire
    //（建筑完成转正走 syncUnlocks 的 cat_trial_converted，这里不重复）。
    if (!this.options.challenge && !this.options.endless && this.trialStartRemaining !== null) {
      const remainingGames = Math.max(
        0,
        this.trialConsumedForRun ? this.trialStartRemaining - 1 : this.trialStartRemaining,
      );
      const trialResult = win ? 'win' : 'fail';
      this.trackEvent('cat_trial_game_end', {
        level: this.options.level,
        remaining_games: remainingGames,
        trial_result: trialResult,
        skill_used: this.catSkillUsed,
      });
      if (remainingGames <= 0) {
        this.trackEvent('cat_trial_expire', { level: this.options.level, trial_result: trialResult });
      }
    }
    this.options.onPlaySound(this.options.endless || win ? 'win' : 'fail');
    this.options.onVibrate();
    if (this.options.endless) {
      this.openEndlessSettlement();
      return;
    }
    // 过关固定奖励 3 星：主题 1–5 每章 20 关 × 3 星 = 60 星，正好点亮对应建筑；
    // 主题 6+ 仍发 3 星，但不再对应新建筑。超萌挑战不计入关卡进度，改发大额金币。
    const challenge = this.options.challenge;
    const starReward = win && !challenge ? 3 : 0;
    const coinReward = win ? (challenge ? challenge.coinReward : 50) : 0;
    this.settlementWin = win;
    this.settlementCoinReward = coinReward;
    this.doubleRewardUsed = false;
    if (win) {
      this.addCoins(coinReward);
      if (!challenge) this.options.onStarsGranted(starReward);
      else this.options.onChallengeWin?.((this.pausedAt || Date.now()) - this.startedAt);
    }
    const collectFailed = !win && !!this.levelCollectGoal() && !this.hasCompletedCollectGoal()
      && !this.boardTiles.some(tile => tile.active);
    this.settlementPopup = SettlementPopup.open(this.gameUI, this.assets, {
      win,
      challenge: !!challenge,
      level: this.options.level,
      stars: starReward,
      starReward,
      coinReward,
      rating: win ? this.calculateRating() : '未完成',
      failTitle: collectFailed ? '目标元素不足' : undefined,
      failMessage: collectFailed ? '锤子和技能不计入收集进度，再试一次吧' : undefined,
      nextButtonLabel: !challenge && win && this.options.level >= MAX_MAIN_LEVEL ? '完成冒险' : undefined,
      onNextLevel: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_next', this.levelTrackProps());
        this.options.onNextLevel();
      },
      onReturnHome: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_home', { ...this.levelTrackProps(), mid_run: false });
        this.options.onReturnHome();
      },
      onReplay: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_replay', this.levelTrackProps());
        this.options.onReplay();
      },
      onDoubleRewardAd: this.options.onDoubleRewardAd,
      rewardMode: this.options.rewardMode,
      onTrack: this.options.onTrack,
      // 复活每局只开放一次；复活后再次失败时不再展示无效按钮。
      onRevive: win || this.reviveUsed ? undefined : () => this.reviveFromAd(),
      onReviveAd: this.options.onReviveAd,
      // 连败中打难关（spike）失败送一次免费复活（不看广告不分享，走同一套清对子逻辑）：
      // 连败 1 次不再取消难关后，需要这个兜底避免难关变成纯劝退点。
      freeRevive: !win && !this.reviveUsed && !challenge && (this.options.level <= 5 || this.options.levelDefinition?.freeRevive === true),
      hadTrayPair: !win ? failHadPair : undefined,
      onDoubleReward: win ? () => this.doubleRewardFromAd() : undefined,
      share: win
        ? (() => {
          const offer = this.options.getShareOffer?.();
          return offer ? {
            ...offer,
            onShare: () => {
              this.options.onPlaySound('click');
              this.options.onShare?.(offer.type);
            },
          } : undefined;
        })()
        : undefined,
      buildTarget: win && !challenge ? this.composeBuildTarget() : undefined,
      onGoBuild: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_go_build', this.levelTrackProps());
        this.options.onGoBuild?.();
      },
    });
    this.trackEvent('page_view', { page_id: 'settlement', ...this.levelTrackProps(), result: win ? 'win' : 'fail' });
  }

  /** 主线成功结算的建设目标行：星够给「点击前往」入口，不够给差值文案；无可建建筑返回空 */
  private composeBuildTarget() {
    const target = this.options.getBuildTargetInfo?.();
    if (!target) return undefined;
    const label = `「${target.buildingName}·${target.stageName}」`;
    return {
      text: target.starsNeeded === 0
        ? `已够点亮${label}下一格`
        : `再赢 ${target.starsNeeded} 星点亮${label}下一格`,
      canBuild: target.starsNeeded === 0,
    };
  }

  private recordEndlessIfNeeded() {
    const endless = this.options.endless;
    if (!endless || this.endlessRecorded) return null;
    this.endlessRecorded = true;
    const durationMs = (this.pausedAt || Date.now()) - this.startedAt;
    const result = endless.onFinish({
      eliminated: this.eliminatedCount,
      durationMs,
      stage: this.endlessDirector?.currentStage().stage ?? this.endlessStage,
      matchCount: this.matchCount,
    });
    this.coins = this.options.getCoins();
    return { durationMs, result };
  }

  private openEndlessSettlement() {
    const recorded = this.recordEndlessIfNeeded();
    const endless = this.options.endless;
    if (!endless) return;
    const durationMs = recorded?.durationMs ?? (this.pausedAt || Date.now()) - this.startedAt;
    const result = recorded?.result ?? {
      coins: 0,
      isNewRecord: false,
      bestEliminated: endless.bestEliminated,
    };
    this.settlementPopup?.close();
    this.settlementPopup = null;
    this.settlementWin = true;
    this.settlementCoinReward = result.coins;
    this.doubleRewardUsed = false;
    this.settlementPopup = SettlementPopup.open(this.gameUI, this.assets, {
      win: true,
      endless: {
        eliminated: this.eliminatedCount,
        durationMs,
        stage: this.endlessDirector?.currentStage().stage ?? this.endlessStage,
        bestEliminated: result.bestEliminated,
        isNewRecord: result.isNewRecord,
      },
      level: this.options.level,
      stars: 0,
      starReward: 0,
      coinReward: result.coins,
      rating: '无尽挑战',
      onNextLevel: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_replay', this.levelTrackProps());
        this.options.onReplay();
      },
      onReturnHome: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_home', { ...this.levelTrackProps(), mid_run: false });
        this.options.onReturnHome();
      },
      onReplay: () => {
        this.options.onPlaySound('click');
        this.trackEvent('level_replay', this.levelTrackProps());
        this.options.onReplay();
      },
      onDoubleRewardAd: result.coins > 0 ? this.options.onDoubleRewardAd : undefined,
      rewardMode: this.options.rewardMode,
      onTrack: this.options.onTrack,
      onDoubleReward: result.coins > 0 ? () => this.doubleRewardFromAd() : undefined,
      share: result.isNewRecord
        ? (() => {
          const offer = this.options.getShareOffer?.({ isNewRecord: true });
          return offer ? {
            ...offer,
            onShare: () => {
              this.options.onPlaySound('click');
              this.options.onShare?.(offer.type);
            },
          } : undefined;
        })()
        : undefined,
    });
    this.trackEvent('page_view', { page_id: 'settlement', ...this.levelTrackProps(), result: 'endless' });
  }

  private reviveFromAd() {
    if (!this.gameOver || this.reviveUsed || this.trayTiles.length === 0) return;
    const pairKind = this.pickRevivePairKind();
    const pair = pairKind === null
      ? []
      : this.trayTiles.filter(tile => tile.kind === pairKind).slice(-2);
    const removed = pair.length >= 2
      ? pair
      : this.trayTiles.slice(-1);
    if (removed.length === 0) return;

    const freeRevive = !this.options.challenge && (this.options.level <= 5 || this.options.levelDefinition?.freeRevive === true);
    this.reviveUsed = true;
    this.gameOver = false;
    this.settlementPopup?.close();
    this.settlementPopup = null;
    this.trayTiles = this.trayTiles.filter(tile => removed.indexOf(tile) === -1);

    const goal = this.levelCollectGoal();
    const protectGoal = !!goal && removed[0].kind === goal.kind
      && this.remainingCollectKindCount() < goal.count;
    const needReturn = removed.length >= 2
      && !this.boardTiles.some(tile => tile.active && !tile.inTray && this.isTopTile(tile) && tile.kind === removed[0].kind);
    const returned = protectGoal ? removed : needReturn ? removed.slice(-1) : [];
    const destroyed = removed.filter(tile => returned.indexOf(tile) === -1);
    returned.forEach(tile => this.restoreTileToBoard(tile));
    this.addEliminated(destroyed.length);

    destroyed.forEach(tile => {
      tile.inTray = false;
      tile.active = false;
      Tween.stopAllByTarget(tile.node);
      tween(tile.node)
        .to(0.14, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
        .call(() => {
          if (tile.node.isValid) tile.node.destroy();
        })
        .start();
    });
    this.reflowTray();
    this.refreshBoardTileStates();
    this.refreshToolButtons();
    this.options.onSaveRun?.();
    this.options.onPlaySound('match');
    this.options.onVibrate();
    if (!this.options.endless && !this.options.challenge) {
      this.options.onAdFunnel?.({
        level: this.options.level,
        freeRevive,
      });
    }
    const prefix = freeRevive ? '免费复活成功' : '复活成功';
    this.toast(returned.length > 0
      ? `${prefix}，腾出槽位并将 ${returned.length} 张放回棋盘`
      : removed.length >= 2
        ? `${prefix}，清出一对，腾出了 2 个槽位`
        : `${prefix}，清空了 1 个槽位`);
  }

  private trayHasPair() {
    const counts = new Map<number, number>();
    for (const tile of this.trayTiles) {
      const count = (counts.get(tile.kind) || 0) + 1;
      if (count >= 2) return true;
      counts.set(tile.kind, count);
    }
    return false;
  }

  private failProgressPercent() {
    const total = this.boardTiles.length || this.options.levelDefinition?.tiles.length || 0;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((this.collectedTotal / total) * 100)));
  }

  private pickRevivePairKind() {
    const counts = new Map<number, number>();
    this.trayTiles.forEach(tile => {
      counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1);
    });
    let bestKind: number | null = null;
    let bestCount = 1;
    let bestRight = -1;
    counts.forEach((count, kind) => {
      if (count < 2) return;
      const right = this.trayTiles.map((tile, index) => tile.kind === kind ? index : -1)
        .reduce((max, index) => Math.max(max, index), -1);
      if (count > bestCount || (count === bestCount && right > bestRight)) {
        bestKind = kind;
        bestCount = count;
        bestRight = right;
      }
    });
    return bestKind;
  }

  private restoreTileToBoard(tile: Tile) {
    Tween.stopAllByTarget(tile.node);
    tile.node.removeFromParent();
    this.boardLayer.addChild(tile.node);
    tile.node.setPosition(tile.boardPosition);
    tile.node.setScale(new Vec3(0.84, 0.84, 1));
    tile.node.angle = tile.boardAngle;
    tile.active = true;
    tile.inTray = false;
    this.resizeBoardTile(tile);
    this.sortBoardTileNodes();
    tween(tile.node)
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  private doubleRewardFromAd() {
    if (!this.settlementWin || this.doubleRewardUsed || this.settlementCoinReward <= 0) return;
    this.doubleRewardUsed = true;
    this.addCoins(this.settlementCoinReward);
    this.toast(`${this.options.rewardMode === 'share' ? '分享奖励' : '视频奖励'}：金币 +${this.settlementCoinReward}`);
  }

  // 星星固定 3 颗后，结算评价按底部空闲槽位区分表现（沿用原星级分档边界）
  private calculateRating() {
    const freeSlots = Math.max(0, this.trayCapacity - this.trayTiles.length);
    if (freeSlots >= 4) return '完美';
    if (freeSlots >= 2) return '表现不错';
    return '完成挑战';
  }

  private buildToolButton(
    itemId: ItemId,
    name: string,
    x: number,
    y: number,
    elementId: number,
    callback: () => void,
  ) {
    const activePath = this.toolPath(elementId);
    const buttonNode = new Node(`Tool_${name}`);
    this.gameUI.addChild(buttonNode);
    buttonNode.setPosition(x, y);
    buttonNode.addComponent(UITransform).setContentSize(128, 128);
    const activeFrame = new Node('ActiveFrame');
    buttonNode.addChild(activeFrame);
    activeFrame.addComponent(UITransform).setContentSize(116, 116);
    const activeGraphics = activeFrame.addComponent(Graphics);
    activeGraphics.fillColor = new Color(255, 224, 108, 72);
    activeGraphics.strokeColor = new Color(255, 224, 108, 245);
    activeGraphics.lineWidth = 5;
    activeGraphics.roundRect(-58, -58, 116, 116, 20);
    activeGraphics.fill();
    activeGraphics.stroke();
    activeFrame.active = false;
    const icon = this.image(buttonNode, activePath, 0, 0, 84, 82);
    icon.name = 'Icon';
    const countBadge = new Node('ToolCountBadge');
    buttonNode.addChild(countBadge);
    countBadge.setPosition(42, -34);
    countBadge.addComponent(UITransform).setContentSize(44, 44);
    const countBackground = countBadge.addComponent(Graphics);
    countBackground.fillColor = new Color(190, 59, 51, 255);
    countBackground.strokeColor = new Color(255, 248, 226, 255);
    countBackground.lineWidth = 3;
    countBackground.circle(0, 0, 20);
    countBackground.fill();
    countBackground.stroke();
    const count = this.label(countBadge, `${this.options.getItemCount(itemId)}`, 0, 0, 22, Color.WHITE);
    count.isBold = true;
    count.outlineWidth = 3;
    count.outlineColor = new Color(90, 61, 38);
    this.toolNameBadge(buttonNode, name, 82);
    const button = buttonNode.addComponent(Button);
    ensureButtonControl(button);
    this.toolButtonViews.set(itemId, {
      node: buttonNode,
      button,
      countLabel: count,
      badgeNode: countBadge,
      badgeGraphics: countBackground,
      icon,
      activeFrame,
    });
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.consumeTrialIfNeeded();
      // 道具用完：不再直接吃掉点击，改为拉起「每日免费补给」
      if (this.options.getItemCount(itemId) <= 0) {
        this.options.onToolSupplyGet?.(itemId);
        this.refreshToolButtons();
        return;
      }
      callback();
      this.refreshToolButtons();
    });
    this.refreshToolButtons();
    return buttonNode;
  }

  private refreshToolButtons() {
    this.options.onSaveRun?.();
    const supplyEnabled = !!this.options.onToolSupplyGet;
    this.toolButtonViews.forEach((viewData, itemId) => {
      const count = Math.max(0, this.options.getItemCount(itemId));
      const used = this.usedTools.has(itemId);
      // 数量为 0 且可免费补给：不置灰，改用金色「+」角标表达「点我获取」
      const claimable = count <= 0 && supplyEnabled && !used;
      viewData.countLabel.string = used ? '✓' : claimable ? '+' : `${count}`;
      viewData.countLabel.fontSize = claimable ? 34 : 22;
      viewData.countLabel.lineHeight = claimable ? 40 : 30;
      viewData.countLabel.color = Color.WHITE;
      // 数量为 0 时仍可点击（走免费补给）；已用过 / 结算中才禁用
      viewData.button.interactable = (count > 0 || (supplyEnabled && !used))
        && !this.gameOver
        && !this.boardIntroActive;
      viewData.activeFrame.active = itemId === 'hammer' && this.activeTool === 'hammer';
      const sprite = viewData.icon.getComponent(Sprite);
      if (sprite) {
        // 图标永远保持全彩（除非本局已用），避免「置灰 = 不能点」的误解
        sprite.color = used ? new Color(178, 169, 150, 220) : Color.WHITE;
      }
      // 角标状态：红底数字（有货）/ 金底加号（空了可免费补给）/ 灰底对勾（本局已用）
      const badgeGraphics = viewData.badgeGraphics;
      badgeGraphics.clear();
      badgeGraphics.fillColor = used
        ? new Color(205, 197, 180, 235)
        : claimable ? new Color(255, 187, 47) : new Color(190, 59, 51);
      badgeGraphics.strokeColor = Color.WHITE;
      badgeGraphics.lineWidth = 3;
      badgeGraphics.circle(0, 0, 20);
      badgeGraphics.fill();
      badgeGraphics.stroke();
      // 可补领的「+」角标轻微呼吸，把「还能拿到」的信号顶出来
      Tween.stopAllByTarget(viewData.badgeNode);
      viewData.badgeNode.setScale(new Vec3(1, 1, 1));
      if (claimable) {
        tween(viewData.badgeNode)
          .repeatForever(
            tween()
              .to(0.6, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'sineInOut' })
              .to(0.6, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
          )
          .start();
      }
    });
  }

  private clearToolMode() {
    this.activeTool = null;
    if (!this.destroyed && this.boardLayer) this.refreshBoardTileStates();
    this.refreshToolButtons();
  }

  private toolNameBadge(parent: Node, name: string, iconHeight: number) {
    const fontSize = 20;
    const padding = 8;
    const badgeWidth = name.length * fontSize + padding * 2;
    const badgeHeight = fontSize + 8 + padding * 2;
    const badge = new Node('ToolNameBadge');
    parent.addChild(badge);
    badge.setPosition(0, -(iconHeight / 2 + 15 + badgeHeight / 2));
    badge.addComponent(UITransform).setContentSize(badgeWidth, badgeHeight);
    const background = badge.addComponent(Graphics);
    background.fillColor = new Color(255, 248, 226, 255);
    background.strokeColor = new Color(235, 205, 158, 255);
    background.lineWidth = 3;
    background.roundRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 8);
    background.fill();
    background.stroke();

    const text = this.label(badge, name, 0, 0, fontSize, new Color(91, 53, 34));
    text.isBold = true;
    text.outlineWidth = 2;
    text.outlineColor = new Color(255, 248, 226, 255);
    text.verticalAlign = Label.VerticalAlign.CENTER;
    text.node.getComponent(UITransform)!.setContentSize(
      badgeWidth - padding * 2,
      badgeHeight - padding * 2,
    );
  }

  private playToolUseAnimation(itemId: ItemId) {
    const viewData = this.toolButtonViews.get(itemId);
    if (!viewData) return;
    const buttonNode = viewData.node;
    Tween.stopAllByTarget(buttonNode);
    buttonNode.setScale(new Vec3(1, 1, 1));
    tween(buttonNode)
      .to(0.08, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
      .start();

    const flash = new Node('ToolUseFlash');
    buttonNode.addChild(flash);
    flash.addComponent(UITransform).setContentSize(136, 136);
    const flashGraphics = flash.addComponent(Graphics);
    flashGraphics.strokeColor = new Color(255, 224, 108, 245);
    flashGraphics.lineWidth = 5;
    flashGraphics.circle(0, 0, 54);
    flashGraphics.stroke();
    const opacity = flash.addComponent(UIOpacity);
    opacity.opacity = 230;
    tween(flash)
      .to(0.26, { scale: new Vec3(1.18, 1.18, 1) }, { easing: 'cubicOut' })
      .start();
    tween(opacity)
      .to(0.26, { opacity: 0 }, { easing: 'cubicOut' })
      .call(() => {
        if (flash.isValid) flash.destroy();
      })
      .start();
  }

  private addTraySlot() {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    if (this.usedTools.has('extra_slot')) {
      this.toast('增加槽位本局已经使用过了');
      return;
    }
    this.clearToolMode();
    if (this.extraTraySlot) {
      this.toast('额外槽位本局已经开启');
      return;
    }
    if (!this.options.onConsumeItem('extra_slot')) {
      this.toast('增加槽位道具不足');
      return;
    }
    this.extraTraySlot = true;
    this.usedTools.add('extra_slot');
    this.trayCapacity = this.baseTraySlots + 1;
    const frame = this.assets.getFrame(this.toolPath(11));
    const sprite = this.extraSlotNode?.getComponent(Sprite);
    if (frame && sprite) sprite.spriteFrame = frame;
    this.playToolUseAnimation('extra_slot');
    if (this.extraSlotNode?.isValid) {
      Tween.stopAllByTarget(this.extraSlotNode);
      tween(this.extraSlotNode)
        .to(0.1, { scale: new Vec3(1.16, 1.16, 1) }, { easing: 'backOut' })
        .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
        .start();
    }
    this.toast(`已开启第 ${this.trayCapacity} 个收集槽位`);
    this.refreshToolButtons();
  }

  private useGlove() {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    if (this.usedTools.has('glove')) {
      this.toast('手套本局已经使用过了');
      return;
    }
    this.clearToolMode();
    if (this.trayTiles.length === 0) {
      this.toast('卡槽里还没有可撤回的元素');
      return;
    }
    // 手套固定撤回最后放入卡槽的牌，避免玩家在危急时刻还要多做一次选择。
    this.returnTrayTile(this.trayTiles[this.trayTiles.length - 1]);
  }

  // —— 装备猫咪技能 ——
  // 充能完成后玩家手动发动，每局一次；充能随本地存档保留。
  private registerCatProgress(type: 'collect' | 'match') {
    const skill = this.catSkill;
    const config = this.catSkillConfig;
    if (!skill || !config || this.gameOver || config.chargeType !== type) return;
    const required = getCatSkillChargeRequired(this.equippedCatId!, skill.level);
    skill.charge = Math.min(required, skill.charge + 1);
    this.refreshCatSkillPanel();
  }

  private onCatSkillTap() {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    if (!this.equippedCatId || !this.catSkill || !this.catSkillConfig) {
      // 一只都没解锁时把玩法链条讲清楚：装饰建筑 → 解锁猫咪 → 装备出战；
      // 建筑名取下一格待建目标（第一个未建成建筑），没有快照时用通用说法兜底。
      const anyUnlocked = this.options.hasAnyUnlockedCat?.() ?? false;
      this.toast(anyUnlocked
        ? '还没有上阵宠物，去首页猫咪社装备一只吧'
        : `装饰完成「${this.options.getBuildTargetInfo?.()?.buildingName ?? '小镇建筑'}」解锁猫咪，装备后技能帮你闯关`);
      return;
    }
    // 有宠物可点 = 玩家开始操作，试住次数在此时才消耗
    this.consumeTrialIfNeeded();
    // 选择目标阶段再点一次宠物 = 取消；已确认过目标则结束选择、放弃剩余次数
    if (this.activeTool === 'cat_skill') {
      const consumed = this.catSkillUsed;
      this.clearToolMode();
      this.catSkillPicksLeft = 0;
      this.refreshCatSkillPanel();
      this.toast(consumed ? '已结束宠物技能选择' : '已取消宠物技能选择');
      return;
    }
    if (this.catSkillUsed) {
      this.toast('本局技能已经发动过啦');
      return;
    }
    const required = getCatSkillChargeRequired(this.equippedCatId, this.catSkill.level);
    if (this.catSkill.charge < required) {
      this.toast(`技能还需要充能 ${required - this.catSkill.charge} 次`);
      return;
    }
    if (Date.now() < this.catSkill.readyAt) {
      this.toast(`技能还在冷却中，请等待 ${this.formatCatSkillRemaining(this.catSkill.readyAt - Date.now())}`);
      return;
    }
    // 清除棋盘元素的技能和锤子一样由玩家自选目标，确认第一个目标时才结算本局充能
    if (this.catSkillConfig.effect === 'clear_board' || this.catSkillConfig.effect === 'clear_board_double') {
      const hasTarget = this.boardTiles.some(tile => tile.active && !tile.inTray && this.isTopTile(tile));
      if (!hasTarget) {
        this.toast(`${getCatDefinition(this.equippedCatId).name}想帮忙，但棋盘上没有能清除的元素啦`);
        return;
      }
      this.clearToolMode();
      this.activeTool = 'cat_skill';
      this.catSkillPicksLeft = this.catSkillConfig.effect === 'clear_board_double' ? 2 : 1;
      this.refreshBoardTileStates();
      this.refreshCatSkillPanel();
      this.toast('请选择要清除的元素');
      return;
    }
    if (this.catSkillConfig.effect === 'clear_tray') {
      const goal = this.levelCollectGoal();
      const canClear = this.trayTiles.some(tile => !goal || tile.kind !== goal.kind || this.remainingCollectKindCount() - 1 >= goal.count);
      if (this.pendingTrayAnimations > 0 || !canClear) {
        this.toast(this.pendingTrayAnimations > 0 ? '请等待元素归位' : '先凑齐收集目标，再请猫咪帮忙');
        return;
      }
    }
    this.clearToolMode();
    this.catSkillUsed = true;
    this.catSkill.charge = 0;
    this.fireCatSkill();
    this.refreshCatSkillPanel();
  }

  // 只负责非选择类技能（槽位移除 / 送道具）；清除棋盘类走 selectCatSkillTile 的点选流程
  private fireCatSkill() {
    const catId = this.equippedCatId;
    const config = this.catSkillConfig;
    if (!catId || !config || this.gameOver) return;
    this.trackEvent('cat_skill_use', { cat_id: catId, ...this.levelTrackProps() });
    const fireResult = this.options.onCatSkillFired(catId);
    this.catSkill!.readyAt = fireResult.readyAt;
    const catName = getCatDefinition(catId).name;
    if (fireResult.giftCoins > 0) {
      this.options.onCoinsChanged(this.options.getCoins());
      this.toast(`猫咪谢礼：金币 +${fireResult.giftCoins}`);
    }
    if ((this.catSkill?.level ?? 1) >= 10) this.toast('强化技能发动，星光更亮啦！');
    this.options.onPlaySound('match');
    switch (config.effect) {
      case 'clear_tray':
        this.catClearTrayTile(catName);
        break;
      case 'grant_item':
        this.catGrantItem(catName);
        break;
    }
  }

  // 清除棋盘类技能的目标确认：和锤子一样只允许点未被遮挡的元素，
  // 第一个目标确认时才扣充能、记录本局已使用，中途取消不浪费技能。
  private selectCatSkillTile(tile: Tile) {
    if (!this.canRemoveGoalTile(tile)) return;
    const catId = this.equippedCatId;
    const skill = this.catSkill;
    if (!catId || !skill || this.catSkillPicksLeft <= 0) return;
    if (!this.isTopTile(tile)) {
      this.options.onPlaySound('click');
      this.toast('请选择未被遮挡的元素');
      this.shakeTile(tile);
      return;
    }
    const catName = getCatDefinition(catId).name;
    const firstPick = !this.catSkillUsed;
    if (firstPick) {
      this.catSkillUsed = true;
      skill.charge = 0;
      this.trackEvent('cat_skill_use', { cat_id: catId, ...this.levelTrackProps() });
      const fireResult = this.options.onCatSkillFired(catId);
      skill.readyAt = fireResult.readyAt;
      if (fireResult.giftCoins > 0) {
        this.options.onCoinsChanged(this.options.getCoins());
        this.toast(`猫咪谢礼：金币 +${fireResult.giftCoins}`);
      }
      if ((skill.level ?? 1) >= 10) this.toast('强化技能发动，星光更亮啦！');
      this.options.onPlaySound('match');
    }
    this.catSkillPicksLeft -= 1;
    this.catClearBoardTile(tile);
    this.toast(firstPick
      ? `🐱${catName}发动技能，清除了 1 个${this.itemNames[tile.kind]}！`
      : `🐱${catName}又清除了 1 个${this.itemNames[tile.kind]}！`);
    if (this.catSkillPicksLeft > 0
      && !this.boardTiles.some(candidate => candidate.active && !candidate.inTray && this.isTopTile(candidate))) {
      // 没有可继续选择的目标时提前收尾，不让选择模式空挂着
      this.catSkillPicksLeft = 0;
    }
    if (this.catSkillPicksLeft <= 0) this.clearToolMode();
    this.refreshCatSkillPanel();
  }

  private catClearBoardTile(tile: Tile) {
    tile.active = false;
    tile.inTray = false;
    this.collectedTotal++;
    this.addEliminated(1);
    Tween.stopAllByTarget(tile.node);
    tween(tile.node)
      .to(0.16, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
      .call(() => {
        if (tile.node.isValid) tile.node.destroy();
        if (this.destroyed || this.gameOver) return;
        this.settleClearedBoardTile();
      })
      .start();
    this.refreshBoardTileStates();
    this.updateTargetLabel();
  }

  // 非收集路径（锤子/猫咪技能）移除棋盘牌后的统一收尾：
  // 清空即胜；其余情况补一次槽位结算，槽满且无三连时按规则判负，
  // 避免槽满状态下清板后既赢不了也判不出输的死角。
  private settleClearedBoardTile() {
    this.options.onSaveRun?.();
    this.refillEndlessBoard();
    if (this.boardIntroActive) return;
    if (this.hasCompletedCollectGoal()) {
      this.finish(true);
      return;
    }
    if (!this.boardTiles.some(candidate => candidate.active)) {
      if (this.options.endless) this.refillEndlessBoard(true);
      else this.finish(this.hasWonLevel());
      return;
    }
    this.resolveTrayMatches();
  }

  private catClearTrayTile(catName: string, retried = 0) {
    // 元素还在飞进收集槽时先等动画落地，否则会打断扣减 pendingTrayAnimations 的回调
    if (this.pendingTrayAnimations > 0 && retried < 10) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.destroyed && !this.gameOver) this.catClearTrayTile(catName, retried + 1);
      }, 200);
      this.timers.add(timer);
      return;
    }
    if (this.trayTiles.length === 0) {
      this.toast(`${catName}想帮忙，但收集槽是空的`);
      return;
    }
    const goal = this.levelCollectGoal();
    const choices = this.trayTiles.filter(tile => !goal || tile.kind !== goal.kind || this.remainingCollectKindCount() - 1 >= goal.count);
    if (!choices.length) {
      this.toast('槽位里的牌都需要用于收集目标，这次技能没有消耗');
      this.catSkillUsed = false;
      if (this.catSkill && this.equippedCatId) this.catSkill.charge = getCatSkillChargeRequired(this.equippedCatId, this.catSkill.level);
      this.options.onSaveRun?.();
      return;
    }
    const tile = choices[Math.floor(Math.random() * choices.length)];
    this.trayTiles = this.trayTiles.filter(candidate => candidate !== tile);
    this.addEliminated(1);
    tile.active = false;
    if (tile.node.parent === this.trayFlightLayer) {
      // 牌还在飞行途中：落地回调被中断后不会再回减计数，这里必须补扣，
      // 否则 pendingTrayAnimations 永远 >0，三消与槽满判负全部卡死。
      this.pendingTrayAnimations = Math.max(0, this.pendingTrayAnimations - 1);
    }
    Tween.stopAllByTarget(tile.node);
    tween(tile.node)
      .to(0.16, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
      .call(() => {
        if (tile.node.isValid) tile.node.destroy();
      })
      .start();
    this.reflowTray();
    this.resolveTrayMatches();
    this.toast(`🐱${catName}发动技能，从收集槽带走了 1 个元素！`);
  }

  private catGrantItem(catName: string) {
    const pool: ItemId[] = ['hammer', 'glove', 'dice'];
    const itemId = pool[Math.floor(Math.random() * pool.length)];
    const itemNames: Record<ItemId, string> = { hammer: '锤子', glove: '手套', dice: '骰子', extra_slot: '增加槽位' };
    this.options.onCatSkillItem(itemId);
    this.refreshToolButtons();
    this.toast(`🐱${catName}发动技能，送来了${itemNames[itemId]}×1！`);
  }

  private useHammer() {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    if (this.usedTools.has('hammer')) {
      this.toast('锤子本局已经使用过了');
      return;
    }
    if (this.activeTool === 'hammer') {
      this.clearToolMode();
      this.toast('已取消锤子');
      return;
    }
    this.clearToolMode();
    if (this.pendingTrayAnimations > 0) {
      this.toast('请等待元素归位');
      return;
    }
    const tile = this.boardTiles.find(candidate => candidate.active && this.isTopTile(candidate));
    if (!tile) {
      this.toast('当前没有可移除的元素');
      return;
    }
    if (this.options.getItemCount('hammer') <= 0) {
      this.toast('锤子道具不足');
      return;
    }
    this.activeTool = 'hammer';
    this.refreshBoardTileStates();
    this.refreshToolButtons();
    this.toast('请选择要移除的元素');
  }

  private selectHammerTile(tile: Tile) {
    if (!this.canRemoveGoalTile(tile)) return;
    if (!this.isTopTile(tile)) {
      this.options.onPlaySound('click');
      this.toast('请选择未被遮挡的元素');
      this.shakeTile(tile);
      return;
    }
    if (!this.options.onConsumeItem('hammer')) {
      this.clearToolMode();
      this.toast('锤子道具不足');
      return;
    }
    this.usedTools.add('hammer');
    tile.active = false;
    tile.inTray = false;
    Tween.stopAllByTarget(tile.node);
    this.clearToolMode();
    this.refreshBoardTileStates();
    this.collectedTotal++;
    this.addEliminated(1);
    this.updateTargetLabel();
    this.options.onPlaySound('collect');
    this.playToolUseAnimation('hammer');
    this.toast(`锤子移除了一个${this.itemNames[tile.kind]}`);
    tween(tile.node)
      .to(0.14, { scale: new Vec3(0.1, 0.1, 1), angle: tile.boardAngle + 10 }, { easing: 'quadIn' })
      .call(() => {
        if (tile.node.isValid) tile.node.destroy();
        if (this.destroyed || this.gameOver) return;
        this.settleClearedBoardTile();
      })
      .start();
  }

  private canRemoveGoalTile(tile: Tile) {
    const goal = this.levelCollectGoal();
    if (goal && tile.kind === goal.kind && this.remainingCollectKindCount() - 1 < goal.count) {
      this.toast('这张牌需要用于收集目标，请选择其他元素');
      this.shakeTile(tile);
      return false;
    }
    return true;
  }

  private canSolveShuffle(active: Tile[], kinds: number[]) {
    const base = this.options.levelDefinition || {
      version: 1 as const, level: this.options.level, seed: 0, archetype: 'normal' as const,
      kindCount: 15, slotCapacity: this.trayCapacity, tiles: [],
      plan: { solution: [], plannedKinds: [], plannedComboCount: 0 },
      score: {} as LevelDefinition['score'], fingerprint: 'current-board',
    };
    const counts = Array.from({ length: base.kindCount }, () => 0);
    this.trayTiles.forEach(tile => counts[tile.kind] += 1);
    const tiles = active.map((tile, index) => ({
      id: index, kind: kinds[index], row: tile.row, col: tile.col,
      layer: tile.layer, x: tile.boardPosition.x, y: tile.boardPosition.y,
      width: tile.width, height: tile.height, rotation: tile.boardAngle,
    }));
    return new LevelSolver().solve({ ...base, tiles, slotCapacity: this.trayCapacity }, {
      analyzeBranches: false, maxStates: 3000,
      initialState: { active: tiles.map(() => true), counts, collected: this.collectProgress },
    }).solvable;
  }

  private shuffle() {
    if (this.gameOver || this.boardIntroActive || this.pausedAt) return;
    if (this.usedTools.has('dice')) {
      this.toast('骰子本局已经使用过了');
      return;
    }
    this.clearToolMode();
    if (this.pendingTrayAnimations > 0) {
      this.toast('请等待元素归位');
      return;
    }
    const active = this.boardTiles.filter(tile => tile.active && !tile.inTray);
    if (active.length < 2) {
      this.toast('当前没有足够的元素可重排');
      return;
    }
    if (this.options.getItemCount('dice') <= 0) {
      this.toast('骰子道具不足');
      return;
    }

    // 重新排列卡片种类
    const kinds = active.map(tile => tile.kind);
    const originalKinds = kinds.slice();
    const collectGoal = this.levelCollectGoal();
    let shuffled = false;
    const maxAttempts = collectGoal ? 20 : 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      this.shuffleArray(kinds);
      const changed = kinds.some((kind, index) => kind !== originalKinds[index]);
      if (!changed) continue;
      if (collectGoal && this.remainingCollectKindCount(kinds) < collectGoal.count) continue;
      if (!this.canSolveShuffle(active, kinds)) continue;
      shuffled = true;
      break;
    }
    if (!shuffled) {
      this.toast('暂未找到安全重排，未消耗道具');
      return;
    }
    if (!this.options.onConsumeItem('dice')) {
      this.toast('骰子道具不足');
      return;
    }
    this.usedTools.add('dice');

    this.playToolUseAnimation('dice');

    active.forEach((tile, index) => this.setTileKind(tile, kinds[index]));
    this.options.onSaveRun?.();

    // 第一阶段：卡片飞散（打乱）
    active.forEach((tile, index) => {
      Tween.stopAllByTarget(tile.node);

      // 随机飞散的目标位置（相对当前位置的偏移）
      const randomOffsetX = (Math.random() - 0.5) * 280;
      const randomOffsetY = (Math.random() - 0.5) * 280;
      const randomAngle = tile.boardAngle + (Math.random() - 0.5) * 60;
      const randomScale = 0.6 + Math.random() * 0.3;

      tween(tile.node)
        .delay(index * 0.012)
        // 飞散阶段：卡片飞向随机位置、旋转、缩小
        .to(0.28, {
          position: new Vec3(tile.boardPosition.x + randomOffsetX, tile.boardPosition.y + randomOffsetY, 0),
          angle: randomAngle,
          scale: new Vec3(randomScale, randomScale, 1),
        }, { easing: 'quadOut' })
        // 更换卡片种类（在飞散到最远处时切换）
        .call(() => {
          this.setTileKind(tile, kinds[index]);
        })
        // 归位阶段：卡片回到原位、恢复角度和大小
        .to(0.32, {
          position: tile.boardPosition,
          angle: tile.boardAngle,
          scale: new Vec3(1, 1, 1),
        }, { easing: 'backOut' })
        .start();
    });

    this.toast('棋盘上的元素已重新排列');
  }

  private returnTrayTile(tile: Tile) {
    if (this.pendingTrayAnimations > 0) {
      this.toast('请等待元素归位');
      return;
    }
    const index = this.trayTiles.indexOf(tile);
    if (index < 0) return;
    if (!this.options.onConsumeItem('glove')) {
      this.clearToolMode();
      this.toast('手套道具不足');
      return;
    }
    this.usedTools.add('glove');
    this.trayTiles.splice(index, 1);
    this.clearToolMode();
    Tween.stopAllByTarget(tile.node);
    tile.node.removeFromParent();
    this.boardLayer.addChild(tile.node);
    tile.node.setPosition(tile.boardPosition);
    tile.node.setScale(new Vec3(0.84, 0.84, 1));
    tile.node.angle = tile.boardAngle;
    tile.active = true;
    tile.inTray = false;
    this.resizeBoardTile(tile);
    this.sortBoardTileNodes();
    this.refreshBoardTileStates();
    this.collectedTotal = Math.max(0, this.collectedTotal - 1);
    this.updateTargetLabel();
    this.options.onPlaySound('collect');
    this.playToolUseAnimation('glove');
    this.toast(`已将${this.itemNames[tile.kind]}放回棋盘`);
    tween(tile.node)
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    this.reflowTray(() => this.resolveTrayMatches());
  }

  private sortBoardTileNodes() {
    const boardTiles = this.boardTiles
      .filter(tile => tile.node.isValid && tile.node.parent === this.boardLayer)
      .slice()
      .sort((a, b) => a.layer - b.layer || a.row - b.row);
    boardTiles.forEach((tile, index) => tile.node.setSiblingIndex(index));
  }

  private setTileKind(tile: Tile, kind: number) {
    tile.kind = kind;
    const item = tile.item.getComponent(Sprite);
    const frame = this.assets.getFrame(this.itemTilePath(kind));
    if (item && frame) item.spriteFrame = frame;
  }

  private shuffleArray<T>(values: T[]) {
    for (let index = values.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
  }

  private addCoins(amount: number) {
    this.coins += amount;
    this.options.onCoinsChanged(this.coins);
  }

  private playMode(): GameMode {
    if (this.options.endless) return 'endless';
    if (this.options.challenge) return 'challenge';
    return 'main';
  }

  private levelTrackProps(): TrackProps {
    return {
      mode: this.playMode(),
      level: this.options.level,
    };
  }

  private trackEvent(name: TrackEventName, props: TrackProps = {}) {
    this.options.onTrack?.(name, props);
  }

  private toast(text: string) {
    if (!this.gameUI) return;
    Toast.show(this.gameUI, text);
  }
}
