import { Button, Color, EventMouse, EventTouch, Graphics, Label, Mask, Node, Sprite, tween, Tween, UITransform, Vec3, view } from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { LEVELS_PER_THEME } from './TownContent';
import { AudioEffect } from './AudioManager';
import { Toast } from './Toast';

export interface AdventureScreenOptions {
  getLevel: () => number;
  getLevelStar: (level: number) => number;
  // 玩家累计获得的星星总数（含活动等奖励入口，只增不减），展示在地图右上角星形角标上
  getTotalStars: () => number;
  getCoins: () => number;
  onPlaySound: (effect: AudioEffect) => void;
  onStartGame: () => void;
  onOpenShop: () => void;
  onReturnHome: () => void;
}

type LevelState = 'completed' | 'current' | 'locked';

export interface ThemeInfo {
  name: string;
  tagline: string;
  icon: string;
}

const MAP_WINDOW = 6;
const CHAPTER_PAGE = 5;
// 滑动换页：触发翻页的最小位移、拖拽可视化上限、落点位移超过该值不算点击（设计稿像素）
const SWIPE_THRESHOLD = 60;
const DRAG_CLAMP = 150;
const TAP_JITTER = 24;
// 主题（章节）定义同时被首页章节横幅使用：章节号 = 主线关卡所在主题 + 1
export const THEME_INFO: ThemeInfo[] = [
  { name: '青青草原', tagline: '阳光洒满草原，冒险开始啦！', icon: 'adventure/adventure_theme_icon_1' },
  { name: '溪谷小镇', tagline: '溪水潺潺，小镇猫咪在等你～', icon: 'adventure/adventure_theme_icon_2' },
  { name: '星光海湾', tagline: '海风轻拂，星空下继续前进！', icon: 'adventure/adventure_theme_icon_3' },
  { name: '云朵山径', tagline: '云端小路，向着高峰出发！', icon: 'adventure/adventure_theme_icon_4' },
  { name: '莓果森林', tagline: '莓果飘香，终点宝藏就在眼前！', icon: 'adventure/adventure_theme_icon_5' },
];
const THEME_LOCK_ICON = 'adventure/adventure_theme_lock';
const THEME_CHECK_ICON = 'adventure/adventure_theme_check';
const THEME_LOCKED_TINT = new Color(172, 172, 172, 255);
const THEME_COUNT = THEME_INFO.length;
// 底部主题栏：芯片宽度/相邻间距、可视宽度、内容总宽与滑动范围（设计稿像素）。
// 内容左对齐放进裁剪区，可滑动范围 = 总宽 - 可视宽；选中主题的锚点保证该芯片完整出现在可视区内
const THEME_CHIP_W = 188;
const THEME_PITCH = 200;
const THEME_VIEW_W = 660;
const THEME_CONTENT_W = THEME_PITCH * (THEME_COUNT - 1) + THEME_CHIP_W;
const THEME_MAX_SCROLL = THEME_CONTENT_W - THEME_VIEW_W;
// 真机手指通常只需要轻轻一划就应切换主题，不能要求拖过半个芯片间距。
const THEME_SWIPE_THRESHOLD = 44;
const THEME_TAP_JITTER = 20;
// 沿背景石板路自上而下取的 6 个节点位（750×1334 设计稿坐标，屏幕中心为原点）
const MAP_SLOTS: Array<[number, number]> = [
  [-4, 330],
  [4, 214],
  [-62, 98],
  [13, -18],
  [-103, -138],
  [-119, -258],
];

const COLORS = {
  title: new Color(111, 62, 28),
  body: new Color(112, 69, 40),
  muted: new Color(136, 94, 63),
  cream: new Color(255, 248, 226, 246),
  creamSoft: new Color(255, 244, 212, 235),
  border: new Color(235, 205, 158),
  borderDark: new Color(205, 165, 102),
  goldDark: new Color(190, 111, 17),
  plusGreen: new Color(139, 196, 74),
  plusGreenDark: new Color(96, 146, 50),
  shadow: new Color(92, 54, 22, 80),
  chipDark: new Color(74, 58, 44, 220),
  navSelect: new Color(250, 203, 190),
  navSelectBorder: new Color(238, 158, 138),
  navSelectText: new Color(196, 86, 60),
};

export class AdventureScreen {
  private adventureUI: Node | null = null;
  private mapLayer: Node | null = null;
  private toastY = 0;
  private coinLabel: Label | null = null;
  private themeTitleLabel: Label | null = null;
  private themeTaglineLabel: Label | null = null;
  private starCountLabel: Label | null = null;
  private currentLevelLabel: Label | null = null;
  private cardSubtitleLabel: Label | null = null;
  private windowStart = 0;
  private active = false;
  private mapArea: Node | null = null;
  private dragStartY = 0;
  private dragDeltaY = 0;
  private mapDragging = false;
  private mapTouchActive = false;
  private selectedTheme = -1;
  private themeContent: Node | null = null;
  private themeBadge: Sprite | null = null;
  private dragStartX = 0;
  private dragDeltaX = 0;
  private themeDragBaseX = 0;
  private themeDragging = false;
  private themeTouchActive = false;
  private themeTapBlocked = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: AdventureScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImages([
      'adventure/adventure_bg',
      COMMON_UI_ASSETS.backButton,
      'adventure/adventure_title',
      'adventure/adventure_banner',
      'adventure/adventure_signpost',
      'adventure/adventure_node_done',
      'adventure/adventure_node_current',
      'adventure/adventure_node_lock',
      'adventure/adventure_cat_roof',
      'adventure/adventure_start_btn',
      'adventure/adventure_theme_icon_1',
      'adventure/adventure_theme_icon_2',
      'adventure/adventure_theme_icon_3',
      'adventure/adventure_theme_icon_4',
      'adventure/adventure_theme_icon_5',
      'adventure/adventure_theme_lock',
      'adventure/adventure_theme_check',
      COMMON_UI_ASSETS.coinIcon,
      COMMON_UI_ASSETS.starIcon,
    ], () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.adventureUI) return;
    this.adventureUI.active = active;
    if (active) {
      // 每次进入地图都回到当前进度所在主题，页内手动选择的主题只在本次停留期间生效
      this.selectedTheme = -1;
      this.refresh();
      if (this.themeContent) this.themeContent.setPosition(this.themeAnchor(this.selectedTheme), 0);
    }
  }

  destroy() {
    if (this.mapLayer) Tween.stopAllByTarget(this.mapLayer);
    if (this.themeContent) Tween.stopAllByTarget(this.themeContent);
    this.adventureUI?.destroy();
    this.adventureUI = null;
    this.mapArea = null;
    this.mapLayer = null;
    this.themeContent = null;
    this.themeBadge = null;
    this.coinLabel = null;
    this.themeTitleLabel = null;
    this.themeTaglineLabel = null;
    this.starCountLabel = null;
    this.currentLevelLabel = null;
    this.cardSubtitleLabel = null;
  }

  private create() {
    if (this.adventureUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -top;

    this.adventureUI = new Node('AdventureUI');
    this.root.addChild(this.adventureUI);
    // 冒险页在 adventureUI 上挂了鼠标 up 监听（收尾主题栏/地图拖拽），
    // 带指针监听的节点必须有 UITransform，否则 PointerEventDispatcher 排序时读 cameraPriority 空指针
    this.adventureUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.adventureUI.active = this.active;

    this.image(this.adventureUI, 'adventure/adventure_bg', 0, 0, visibleSize.width, visibleSize.height);

    // 地图手势区域：必须先于箭头/卡片等控件创建，保证后续控件在上层正常接收点击
    const areaTop = top - 260;
    const areaBottom = bottom + 337;
    this.mapArea = new Node('AdventureMapArea');
    this.adventureUI.addChild(this.mapArea);
    this.mapArea.setPosition(0, (areaTop + areaBottom) / 2);
    this.mapArea.addComponent(UITransform).setContentSize(visibleSize.width, areaTop - areaBottom);
    this.registerMapSwipe(this.mapArea);

    this.mapLayer = new Node('AdventureMapLayer');
    this.mapArea.addChild(this.mapLayer);

    this.buildMapDecoration();
    this.buildChapterArrows(top);
    this.buildThemeRow(top);
    this.buildHeader(top);
    this.buildLevelCard(bottom);
    this.buildThemeBar(bottom);

    this.toastY = bottom + 520;
    this.refresh();
  }

  private buildHeader(top: number) {
    const headerY = top - 94;

    const back = new Node('AdventureBackButton');
    this.adventureUI!.addChild(back);
    back.setPosition(-312, headerY);
    back.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(back, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    this.addButton(back, () => this.options.onReturnHome());

    const title = this.image(this.adventureUI!, 'adventure/adventure_title', -104, top - 96, 260, 77);
    const titleLabel = this.label(title, '冒险地图', 8, -2, 29, COLORS.title);
    titleLabel.isBold = true;

    this.buildResourceChip('AdventureCoinChip', 280, COMMON_UI_ASSETS.coinIcon, () => `${this.options.getCoins()}`);
  }

  private buildResourceChip(name: string, x: number, iconPath: string, getValue: () => string) {
    const chip = this.roundedShape(
      this.adventureUI!, name, x, this.topY() - 92, 140, 55, 27,
      COLORS.cream, COLORS.border,
    );
    this.image(chip, iconPath, -46, 0, 42, 42);
    const value = this.label(chip, getValue(), 8, -1, 21, COLORS.body);
    value.isBold = true;
    value.node.getComponent(UITransform)!.setContentSize(56, 36);
    this.coinLabel = value;

    const plus = new Node(`${name}Plus`);
    chip.addChild(plus);
    plus.setPosition(52, 0);
    plus.addComponent(UITransform).setContentSize(44, 44);
    const graphics = plus.addComponent(Graphics);
    graphics.fillColor = COLORS.plusGreen;
    graphics.strokeColor = COLORS.plusGreenDark;
    graphics.lineWidth = 3;
    graphics.circle(0, 0, 15);
    graphics.fill();
    graphics.stroke();
    const plusLabel = this.label(plus, '+', 0, -1, 20, Color.WHITE);
    plusLabel.isBold = true;
    this.addButton(plus, () => this.options.onOpenShop());
  }

  private buildThemeRow(top: number) {
    const y = top - 212;
    const banner = this.image(this.adventureUI!, 'adventure/adventure_banner', -105, y, 400, 96);

    const badge = this.imageFit(banner, THEME_INFO[0].icon, -144, 0, 58);
    this.themeBadge = badge.getComponent(Sprite);

    this.themeTitleLabel = this.label(banner, '', 0, 14, 24, COLORS.title);
    this.themeTitleLabel.isBold = true;
    this.themeTitleLabel.node.getComponent(UITransform)!.setContentSize(280, 36);
    this.themeTaglineLabel = this.label(banner, '', 0, -18, 17, COLORS.muted);
    this.themeTaglineLabel.node.getComponent(UITransform)!.setContentSize(300, 26);

    // 右上角星形角标：展示玩家累计获得的星星数（过关数进度已在底部主题芯片上展示）
    const starChip = this.roundedShape(
      this.adventureUI!, 'AdventureStarChip', 289, y, 122, 52, 24,
      COLORS.chipDark, new Color(255, 248, 226, 60), 2,
    );
    this.starCountLabel = this.label(starChip, '', -12, -1, 20, Color.WHITE);
    this.starCountLabel.isBold = true;
    this.starCountLabel.node.getComponent(UITransform)!.setContentSize(64, 32);
    this.image(starChip, COMMON_UI_ASSETS.starIcon, 36, 0, 30, 30);
  }

  private buildMapDecoration() {
    this.image(this.mapLayer!, 'adventure/adventure_signpost', 238, 150, 84, 99);
  }

  private buildChapterArrows(top: number) {
    this.buildChapterArrow('AdventureChapterUp', 312, 296, true);
    this.buildChapterArrow('AdventureChapterDown', 312, -268, false);
  }

  private buildChapterArrow(name: string, x: number, y: number, up: boolean) {
    const node = new Node(name);
    this.adventureUI!.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(84, 100);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(255, 248, 226, 242);
    graphics.strokeColor = COLORS.borderDark;
    graphics.lineWidth = 3;
    graphics.roundRect(-40, -48, 80, 96, 24);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = COLORS.body;
    graphics.lineWidth = 5;
    graphics.moveTo(-12, up ? 22 : 34);
    graphics.lineTo(0, up ? 34 : 22);
    graphics.lineTo(12, up ? 22 : 34);
    graphics.stroke();
    const label = this.label(node, up ? '上一章' : '下一章', 0, -8, 16, COLORS.body);
    label.isBold = true;
    this.addButton(node, () => this.shiftWindow(up ? -CHAPTER_PAGE : CHAPTER_PAGE, up ? '已经在第一章啦' : '已经是最后一章啦'));
  }

  private shiftWindow(delta: number, blockedTip: string): boolean {
    const maxStart = LEVELS_PER_THEME - MAP_WINDOW;
    const next = Math.max(0, Math.min(maxStart, this.windowStart + delta));
    if (next === this.windowStart) {
      this.toast(blockedTip);
      return false;
    }
    this.windowStart = next;
    this.rebuildMapNodes(true);
    return true;
  }

  // 地图区域拖拽换页：手指上滑看后面的关卡，下滑看前面的关卡，拖动时关卡节点跟随手指。
  // 微信端走触摸事件；桌面浏览器预览没有触摸，走鼠标事件驱动同一套逻辑
  private registerMapSwipe(area: Node) {
    area.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      this.mapTouchActive = true;
      this.onMapDragStart(event.getUILocation().y);
    }, this);
    area.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      this.onMapDragMove(event.getUILocation().y);
    }, this);
    const touchFinish = (event: EventTouch) => {
      this.mapTouchActive = false;
      this.onMapDragEnd(event.getUILocation().y);
    };
    area.on(Node.EventType.TOUCH_END, touchFinish, this);
    area.on(Node.EventType.TOUCH_CANCEL, touchFinish, this);

    area.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
      if (!this.mapTouchActive) this.onMapDragStart(event.getUILocation().y);
    }, this);
    area.on(Node.EventType.MOUSE_MOVE, (event: EventMouse) => {
      if (!this.mapTouchActive) this.onMapDragMove(event.getUILocation().y);
    }, this);
    // 鼠标可能拖出地图区后松开，鼠标 up 挂在全屏 UI 上保证拖拽一定收尾
    this.adventureUI!.on(Node.EventType.MOUSE_UP, (event: EventMouse) => {
      if (!this.mapTouchActive) this.onMapDragEnd(event.getUILocation().y);
    }, this);
  }

  private onMapDragStart(uiY: number) {
    this.mapDragging = true;
    this.dragStartY = uiY;
    this.dragDeltaY = 0;
    if (this.mapLayer) Tween.stopAllByTarget(this.mapLayer);
  }

  private onMapDragMove(uiY: number) {
    if (!this.mapDragging || !this.mapLayer) return;
    this.dragDeltaY = uiY - this.dragStartY;
    this.mapLayer.setPosition(0, Math.max(-DRAG_CLAMP, Math.min(DRAG_CLAMP, this.dragDeltaY)));
  }

  private onMapDragEnd(uiY: number) {
    if (!this.mapDragging) return;
    this.mapDragging = false;
    const delta = uiY - this.dragStartY;
    this.dragDeltaY = 0;
    if (!this.mapLayer) return;
    if (delta <= -SWIPE_THRESHOLD) {
      this.mapLayer.setPosition(0, 0);
      if (this.shiftWindow(CHAPTER_PAGE, '已经是最后一章啦')) this.options.onPlaySound('click');
    } else if (delta >= SWIPE_THRESHOLD) {
      this.mapLayer.setPosition(0, 0);
      if (this.shiftWindow(-CHAPTER_PAGE, '已经在第一章啦')) this.options.onPlaySound('click');
    } else {
      tween(this.mapLayer)
        .to(0.16, { position: new Vec3(0, 0, 0) }, { easing: 'cubicOut' })
        .start();
    }
  }

  private rebuildMapNodes(animated: boolean) {
    if (!this.mapLayer) return;
    this.mapLayer.destroyAllChildren();
    this.buildMapDecoration();

    const playerLevel = Math.max(1, Math.floor(this.options.getLevel()));
    const themeStart = Math.max(0, this.selectedTheme) * LEVELS_PER_THEME + 1;
    const count = Math.min(MAP_WINDOW, LEVELS_PER_THEME - this.windowStart);
    for (let slot = 0; slot < count; slot += 1) {
      const index = this.windowStart + slot;
      const level = themeStart + index;
      const state: LevelState = level < playerLevel ? 'completed' : level === playerLevel ? 'current' : 'locked';
      this.buildLevelNode(level, state, MAP_SLOTS[slot][0], MAP_SLOTS[slot][1], animated ? slot : -1);
    }
  }

  private buildLevelNode(level: number, state: LevelState, x: number, y: number, stagger: number) {
    const node = new Node(`AdventureLevel_${level}`);
    this.mapLayer!.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(116, 156);

    let body: Node;
    let numberColor = Color.WHITE;
    let numberOutline = COLORS.body;
    let numberY = 0;
    let numberX = 0;
    if (state === 'completed') {
      body = this.image(node, 'adventure/adventure_node_done', 0, 0, 104, 85);
      numberY = 9;
      numberOutline = new Color(74, 124, 40);
    } else if (state === 'current') {
      body = this.image(node, 'adventure/adventure_node_current', 0, 0, 112, 136);
      numberX = 0;
      numberY = -44;
      numberOutline = new Color(170, 62, 34);
      tween(body)
        .repeatForever(
          tween()
            .to(0.9, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
            .to(0.9, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
        )
        .start();
    } else {
      body = this.image(node, 'adventure/adventure_node_lock', 0, 0, 92, 92);
      numberY = -26;
      numberColor = new Color(96, 92, 80);
      numberOutline = new Color(96, 92, 80, 0);
    }

    const number = this.label(node, `${level}`, numberX, numberY, state === 'locked' ? 19 : 25, numberColor);
    number.isBold = true;
    if (state !== 'locked') {
      number.outlineWidth = 4;
      number.outlineColor = numberOutline;
    }

    if (stagger >= 0) {
      node.setScale(new Vec3(0, 0, 1));
      tween(node)
        .delay(stagger * 0.05)
        .to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    }

    this.addButton(node, () => {
      // Button 的 CLICK 在手势区 TOUCH_END 之前触发，此时 dragDeltaY 还未清零，可用来区分拖拽和点击
      if (Math.abs(this.dragDeltaY) > TAP_JITTER) return;
      if (state === 'current') {
        this.options.onStartGame();
      } else if (state === 'completed') {
        this.toast(`第 ${level} 关已通关，当前挑战是第 ${this.options.getLevel()} 关`);
      } else {
        this.toast(`完成第 ${level - 1} 关后解锁`);
        tween(node)
          .to(0.05, { scale: new Vec3(1.08, 0.92, 1) })
          .to(0.08, { scale: new Vec3(1, 1, 1) })
          .start();
      }
    });
  }

  private buildLevelCard(bottom: number) {
    // Leave a small gap above the theme selector while keeping both controls
    // clear of the bottom safe area.
    const y = bottom + 280;
    const card = this.roundedShape(
      this.adventureUI!, 'AdventureLevelCard', 0, y, 668, 178, 30,
      COLORS.cream, COLORS.border, 4,
    );
    this.innerBorder(card, 646, 156, 24, new Color(255, 252, 239, 170), 2);

    this.image(card, 'adventure/adventure_cat_roof', -238, -4, 170, 98);

    const plate = this.roundedShape(
      card, 'AdventureCurrentTitlePlate', -30, 43, 210, 50, 18,
      COLORS.creamSoft, COLORS.border, 3,
    );
    this.currentLevelLabel = this.label(plate, '', 0, -1, 26, COLORS.title);
    this.currentLevelLabel.isBold = true;

    this.cardSubtitleLabel = this.label(card, '', -30, 7, 17, COLORS.muted);
    this.cardSubtitleLabel.node.getComponent(UITransform)!.setContentSize(320, 26);

    const starBar = this.roundedShape(
      card, 'AdventureStarBar', -86, -37, 148, 48, 22,
      COLORS.creamSoft, COLORS.border, 2,
    );
    [-41, 0, 41].forEach(starX => this.image(starBar, COMMON_UI_ASSETS.starIcon, starX, 1, 31, 31));

    const reward = this.roundedShape(
      card, 'AdventureCoinReward', 48, -37, 100, 44, 20,
      COLORS.creamSoft, COLORS.border, 2,
    );
    this.image(reward, COMMON_UI_ASSETS.coinIcon, -20, 0, 28, 28);
    const rewardLabel = this.label(reward, '+50', 20, -1, 19, COLORS.body);
    rewardLabel.isBold = true;

    const start = new Node('AdventureStartButton');
    card.addChild(start);
    start.setPosition(222, -4);
    start.addComponent(UITransform).setContentSize(204, 85);
    const inner = new Node('AdventureStartButtonInner');
    start.addChild(inner);
    inner.addComponent(UITransform).setContentSize(204, 85);
    this.image(inner, 'adventure/adventure_start_btn', 0, 0, 204, 85);
    const startLabel = this.label(inner, '开始挑战', 0, -2, 30, Color.WHITE);
    startLabel.isBold = true;
    startLabel.outlineWidth = 4;
    startLabel.outlineColor = new Color(72, 120, 40);
    this.addButton(start, () => this.onStartPressed());
    tween(inner)
      .repeatForever(
        tween()
          .to(0.8, { scale: new Vec3(1.035, 1.035, 1) }, { easing: 'sineInOut' })
          .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private buildThemeBar(bottom: number) {
    const y = bottom + 107;
    const panel = this.roundedShape(
      this.adventureUI!, 'AdventureThemeBar', 0, y, 700, 122, 32,
      COLORS.cream, COLORS.border, 4,
    );
    this.innerBorder(panel, 678, 102, 26, new Color(255, 252, 239, 160), 2);

    const viewport = new Node('AdventureThemeViewport');
    panel.addChild(viewport);
    viewport.addComponent(UITransform).setContentSize(THEME_VIEW_W, 96);
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;

    this.themeContent = new Node('AdventureThemeContent');
    viewport.addChild(this.themeContent);
    this.themeContent.addComponent(UITransform).setContentSize(THEME_CONTENT_W, 96);
    this.themeContent.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    this.themeContent.setPosition(-THEME_VIEW_W / 2, 0);
    this.registerThemeSwipe(panel);
    this.rebuildThemeChips();
  }

  // 选中主题 i 时的滚动位置：把芯片尽量滑到裁剪区中部，并始终完整可见
  private themeAnchor(index: number) {
    const offset = THEME_CHIP_W / 2 + index * THEME_PITCH;
    const scroll = Math.max(-THEME_MAX_SCROLL, Math.min(0, THEME_VIEW_W / 2 - offset));
    return -THEME_VIEW_W / 2 + scroll;
  }

  private nearestThemeAnchor(x: number) {
    let nearest = this.themeAnchor(0);
    let nearestDist = Infinity;
    for (let index = 0; index < THEME_COUNT; index += 1) {
      const anchor = this.themeAnchor(index);
      const dist = Math.abs(anchor - x);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = anchor;
      }
    }
    return nearest;
  }

  // 主题栏横向拖拽：松手后吸附到最近的主题芯片，选择主题仍由点击完成。
  // 与地图滑动一样同时支持触摸（微信端）和鼠标（编辑器预览）
  private registerThemeSwipe(area: Node) {
    area.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      this.themeTouchActive = true;
      this.onThemeDragStart(event.getUILocation().x);
    }, this, true);
    area.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      this.onThemeDragMove(event.getUILocation().x);
    }, this, true);
    const touchFinish = (event: EventTouch) => {
      this.themeTouchActive = false;
      this.onThemeDragEnd(event.getUILocation().x);
    };
    area.on(Node.EventType.TOUCH_END, touchFinish, this, true);
    area.on(Node.EventType.TOUCH_CANCEL, touchFinish, this, true);

    area.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
      if (!this.themeTouchActive) this.onThemeDragStart(event.getUILocation().x);
    }, this);
    area.on(Node.EventType.MOUSE_MOVE, (event: EventMouse) => {
      if (!this.themeTouchActive) this.onThemeDragMove(event.getUILocation().x);
    }, this);
    // 鼠标可能拖出主题栏后松开，鼠标 up 挂在全屏 UI 上保证拖拽一定收尾
    this.adventureUI!.on(Node.EventType.MOUSE_UP, (event: EventMouse) => {
      if (!this.themeTouchActive) this.onThemeDragEnd(event.getUILocation().x);
    }, this, true);
  }

  private onThemeDragStart(uiX: number) {
    this.themeDragging = true;
    this.dragStartX = uiX;
    this.dragDeltaX = 0;
    this.themeTapBlocked = false;
    if (this.themeContent) {
      this.themeDragBaseX = this.themeContent.position.x;
      Tween.stopAllByTarget(this.themeContent);
    }
  }

  private onThemeDragMove(uiX: number) {
    if (!this.themeDragging || !this.themeContent) return;
    this.dragDeltaX = uiX - this.dragStartX;
    const x = Math.max(-THEME_VIEW_W / 2 - THEME_MAX_SCROLL, Math.min(-THEME_VIEW_W / 2, this.themeDragBaseX + this.dragDeltaX));
    this.themeContent.setPosition(x, 0);
  }

  private onThemeDragEnd(uiX: number) {
    if (!this.themeDragging) return;
    this.themeDragging = false;
    const delta = uiX - this.dragStartX;
    this.dragDeltaX = 0;
    this.themeTapBlocked = Math.abs(delta) > THEME_TAP_JITTER;
    if (!this.themeContent) return;

    // 获取当前实际位置
    const currentX = this.themeContent.position.x;

    // 找到当前位置最接近的主题索引
    let currentNearestIndex = 0;
    let currentNearestDist = Infinity;
    for (let index = 0; index < THEME_COUNT; index += 1) {
      const anchor = this.themeAnchor(index);
      const dist = Math.abs(anchor - currentX);
      if (dist < currentNearestDist) {
        currentNearestDist = dist;
        currentNearestIndex = index;
      }
    }

    let targetIndex = currentNearestIndex;

    // 如果滑动距离超过阈值，尝试切换到相邻主题
    if (Math.abs(delta) >= THEME_SWIPE_THRESHOLD) {
      if (delta < 0) {
        // 手指向左滑，切换到下一个主题（索引+1，向右滚动）
        targetIndex = Math.min(THEME_COUNT - 1, currentNearestIndex + 1);
      } else {
        // 手指向右滑，切换到上一个主题（索引-1，向左滚动）
        targetIndex = Math.max(0, currentNearestIndex - 1);
      }
    }
    // 如果滑动距离不够，targetIndex 已经是 currentNearestIndex，会吸附到最近的主题

    const targetX = this.themeAnchor(targetIndex);
    tween(this.themeContent)
      .to(0.18, { position: new Vec3(targetX, 0, 0) }, { easing: 'cubicOut' })
      .start();
  }

  private snapThemeContent(index: number) {
    if (!this.themeContent) return;
    Tween.stopAllByTarget(this.themeContent);
    tween(this.themeContent)
      .to(0.18, { position: new Vec3(this.themeAnchor(index), 0, 0) }, { easing: 'cubicOut' })
      .start();
  }

  private rebuildThemeChips() {
    if (!this.themeContent) return;
    this.themeContent.destroyAllChildren();
    const level = Math.max(1, Math.floor(this.options.getLevel()));
    const currentTheme = Math.min(THEME_COUNT - 1, Math.floor((level - 1) / LEVELS_PER_THEME));
    THEME_INFO.forEach((info, index) => {
      const unlocked = index <= currentTheme;
      const cleared = Math.max(0, Math.min(LEVELS_PER_THEME, level - 1 - index * LEVELS_PER_THEME));
      const clearedAll = cleared >= LEVELS_PER_THEME;
      const selected = index === this.selectedTheme;
      const chip = new Node(`AdventureThemeChip_${index}`);
      this.themeContent!.addChild(chip);
      chip.setPosition(THEME_CHIP_W / 2 + index * THEME_PITCH, 0);
      chip.addComponent(UITransform).setContentSize(THEME_CHIP_W, 96);
      if (selected) {
        this.roundedShape(chip, 'AdventureThemeChipSelected', 0, 0, THEME_CHIP_W - 6, 90, 24, COLORS.navSelect, COLORS.navSelectBorder, 3);
      }

      const icon = this.imageFit(chip, info.icon, -58, 2, 56);
      if (!unlocked) {
        const sprite = icon.getComponent(Sprite);
        if (sprite) sprite.color = THEME_LOCKED_TINT;
        this.imageFit(chip, THEME_LOCK_ICON, -38, -22, 26);
      } else if (clearedAll) {
        this.imageFit(chip, THEME_CHECK_ICON, -36, 24, 24);
      }

      const name = this.label(chip, info.name, 26, 13, 21, selected ? COLORS.navSelectText : unlocked ? COLORS.title : new Color(160, 148, 126));
      name.isBold = true;
      name.node.getComponent(UITransform)!.setContentSize(124, 28);

      const subText = !unlocked ? '未解锁' : clearedAll ? '已通关' : `${cleared} / ${LEVELS_PER_THEME}`;
      const sub = this.label(chip, subText, 26, -17, 18, !unlocked ? new Color(170, 158, 136) : clearedAll ? COLORS.goldDark : COLORS.muted);
      sub.node.getComponent(UITransform)!.setContentSize(124, 22);

      this.addButton(chip, () => this.onThemeChipTap(index, chip, unlocked));
    });
  }

  private onThemeChipTap(index: number, chip: Node, unlocked: boolean) {
    // 主题栏在捕获阶段先收到 TOUCH_END，因此用一次性标记阻止拖拽结束时误触发 Button CLICK。
    if (this.themeTapBlocked || Math.abs(this.dragDeltaX) > THEME_TAP_JITTER) {
      // 捕获阶段会先收到 TOUCH_END，单独保留一次阻断标记，避免拖拽结束后误触发主题按钮。
      this.themeTapBlocked = false;
      return;
    }
    if (!unlocked) {
      this.toast(`通关「${THEME_INFO[index - 1].name}」后解锁`);
      tween(chip)
        .to(0.05, { scale: new Vec3(1.06, 0.94, 1) })
        .to(0.08, { scale: new Vec3(1, 1, 1) })
        .start();
      return;
    }
    if (index === this.selectedTheme) return;
    this.selectedTheme = index;
    this.refresh();
    this.snapThemeContent(index);
  }

  // 按纹理原始宽高比适配高度放置图片，避免非正方形图标被拉伸
  private imageFit(parent: Node, path: string, x: number, y: number, height: number) {
    const node = this.image(parent, path, x, y, height, height);
    const frame = this.assets.getFrame(path);
    const original = frame ? frame.originalSize : null;
    if (original && original.height > 0) {
      node.getComponent(UITransform)!.setContentSize(Math.round(height * original.width / original.height), height);
    }
    return node;
  }

  private refresh() {
    const level = Math.max(1, Math.floor(this.options.getLevel()));
    const currentTheme = Math.min(THEME_COUNT - 1, Math.floor((level - 1) / LEVELS_PER_THEME));
    if (this.selectedTheme < 0 || this.selectedTheme >= THEME_COUNT) this.selectedTheme = currentTheme;
    const theme = this.selectedTheme;
    const info = THEME_INFO[theme];
    const isCurrentTheme = theme === currentTheme;
    if (isCurrentTheme) {
      const focusIndex = Math.min(LEVELS_PER_THEME - 1, level - 1 - theme * LEVELS_PER_THEME);
      this.windowStart = Math.max(0, Math.min(LEVELS_PER_THEME - MAP_WINDOW, focusIndex - 2));
    } else {
      this.windowStart = LEVELS_PER_THEME - MAP_WINDOW;
    }

    if (this.themeBadge) {
      const frame = this.assets.getFrame(info.icon);
      if (frame) this.themeBadge.spriteFrame = frame;
    }
    if (this.coinLabel) this.coinLabel.string = `${this.options.getCoins()}`;
    if (this.themeTitleLabel) this.themeTitleLabel.string = `主题 ${theme + 1} · ${info.name}`;
    if (this.themeTaglineLabel) this.themeTaglineLabel.string = info.tagline;
    if (this.starCountLabel) this.starCountLabel.string = `${this.options.getTotalStars()}`;
    if (this.currentLevelLabel) this.currentLevelLabel.string = isCurrentTheme ? `第 ${level} 关` : '已通关';
    if (this.cardSubtitleLabel) {
      this.cardSubtitleLabel.string = isCurrentTheme
        ? `本主题 ${LEVELS_PER_THEME} 关 · ${info.name}路线`
        : `${info.name} · ${LEVELS_PER_THEME} 关全部通关`;
    }
    this.rebuildThemeChips();
    this.rebuildMapNodes(false);
  }

  private onStartPressed() {
    const level = Math.max(1, Math.floor(this.options.getLevel()));
    const currentTheme = Math.min(THEME_COUNT - 1, Math.floor((level - 1) / LEVELS_PER_THEME));
    if (this.selectedTheme === currentTheme) {
      this.options.onStartGame();
      return;
    }
    this.toast(`「${THEME_INFO[this.selectedTheme].name}」已通关，选择新主题继续冒险吧`);
  }

  private topY() {
    return view.getVisibleSize().height / 2;
  }

  private toast(text: string) {
    if (!this.adventureUI) return;
    Toast.show(this.adventureUI, text, { y: this.toastY });
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

  private roundedShape(
    parent: Node,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: Color,
    stroke: Color,
    lineWidth = 3,
  ) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = lineWidth;
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.roundRect(-w / 2, -h / 2, w, h, r);
    graphics.fill();
    if (lineWidth > 0) graphics.stroke();
    return node;
  }

  private innerBorder(parent: Node, w: number, h: number, r: number, color: Color, lineWidth: number) {
    const node = new Node('InnerBorder');
    parent.addChild(node);
    node.addComponent(UITransform).setContentSize(w, h);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = lineWidth;
    graphics.strokeColor = color;
    graphics.roundRect(-w / 2, -h / 2, w, h, r);
    graphics.stroke();
  }

  private addButton(node: Node, onTap: () => void) {
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onTap();
    });
  }
}
