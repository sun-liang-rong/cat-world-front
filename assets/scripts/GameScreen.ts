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
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { ComboTracker } from './ComboTracker';
import { getCatDefinition, getCatSkillConfig } from './GameContent';
import { SettlementPopup } from './SettlementPopup';
import { Toast } from './Toast';
import type { RewardedAdResult } from './RewardedAdService';
import { EndlessDirector } from './level/EndlessDirector';
import { LevelRules } from './level/LevelSolver';
import { LevelDefinition, PlayerRun, TileDefinition, TileGeometry } from './level/LevelTypes';
import { CatId, ItemId } from './PlayerTypes';
import { LEVELS_PER_THEME } from './TownContent';

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
};

type ActiveTool = 'hammer' | 'glove_menu' | 'glove_swap' | 'glove_return' | null;

type ToolButtonView = {
  button: Button;
  countLabel: Label;
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
  nameLabel: Label;
  cooldownLabel: Label;
  descriptionLabel: Label;
  chargeLabel: Label;
  statusLabel: Label;
  chargeFill: Graphics;
};

// 通用元素皮肤（game/tiles/tile_7..21）：未配套主题时的默认皮肤，也是主题皮肤缺图时的回退
const GENERIC_ITEM_NAMES = ['小鱼', '毛线球', '猫爪', '铃铛', '玩具鼠', '猫罐头', '牛奶', '爱心', '饼干', '篮子', '蝴蝶结', '叶子', '羽毛', '骨头', '猫粮'];

// 主题专属元素皮肤：kind 序号与通用皮肤一一对应，目录内 tile_1..15（见 需求.md 5.2.1）；
// null 表示该主题尚未配套，沿用通用皮肤。素材在 assets/resources/game/tiles/<folder>/
const THEME_ITEM_SKINS: Array<{ folder: string; names: string[] } | null> = [
  { folder: 'grassland', names: ['雏菊', '四叶草', '蘑菇', '蒲公英', '瓢虫', '蝴蝶', '蜗牛', '蜜蜂', '胡萝卜', '麦穗', '风车', '橡果', '鸟蛋', '木栅栏', '小青蛙'] },
  null, // 2 溪谷小镇
  null, // 3 星光海湾
  null, // 4 云朵山径
  null, // 5 莓果森林
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
  const themeIndex = theme ?? Math.floor((level - 1) / LEVELS_PER_THEME);
  const skin = THEME_ITEM_SKINS[themeIndex] ?? null;
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
  level: number;
  /** 关卡主题序号（0 起，-1 强制通用皮肤）；缺省按关卡号推导（每主题 20 关）。超级挑战传 -1 */
  theme?: number;
  levelDefinition?: LevelDefinition;
  /** 超级挑战模式：赢了改发大额金币，不发星星；对局数据不计入难度自适应 */
  challenge?: { coinReward: number };
  /** 超级挑战通关时回调（用于结算每日限领的大奖） */
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
  getEquippedCat: () => CatId | null;
  getCatSkillState: (id: CatId) => CatSkillState;
  onCatSkillFired: (id: CatId) => number;
  onCatSkillCharge: (id: CatId, charge: number) => void;
  onCatSkillItem: (id: ItemId) => void;
  onPlaySound: (effect: AudioEffect) => void;
  onVibrate: () => void;
  onPerformance: (run: PlayerRun) => void;
  onNextLevel: () => void;
  onReturnHome: () => void;
  onReplay: () => void;
  onWatchAd: () => Promise<RewardedAdResult>;
  /**
   * 启动预创建：只搭好关卡 UI，等 startPlay() 再开始计时和显示。
   * 加载页用它在进度条走完前把关卡准备好，避免开打时再等远程图。
   */
  deferStart?: boolean;
}

export class GameScreen {
  private readonly baseTraySlots: number;
  private readonly trayFlightDuration = 0.32;
  private readonly traySettleDuration = 0.08;
  private readonly traySettleReturnDuration = 0.06;
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
  private collectedTotal = 0;
  private eliminatedCount = 0;
  private endlessDirector: EndlessDirector | null = null;
  private endlessStage = 0;
  private endlessHudLabel: Label | null = null;
  private endlessHudTimer: ReturnType<typeof setInterval> | null = null;
  private leaveConfirmNode: Node | null = null;
  private nextTileIndex = 0;
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
  private reviveUsed = false;
  private doubleRewardUsed = false;
  private settlementWin = false;
  private settlementCoinReward = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly tweenTargets = new Set<object>();
  private readonly toolButtonViews = new Map<ItemId, ToolButtonView>();
  private extraSlotNode: Node | null = null;
  private gloveMenuNode: Node | null = null;
  private gloveSelectedTile: Tile | null = null;
  private activeTool: ActiveTool = null;
  // 装备猫咪的技能：充能进度跨局保留，技能只由玩家手动触发
  private equippedCatId: CatId | null = null;
  private catSkill: CatSkillState | null = null;
  private catSkillConfig: ReturnType<typeof getCatSkillConfig> | null = null;
  private catSkillPanel: CatSkillPanelView | null = null;
  private catSkillRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private catSkillUsed = false;
  private settlementPopup: SettlementPopup | null = null;
  private endlessRecorded = false;

  constructor(root: Node, assets: AssetStore, options: GameScreenOptions) {
    this.assets = assets;
    this.options = options;
    this.coins = options.getCoins();
    this.equippedCatId = options.getEquippedCat();
    // 槽位数可按玩法配置（超级挑战用 5 槽），含额外槽位整体居中：6+1 槽时与原 -264 常量一致
    this.baseTraySlots = Math.max(4, Math.min(7, options.traySlots ?? 6));
    this.trayCapacity = this.baseTraySlots;
    this.trayFirstSlotX = -(this.baseTraySlots / 2) * this.traySlotSpacing;
    // 主题皮肤：显式传入优先（超级挑战传 -1 强制通用皮肤），否则按关卡号推导
    this.themeIndex = options.theme ?? Math.floor((options.level - 1) / LEVELS_PER_THEME);
    this.itemNames = THEME_ITEM_SKINS[this.themeIndex]?.names ?? GENERIC_ITEM_NAMES;
    if (options.endless) this.endlessDirector = new EndlessDirector(options.endless.seed, this.startedAt);
    if (this.equippedCatId) {
      this.catSkill = options.getCatSkillState(this.equippedCatId);
      this.catSkillConfig = getCatSkillConfig(this.equippedCatId);
    }
    this.gameUI = new Node('GameUI');
    root.addChild(this.gameUI);
    this.gameUI.active = false;
  }

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImages(buildGameScreenImagePaths(this.options.level, this.options.theme), () => {
      if (this.destroyed) return;
      this.create();
      if (!this.options.deferStart || this.pendingStart) this.startPlay();
      onReady?.();
    });
  }

  hasStartedPlay() {
    return this.playStarted;
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
    this.coins = this.options.getCoins();
    this.equippedCatId = this.options.getEquippedCat();
    if (this.equippedCatId) {
      this.catSkill = this.options.getCatSkillState(this.equippedCatId);
      this.catSkillConfig = getCatSkillConfig(this.equippedCatId);
    } else {
      this.catSkill = null;
      this.catSkillConfig = null;
    }
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.gameUI.active = true;
    if (this.gameUI.parent) {
      this.gameUI.setSiblingIndex(this.gameUI.parent.children.length - 1);
    }
    this.startCatSkillRefresh();
    if (this.options.endless) this.startEndlessHud();
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
    backButton.transition = Button.Transition.SCALE;
    backButton.zoomScale = 0.93;
    backButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.requestLeave();
    });

    const levelBanner = this.image(this.gameUI, this.gamePath(3), -86, headerY, 260, 80);
    const levelTitle = this.label(
      levelBanner,
      this.options.endless ? '无尽模式' : this.options.challenge ? '超级挑战' : `第 ${this.options.level} 关`,
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
      const collectText = this.label(goal, '收集全部元素', -38, -12, 21, new Color(112, 69, 40));
      collectText.isBold = true;
      const clearText = this.label(goal, '即可通关', 190, -12, 21, new Color(112, 69, 40));
      clearText.isBold = true;
    }

    this.buildCatSkillPanel(220, headerY);

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
    this.trayLayer.setPosition(0, -535);
    this.buildTray();
    this.buildComboFeedback();
    this.buildToolButton('hammer', '锤子', -252, -398, 1, () => this.useHammer());
    this.buildToolButton('dice', '骰子', -84, -398, 2, () => this.shuffle());
    this.buildToolButton('glove', '手套', 84, -398, 3, () => this.useGlove());
    this.buildToolButton('extra_slot', '增加槽位', 252, -398, 4, () => this.addTraySlot());
    this.trayFlightLayer = new Node('TrayFlight');
    this.gameUI.addChild(this.trayFlightLayer);
    this.trayFlightLayer.setPosition(this.trayLayer.position);
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
    this.gloveMenuNode = null;
    this.gloveSelectedTile = null;
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
    this.catSkillPanel = null;
    this.settlementPopup = null;
    this.toolButtonViews.clear();
    if (this.gameUI.isValid) this.gameUI.destroy();
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

  private buildCatSkillPanel(x: number, y: number) {
    const panel = this.addPanel(
      'CatSkillPanel',
      x,
      y,
      300,
      96,
      new Color(255, 248, 226, 248),
      this.gameUI,
    );
    const panelGraphics = panel.getComponent(Graphics);
    if (panelGraphics) {
      panelGraphics.strokeColor = new Color(235, 205, 158, 255);
      panelGraphics.lineWidth = 3;
      panelGraphics.roundRect(-150, -48, 300, 96, 22);
      panelGraphics.stroke();
    }

    const portraitPath = this.equippedCatId
      ? getCatDefinition(this.equippedCatId).portraitPath
      : 'cat_detail/icon_skill';
    const portrait = this.image(panel, portraitPath, -116, 0, 58, 58);
    const skillIcon = this.image(panel, 'game/cat_skill_badge', -98, 22, 22, 22);
    const skillSprite = skillIcon.getComponent(Sprite);
    if (skillSprite) skillSprite.color = new Color(255, 189, 42, 255);

    // 300x96 面板三行排布，行中心 y = 32 / -2 / -34，行间留 4-5px 空隙；
    // 文字框宽度按字号精确计算（正文 15px，每行最多 14 字 = 210px），
    // 名字、冷却、状态左右对齐固定在内容区 x=-84..142 两端，行间互不挤压。
    const nameLabel = this.label(panel, '', -19, 32, 18, new Color(111, 62, 28));
    nameLabel.isBold = true;
    nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    nameLabel.overflow = Label.Overflow.CLAMP;
    nameLabel.lineHeight = 22;
    nameLabel.node.getComponent(UITransform)!.setContentSize(130, 22);
    const cooldownLabel = this.label(panel, '', 96, 32, 15, new Color(177, 106, 43));
    cooldownLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
    cooldownLabel.overflow = Label.Overflow.CLAMP;
    cooldownLabel.lineHeight = 22;
    cooldownLabel.node.getComponent(UITransform)!.setContentSize(92, 22);

    const descriptionLabel = this.label(panel, '', 29, -2, 15, new Color(112, 69, 40));
    descriptionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    descriptionLabel.verticalAlign = Label.VerticalAlign.CENTER;
    descriptionLabel.lineHeight = 18;
    descriptionLabel.overflow = Label.Overflow.CLAMP;
    descriptionLabel.node.getComponent(UITransform)!.setContentSize(226, 36);

    const chargeLabel = this.label(panel, '', -47, -34, 15, new Color(145, 99, 54));
    chargeLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    chargeLabel.overflow = Label.Overflow.CLAMP;
    chargeLabel.lineHeight = 20;
    chargeLabel.node.getComponent(UITransform)!.setContentSize(74, 20);

    const chargeTrack = new Node('CatSkillChargeTrack');
    panel.addChild(chargeTrack);
    chargeTrack.setPosition(29, -34);
    chargeTrack.addComponent(UITransform).setContentSize(64, 10);
    const trackGraphics = chargeTrack.addComponent(Graphics);
    trackGraphics.fillColor = new Color(235, 215, 177, 255);
    trackGraphics.roundRect(-32, -5, 64, 10, 5);
    trackGraphics.fill();

    const chargeFillNode = new Node('CatSkillChargeFill');
    panel.addChild(chargeFillNode);
    chargeFillNode.setPosition(29, -34);
    chargeFillNode.addComponent(UITransform).setContentSize(64, 10);
    const chargeFill = chargeFillNode.addComponent(Graphics);

    const statusLabel = this.label(panel, '', 103, -34, 15, new Color(177, 106, 43));
    statusLabel.isBold = true;
    statusLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
    statusLabel.overflow = Label.Overflow.CLAMP;
    statusLabel.lineHeight = 20;
    statusLabel.node.getComponent(UITransform)!.setContentSize(78, 20);

    const button = panel.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.onCatSkillTap();
    });

    this.catSkillPanel = {
      node: panel,
      button,
      portrait,
      nameLabel,
      cooldownLabel,
      descriptionLabel,
      chargeLabel,
      statusLabel,
      chargeFill,
    };
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
    const config = this.catSkillConfig;
    const portraitPath = catId
      ? getCatDefinition(catId).portraitPath
      : 'cat_detail/icon_skill';
    const portraitSprite = panel.portrait.getComponent(Sprite);
    const portraitFrame = this.assets.getFrame(portraitPath);
    if (portraitSprite && portraitFrame) portraitSprite.spriteFrame = portraitFrame;
    if (!catId || !skill || !config) {
      panel.portrait.active = true;
      panel.nameLabel.string = '未佩戴宠物';
      panel.cooldownLabel.string = '';
      panel.descriptionLabel.string = '去首页更多里的图鉴上阵宠物';
      panel.chargeLabel.string = '';
      panel.statusLabel.string = '去上阵';
      panel.statusLabel.color = new Color(145, 99, 54);
      panel.button.interactable = true;
      panel.chargeFill.clear();
      return;
    }

    const definition = getCatDefinition(catId);
    const required = config.chargeRequired;
    const charge = Math.min(required, Math.max(0, skill.charge));
    const cooldownRemaining = Math.max(0, skill.readyAt - Date.now());
    const chargeReady = charge >= required;
    const canFire = !this.gameOver
      && !this.boardIntroActive
      && !this.catSkillUsed
      && chargeReady
      && cooldownRemaining === 0;

    panel.portrait.active = true;
    panel.nameLabel.string = definition.name;
    panel.descriptionLabel.string = this.wrapCatSkillDescription(definition.skill);
    panel.cooldownLabel.string = cooldownRemaining > 0
      ? `冷却 ${this.formatCatSkillRemaining(cooldownRemaining)}`
      : '冷却完成';
    panel.chargeLabel.string = `充能 ${charge}/${required}`;
    panel.statusLabel.string = this.catSkillUsed
      ? '本局已发动'
      : canFire
        ? '点击发动'
        : chargeReady
          ? '等待冷却'
          : '充能中';
    panel.statusLabel.color = canFire
      ? new Color(190, 59, 51)
      : new Color(177, 106, 43);
    panel.button.interactable = !this.gameOver && !this.catSkillUsed && !this.boardIntroActive;

    panel.chargeFill.clear();
    if (charge > 0) {
      const width = 64 * charge / required;
      panel.chargeFill.fillColor = canFire
        ? new Color(255, 189, 42, 255)
        : new Color(244, 183, 77, 255);
      panel.chargeFill.roundRect(-32, -5, width, 10, 5);
      panel.chargeFill.fill();
    }
  }

  private wrapCatSkillDescription(text: string) {
    // 每行 14 字 × 15px = 210px，确保在 226px 宽的描述框内单行放下不二次折行
    const characters = text.replace(/\s+/g, '').split('');
    const lines: string[] = [];
    for (let index = 0; index < characters.length; index += 14) {
      lines.push(characters.slice(index, index + 14).join(''));
    }
    return lines.slice(0, 2).join('\n');
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
    const skin = THEME_ITEM_SKINS[this.themeIndex];
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

    const title = this.label(panel, '关卡准备中', 0, 16, 28, new Color(111, 62, 28));
    title.isBold = true;
    this.preparingHintLabel = this.label(panel, '正在叠放卡牌', 0, -22, 21, new Color(112, 69, 40));
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
      this.preparingHintLabel.string = `正在叠放卡牌${'.'.repeat(dots)}`;
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

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) this.spawnOpeningPlacements(placements, endIndex);
    }, 28);
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
    tween(tile.node)
      .delay((index % 8) * 0.012)
      .to(0.32, {
        position: target,
        scale: new Vec3(1, 1, 1),
        angle: tile.boardAngle,
      }, { easing: 'cubicOut' })
      .start();
    tween(opacity)
      .delay((index % 8) * 0.012)
      .to(0.18, { opacity: 255 }, { easing: 'sineOut' })
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
    this.refreshBoardTileStates();
    this.refreshToolButtons();
    this.refreshCatSkillPanel();
    this.updateTargetLabel();
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
    const tile: Tile = {
      node,
      kind,
      row: index,
      col: 0,
      layer: placement.layer,
      width: placement.width,
      height: placement.height,
      boardPosition: node.position.clone(),
      boardAngle: angle,
      active: true,
      inTray: false,
    };
    node.on(Node.EventType.TOUCH_END, () => this.onTileTap(tile));
    return tile;
  }

  private refreshBoardTileStates() {
    this.boardTiles.forEach(tile => {
      if (!tile.node.isValid) return;
      const blockedOverlay = tile.node.getChildByName('BlockedOverlay');
      const targetOverlay = tile.node.getChildByName('ToolTargetOverlay');
      if (!tile.active || tile.inTray || this.boardIntroActive) {
        if (blockedOverlay) blockedOverlay.active = false;
        if (targetOverlay) targetOverlay.active = false;
        return;
      }
      const top = this.isTopTile(tile);
      if (blockedOverlay) blockedOverlay.active = !top;
      if (targetOverlay) targetOverlay.active = this.activeTool === 'hammer' && top;
    });
  }

  private onTileTap(tile: Tile) {
    if (this.gameOver || this.boardIntroActive) return;
    if (tile.inTray) {
      this.onTrayTileTap(tile);
      return;
    }
    if (!tile.active) return;
    if (this.activeTool === 'hammer') {
      this.selectHammerTile(tile);
      return;
    }
    if (
      this.activeTool === 'glove_menu'
      || this.activeTool === 'glove_swap'
      || this.activeTool === 'glove_return'
    ) {
      this.options.onPlaySound('click');
      this.toast('请点击收集槽中的元素');
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
    if (this.activeTool === 'glove_return') {
      this.returnTrayTile(tile);
      return;
    }
    if (this.activeTool === 'glove_swap') {
      this.selectGloveTile(tile);
      return;
    }
    if (this.activeTool === 'hammer') {
      this.options.onPlaySound('click');
      this.toast('锤子只能移除棋盘上的元素');
      return;
    }
    if (this.activeTool === 'glove_menu') {
      this.options.onPlaySound('click');
      this.toast('请先选择手套功能');
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

  private tileGeometry(tile: Tile): TileGeometry {
    return {
      x: tile.boardPosition.x,
      y: tile.boardPosition.y,
      width: tile.width,
      height: tile.height,
      rotation: tile.boardAngle,
    };
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
    this.animateTileToTray(tile, startPosition, targetPosition, startAngle);
  }

  private animateTileToTray(tile: Tile, startPosition: Vec3, targetPosition: Vec3, startAngle: number) {
    const horizontalDelta = targetPosition.x - startPosition.x;
    const lift = Math.min(116, Math.max(76, Math.abs(startPosition.y - targetPosition.y) * 0.18));
    const controlStart = new Vec3(
      startPosition.x + horizontalDelta * 0.18,
      startPosition.y + lift,
      0,
    );
    const controlEnd = new Vec3(
      targetPosition.x - horizontalDelta * 0.2,
      targetPosition.y + lift * 0.62,
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

    // A single bezier path keeps the flight continuous while the shorter
    // duration leaves room for quick decisions and chained matches.
    tween(motion)
      .to(this.trayFlightDuration, { ratio: 1 }, {
        easing: 'cubicOut',
        onUpdate: () => {
          const ratio = motion.ratio;
          const inverse = 1 - ratio;
          const inverseSquared = inverse * inverse;
          const ratioSquared = ratio * ratio;
          const curveX = inverseSquared * inverse * startPosition.x
            + 3 * inverseSquared * ratio * controlStart.x
            + 3 * inverse * ratioSquared * controlEnd.x
            + ratioSquared * ratio * targetPosition.x;
          const curveY = inverseSquared * inverse * startPosition.y
            + 3 * inverseSquared * ratio * controlStart.y
            + 3 * inverse * ratioSquared * controlEnd.y
            + ratioSquared * ratio * targetPosition.y;
          const arc = Math.sin(Math.PI * ratio);
          const scaleX = 1 + (targetScale.x - 1) * ratio + 0.035 * arc;
          const scaleY = 1 + (targetScale.y - 1) * ratio + 0.035 * arc;

          tile.node.setPosition(curveX, curveY, 0);
          tile.node.setScale(scaleX, scaleY, 1);
          tile.node.angle = startAngle * (1 - ratio) + direction * 5 * arc;
        },
      })
      .call(() => {
        this.tweenTargets.delete(motion);
        if (this.destroyed || !tile.node.isValid) return;
        tile.node.removeFromParent();
        this.trayLayer.addChild(tile.node);
        tile.node.setPosition(targetPosition);
        tile.node.angle = 0;
        this.resizeTrayTile(tile.node);
        tile.node.setScale(new Vec3(1, 1, 1));
        tween(tile.node)
          .to(this.traySettleDuration, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'backOut' })
          .to(this.traySettleReturnDuration, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
          .call(() => {
            this.pendingTrayAnimations = Math.max(0, this.pendingTrayAnimations - 1);
            this.resolveTrayMatches();
          })
          .start();
      })
      .start();
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
      const combo = this.comboTracker.registerMatch();
      if (combo >= 2) this.showComboFeedback(combo);
      this.addCoins(6);
      this.registerCatProgress('match');
      let pendingMatchAnimations = removed.length + 1;
      this.addEliminated(removed.length);
      const continueAfterMatch = () => {
        pendingMatchAnimations -= 1;
        if (pendingMatchAnimations > 0 || this.destroyed || this.gameOver) return;
        this.refillEndlessBoard();
        if (this.boardIntroActive) return;
        if (this.boardTiles.some(tile => tile.active)) this.resolveTrayMatches();
        else if (this.options.endless) this.refillEndlessBoard(true);
        else this.finish(true);
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
      else this.finish(true);
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

  private resizeTrayTile(node: Node) {
    node.getComponent(UITransform)!.setContentSize(this.traySlotWidth, this.traySlotHeight);
    const card = node.getChildByName('Card');
    if (card) card.active = true;
    card?.getComponent(UITransform)?.setContentSize(this.traySlotWidth, this.traySlotHeight);
    const cardSprite = card?.getComponent(Sprite);
    const trayCardFrame = this.assets.getFrame(this.gamePath(2));
    if (cardSprite && trayCardFrame) cardSprite.spriteFrame = trayCardFrame;
    const blockedOverlay = node.getChildByName('BlockedOverlay');
    if (blockedOverlay) blockedOverlay.active = false;
    const item = node.getChildByName('Item');
    item?.setPosition(0, 4);
    item?.getComponent(UITransform)?.setContentSize(61, 61);
  }

  private resizeBoardTile(tile: Tile) {
    tile.node.getComponent(UITransform)!.setContentSize(tile.width, tile.height);
    const card = tile.node.getChildByName('Card');
    if (card) card.active = true;
    card?.getComponent(UITransform)?.setContentSize(tile.width, tile.height);
    const cardSprite = card?.getComponent(Sprite);
    const boardCardFrame = this.assets.getFrame(this.gamePath(2));
    if (cardSprite && boardCardFrame) cardSprite.spriteFrame = boardCardFrame;
    const item = tile.node.getChildByName('Item');
    item?.setPosition(0, 5);
    item?.getComponent(UITransform)?.setContentSize(71, 71);
  }

  private traySlotX(index: number) {
    return this.trayFirstSlotX + index * this.traySlotSpacing;
  }

  private updateTargetLabel() {
    if (this.options.endless) {
      this.refreshEndlessHud();
      return;
    }
    if (this.targetLabel) this.targetLabel.string = `已收集 ${this.collectedTotal} / ${this.boardTiles.length || this.options.levelDefinition?.tiles.length || 45}`;
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

  private activeBoardCount() {
    return this.boardTiles.filter(tile => tile.active && !tile.inTray).length;
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

    const panel = this.addPanel('LeavePanel', 0, 20, 560, 280, new Color(255, 248, 226, 255), overlay);
    const panelGraphics = panel.getComponent(Graphics);
    if (panelGraphics) {
      panelGraphics.strokeColor = new Color(235, 205, 158);
      panelGraphics.lineWidth = 3;
      panelGraphics.roundRect(-280, -140, 560, 280, 24);
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
        if (this.options.endless) this.finish(false, true);
        else this.options.onReturnHome();
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
    const label = this.label(node, text, 0, 0, 24, new Color(255, 251, 238));
    label.isBold = true;
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onClick();
    });
  }

  private closeLeaveConfirm() {
    if (this.leaveConfirmNode?.isValid) this.leaveConfirmNode.destroy();
    this.leaveConfirmNode = null;
  }

  private finish(win: boolean, skipRevive = false) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.clearToolMode();
    // 把本局累计的技能充能写回存档，换猫/重开都不会丢进度
    if (this.equippedCatId && this.catSkill) {
      this.options.onCatSkillCharge(this.equippedCatId, this.catSkill.charge);
    }
    if (!this.performanceReported && !this.options.endless) {
      this.performanceReported = true;
      this.options.onPerformance({
        won: win,
        level: this.options.level,
        remainingSlots: Math.max(0, this.trayCapacity - this.trayTiles.length),
        mistakes: this.mistakes,
        elapsedMs: Date.now() - this.startedAt,
        decisionCount: this.decisionCount,
        nearFailureCount: this.nearFailureCount,
        collectedElements: this.collectedTotal,
        matchCount: this.matchCount,
      });
    }
    this.closeLeaveConfirm();
    this.options.onPlaySound(this.options.endless || win ? 'win' : 'fail');
    this.options.onVibrate();
    if (this.options.endless) {
      if (!win && !skipRevive && !this.reviveUsed) this.openEndlessFailWithRevive();
      else this.openEndlessSettlement();
      return;
    }
    // 过关固定奖励 3 星：每主题 20 关 × 3 星 = 60 星，正好覆盖建筑三阶段（15/20/25）的星星消耗；
    // 超级挑战不计入关卡进度，改发大额金币。
    const challenge = this.options.challenge;
    const starReward = win && !challenge ? 3 : 0;
    const coinReward = win ? (challenge ? challenge.coinReward : 50) : 0;
    this.settlementWin = win;
    this.settlementCoinReward = coinReward;
    this.doubleRewardUsed = false;
    if (win) {
      this.addCoins(coinReward);
      if (!challenge) this.options.onStarsGranted(starReward);
      else this.options.onChallengeWin?.(Date.now() - this.startedAt);
    }
    this.settlementPopup = SettlementPopup.open(this.gameUI, this.assets, {
      win,
      challenge: !!challenge,
      level: this.options.level,
      stars: starReward,
      starReward,
      coinReward,
      rating: win ? this.calculateRating() : '未完成',
      nextButtonLabel: challenge && win ? '回到首页' : undefined,
      onNextLevel: () => {
        this.options.onPlaySound('click');
        if (challenge) this.options.onReturnHome();
        else this.options.onNextLevel();
      },
      onReturnHome: () => {
        this.options.onPlaySound('click');
        this.options.onReturnHome();
      },
      onReplay: () => {
        this.options.onPlaySound('click');
        this.options.onReplay();
      },
      onWatchAd: this.options.onWatchAd,
      // 广告复活每局只开放一次；复活后再次失败时不再展示无效按钮。
      onRevive: win || this.reviveUsed ? undefined : () => this.reviveFromAd(),
      onDoubleReward: win ? () => this.doubleRewardFromAd() : undefined,
    });
  }

  private recordEndlessIfNeeded() {
    const endless = this.options.endless;
    if (!endless || this.endlessRecorded) return null;
    this.endlessRecorded = true;
    const durationMs = Date.now() - this.startedAt;
    const result = endless.onFinish({
      eliminated: this.eliminatedCount,
      durationMs,
      stage: this.endlessDirector?.currentStage().stage ?? this.endlessStage,
      matchCount: this.matchCount,
    });
    this.coins = this.options.getCoins();
    return { durationMs, result };
  }

  private openEndlessFailWithRevive() {
    this.settlementWin = false;
    this.settlementPopup = SettlementPopup.open(this.gameUI, this.assets, {
      win: false,
      level: this.options.level,
      stars: 0,
      starReward: 0,
      coinReward: 0,
      rating: '未完成',
      onNextLevel: () => this.options.onReplay(),
      onReturnHome: () => {
        this.options.onPlaySound('click');
        this.recordEndlessIfNeeded();
        this.options.onReturnHome();
      },
      onReplay: () => {
        this.options.onPlaySound('click');
        this.recordEndlessIfNeeded();
        this.options.onReplay();
      },
      onWatchAd: this.options.onWatchAd,
      onRevive: () => this.reviveFromAd(),
    });
  }

  private openEndlessSettlement() {
    const recorded = this.recordEndlessIfNeeded();
    const endless = this.options.endless;
    if (!endless) return;
    const durationMs = recorded?.durationMs ?? Date.now() - this.startedAt;
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
        this.options.onReplay();
      },
      onReturnHome: () => {
        this.options.onPlaySound('click');
        this.options.onReturnHome();
      },
      onReplay: () => {
        this.options.onPlaySound('click');
        this.options.onReplay();
      },
      onWatchAd: result.coins > 0 ? this.options.onWatchAd : undefined,
      onDoubleReward: result.coins > 0 ? () => this.doubleRewardFromAd() : undefined,
    });
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

    this.reviveUsed = true;
    this.gameOver = false;
    this.settlementPopup?.close();
    this.settlementPopup = null;
    this.trayTiles = this.trayTiles.filter(tile => removed.indexOf(tile) === -1);
    this.addEliminated(removed.length);

    const needReturn = removed.length >= 2
      && !this.boardTiles.some(tile => tile.active && !tile.inTray && this.isTopTile(tile) && tile.kind === removed[0].kind);
    const returned = needReturn ? removed[removed.length - 1] : null;
    const destroyed = returned
      ? removed.filter(tile => tile !== returned)
      : removed;
    if (returned) this.restoreTileToBoard(returned);

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
    this.options.onPlaySound('match');
    this.options.onVibrate();
    this.toast(returned
      ? '广告复活成功，清出一对并把一张放回棋盘'
      : removed.length >= 2
        ? '广告复活成功，清出一对，下一手就能三消'
        : '广告复活成功，清空了 1 个槽位');
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
    this.toast(`广告奖励：金币 +${this.settlementCoinReward}`);
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
    const count = this.label(buttonNode, `${this.options.getItemCount(itemId)}`, 21, -23, 11, new Color(255, 251, 238));
    count.isBold = true;
    count.outlineWidth = 2;
    count.outlineColor = new Color(90, 61, 38);
    this.toolNameBadge(buttonNode, name, 82);
    const button = buttonNode.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    this.toolButtonViews.set(itemId, { button, countLabel: count, icon, activeFrame });
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
      this.refreshToolButtons();
    });
    this.refreshToolButtons();
    return buttonNode;
  }

  private refreshToolButtons() {
    this.toolButtonViews.forEach((viewData, itemId) => {
      const count = Math.max(0, this.options.getItemCount(itemId));
      viewData.countLabel.string = `${count}`;
      viewData.button.interactable = count > 0 && !this.gameOver && !this.boardIntroActive;
      viewData.activeFrame.active = itemId === 'hammer'
        ? this.activeTool === 'hammer'
        : itemId === 'glove'
          && (
            this.activeTool === 'glove_menu'
            || this.activeTool === 'glove_swap'
            || this.activeTool === 'glove_return'
          );
      const sprite = viewData.icon.getComponent(Sprite);
      if (sprite) {
        sprite.color = count > 0
          ? Color.WHITE
          : new Color(178, 169, 150, 220);
      }
    });
  }

  private clearToolMode() {
    if (this.gloveSelectedTile?.node.isValid) {
      Tween.stopAllByTarget(this.gloveSelectedTile.node);
      this.gloveSelectedTile.node.setScale(new Vec3(1, 1, 1));
    }
    this.gloveSelectedTile = null;
    if (this.gloveMenuNode?.isValid) this.gloveMenuNode.destroy();
    this.gloveMenuNode = null;
    this.activeTool = null;
    if (!this.destroyed && this.boardLayer) this.refreshBoardTileStates();
    this.refreshToolButtons();
  }

  private toolNameBadge(parent: Node, name: string, iconHeight: number) {
    const fontSize = 18;
    const padding = 5;
    const badgeWidth = name.length * fontSize + padding * 2;
    const badgeHeight = fontSize + 8 + padding * 2;
    const badge = new Node('ToolNameBadge');
    parent.addChild(badge);
    badge.setPosition(0, -(iconHeight / 2 + 15 + badgeHeight / 2));
    badge.addComponent(UITransform).setContentSize(badgeWidth, badgeHeight);
    const background = badge.addComponent(Graphics);
    background.fillColor = new Color(214, 184, 137);
    background.strokeColor = new Color(166, 130, 84);
    background.lineWidth = 2;
    background.roundRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 8);
    background.fill();
    background.stroke();

    const text = this.label(badge, name, 0, 0, fontSize, Color.WHITE);
    text.isBold = true;
    text.verticalAlign = Label.VerticalAlign.CENTER;
    text.node.getComponent(UITransform)!.setContentSize(
      badgeWidth - padding * 2,
      badgeHeight - padding * 2,
    );
  }

  private addTraySlot() {
    if (this.gameOver || this.boardIntroActive) return;
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
    this.trayCapacity = this.baseTraySlots + 1;
    const frame = this.assets.getFrame(this.toolPath(11));
    const sprite = this.extraSlotNode?.getComponent(Sprite);
    if (frame && sprite) sprite.spriteFrame = frame;
    this.toast(`已开启第 ${this.trayCapacity} 个收集槽位`);
    this.refreshToolButtons();
  }

  private useGlove() {
    if (this.gameOver || this.boardIntroActive) return;
    if (
      this.activeTool === 'glove_menu'
      || this.activeTool === 'glove_swap'
      || this.activeTool === 'glove_return'
    ) {
      this.clearToolMode();
      this.toast('已取消手套');
      return;
    }
    this.clearToolMode();
    if (this.pendingTrayAnimations > 0) {
      this.toast('请等待元素归位');
      return;
    }
    if (this.trayTiles.length === 0) {
      this.toast('卡槽里还没有可撤回的元素');
      return;
    }
    if (this.options.getItemCount('glove') <= 0) {
      this.toast('手套道具不足');
      return;
    }

    this.activeTool = 'glove_menu';
    this.buildGloveMenu();
    this.refreshToolButtons();
    this.toast('请选择手套功能');
  }

  // —— 装备猫咪技能 ——
  // 充能完成后等待玩家点击发动；冷却时间随猫咪等级缩短（40 → 30 分钟），
  // 换猫不重置冷却，技能进度随存档保留。
  private registerCatProgress(type: 'collect' | 'match') {
    const skill = this.catSkill;
    const config = this.catSkillConfig;
    if (!skill || !config || this.gameOver || config.chargeType !== type) return;
    skill.charge = Math.min(config.chargeRequired, skill.charge + 1);
    this.refreshCatSkillPanel();
  }

  private onCatSkillTap() {
    if (this.gameOver || this.boardIntroActive) return;
    if (!this.equippedCatId || !this.catSkill || !this.catSkillConfig) {
      this.toast('还没有上阵宠物，去首页更多里的图鉴装备一只吧');
      return;
    }
    if (this.catSkillUsed) {
      this.toast('本局技能已经发动过啦');
      return;
    }
    if (this.catSkill.charge < this.catSkillConfig.chargeRequired) {
      this.toast(`技能还需要充能 ${this.catSkillConfig.chargeRequired - this.catSkill.charge} 次`);
      return;
    }
    if (Date.now() < this.catSkill.readyAt) {
      this.toast(`技能还在冷却中，请等待 ${this.formatCatSkillRemaining(this.catSkill.readyAt - Date.now())}`);
      return;
    }
    this.clearToolMode();
    this.catSkillUsed = true;
    this.catSkill.charge = 0;
    this.fireCatSkill();
    this.refreshCatSkillPanel();
  }

  private fireCatSkill() {
    const catId = this.equippedCatId;
    const config = this.catSkillConfig;
    if (!catId || !config || this.gameOver) return;
    this.catSkill!.readyAt = this.options.onCatSkillFired(catId);
    const catName = getCatDefinition(catId).name;
    this.options.onPlaySound('match');
    switch (config.effect) {
      case 'clear_board':
        this.catClearBoardTiles(1, catName);
        break;
      case 'clear_board_double':
        this.catClearBoardTiles(2, catName);
        break;
      case 'clear_tray':
        this.catClearTrayTile(catName);
        break;
      case 'grant_item':
        this.catGrantItem(catName);
        break;
    }
  }

  private catClearBoardTiles(count: number, catName: string) {
    const candidates = this.boardTiles.filter(tile => tile.active && !tile.inTray && this.isTopTile(tile));
    if (candidates.length === 0) {
      this.toast(`${catName}想帮忙，但棋盘上没有能清除的元素啦`);
      return;
    }
    const picked = candidates.sort(() => Math.random() - 0.5).slice(0, Math.min(count, candidates.length));
    this.addEliminated(picked.length);
    picked.forEach(tile => {
      tile.active = false;
      tile.inTray = false;
      this.collectedTotal++;
      Tween.stopAllByTarget(tile.node);
      tween(tile.node)
        .to(0.16, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
        .call(() => {
          if (tile.node.isValid) tile.node.destroy();
          if (this.destroyed || this.gameOver) return;
          this.refillEndlessBoard();
          if (this.boardIntroActive) return;
          if (!this.boardTiles.some(candidate => candidate.active)) {
            if (this.options.endless) this.refillEndlessBoard(true);
            else this.finish(true);
          }
        })
        .start();
    });
    this.refreshBoardTileStates();
    this.updateTargetLabel();
    this.toast(`🐱${catName}发动技能，清除了 ${picked.length} 个元素！`);
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
    const tile = this.trayTiles[Math.floor(Math.random() * this.trayTiles.length)];
    this.trayTiles = this.trayTiles.filter(candidate => candidate !== tile);
    this.addEliminated(1);
    tile.active = false;
    Tween.stopAllByTarget(tile.node);
    tween(tile.node)
      .to(0.16, { scale: new Vec3(0.1, 0.1, 1) }, { easing: 'quadIn' })
      .call(() => {
        if (tile.node.isValid) tile.node.destroy();
      })
      .start();
    this.reflowTray();
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
    if (this.gameOver || this.boardIntroActive) return;
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
    tile.active = false;
    tile.inTray = false;
    Tween.stopAllByTarget(tile.node);
    this.clearToolMode();
    this.refreshBoardTileStates();
    this.collectedTotal++;
    this.addEliminated(1);
    this.updateTargetLabel();
    this.options.onPlaySound('collect');
    this.toast(`锤子移除了一个${this.itemNames[tile.kind]}`);
    tween(tile.node)
      .to(0.14, { scale: new Vec3(0.1, 0.1, 1), angle: tile.boardAngle + 10 }, { easing: 'quadIn' })
      .call(() => {
        if (tile.node.isValid) tile.node.destroy();
        if (this.destroyed || this.gameOver) return;
        this.refillEndlessBoard();
        if (this.boardIntroActive) return;
        if (!this.boardTiles.some(candidate => candidate.active)) {
          if (this.options.endless) this.refillEndlessBoard(true);
          else this.finish(true);
        }
      })
      .start();
  }

  private shuffle() {
    if (this.gameOver || this.boardIntroActive) return;
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
    if (!this.options.onConsumeItem('dice')) {
      this.toast('骰子道具不足');
      return;
    }
    const kinds = active.map(tile => tile.kind);
    const originalKinds = kinds.slice();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      this.shuffleArray(kinds);
      if (kinds.some((kind, index) => kind !== originalKinds[index])) break;
    }
    active.forEach((tile, index) => this.setTileKind(tile, kinds[index]));
    this.toast('棋盘上的元素已重新排列');
  }

  private buildGloveMenu() {
    const menu = this.addPanel(
      'GloveMenu',
      0,
      -315,
      536,
      108,
      new Color(255, 248, 226, 250),
      this.gameUI,
    );
    const background = menu.getComponent(Graphics);
    if (background) {
      background.strokeColor = new Color(235, 205, 158, 255);
      background.lineWidth = 4;
      background.stroke();
    }
    this.gloveMenuNode = menu;
    const title = this.label(menu, '选择手套功能', 0, 31, 20, new Color(112, 69, 40));
    title.isBold = true;
    this.buildGloveActionButton(menu, '交换两个元素', -126, -18, () => {
      this.enterGloveMode('glove_swap');
    });
    this.buildGloveActionButton(menu, '放回棋盘', 126, -18, () => {
      this.enterGloveMode('glove_return');
    });
  }

  private buildGloveActionButton(parent: Node, text: string, x: number, y: number, callback: () => void) {
    const width = 190;
    const visualHeight = 58;
    const node = new Node(`GloveAction_${text}`);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, 88);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(241, 139, 47, 255);
    graphics.strokeColor = new Color(184, 102, 26, 255);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -visualHeight / 2, width, visualHeight, 16);
    graphics.fill();
    graphics.stroke();
    const label = this.label(node, text, 0, 0, 20, new Color(255, 251, 238));
    label.isBold = true;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(width - 12, visualHeight - 8);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
    });
  }

  private enterGloveMode(mode: 'glove_swap' | 'glove_return') {
    if (this.gameOver || this.boardIntroActive) return;
    if (this.pendingTrayAnimations > 0) {
      this.clearToolMode();
      this.toast('请等待元素归位');
      return;
    }
    if (mode === 'glove_swap' && this.trayTiles.length < 2) {
      this.clearToolMode();
      this.toast('交换顺序至少需要两个槽位元素');
      return;
    }
    this.closeGloveMenu();
    this.gloveSelectedTile = null;
    this.activeTool = mode;
    this.refreshToolButtons();
    this.toast(mode === 'glove_swap' ? '请选择两个槽位元素交换顺序' : '请选择要放回棋盘的元素');
  }

  private selectGloveTile(tile: Tile) {
    if (this.pendingTrayAnimations > 0) {
      this.toast('请等待元素归位');
      return;
    }
    if (!this.gloveSelectedTile) {
      this.gloveSelectedTile = tile;
      Tween.stopAllByTarget(tile.node);
      tween(tile.node)
        .to(0.08, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'backOut' })
        .start();
      this.toast('请选择另一个槽位元素');
      return;
    }
    if (this.gloveSelectedTile === tile) {
      this.clearGloveSelection();
      this.toast('已取消选择');
      return;
    }
    const firstIndex = this.trayTiles.indexOf(this.gloveSelectedTile);
    const secondIndex = this.trayTiles.indexOf(tile);
    if (firstIndex < 0 || secondIndex < 0) {
      this.clearGloveSelection();
      this.toast('槽位元素已发生变化，请重新选择');
      return;
    }
    if (!this.options.onConsumeItem('glove')) {
      this.clearToolMode();
      this.toast('手套道具不足');
      return;
    }
    [this.trayTiles[firstIndex], this.trayTiles[secondIndex]] = [
      this.trayTiles[secondIndex],
      this.trayTiles[firstIndex],
    ];
    this.clearToolMode();
    this.options.onPlaySound('collect');
    this.toast('已交换两个槽位元素');
    this.reflowTray();
  }

  private clearGloveSelection() {
    if (this.gloveSelectedTile?.node.isValid) {
      Tween.stopAllByTarget(this.gloveSelectedTile.node);
      this.gloveSelectedTile.node.setScale(new Vec3(1, 1, 1));
    }
    this.gloveSelectedTile = null;
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
    this.toast(`已将${this.itemNames[tile.kind]}放回棋盘`);
    tween(tile.node)
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    this.reflowTray(() => this.resolveTrayMatches());
  }

  private closeGloveMenu() {
    if (this.gloveMenuNode?.isValid) this.gloveMenuNode.destroy();
    this.gloveMenuNode = null;
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
    const item = tile.node.getChildByName('Item')?.getComponent(Sprite);
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

  private toast(text: string) {
    if (!this.gameUI) return;
    Toast.show(this.gameUI, text, { y: -235 });
  }
}
