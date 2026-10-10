import { BlockInputEvents, Button, Color, Graphics, Label, Node, Sprite, tween, UIOpacity, UITransform, Vec2, Vec3, view } from 'cc';
import { TrackEventName, TrackProps } from './Analytics';
import { ActivitySnapshot } from './ActivityContent';
import { AssetStore, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { SettingsPopup } from './SettingsPopup';
import { PlayerExperienceInfo, CatTrialStatus } from './PlayerTypes';
import { Toast } from './Toast';

type SettingsFrameKey =
  | 'popupPanel' | 'btnClose' | 'rowCard'
  | 'iconTile' | 'iconMusic' | 'iconSound' | 'iconVibrate';

const SETTINGS_FRAME_FILES: Array<[string, SettingsFrameKey]> = [
  ['popup_panel', 'popupPanel'],
  ['btn_close', 'btnClose'],
  ['row_card', 'rowCard'],
  ['icon_tile', 'iconTile'],
  ['icon_music', 'iconMusic'],
  ['icon_sound', 'iconSound'],
  ['icon_vibrate', 'iconVibrate'],
];

// 首页首屏依赖的资源路径；加载页必须在进度条走完前把这份清单和关卡页一起准备好。
export function buildHomeScreenImagePaths() {
  const cropNames = [
    'hud_settings', 'button_start', 'title_logo',
    'side_moments', 'side_challenge',
    'nav_bar', 'nav_cats', 'nav_shop', 'nav_tasks', 'nav_more',
    'nav_adventure', 'nav_rank', 'nav_guide',
  ];
  return [
      'home/home_bg_river',
      'home/home_board_3d',
      'home/home_cats_group',
      'home/house_icon',
      COMMON_UI_ASSETS.coinIcon,
      ...cropNames.map(name => `home_crops/${name}`),
      'home_top_crops/avatar',
      COMMON_UI_ASSETS.coinHud,
    ];
}

export function buildGuideImagePaths() {
  return [
    'cats/cat_orange',
    COMMON_UI_ASSETS.starIcon,
    'tasks/daily_icon_collect',
    'tasks/daily_icon_match',
    'tasks/daily_icon_clear',
    'guide/step_play',
    'guide/step_cat',
    'guide/step_upgrade',
    'guide/step_skill',
  ];
}

export function buildSettingsImagePaths() {
  return SETTINGS_FRAME_FILES.map(([file]) => `home_settings/${file}`);
}

// 玩法介绍弹窗的分页签：idle/active 是两套互斥的胶囊底，page 是切换的内容页
interface GuideTabItem {
  idle: Node;
  active: Node;
  label: Label;
  page: Node | null;
}

// 章节横幅数据：关卡号与主题内通关数跟随主线进度，主题名取关卡所在冒险主题
export interface HomeChapterInfo {
  level: number;
  name: string;
  clearedInTheme: number;
  levelsPerTheme: number;
  /** 主线 160 关全部打完，横幅改显示已通关 */
  campaignComplete?: boolean;
}

export interface HomeScreenOptions {
  getExperienceInfo: () => PlayerExperienceInfo;
  getCoins: () => number;
  getMusicEnabled: () => boolean;
  getSoundEnabled: () => boolean;
  getVibrationEnabled: () => boolean;
  onMusicChanged: (enabled: boolean) => void;
  onSoundChanged: (enabled: boolean) => void;
  onVibrationChanged: (enabled: boolean) => void;
  onPlaySound: (effect: AudioEffect) => void;
  onStartGame: () => void;
  onStartEndless: () => void;
  isEndlessUnlocked: () => boolean;
  onStartChallenge: () => void;
  isChallengeUnlocked: () => boolean;
  challengeCoinReward: number;
  isChallengeRewardClaimed: () => boolean;
  shouldShowCatTrialOffer?: () => boolean;
  onCatTrialOfferShown?: () => void;
  onStartCatTrial?: () => void;
  /** 试住快照：首页猫咪群上方的「试住中 · 剩余 X/3 局」气泡数据源 */
  getCatTrialStatus?: () => CatTrialStatus | null;
  /** 通关第 5 关后的一次性「超萌挑战解锁」提示（回首页时展示） */
  shouldShowChallengeUnlockNotice?: () => boolean;
  onChallengeUnlockNoticeShown?: () => void;
  onOpenTown: () => void;
  shouldShowTownBuildHint: () => boolean;
  /** 第 1 关一次性引导：过关且从未点亮过建设格子时，首页弹引导蒙层 */
  shouldShowFirstTownGuide?: () => boolean;
  /** 引导里点了「去建设」：写入一次性标记，防止下次回首页再弹 */
  onFirstTownGuideDone?: () => void;
  onOpenCatCollection: () => void;
  shouldShowCatEquipHint: () => boolean;
  onOpenDailyTasks: () => void;
  onOpenShop: () => void;
  onOpenLeaderboard: () => void;
  onOpenMoments: () => void;
  onOpenAdventure: () => void;
  getActivity: () => ActivitySnapshot;
  onOpenActivity: () => void;
  getDailyTaskBadgeCount: () => number;
  getChapterInfo: () => HomeChapterInfo;
  getPlayerName: () => string;
  /** 首页金币弹窗：分享好友换 888 金币（Main 处理平台可用性与每日限领） */
  onShareForCoins?: () => Promise<boolean>;
  /** 今天是否还能通过分享领取金币（弹窗内据此切换按钮/文案） */
  canShareForCoins?: () => boolean;
  onAddCoins?: (amount: number) => void;
  onTrack?: (name: TrackEventName, props?: TrackProps) => void;
}

export class HomeScreen {
  private homeUI: Node | null = null;
  private homeCoinLabel: Label | null = null;
  private homeLevelLabel: Label | null = null;
  private homeNameLabel: Label | null = null;
  // 设置弹窗抽成了共享组件（SettingsPopup），首页与关卡页共用
  private settingsPopup: SettingsPopup | null = null;
  private guideUI: Node | null = null;
  private guideTabItems: GuideTabItem[] = [];
  private moreUI: Node | null = null;
  private morePanel: Node | null = null;
  private challengeRewardLabel: Label | null = null;
  private challengeRewardCoin: Node | null = null;
  private challengeEntry: Node | null = null;
  private challengeLockLabel: Label | null = null;
  private catTrialUI: Node | null = null;
  private catTrialLoading = false;
  private catTrialPill: Node | null = null;
  private catTrialPillLabel: Label | null = null;
  private challengeUnlockUI: Node | null = null;
  private challengeUnlockLoading = false;
  private challengeLockUI: Node | null = null;
  private challengeLockIcon: Node | null = null;
  private challengeTagGraphics: Graphics | null = null;
  private endlessLabel: Label | null = null;
  private homeChapterTitleLabel: Label | null = null;
  private moreBadge: Node | null = null;
  private taskBadge: Node | null = null;
  private taskBadgeLabel: Label | null = null;
  private townHintBubble: Node | null = null;
  private catEquipHintBubble: Node | null = null;
  private townGuideUI: Node | null = null;
  private townGuideLoading = false;
  private townEntry: Node | null = null;
  private readonly navSelectedPlates: Node[] = [];
  private selectedNavIndex = -1;
  private guideLoading = false;
  private coinAdPopup: Node | null = null;
  private coinAdButton: Button | null = null;
  private coinAdButtonLabel: Label | null = null;
  private coinAdHintLabel: Label | null = null;
  private coinShareBadge: Node | null = null;
  private adRewardBusy = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: HomeScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImages(buildHomeScreenImagePaths(), () => {
      this.create();
      onReady?.();
    });
  }

  // 设置和玩法介绍不阻塞进首页，但首页亮起后立刻预载帧图，避免第一次点开再拉远程图。
  // 设置弹窗本体已抽为 SettingsPopup，这里只负责把它的帧图预热进全局缓存。
  preloadOverlays(onReady?: () => void) {
    this.assets.loadImages([
      ...buildGuideImagePaths(),
      ...buildSettingsImagePaths(),
      // 金币弹窗的分享按钮底图（复用结算弹窗的绿色胶囊），否则没进过商店/结算的用户点开是无底图按钮
      'popup/btn_green',
    ], () => {
      if (this.homeUI && !this.guideUI) this.buildGuide();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    if (!this.homeUI) return;
    this.homeUI.active = active;
    if (!active && this.settingsPopup) {
      this.settingsPopup.close();
      this.settingsPopup = null;
    }
    if (!active && this.guideUI) this.guideUI.active = false;
    if (!active && this.moreUI) this.moreUI.active = false;
    if (!active) {
      this.closeCatTrialOffer();
      this.closeChallengeUnlockNotice();
      this.closeChallengeLockPanel();
    }
    if (active) {
      if (this.homeUI.parent) {
        this.homeUI.setSiblingIndex(this.homeUI.parent.children.length - 1);
      }
      if (this.homeCoinLabel) this.homeCoinLabel.string = `${this.options.getCoins()}`;
      this.refreshLevelBadge();
      this.refreshPlayerName();
      this.refreshChapterBanner();
      this.refreshTaskBadge();
      this.refreshPlayEntries();
      this.refreshMoreEntries();
      this.refreshTownHintBubble();
      this.refreshCatEquipHintBubble();
      this.refreshCatTrialPill();
      this.refreshCoinShareBadge();
      this.maybeShowFirstTownGuide();
      this.maybeShowCatTrialOffer();
      this.maybeShowChallengeUnlockNotice();
    } else {
      this.closeFirstTownGuide(false);
    }
  }

  destroy() {
    this.settingsPopup?.close();
    this.settingsPopup = null;
    this.homeUI?.destroy();
    this.homeUI = null;
    this.homeCoinLabel = null;
    this.homeLevelLabel = null;
    this.homeNameLabel = null;
    this.guideUI = null;
    this.guideTabItems = [];
    this.moreUI = null;
    this.morePanel = null;
    this.challengeRewardLabel = null;
    this.challengeRewardCoin = null;
    this.challengeEntry = null;
    this.challengeLockLabel = null;
    this.coinAdPopup = null;
    this.coinAdButton = null;
    this.coinAdButtonLabel = null;
    this.coinAdHintLabel = null;
    this.coinShareBadge = null;
    this.catTrialUI = null;
    this.catTrialLoading = false;
    this.catTrialPill = null;
    this.catTrialPillLabel = null;
    this.challengeUnlockUI = null;
    this.challengeUnlockLoading = false;
    this.challengeLockUI = null;
    this.challengeLockIcon = null;
    this.challengeTagGraphics = null;
    this.endlessLabel = null;
    this.homeChapterTitleLabel = null;
    this.moreBadge = null;
    this.taskBadge = null;
    this.taskBadgeLabel = null;
    this.townHintBubble = null;
    this.catEquipHintBubble = null;
    this.townGuideUI = null;
    this.townGuideLoading = false;
    this.townEntry = null;
    this.navSelectedPlates.length = 0;
    this.selectedNavIndex = -1;
    this.guideLoading = false;
  }

  private label(parent: Node, text: string, x: number, y: number, size = 24, color = Color.WHITE) {
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

  private addTapFeedback(node: Node, onTap: () => void, zoomScale = 0.93) {
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = zoomScale;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onTap();
    });
  }

  private cropPath(name: string) {
    return `home_crops/${name}`;
  }

  private topCropPath(name: string) {
    return `home_top_crops/${name}`;
  }

  private homeCrop(parent: Node, name: string, x: number, y: number, w: number, h: number) {
    return this.image(parent, this.cropPath(name), x, y, w, h);
  }

  private topHomeCrop(parent: Node, name: string, x: number, y: number, w: number, h: number) {
    return this.image(parent, this.topCropPath(name), x, y, w, h);
  }

  private notificationBadge(parent: Node, x: number, y: number, value: number) {
    const badge = new Node('NotificationBadge');
    parent.addChild(badge);
    badge.setPosition(x, y);
    badge.addComponent(UITransform).setContentSize(34, 34);
    const graphics = badge.addComponent(Graphics);
    graphics.fillColor = new Color(244, 72, 74);
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = 3;
    graphics.circle(0, 0, 15);
    graphics.fill();
    graphics.stroke();
    const text = this.label(badge, `${value}`, 0, 0, 17, Color.WHITE);
    text.node.getComponent(UITransform)!.setContentSize(28, 28);
    text.verticalAlign = Label.VerticalAlign.CENTER;
    text.isBold = true;
    tween(badge)
      .repeatForever(
        tween()
          .delay(1.8)
          .to(0.2, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'sineInOut' })
          .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
    return badge;
  }

  private creamPanel(
    parent: Node,
    x: number,
    y: number,
    w: number,
    h: number,
    r = 24,
    fill = new Color(255, 248, 226),
    stroke = new Color(235, 205, 158),
  ) {
    const node = new Node('Panel');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = 3;
    graphics.strokeColor = stroke;
    graphics.fillColor = fill;
    graphics.roundRect(-w / 2, -h / 2, w, h, r);
    graphics.fill();
    graphics.stroke();
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
    graphics.strokeColor = stroke;
    graphics.fillColor = fill;
    graphics.roundRect(-w / 2, -h / 2, w, h, r);
    graphics.fill();
    graphics.stroke();
    return node;
  }

  private sideEntryLabel(parent: Node, name: string, x: number, y: number) {
    const width = name.length >= 4 ? 108 : name.length === 3 ? 88 : 68;
    const background = this.creamPanel(
      parent, x, y, width, 34, 12,
      new Color(255, 248, 226, 245), new Color(235, 205, 158),
    );
    const text = this.label(background, name, 0, -2, 22, new Color(107, 74, 46));
    text.isBold = true;
    return background;
  }

  private create() {
    if (this.homeUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -visibleSize.height / 2;
    this.homeUI = new Node('HomeUI');
    this.root.addChild(this.homeUI);
    this.homeUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.homeUI.active = false;
    this.image(this.homeUI, 'home/home_bg_river', 0, 0, visibleSize.width, visibleSize.height);
    this.buildPlazaBoard();
    this.buildPlazaCats();
    this.buildTownEntry();
    this.buildCatSocietyEntry();
    this.buildPlayEntries();
    this.buildTopBar(top);
    this.buildGameTitle(top);
    this.buildChapterBanner(top);
    this.buildStartCluster(bottom);
    this.buildBottomNav(bottom);
  }

  // 立体厚牌棋盘：叠在标题和开始按钮之间，让首页一眼能看出是收集式三消。
  // 原生图 900×745；底部停在开始按钮上方，顶部不压标题。
  private buildPlazaBoard() {
    const visibleSize = view.getVisibleSize();
    const boardWidth = Math.min(visibleSize.width * 0.64, 480);
    const boardHeight = boardWidth * (745 / 900);
    const centerV = 0.46;
    const centerY = visibleSize.height / 2 - centerV * visibleSize.height;

    const holder = new Node('PlazaBoard');
    this.homeUI!.addChild(holder);
    holder.setPosition(0, centerY);
    holder.addComponent(UITransform).setContentSize(boardWidth, boardHeight);

    const shadow = new Node('PlazaBoardShadow');
    holder.addChild(shadow);
    shadow.setPosition(0, -boardHeight / 2 + 18);
    shadow.addComponent(UITransform).setContentSize(boardWidth * 0.86, 28);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics.ellipse(0, 0, boardWidth * 0.43, 14);
    shadowGraphics.fill();

    this.image(holder, 'home/home_board_3d', 0, 0, boardWidth, boardHeight);

    holder.setScale(new Vec3(0.82, 0.82, 1));
    const opacity = holder.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(holder)
      .delay(0.38)
      .to(0.34, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity).delay(0.38).to(0.22, { opacity: 255 }).start();
  }

  // 五只立体猫咪：坐在棋盘前排，脚踩河岸步道，点进去猫咪社。
  // 原生组图 995×400；用归一化脚底坐标，避免不同屏幕比例下漂离地面。
  // 背景纵向结构：桥面约 0.46 / 河面 0.51~0.67 / 石岸 0.67~0.72 / 步道 0.72 以下。
  private buildPlazaCats() {
    const visibleSize = view.getVisibleSize();
    const catWidth = Math.min(visibleSize.width * 0.75, 560);
    const catHeight = catWidth * (400 / 995);
    const feetV = 0.66;
    const centerY = visibleSize.height / 2 - feetV * visibleSize.height + catHeight / 2 - 30;

    const holder = new Node('PlazaCats');
    this.homeUI!.addChild(holder);
    holder.setPosition(0, centerY);
    holder.addComponent(UITransform).setContentSize(catWidth, catHeight);

    const shadow = new Node('PlazaCatsShadow');
    holder.addChild(shadow);
    shadow.setPosition(0, -catHeight / 2 + 10);
    shadow.addComponent(UITransform).setContentSize(catWidth * 0.94, 22);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics.ellipse(0, 0, catWidth * 0.47, 11);
    shadowGraphics.fill();

    this.image(holder, 'home/home_cats_group', 0, 0, catWidth, catHeight);
    this.addTapFeedback(holder, this.options.onOpenCatCollection, 0.98);
    // 试住期间猫咪群下方挂「试住中」状态气泡；非试住对局自动隐藏
    this.buildCatTrialPill(holder, -catHeight / 2 - 34);
    this.refreshCatTrialPill();

    holder.setScale(new Vec3(0, 0, 1));
    const opacity = holder.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(holder)
      .delay(0.55)
      .to(0.36, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity).delay(0.55).to(0.25, { opacity: 255 }).start();

    this.startCatIdleAnimation(holder);
  }

  private startCatIdleAnimation(holder: Node) {
    // 轻微的左右摇摆
    tween(holder)
      .repeatForever(
        tween()
          .to(3.2, { angle: 0.8 }, { easing: 'sineInOut' })
          .to(3.2, { angle: -0.8 }, { easing: 'sineInOut' })
          .to(3.2, { angle: 0 }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private sideEntryAnchorY() {
    return view.getVisibleSize().height / 2 - 0.52 * view.getVisibleSize().height + 160;
  }

  private buildTownEntry() {
    const entry = new Node('TownEntry');
    this.homeUI!.addChild(entry);
    entry.setPosition(-304, this.sideEntryAnchorY());
    entry.addComponent(UITransform).setContentSize(124, 148);
    this.townEntry = entry;

    this.image(entry, 'home/house_icon', 0, 18, 84, 80);
    this.sideEntryLabel(entry, '建设小镇', 0, -50);
    this.townHintBubble = this.buildHintBubble(entry, 'TownHintBubble', '可以建设小镇啦');
    this.addTapFeedback(entry, this.options.onOpenTown, 0.97);
    this.popIn(entry, 0.28);
    this.pulseSideEntry(entry, 3.5);
    this.refreshTownHintBubble();
  }

  private buildHintBubble(parent: Node, name: string, text: string) {
    const bubble = new Node(name);
    parent.addChild(bubble);
    bubble.setPosition(78, 78);
    const width = Math.max(156, text.length * 20 + 28);
    const height = 40;
    bubble.addComponent(UITransform).setContentSize(width + 12, 64);

    const graphics = bubble.addComponent(Graphics);
    graphics.lineWidth = 3;
    graphics.fillColor = new Color(255, 224, 108);
    graphics.strokeColor = new Color(201, 148, 47);
    graphics.roundRect(-width / 2, -height / 2 + 8, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.moveTo(-42, -height / 2 + 8);
    graphics.lineTo(-18, -height / 2 + 8);
    graphics.lineTo(-46, -height / 2 - 10);
    graphics.close();
    graphics.fill();
    graphics.moveTo(-42, -height / 2 + 8);
    graphics.lineTo(-46, -height / 2 - 10);
    graphics.lineTo(-18, -height / 2 + 8);
    graphics.stroke();

    const label = this.label(bubble, text, 0, 8, 18, new Color(111, 62, 28));
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(width - 16, 28);

    tween(bubble)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
    return bubble;
  }

  private refreshTownHintBubble() {
    if (!this.townHintBubble) return;
    this.townHintBubble.active = this.options.shouldShowTownBuildHint();
  }

  private refreshCatEquipHintBubble() {
    if (!this.catEquipHintBubble) return;
    this.catEquipHintBubble.active = this.options.shouldShowCatEquipHint();
  }

  // 大橘试住邀请：优先级低于第 1 关建设引导，避免同一时刻连续弹两个蒙层。
  private maybeShowCatTrialOffer() {
    if (
      !this.options.shouldShowCatTrialOffer?.()
      || !this.homeUI
      || !this.homeUI.active
      || this.townGuideUI
      || this.townGuideLoading
      || this.catTrialUI
      || this.catTrialLoading
    ) return;
    this.catTrialLoading = true;
    this.assets.loadImages(['cats/cat_orange'], () => {
      this.catTrialLoading = false;
      this.options.onCatTrialOfferShown?.();
      this.buildCatTrialOffer();
    });
  }

  private buildCatTrialOffer() {
    if (!this.homeUI || !this.homeUI.active || this.catTrialUI) return;
    const overlay = new Node('CatTrialOffer');
    this.homeUI.addChild(overlay);
    this.catTrialUI = overlay;
    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('CatTrialOfferMask');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);

    this.roundedShape(
      overlay, 'CatTrialOfferShadow', 0, -28, 560, 460, 34,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );
    const panel = this.creamPanel(
      overlay, 0, -18, 540, 456, 32,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.setScale(new Vec3(0.76, 0.76, 1));
    tween(panel).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    // 吉祥物溢出面板顶边，与玩法介绍/建设引导同一套「探头」视觉
    const mascot = this.image(panel, 'cats/cat_orange', 0, 196, 126, 126);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const title = this.label(panel, '大橘想陪你冒险 3 局！', 0, 110, 29, new Color(111, 62, 28));
    title.isBold = true;

    // 三条试住权益行：序号徽章 + 文案，替代原来的两行小字
    const perks = [
      { text: '每局可发动 1 次大橘专属技能' },
      { text: '开局自动充满技能能量' },
      { text: '建好流浪猫小屋，大橘正式留下' },
    ];
    perks.forEach((perk, index) => {
      const row = this.creamPanel(
        panel, 0, 52 - index * 54, 480, 46, 16,
        new Color(255, 252, 241), new Color(235, 215, 180, 220),
      );
      const badge = new Node('PerkBadge');
      row.addChild(badge);
      badge.setPosition(-212, 0);
      badge.addComponent(UITransform).setContentSize(26, 26);
      const badgeGraphics = badge.addComponent(Graphics);
      badgeGraphics.fillColor = new Color(255, 224, 108);
      badgeGraphics.strokeColor = new Color(184, 119, 36);
      badgeGraphics.lineWidth = 2;
      badgeGraphics.circle(0, 0, 13);
      badgeGraphics.fill();
      badgeGraphics.stroke();
      const num = this.label(badge, `${index + 1}`, 0, -1, 15, new Color(111, 62, 28));
      num.isBold = true;
      const perkLabel = this.label(row, perk.text, -190, 0, 19, new Color(112, 69, 40));
      perkLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
      perkLabel.verticalAlign = Label.VerticalAlign.CENTER;
      const perkTransform = perkLabel.node.getComponent(UITransform)!;
      perkTransform.anchorX = 0;
      perkTransform.anchorY = 0.5;
      perkTransform.setContentSize(380, 26);
    });

    const startButton = this.creamPanel(
      panel, -112, -148, 196, 88, 44,
      new Color(255, 224, 108), new Color(201, 148, 47),
    );
    const startLabel = this.label(startButton, '立即试住', 0, -1, 25, new Color(111, 62, 28));
    startLabel.isBold = true;
    this.addTapFeedback(startButton, () => {
      this.options.onTrack?.('cat_trial_offer_click', { accepted: true });
      this.closeCatTrialOffer();
      this.options.onStartCatTrial?.();
    });

    const laterButton = this.creamPanel(
      panel, 112, -148, 196, 88, 44,
      new Color(255, 252, 241), new Color(228, 215, 193),
    );
    const laterLabel = this.label(laterButton, '稍后再说', 0, -1, 23, new Color(135, 104, 76));
    laterLabel.isBold = true;
    this.addTapFeedback(laterButton, () => {
      this.options.onTrack?.('cat_trial_offer_click', { accepted: false });
      this.closeCatTrialOffer();
    }, 0.95);
  }

  private closeCatTrialOffer() {
    this.catTrialUI?.destroy();
    this.catTrialUI = null;
    // 试住邀请关闭后补上「挑战解锁」提示，保持一次只弹一个蒙层的节奏
    this.maybeShowChallengeUnlockNotice();
  }

  // —— 首页试住气泡：猫咪群上方「大橘试住中 · 剩余 X/3 局」 ——
  private buildCatTrialPill(parent: Node, y: number) {
    const pill = new Node('CatTrialPill');
    parent.addChild(pill);
    pill.setPosition(0, y);
    const text = '大橘试住中 · 剩余 3/3 局';
    const width = Math.max(250, text.length * 17 + 40);
    pill.addComponent(UITransform).setContentSize(width, 46);
    const graphics = pill.addComponent(Graphics);
    graphics.fillColor = new Color(255, 248, 226, 246);
    graphics.strokeColor = new Color(214, 151, 38);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -23, width, 46, 23);
    graphics.fill();
    graphics.stroke();
    // 左侧大橘头像位：黄底圆 + 猫耳三角，暗示这是大橘的状态条
    graphics.fillColor = new Color(255, 224, 108);
    graphics.circle(-width / 2 + 26, 0, 16);
    graphics.fill();
    const label = this.label(pill, text, 14, 0, 17, new Color(111, 62, 28));
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(width - 58, 30);
    pill.active = false;
    this.catTrialPill = pill;
    this.catTrialPillLabel = label;
  }

  private refreshCatTrialPill() {
    if (!this.catTrialPill || !this.catTrialPillLabel) return;
    const status = this.options.getCatTrialStatus?.() ?? null;
    this.catTrialPill.active = !!status;
    if (status) {
      this.catTrialPillLabel.string = `大橘试住中 · 剩余 ${status.remainingGames}/3 局`;
    }
  }

  // 金币入口红点：当天还能通过分享好友领金币时亮起
  private refreshCoinShareBadge() {
    if (!this.coinShareBadge) return;
    this.coinShareBadge.active = this.options.canShareForCoins?.() ?? false;
  }

  // —— 超萌挑战解锁一次性提示：优先级排在试住邀请之后 ——
  private maybeShowChallengeUnlockNotice() {
    if (
      !this.options.shouldShowChallengeUnlockNotice?.()
      || !this.homeUI
      || !this.homeUI.active
      || this.townGuideUI
      || this.townGuideLoading
      || this.catTrialUI
      || this.catTrialLoading
      || this.challengeUnlockUI
      || this.challengeUnlockLoading
    ) return;
    this.challengeUnlockLoading = true;
    this.assets.loadImages(['home_crops/side_challenge'], () => {
      this.challengeUnlockLoading = false;
      if (!this.options.shouldShowChallengeUnlockNotice?.()) return;
      this.options.onChallengeUnlockNoticeShown?.();
      this.buildChallengeUnlockNotice();
    });
  }

  private buildChallengeUnlockNotice() {
    if (!this.homeUI || !this.homeUI.active || this.challengeUnlockUI) return;
    const overlay = new Node('ChallengeUnlockNotice');
    this.homeUI.addChild(overlay);
    this.challengeUnlockUI = overlay;
    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('ChallengeUnlockMask');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);

    this.roundedShape(
      overlay, 'ChallengeUnlockShadow', 0, -24, 560, 440, 34,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );
    const panel = this.creamPanel(
      overlay, 0, -14, 540, 424, 32,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.setScale(new Vec3(0.76, 0.76, 1));
    tween(panel).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    const mascot = this.image(panel, 'home_crops/side_challenge', 0, 150, 132, 126);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const title = this.label(panel, '超萌挑战解锁！', 0, 62, 30, new Color(111, 62, 28));
    title.isBold = true;
    const body = this.label(
      panel,
      '每天首次通关可获得大量金币。\n准备好挑战高压棋盘了吗？',
      0,
      10,
      21,
      new Color(112, 69, 40),
    );
    body.enableWrapText = true;
    body.node.getComponent(UITransform)!.setContentSize(440, 64);

    const goButton = this.creamPanel(
      panel, -100, -130, 190, 88, 44,
      new Color(255, 224, 108), new Color(201, 148, 47),
    );
    const goLabel = this.label(goButton, '去看看', 0, -1, 25, new Color(111, 62, 28));
    goLabel.isBold = true;
    this.addTapFeedback(goButton, () => {
      this.closeChallengeUnlockNotice();
      this.options.onStartChallenge();
    });

    const laterButton = this.creamPanel(
      panel, 104, -130, 168, 88, 44,
      new Color(255, 252, 241), new Color(228, 215, 193),
    );
    const laterLabel = this.label(laterButton, '稍后再说', 0, -1, 22, new Color(135, 104, 76));
    laterLabel.isBold = true;
    this.addTapFeedback(laterButton, () => this.closeChallengeUnlockNotice(), 0.95);
  }

  private closeChallengeUnlockNotice() {
    this.challengeUnlockUI?.destroy();
    this.challengeUnlockUI = null;
  }

  // —— 超萌挑战锁定说明面板：未解锁点击入口时展示玩法与解锁条件 ——
  private toggleChallengeLockPanel(open: boolean) {
    if (!open) {
      this.closeChallengeLockPanel();
      return;
    }
    if (this.challengeLockUI || !this.homeUI) return;
    this.options.onTrack?.('challenge_lock_show', {
      current_level: this.options.getChapterInfo().level,
    });
    const overlay = new Node('ChallengeLockPanel');
    this.homeUI.addChild(overlay);
    this.challengeLockUI = overlay;
    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('ChallengeLockMask');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.closeChallengeLockPanel());

    this.roundedShape(
      overlay, 'ChallengeLockShadow', 0, -20, 560, 440, 34,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );
    const panel = this.creamPanel(
      overlay, 0, -10, 540, 420, 32,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.setScale(new Vec3(0.8, 0.8, 1));
    tween(panel).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    const mascot = this.image(panel, 'home_crops/side_challenge', 0, 148, 120, 114);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const title = this.label(panel, '超萌挑战', 0, 66, 28, new Color(111, 62, 28));
    title.isBold = true;
    this.label(panel, '这里是给熟练玩家的高压挑战。', 0, 22, 20, new Color(112, 69, 40));

    const specPill = this.creamPanel(
      panel, 0, -24, 400, 46, 23,
      new Color(255, 239, 188), new Color(244, 209, 126),
    );
    const specLabel = this.label(specPill, '69 张牌 · 15 种元素 · 5 格槽位', 0, 0, 19, new Color(166, 110, 34));
    specLabel.isBold = true;

    this.label(panel, '先完成前 5 关，熟悉收集规则后再来挑战。', 0, -74, 19, new Color(136, 94, 63));

    const okButton = this.creamPanel(
      panel, 0, -150, 220, 82, 41,
      new Color(255, 224, 108), new Color(201, 148, 47),
    );
    const okLabel = this.label(okButton, '知道了', 0, -1, 24, new Color(111, 62, 28));
    okLabel.isBold = true;
    this.addTapFeedback(okButton, () => this.closeChallengeLockPanel(), 0.95);
  }

  private closeChallengeLockPanel() {
    this.challengeLockUI?.destroy();
    this.challengeLockUI = null;
  }

  // 第 1 关一次性建设引导：半透明蒙层 + 小镇入口高亮副本 + 脉冲光环 + 指引面板。
  // 跳过（稍后再说）不置标记，下次回首页会再弹；点亮过任意格子后条件自然消失。
  private maybeShowFirstTownGuide() {
    if (
      !this.options.shouldShowFirstTownGuide?.()
      || !this.homeUI
      || this.townGuideUI
      || this.townGuideLoading
    ) return;
    this.townGuideLoading = true;
    // 猫探头 / 星星图标可能还没被预热进缓存，这里按需加载一次再画面板（命中缓存即同步回调）
    this.assets.loadImages(['cats/cat_orange', COMMON_UI_ASSETS.starIcon], () => {
      this.townGuideLoading = false;
      this.buildFirstTownGuide();
    });
  }

  private buildFirstTownGuide() {
    if (!this.homeUI || !this.homeUI.active || this.townGuideUI) return;
    if (!this.options.shouldShowFirstTownGuide?.()) return;
    const overlay = new Node('FirstTownGuide');
    this.homeUI.addChild(overlay);
    this.townGuideUI = overlay;
    // 蒙层会压暗整个首页：真实的入口和小气泡先藏起来，入口改由蒙层上的高亮副本呈现
    if (this.townEntry) this.townEntry.active = false;
    if (this.townHintBubble) this.townHintBubble.active = false;

    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('FirstTownGuideMask');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);

    const entryY = this.sideEntryAnchorY();
    const ring = new Node('FirstTownGuideRing');
    overlay.addChild(ring);
    ring.setPosition(-304, entryY);
    ring.addComponent(UITransform).setContentSize(220, 220);
    const ringGraphics = ring.addComponent(Graphics);
    ringGraphics.strokeColor = new Color(255, 224, 108);
    ringGraphics.lineWidth = 8;
    ringGraphics.circle(0, 0, 96);
    ringGraphics.stroke();
    tween(ring)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    // 入口高亮副本：与 buildTownEntry / sideEntryLabel 同款内容，画在蒙层之上保持明亮
    const entryCopy = new Node('FirstTownGuideEntryCopy');
    overlay.addChild(entryCopy);
    entryCopy.setPosition(-304, entryY);
    entryCopy.addComponent(UITransform).setContentSize(124, 148);
    this.image(entryCopy, 'home/house_icon', 0, 18, 84, 80);
    const entryPill = this.creamPanel(
      entryCopy, 0, -50, 108, 34, 12,
      new Color(255, 248, 226, 245), new Color(235, 205, 158),
    );
    const entryText = this.label(entryPill, '建设小镇', 0, -2, 22, new Color(107, 74, 46));
    entryText.isBold = true;

    // 面板带投影 + 顶部猫探头，与玩法介绍弹窗同一套视觉语言；
    // 宽度压在 480 内，左缘不盖住小镇入口的脉冲光环
    this.roundedShape(
      overlay, 'FirstTownGuideShadow', 56, entryY - 86, 488, 276, 32,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );
    const panel = this.creamPanel(
      overlay, 56, entryY - 80, 480, 268, 30,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.setScale(new Vec3(0.7, 0.7, 1));
    tween(panel)
      .to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    const mascot = this.image(panel, 'cats/cat_orange', 0, 170, 112, 112);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    this.image(panel, COMMON_UI_ASSETS.starIcon, -106, 70, 30, 30);
    const title = this.label(panel, '通关第 1 关啦！', 21, 70, 28, new Color(111, 62, 28));
    title.isBold = true;
    const body = this.label(panel, '刚赢的星星可以逐格点亮\n流浪猫小屋，修好它解锁猫咪！', 0, 14, 20, new Color(112, 69, 40));

    // 按钮宽度贴内容：去建设 3 字 ≈78px、稍后再说 4 字 ≈88px，左右各留 ~36/28px 内边距
    const goButton = this.creamPanel(
      panel, -85, -76, 152, 88, 44,
      new Color(255, 224, 108), new Color(201, 148, 47),
    );
    const goLabel = this.label(goButton, '去建设', 0, -1, 26, new Color(111, 62, 28));
    goLabel.isBold = true;
    this.addTapFeedback(goButton, () => {
      this.closeFirstTownGuide(false);
      this.options.onFirstTownGuideDone?.();
      this.options.onOpenTown();
    });

    const skipButton = this.creamPanel(
      panel, 88, -76, 146, 88, 44,
      new Color(255, 252, 241), new Color(228, 215, 193),
    );
    const skipLabel = this.label(skipButton, '稍后再说', 0, -1, 22, new Color(135, 104, 76));
    skipLabel.isBold = true;
    this.addTapFeedback(skipButton, () => this.closeFirstTownGuide(true), 0.95);
  }

  private closeFirstTownGuide(showTrial = true) {
    this.townGuideUI?.destroy();
    this.townGuideUI = null;
    if (this.townEntry) this.townEntry.active = true;
    this.refreshTownHintBubble();
    if (showTrial) this.maybeShowCatTrialOffer();
    // 建设引导结束后没有试住邀请可弹时，轮到「挑战解锁」提示
    this.maybeShowChallengeUnlockNotice();
  }

  private buildCatSocietyEntry() {
    const entry = new Node('CatSocietyEntry');
    this.homeUI!.addChild(entry);
    entry.setPosition(-304, this.sideEntryAnchorY() - 168);
    entry.addComponent(UITransform).setContentSize(124, 148);

    this.homeCrop(entry, 'nav_cats', 0, 18, 84, 80);
    this.sideEntryLabel(entry, '猫咪社', 0, -50);
    this.catEquipHintBubble = this.buildHintBubble(entry, 'CatEquipHintBubble', '装备宠物可用技能');
    this.addTapFeedback(entry, this.options.onOpenCatCollection, 0.97);
    this.popIn(entry, 0.34);
    this.pulseSideEntry(entry, 4.1);
    this.refreshCatEquipHintBubble();
  }

  private pulseSideEntry(entry: Node, delay: number) {
    tween(entry)
      .delay(delay)
      .repeatForever(
        tween()
          .delay(8)
          .to(0.3, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'backOut' })
          .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }),
      )
      .start();
  }

  private buildPlayEntries() {
    const y = this.sideEntryAnchorY();
    const x = 304;

    const challenge = new Node('ChallengeEntry');
    this.homeUI!.addChild(challenge);
    challenge.setPosition(x, y);
    challenge.addComponent(UITransform).setContentSize(124, 148);
    this.challengeEntry = challenge;
    this.homeCrop(challenge, 'side_challenge', 0, 18, 84, 80);
    this.sideEntryLabel(challenge, '超萌挑战', 0, -50);
    const tag = this.creamPanel(
      challenge, 0, -88, 128, 32, 16,
      new Color(255, 224, 108), new Color(166, 110, 34),
    );
    this.challengeTagGraphics = tag.getComponent(Graphics);
    this.challengeRewardCoin = this.image(tag, COMMON_UI_ASSETS.coinIcon, -46, 0, 20, 20);
    this.challengeRewardLabel = this.label(tag, this.challengeRewardText(), 10, -1, 16, new Color(111, 62, 28));
    this.challengeRewardLabel.isBold = true;
    this.challengeRewardLabel.overflow = Label.Overflow.SHRINK;
    this.challengeRewardLabel.enableWrapText = false;
    this.challengeRewardLabel.verticalAlign = Label.VerticalAlign.CENTER;
    this.challengeRewardLabel.node.getComponent(UITransform)!.setContentSize(92, 28);
    // 锁定态：小挂锁图标 + 「第 5 关解锁」，底色换成米灰以区分奖励金字签
    this.challengeLockIcon = this.buildLockIcon(tag, -46);
    this.challengeLockLabel = this.label(tag, '', 10, -1, 14, new Color(135, 104, 76));
    this.challengeLockLabel.isBold = true;
    this.challengeLockLabel.node.getComponent(UITransform)!.setContentSize(110, 28);
    this.challengeLockLabel.node.active = false;
    // 未解锁点击只弹说明面板，不进关卡；解锁校验仍在 Main.startChallenge 兜底
    this.addTapFeedback(challenge, () => {
      if (this.options.isChallengeUnlocked()) {
        this.options.onStartChallenge();
      } else {
        this.toggleChallengeLockPanel(true);
      }
    }, 0.93);
    this.popIn(challenge, 0.30);
    this.refreshPlayEntries();

    // 奖励标签闪烁动画
    tween(tag)
      .delay(4)
      .repeatForever(
        tween()
          .delay(6)
          .to(0.2, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'sineOut' })
          .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }),
      )
      .start();

    // 挑战入口待机动画
    tween(challenge)
      .delay(3.8)
      .repeatForever(
        tween()
          .delay(8)
          .to(0.3, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'backOut' })
          .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }),
      )
      .start();
  }

  private popIn(node: Node, delay: number) {
    node.setScale(new Vec3(0, 0, 1));
    tween(node)
      .delay(delay)
      .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  private buildTopBar(top: number) {
    // Keep the HUD below the system status bar and WeChat capsule area.
    const y = top - 148;
    const hudY = belowWeChatCapsule(top, 88);

    const avatar = this.topHomeCrop(this.homeUI!, 'avatar', -292, y, 96, 102);
    avatar.getComponent(UITransform)!.setContentSize(108, 108);
    this.homeLevelLabel = this.label(avatar, '', 0, -39, 16, new Color(91, 53, 34));
    this.homeLevelLabel.isBold = true;
    // 昵称名牌：奶油胶囊垫底 + 椭圆投影，把名字从天空背景里托出来（与侧边入口胶囊同族样式）
    const nameShadow = new Node('NameShadow');
    avatar.addChild(nameShadow);
    nameShadow.setPosition(0, -90);
    nameShadow.addComponent(UITransform).setContentSize(124, 10);
    const nameShadowGraphics = nameShadow.addComponent(Graphics);
    nameShadowGraphics.fillColor = new Color(92, 54, 22, 80);
    nameShadowGraphics.ellipse(0, 0, 62, 5);
    nameShadowGraphics.fill();
    const namePlate = this.creamPanel(
      avatar, 0, -70, 136, 34, 12,
      new Color(255, 248, 226, 245), new Color(235, 205, 158),
    );
    this.homeNameLabel = this.label(namePlate, '', 0, 0, 21, new Color(91, 53, 34));
    this.homeNameLabel.isBold = true;
    this.homeNameLabel.overflow = Label.Overflow.SHRINK;
    this.homeNameLabel.enableWrapText = false;
    this.homeNameLabel.verticalAlign = Label.VerticalAlign.CENTER;
    this.homeNameLabel.node.getComponent(UITransform)!.setContentSize(124, 34);
    this.refreshPlayerName();
    this.addTapFeedback(avatar, () => {
      const exp = this.options.getExperienceInfo();
      this.toast(`玩家等级 Lv.${exp.level}（经验 ${exp.exp}/${exp.expToNext}）`);
    });
    this.refreshLevelBadge();

    const coin = this.image(this.homeUI!, COMMON_UI_ASSETS.coinHud, 168, hudY, 176, 54);

    // 添加金币底部阴影
    const coinShadow = new Node('CoinShadow');
    coin.addChild(coinShadow);
    coinShadow.setPosition(0, -32);
    coinShadow.addComponent(UITransform).setContentSize(150, 12);
    const shadowGraphics = coinShadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 60);
    shadowGraphics.ellipse(0, 0, 75, 6);
    shadowGraphics.fill();

    this.homeCoinLabel = this.label(coin, `${this.options.getCoins()}`, 0, 0, 22, new Color(91, 53, 34));
    this.homeCoinLabel.node.getComponent(UITransform)!.setContentSize(72, 36);
    this.homeCoinLabel.verticalAlign = Label.VerticalAlign.CENTER;
    this.homeCoinLabel.isBold = true;
    this.addTapFeedback(coin, () => {
      // 金币弹窗走分享好友链路（Main 注入 onShareForCoins；缺失时提示不可用）
      if (!this.options.onShareForCoins) {
        this.toast('分享功能暂未开放');
        return;
      }
      this.toggleCoinAdPopup();
    });
    // 可分享领金币提醒：金币入口右上角的红点，领完当天金币后消失
    this.coinShareBadge = new Node('CoinShareBadge');
    coin.addChild(this.coinShareBadge);
    this.coinShareBadge.setPosition(78, 24);
    this.coinShareBadge.addComponent(UITransform).setContentSize(26, 26);
    const badgeGraphics = this.coinShareBadge.addComponent(Graphics);
    badgeGraphics.fillColor = new Color(244, 72, 74);
    badgeGraphics.strokeColor = Color.WHITE;
    badgeGraphics.lineWidth = 2.5;
    badgeGraphics.circle(0, 0, 11);
    badgeGraphics.fill();
    badgeGraphics.stroke();
    this.coinShareBadge.active = false;
    tween(this.coinShareBadge)
      .repeatForever(
        tween()
          .delay(1.4)
          .to(0.2, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'sineOut' })
          .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }),
      )
      .start();
    this.refreshCoinShareBadge();

    const settings = this.homeCrop(this.homeUI!, 'hud_settings', 312, hudY, 72, 72);
    settings.getComponent(UITransform)!.setContentSize(88, 88);
    this.addTapFeedback(settings, () => this.toggleSettings(), 0.92);
  }

  private refreshLevelBadge() {
    const exp = this.options.getExperienceInfo();
    if (this.homeLevelLabel) this.homeLevelLabel.string = `Lv.${exp.level}`;
  }

  private refreshPlayerName() {
    if (!this.homeNameLabel) return;
    const name = this.options.getPlayerName().trim();
    this.homeNameLabel.string = name || '新来的猫';
  }

  private buildGameTitle(top: number) {
    const logo = this.homeCrop(this.homeUI!, 'title_logo', 0, top - 298, 540, 126);
    const opacity = logo.addComponent(UIOpacity);
    opacity.opacity = 0;
    const finalY = logo.position.y;
    logo.setPosition(0, finalY + 28);
    tween(logo)
      .delay(0.12)
      .to(0.34, { position: new Vec3(0, finalY, 0) }, { easing: 'cubicOut' })
      .start();
    tween(opacity).delay(0.12).to(0.24, { opacity: 255 }).start();
  }

  // 关卡条跟标题锚定在屏幕上方，不再跟着底部开始按钮走，避免长屏时掉到猫咪头顶。
  private buildChapterBanner(top: number) {
    const banner = this.creamPanel(
      this.homeUI!, 0, top - 380, 360, 52, 26,
      new Color(255, 248, 226, 246), new Color(235, 205, 158),
    );

    const bannerShadow = new Node('BannerShadow');
    banner.addChild(bannerShadow);
    bannerShadow.setPosition(0, -32);
    bannerShadow.addComponent(UITransform).setContentSize(320, 12);
    const shadowGraphics = bannerShadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics.ellipse(0, 0, 160, 6);
    shadowGraphics.fill();

    const title = this.label(banner, '', 0, 0, 22, new Color(111, 62, 28));
    title.isBold = true;
    title.node.getComponent(UITransform)!.setContentSize(320, 32);
    this.homeChapterTitleLabel = title;
    this.refreshChapterBanner();

    tween(banner)
      .delay(2)
      .repeatForever(
        tween()
          .delay(5)
          .to(0.4, { scale: new Vec3(1.03, 1.03, 1) }, { easing: 'sineInOut' })
          .to(0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private buildStartCluster(bottom: number) {
    const cluster = new Node('StartCluster');
    this.homeUI!.addChild(cluster);
    cluster.setPosition(0, bottom + 380);

    const start = new Node('StartButton');
    cluster.addChild(start);
    start.setPosition(0, 42);
    start.addComponent(UITransform).setContentSize(420, 118);

    const shadow = new Node('StartShadow');
    start.addChild(shadow);
    shadow.setPosition(0, -58);
    shadow.addComponent(UITransform).setContentSize(330, 28);
    const shadowGraphics2 = shadow.addComponent(Graphics);
    shadowGraphics2.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics2.ellipse(0, 0, 165, 14);
    shadowGraphics2.fill();

    const inner = new Node('StartInner');
    start.addChild(inner);
    this.homeCrop(inner, 'button_start', 0, 0, 420, 118);
    const text = this.label(inner, '开始闯关', 0, 0, 44, new Color(255, 251, 238));
    text.isBold = true;
    text.outlineWidth = 5;
    text.outlineColor = new Color(184, 74, 10);
    text.enableShadow = true;
    text.shadowColor = new Color(150, 66, 14, 160);
    text.shadowOffset = new Vec2(0, -4);

    const button = start.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.options.onStartGame();
    });

    // 增强主按钮脉冲效果
    tween(inner)
      .repeatForever(
        tween()
          .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
          .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const endless = new Node('EndlessButton');
    cluster.addChild(endless);
    endless.setPosition(0, -81);
    endless.addComponent(UITransform).setContentSize(300, 78);

    const endlessShadow = new Node('EndlessShadow');
    endless.addChild(endlessShadow);
    endlessShadow.setPosition(0, -40);
    endlessShadow.addComponent(UITransform).setContentSize(220, 20);
    const endlessShadowGraphics = endlessShadow.addComponent(Graphics);
    endlessShadowGraphics.fillColor = new Color(92, 54, 22, 70);
    endlessShadowGraphics.ellipse(0, 0, 110, 10);
    endlessShadowGraphics.fill();

    const endlessInner = new Node('EndlessInner');
    endless.addChild(endlessInner);
    this.homeCrop(endlessInner, 'button_start', 0, 0, 300, 78);
    this.endlessLabel = this.label(endlessInner, '无尽模式', 0, 0, 30, new Color(255, 251, 238));
    this.endlessLabel.isBold = true;
    this.endlessLabel.outlineWidth = 4;
    this.endlessLabel.outlineColor = new Color(184, 74, 10);
    this.addTapFeedback(endless, () => {
      if (!this.options.isEndlessUnlocked()) {
        this.toast('先通关第 1 关再来挑战无尽');
        return;
      }
      this.options.onStartEndless();
    }, 0.93);
    this.refreshPlayEntries();

    cluster.setScale(new Vec3(0.72, 0.72, 1));
    const opacity = cluster.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(cluster)
      .delay(0.32)
      .to(0.34, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity).delay(0.32).to(0.2, { opacity: 255 }).start();
  }

  private refreshChapterBanner() {
    const info = this.options.getChapterInfo();
    if (this.homeChapterTitleLabel) {
      this.homeChapterTitleLabel.string = info.campaignComplete
        ? `${info.name} · 已通关`
        : `第 ${info.level} 关 · ${info.name}`;
    }
  }

  private challengeRewardText() {
    if (!this.options.isChallengeUnlocked()) return '';
    return this.options.isChallengeRewardClaimed()
      ? '今日已领取'
      : `赢${this.options.challengeCoinReward}金币`;
  }

  private hasMoreBadge() {
    return false;
  }

  private refreshPlayEntries() {
    const challengeUnlocked = this.options.isChallengeUnlocked();
    const claimed = this.options.isChallengeRewardClaimed();
    if (this.challengeEntry) this.challengeEntry.setScale(new Vec3(challengeUnlocked ? 1 : 0.92, challengeUnlocked ? 1 : 0.92, 1));
    if (this.challengeTagGraphics) {
      // 锁定态金字签换米灰底，避免「奖励」和「锁定」两套信息挤在同一视觉里
      const graphics = this.challengeTagGraphics;
      graphics.clear();
      graphics.lineWidth = 3;
      graphics.fillColor = challengeUnlocked ? new Color(255, 224, 108) : new Color(240, 231, 214);
      graphics.strokeColor = challengeUnlocked ? new Color(166, 110, 34) : new Color(203, 188, 164);
      graphics.roundRect(-64, -16, 128, 32, 16);
      graphics.fill();
      graphics.stroke();
    }
    if (this.challengeRewardLabel) {
      this.challengeRewardLabel.string = this.challengeRewardText();
      this.challengeRewardLabel.node.setPosition(claimed || !challengeUnlocked ? 0 : 10, -1);
      this.challengeRewardLabel.node.active = challengeUnlocked;
    }
    if (this.challengeRewardCoin) this.challengeRewardCoin.active = challengeUnlocked && !claimed;
    if (this.challengeLockIcon) this.challengeLockIcon.active = !challengeUnlocked;
    if (this.challengeLockLabel) {
      this.challengeLockLabel.string = challengeUnlocked ? '' : '第 5 关解锁';
      this.challengeLockLabel.node.active = !challengeUnlocked;
      this.challengeLockLabel.node.setPosition(14, -1);
    }
    if (this.endlessLabel) {
      const unlocked = this.options.isEndlessUnlocked();
      this.endlessLabel.string = unlocked ? '无尽模式' : '无尽未解锁';
      this.endlessLabel.color = unlocked ? new Color(255, 251, 238) : new Color(255, 236, 206);
    }
  }

  // 小挂锁图标（挑战锁定态金字签左侧），与 GameScreen 的宠物位锁标同一画法
  private buildLockIcon(parent: Node, x: number) {
    const node = new Node('LockIcon');
    parent.addChild(node);
    node.setPosition(x, 0);
    node.addComponent(UITransform).setContentSize(26, 28);
    const graphics = node.addComponent(Graphics);
    graphics.strokeColor = new Color(135, 104, 76);
    graphics.lineWidth = 3;
    graphics.arc(0, 3, 7, Math.PI, 0, false);
    graphics.stroke();
    graphics.fillColor = new Color(135, 104, 76);
    graphics.roundRect(-11, -11, 22, 16, 4);
    graphics.fill();
    graphics.fillColor = new Color(255, 248, 226);
    graphics.circle(0, -3, 2.4);
    graphics.fill();
    node.active = false;
    return node;
  }

  private refreshMoreEntries() {
    if (this.moreBadge) this.moreBadge.active = this.hasMoreBadge();
  }

  private refreshTaskBadge() {
    if (!this.taskBadge) return;
    const count = Math.max(0, this.options.getDailyTaskBadgeCount());
    this.taskBadge.active = count > 0;
    if (this.taskBadgeLabel) this.taskBadgeLabel.string = `${Math.min(count, 9)}`;
  }

  private buildBottomNav(bottom: number) {
    const navWidth = 702;
    const navHeight = 168;
    // Keep the navigation bar above the home-indicator safe area.
    const navFinalY = bottom + navHeight / 2 + 68;
    const nav = new Node('BottomNav');
    this.homeUI!.addChild(nav);
    nav.setPosition(0, navFinalY);
    nav.addComponent(UITransform).setContentSize(navWidth, navHeight);
    const barFrame = this.assets.getFrame(this.cropPath('nav_bar'));
    if (barFrame) {
      const bar = nav.addComponent(Sprite);
      bar.sizeMode = Sprite.SizeMode.CUSTOM;
      bar.spriteFrame = barFrame;
    } else {
      const graphics = nav.addComponent(Graphics);
      graphics.fillColor = new Color(255, 248, 226);
      graphics.strokeColor = new Color(235, 205, 158);
      graphics.lineWidth = 3;
      graphics.roundRect(-navWidth / 2, -navHeight / 2, navWidth, navHeight, 34);
      graphics.fill();
      graphics.stroke();
    }
    const items: [string, string, (() => void)][] = [
      ['冒险', 'nav_adventure', this.options.onOpenAdventure],
      ['商店', 'nav_shop', this.options.onOpenShop],
      ['排行榜', 'nav_rank', this.options.onOpenLeaderboard],
      ['任务', 'nav_tasks', this.options.onOpenDailyTasks],
      ['更多', 'nav_more', () => this.toggleMore()],
    ];
    items.forEach(([name, cropName, callback], index) => {
      const item = new Node(`Nav_${name}`);
      nav.addChild(item);
      item.setPosition(-264 + index * 132, 8);
      item.addComponent(UITransform).setContentSize(112, 132);

      // 优化选中状态背板：更明显的高亮和底部指示条
      const selectedPlate = this.creamPanel(
        item,
        0,
        3,
        108,
        116,
        24,
        new Color(255, 238, 191, 240),
        new Color(235, 205, 158, 240),
      );
      selectedPlate.active = false;
      selectedPlate.setSiblingIndex(0);

      // 添加底部指示条
      const indicator = new Node('Indicator');
      selectedPlate.addChild(indicator);
      indicator.setPosition(0, -52);
      indicator.addComponent(UITransform).setContentSize(72, 6);
      const indicatorGraphics = indicator.addComponent(Graphics);
      indicatorGraphics.fillColor = new Color(255, 184, 77);
      indicatorGraphics.roundRect(-36, -3, 72, 6, 3);
      indicatorGraphics.fill();

      this.navSelectedPlates.push(selectedPlate);
      this.homeCrop(item, cropName, 0, 14, 88, 88);
      const navLabel = this.label(item, name, 0, -52, 20, new Color(111, 62, 28));
      navLabel.isBold = true;
      if (name === '任务') {
        this.taskBadge = this.notificationBadge(item, 38, 50, 0);
        this.taskBadgeLabel = this.taskBadge.getChildByName('Label')?.getComponent(Label) ?? null;
        this.refreshTaskBadge();
      }
      if (name === '更多') {
        this.moreBadge = this.notificationBadge(item, 38, 50, 1);
        this.refreshMoreEntries();
      }
      this.addTapFeedback(item, () => {
        this.selectedNavIndex = index;
        this.refreshNavSelection();
        callback();
      }, 0.92);
    });
    nav.setPosition(0, navFinalY - 240);
    tween(nav)
      .delay(0.12)
      .to(0.42, { position: new Vec3(0, navFinalY, 0) }, { easing: 'cubicOut' })
      .start();
    this.refreshNavSelection();
  }

  private refreshNavSelection() {
    this.navSelectedPlates.forEach((plate, index) => {
      const wasActive = plate.active;
      const isActive = index === this.selectedNavIndex;
      plate.active = isActive;

      // 添加选中时的弹出动画
      if (isActive && !wasActive) {
        plate.setScale(new Vec3(0.9, 0.9, 1));
        tween(plate)
          .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      }
    });
  }

  private toggleMore(active = !this.moreUI?.active) {
    if (!active) {
      if (this.moreUI) this.moreUI.active = false;
      return;
    }
    if (!this.moreUI) this.buildMoreSheet();
    if (!this.moreUI) return;
    this.refreshMoreEntries();
    this.moreUI.active = true;
    if (this.morePanel) {
      this.morePanel.setPosition(0, -view.getVisibleSize().height);
      tween(this.morePanel)
        .to(0.32, { position: new Vec3(0, -view.getVisibleSize().height / 2 + 214) }, { easing: 'cubicOut' })
        .start();
    }
  }

  private buildMoreSheet() {
    if (this.moreUI || !this.homeUI) return;
    const overlay = new Node('MoreOverlay');
    this.homeUI.addChild(overlay);
    overlay.active = false;
    this.moreUI = overlay;

    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('MoreBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.toggleMore(false));

    const panel = this.creamPanel(
      overlay, 0, -visibleSize.height, 702, 292, 34,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    this.morePanel = panel;
    panel.addComponent(BlockInputEvents);

    const handle = this.roundedShape(
      panel, 'MoreHandle', 0, 118, 72, 8, 4,
      new Color(235, 205, 158), new Color(235, 205, 158), 0,
    );
    handle.addComponent(UITransform).setContentSize(72, 8);

    const title = this.label(panel, '更多', 0, 78, 30, new Color(111, 62, 28));
    title.isBold = true;
    this.buildMoreGrid(panel, -24);
  }

  private buildMoreGrid(parent: Node, y: number) {
    const items: Array<{ name: string; crop: string; onTap: () => void }> = [
      { name: '瞬间', crop: 'side_moments', onTap: () => { this.toggleMore(false); this.options.onOpenMoments(); } },
      { name: '玩法介绍', crop: 'nav_guide', onTap: () => { this.toggleMore(false); this.toggleGuide(true); } },
      { name: '设置', crop: 'hud_settings', onTap: () => { this.toggleMore(false); this.toggleSettings(true); } },
    ];
    items.forEach((item, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const card = this.creamPanel(parent, -220 + col * 220, y - row * 128, 196, 112, 22);
      this.homeCrop(card, item.crop, 0, 16, 64, 64);
      const caption = this.label(card, item.name, 0, -38, 20, new Color(111, 62, 28));
      caption.isBold = true;
      this.addTapFeedback(card, item.onTap, 0.95);
    });
  }

  private buildGuide() {
    if (this.guideUI || !this.homeUI) return;
    const overlay = new Node('GuideOverlay');
    this.homeUI!.addChild(overlay);
    overlay.active = false;
    this.guideUI = overlay;
    this.guideTabItems = [];

    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('GuideBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.toggleGuide(false));

    // 面板压到 800 高，保证 4:3 等矮屏设备也能完整显示；内容按"成长路线 / 关卡规则"分页
    this.roundedShape(
      overlay, 'GuideShadow', 0, -6, 636, 816, 38,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );
    const panel = this.creamPanel(
      overlay, 0, 0, 620, 800, 32,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );

    this.buildGuideHeader(panel);
    this.buildGuideTabs(panel);
    this.buildGuideGrowthPage(panel);
    this.buildGuideRulesPage(panel);
    this.buildGuideClose(panel);
    this.setGuideTab(0);
  }

  private buildGuideHeader(parent: Node) {
    // 顶部吉祥物复用橙猫半身像，溢出面板顶边形成"探头"效果
    const mascot = this.image(parent, 'cats/cat_orange', 0, 424, 132, 132);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const title = this.label(parent, '玩法介绍', 0, 314, 36, new Color(111, 62, 28));
    title.isBold = true;

    const subtitle = this.label(parent, '闯关得星星 · 建设小镇 · 养成猫咪', 0, 280, 18, new Color(104, 145, 70));
    subtitle.isBold = true;

    // 标题下分隔线：两侧短线 + 中央金色圆点，给下方内容留出明确的起始节奏
    const headerRule = new Node('GuideHeaderRule');
    parent.addChild(headerRule);
    headerRule.setPosition(0, 256);
    const headerRuleGraphics = headerRule.addComponent(Graphics);
    headerRuleGraphics.lineWidth = 2;
    headerRuleGraphics.strokeColor = new Color(235, 215, 180, 220);
    headerRuleGraphics.moveTo(-184, 0);
    headerRuleGraphics.lineTo(-14, 0);
    headerRuleGraphics.moveTo(14, 0);
    headerRuleGraphics.lineTo(184, 0);
    headerRuleGraphics.stroke();
    headerRuleGraphics.fillColor = new Color(220, 171, 73);
    headerRuleGraphics.circle(0, 0, 5);
    headerRuleGraphics.fill();
  }

  // 分页签：米白胶囊（未选中）与主题色胶囊（选中）两套底互斥切换
  private buildGuideTabs(parent: Node) {
    const tabs: Array<{ title: string; accent: Color }> = [
      { title: '成长路线', accent: new Color(111, 158, 64) },
      { title: '关卡规则', accent: new Color(232, 145, 60) },
    ];
    tabs.forEach((tab, index) => {
      const root = new Node(`GuideTab_${tab.title}`);
      parent.addChild(root);
      root.setPosition(index === 0 ? -126 : 126, 206);
      root.addComponent(UITransform).setContentSize(236, 60);

      const idle = new Node('Idle');
      root.addChild(idle);
      const idleGraphics = idle.addComponent(Graphics);
      idleGraphics.lineWidth = 3;
      idleGraphics.strokeColor = new Color(tab.accent.r, tab.accent.g, tab.accent.b, 170);
      idleGraphics.fillColor = new Color(255, 252, 241, 245);
      idleGraphics.roundRect(-118, -30, 236, 60, 30);
      idleGraphics.fill();
      idleGraphics.stroke();

      const active = new Node('Active');
      root.addChild(active);
      const activeGraphics = active.addComponent(Graphics);
      activeGraphics.lineWidth = 3;
      activeGraphics.strokeColor = new Color(
        Math.max(tab.accent.r - 46, 0),
        Math.max(tab.accent.g - 46, 0),
        Math.max(tab.accent.b - 46, 0),
      );
      activeGraphics.fillColor = tab.accent;
      activeGraphics.roundRect(-118, -30, 236, 60, 30);
      activeGraphics.fill();
      activeGraphics.stroke();

      const tabLabel = this.label(root, tab.title, 0, -1, 22, Color.WHITE);
      tabLabel.isBold = true;

      this.addTapFeedback(root, () => this.setGuideTab(index), 0.95);
      this.guideTabItems.push({ idle, active, label: tabLabel, page: null });
    });
  }

  private setGuideTab(index: number) {
    this.guideTabItems.forEach((item, tabIndex) => {
      const active = tabIndex === index;
      item.idle.active = !active;
      item.active.active = active;
      item.label.color = active ? Color.WHITE : new Color(141, 105, 66);
      if (!item.page || item.page.active === active) return;
      item.page.active = active;
      if (active) {
        // 切页时轻微回弹，强化“翻到新一页”的手感
        item.page.setScale(new Vec3(0.94, 0.94, 1));
        tween(item.page).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      }
    });
  }

  private buildGuideGrowthPage(parent: Node) {
    const page = new Node('GuideGrowthPage');
    parent.addChild(page);
    page.addComponent(UITransform).setContentSize(568, 424);
    this.guideTabItems[0].page = page;

    const steps: Array<{ title: string; body: string; icon: string }> = [
      { title: '开始闯关', body: '点击首页“开始闯关”挑战当前主线关卡', icon: 'guide/step_play' },
      { title: '获得星星', body: '每关固定得 3 星，3 星正好点亮一格建设', icon: COMMON_UI_ASSETS.starIcon },
      { title: '建设小镇', body: '用星星逐格点亮建筑，亮满一个大节点就焕然一新', icon: 'home/house_icon' },
      { title: '解锁猫咪', body: '建筑装饰完成后，对应猫咪加入猫咪社', icon: 'guide/step_cat' },
      { title: '升级猫咪', body: '消耗金币升级猫咪，缩短技能冷却', icon: 'guide/step_upgrade' },
      { title: '使用专属技能', body: '装备猫咪闯关，充能满后释放技能', icon: 'guide/step_skill' },
    ];

    steps.forEach((step, index) => {
      this.guideStepRow(page, 125 - index * 70, index + 1, step.title, step.body, step.icon);
    });
  }

  private guideStepRow(parent: Node, y: number, index: number, titleText: string, bodyText: string, iconPath: string) {
    const row = this.creamPanel(parent, 0, y, 548, 60, 16,
      new Color(255, 253, 244, 250), new Color(224, 215, 179, 220));

    this.image(row, iconPath, -246, 0, 46, 46);

    // 序号小徽章压在图标左上角，强调成长路线的先后顺序
    const badge = new Node('StepBadge');
    row.addChild(badge);
    badge.setPosition(-260, 16);
    badge.addComponent(UITransform).setContentSize(24, 24);
    const badgeGraphics = badge.addComponent(Graphics);
    badgeGraphics.fillColor = new Color(255, 224, 108);
    badgeGraphics.strokeColor = new Color(184, 119, 36);
    badgeGraphics.lineWidth = 2;
    badgeGraphics.circle(0, 0, 12);
    badgeGraphics.fill();
    badgeGraphics.stroke();
    const num = this.label(badge, `${index}`, 0, -1, 14, new Color(111, 62, 28));
    num.isBold = true;

    const title = this.label(row, titleText, -216, 11, 20, new Color(111, 62, 28));
    title.isBold = true;
    title.horizontalAlign = Label.HorizontalAlign.LEFT;
    const titleTransform = title.node.getComponent(UITransform)!;
    titleTransform.anchorX = 0;
    titleTransform.anchorY = 0.5;
    titleTransform.setContentSize(460, 24);

    const body = this.label(row, bodyText, -216, -12, 17, new Color(112, 69, 40));
    body.horizontalAlign = Label.HorizontalAlign.LEFT;
    body.verticalAlign = Label.VerticalAlign.CENTER;
    const bodyTransform = body.node.getComponent(UITransform)!;
    bodyTransform.anchorX = 0;
    bodyTransform.anchorY = 0.5;
    bodyTransform.setContentSize(460, 22);
  }

  private buildGuideRulesPage(parent: Node) {
    const page = new Node('GuideRulesPage');
    parent.addChild(page);
    page.active = false;
    page.addComponent(UITransform).setContentSize(568, 424);
    this.guideTabItems[1].page = page;

    const rules: Array<{ title: string; body: string; icon: string }> = [
      { title: '点击收集', body: '只能点击未受遮挡的牌，自动入槽', icon: 'tasks/daily_icon_collect' },
      { title: '三同消除', body: '槽内 3 个相同元素自动消除，不要求相邻', icon: 'tasks/daily_icon_match' },
      { title: '槽满失败', body: '6 格槽位占满即失败；清空棋盘获胜', icon: 'tasks/daily_icon_clear' },
    ];

    rules.forEach((rule, index) => {
      this.guideRuleRow(page, 110 - index * 106, rule.title, rule.body, rule.icon);
    });
    this.guideTipCard(page);
  }

  private guideRuleRow(parent: Node, y: number, titleText: string, bodyText: string, iconPath: string) {
    const row = this.creamPanel(parent, 0, y, 548, 92, 20,
      new Color(255, 252, 240, 250), new Color(238, 190, 132, 220));

    this.image(row, iconPath, -230, 0, 58, 58);

    const title = this.label(row, titleText, -188, 19, 21, new Color(111, 62, 28));
    title.isBold = true;
    title.horizontalAlign = Label.HorizontalAlign.LEFT;
    const titleTransform = title.node.getComponent(UITransform)!;
    titleTransform.anchorX = 0;
    titleTransform.anchorY = 0.5;
    titleTransform.setContentSize(420, 26);

    const body = this.label(row, bodyText, -188, -14, 17, new Color(112, 69, 40));
    body.horizontalAlign = Label.HorizontalAlign.LEFT;
    body.verticalAlign = Label.VerticalAlign.CENTER;
    const bodyTransform = body.node.getComponent(UITransform)!;
    bodyTransform.anchorX = 0;
    bodyTransform.anchorY = 0.5;
    bodyTransform.setContentSize(420, 22);
  }

  private guideTipCard(parent: Node) {
    // 黄色技巧条 + 左侧灯泡图形，归入“关卡规则”页底部
    const tip = this.creamPanel(parent, 0, -193, 548, 62, 18,
      new Color(255, 239, 188), new Color(244, 209, 126));

    const bulb = new Node('TipBulb');
    tip.addChild(bulb);
    bulb.setPosition(-244, 0);
    const bulbGraphics = bulb.addComponent(Graphics);
    bulbGraphics.fillColor = new Color(255, 224, 108);
    bulbGraphics.strokeColor = new Color(184, 119, 36);
    bulbGraphics.lineWidth = 2;
    bulbGraphics.circle(0, -2, 12);
    bulbGraphics.fill();
    bulbGraphics.stroke();
    bulbGraphics.fillColor = new Color(184, 119, 36);
    bulbGraphics.rect(-3, 8, 6, 5);
    bulbGraphics.fill();
    // 灯泡高光（米色小弧）
    bulbGraphics.fillColor = new Color(255, 252, 239);
    bulbGraphics.ellipse(-3, -7, 3.5, 5);
    bulbGraphics.fill();

    const tipLabel = this.label(tip, '小技巧：优先点击能露出更多元素的牌', -212, 0, 17, new Color(91, 53, 34));
    tipLabel.isBold = true;
    tipLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    tipLabel.verticalAlign = Label.VerticalAlign.CENTER;
    const tipTransform = tipLabel.node.getComponent(UITransform)!;
    tipTransform.anchorX = 0;
    tipTransform.anchorY = 0.5;
    tipTransform.setContentSize(448, 30);
  }

  private buildGuideClose(parent: Node) {
    const close = this.creamPanel(parent, 0, -320, 240, 88, 28,
      new Color(255, 224, 108), new Color(201, 148, 47));
    const closeLabel = this.label(close, '知道了', 0, -2, 30, new Color(111, 62, 28));
    closeLabel.isBold = true;
    this.addTapFeedback(close, () => this.toggleGuide(false), 0.93);
  }

  private toggleGuide(active = !this.guideUI?.active) {
    if (!active) {
      if (this.guideUI) this.guideUI.active = false;
      return;
    }
    if (!this.guideUI) {
      if (this.guideLoading || !this.homeUI) return;
      this.guideLoading = true;
      this.assets.loadImages(buildGuideImagePaths(), () => {
        this.guideLoading = false;
        if (!this.homeUI || !this.homeUI.active) return;
        if (!this.guideUI) this.buildGuide();
        this.toggleGuide(true);
      });
      return;
    }
    this.guideUI.active = active;
    if (active) {
      const overlay = this.guideUI;
      const panel = overlay.children.find(child => child.name === 'Panel');
      if (panel) {
        panel.setScale(new Vec3(0.86, 0.86, 1));
        tween(panel).to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      }
    }
  }

  toast(text: string) {
    if (!this.homeUI) return;
    Toast.show(this.homeUI, text);
  }

  private toggleCoinAdPopup(active = !this.coinAdPopup?.active) {
    if (!active) {
      if (this.coinAdPopup) this.coinAdPopup.active = false;
      return;
    }
    if (!this.coinAdPopup) this.buildCoinAdPopup();
    if (!this.coinAdPopup) return;
    this.coinAdPopup.active = true;
    this.options.onTrack?.('share_entrance_show', { scene: 'home_coins' });
    // 今日已领取时切换按钮与文案，避免玩家点了才知道领不了
    const canClaim = this.options.canShareForCoins?.() ?? true;
    if (this.coinAdHintLabel) {
      this.coinAdHintLabel.string = canClaim ? '分享给好友即可领取金币奖励' : '今日已领取，明天再来';
    }
    if (this.coinAdButtonLabel) {
      this.coinAdButtonLabel.string = canClaim ? '分享好友' : '明天再来';
    }
    if (this.coinAdButton) this.coinAdButton.interactable = canClaim;
    const panel = this.coinAdPopup.getChildByName('AdPanel');
    if (panel) {
      panel.setScale(new Vec3(0.86, 0.86, 1));
      tween(panel).to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }
  }

  private buildCoinAdPopup() {
    if (this.coinAdPopup || !this.homeUI) return;
    const overlay = new Node('CoinAdPopup');
    this.homeUI.addChild(overlay);
    overlay.active = false;
    this.coinAdPopup = overlay;

    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('AdBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.toggleCoinAdPopup(false));

    // 面板阴影
    this.roundedShape(
      overlay, 'AdShadow', 0, -6, 556, 436, 40,
      new Color(69, 48, 29, 88), new Color(69, 48, 29, 0), 0,
    );

    const panel = this.creamPanel(
      overlay, 0, 0, 540, 420, 36,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.name = 'AdPanel';
    panel.addComponent(BlockInputEvents);

    // 标题
    const title = this.label(panel, '金币奖励', 0, 162, 32, new Color(111, 62, 28));
    title.isBold = true;

    // 金币图标
    const coinIcon = this.image(panel, COMMON_UI_ASSETS.coinIcon, 0, 60, 120, 120);

    // 奖励数字
    const rewardLabel = this.label(panel, '+888', 0, -40, 56, new Color(255, 184, 77));
    rewardLabel.isBold = true;
    rewardLabel.outlineWidth = 5;
    rewardLabel.outlineColor = new Color(184, 119, 36);
    rewardLabel.enableShadow = true;
    rewardLabel.shadowColor = new Color(150, 100, 30, 160);
    rewardLabel.shadowOffset = new Vec2(0, -4);

    // 提示文字
    const hint = this.label(panel, '分享给好友即可领取金币奖励', 0, -90, 20, new Color(112, 69, 40));
    hint.isBold = true;
    this.coinAdHintLabel = hint;

    // 分享按钮（复用结算弹窗的绿色胶囊底图）
    const shareButtonNode = this.image(panel, 'popup/btn_green', 0, -150, 236, 88);
    const shareLabel = this.label(shareButtonNode, '分享好友', 0, 0, 24, Color.WHITE);
    shareLabel.isBold = true;
    shareLabel.outlineWidth = 3;
    shareLabel.outlineColor = new Color(43, 94, 34);
    const shareButton = shareButtonNode.addComponent(Button);
    shareButton.transition = Button.Transition.SCALE;
    shareButton.zoomScale = 0.93;
    shareButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.handleShareForCoins();
    });
    this.coinAdButton = shareButton;
    this.coinAdButtonLabel = shareLabel;

    // 关闭按钮（使用图片资源）
    const close = this.image(panel, 'home_settings/btn_close', 230, 170, 88, 88);
    this.addTapFeedback(close, () => this.toggleCoinAdPopup(false), 0.93);
  }

  private async handleShareForCoins() {
    if (this.adRewardBusy) return;
    if (!this.options.onShareForCoins || !this.options.onAddCoins) {
      this.toast('分享功能暂未开放');
      return;
    }

    this.adRewardBusy = true;
    this.toast('正在拉起分享...');

    let shareOk = false;
    try {
      shareOk = await this.options.onShareForCoins();
    } catch (error) {
      console.error('[CatWorld] Share for coins failed', error);
      shareOk = false;
    }

    this.adRewardBusy = false;

    if (!shareOk) {
      this.toast('分享未完成，未获得奖励');
      return;
    }

    this.options.onAddCoins(888);
    if (this.homeCoinLabel) {
      this.homeCoinLabel.string = `${this.options.getCoins()}`;
    }
    this.refreshCoinShareBadge();

    this.toast('获得 888 金币');
    this.toggleCoinAdPopup(false);
  }

  private toggleSettings(open = !this.settingsPopup) {    if (!open) {
      this.settingsPopup?.close();
      this.settingsPopup = null;
      return;
    }
    if (this.settingsPopup || !this.homeUI) return;
    this.settingsPopup = SettingsPopup.open(this.homeUI, this.assets, {
      getMusicEnabled: () => this.options.getMusicEnabled(),
      getSoundEnabled: () => this.options.getSoundEnabled(),
      getVibrationEnabled: () => this.options.getVibrationEnabled(),
      onMusicChanged: enabled => this.options.onMusicChanged(enabled),
      onSoundChanged: enabled => this.options.onSoundChanged(enabled),
      onVibrationChanged: enabled => this.options.onVibrationChanged(enabled),
      onPlaySound: effect => this.options.onPlaySound(effect),
      // 弹窗自毁（点遮罩/关闭钮）时同步清引用，避免残留已销毁组件
      onClose: () => { this.settingsPopup = null; },
    });
  }
}
