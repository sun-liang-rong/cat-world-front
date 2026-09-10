import { BlockInputEvents, Button, Color, Graphics, Label, Node, Sprite, SpriteFrame, tween, UIOpacity, UITransform, Vec2, Vec3, view } from 'cc';
import { ActivitySnapshot } from './ActivityContent';
import { AssetStore, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { PlayerExperienceInfo } from './PlayerTypes';
import { Toast } from './Toast';

type SettingsFrameKey =
  | 'popupPanel' | 'btnClose' | 'rowCard'
  | 'iconTile' | 'iconMusic' | 'iconSound' | 'iconVibrate' | 'toggleOff' | 'toggleOn';

const SETTINGS_FRAME_FILES: Array<[string, SettingsFrameKey]> = [
  ['popup_panel', 'popupPanel'],
  ['btn_close', 'btnClose'],
  ['row_card', 'rowCard'],
  ['icon_tile', 'iconTile'],
  ['icon_music', 'iconMusic'],
  ['icon_sound', 'iconSound'],
  ['icon_vibrate', 'iconVibrate'],
  ['toggle_off', 'toggleOff'],
  ['toggle_on', 'toggleOn'],
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
  challengeCoinReward: number;
  isChallengeRewardClaimed: () => boolean;
  onOpenTown: () => void;
  onOpenCatCollection: () => void;
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
}

export class HomeScreen {
  private homeUI: Node | null = null;
  private toastY = 0;
  private homeCoinLabel: Label | null = null;
  private homeLevelLabel: Label | null = null;
  private homeNameLabel: Label | null = null;
  private settingsUI: Node | null = null;
  private settingsPanel: Node | null = null;
  private settingsBackdrop: Node | null = null;
  private readonly settingsFrames: Partial<Record<SettingsFrameKey, SpriteFrame>> = {};
  private musicToggle: Node | null = null;
  private soundToggle: Node | null = null;
  private vibrationToggle: Node | null = null;
  private guideUI: Node | null = null;
  private guideTabItems: GuideTabItem[] = [];
  private moreUI: Node | null = null;
  private morePanel: Node | null = null;
  private challengeRewardLabel: Label | null = null;
  private challengeRewardCoin: Node | null = null;
  private endlessLabel: Label | null = null;
  private homeChapterTitleLabel: Label | null = null;
  private homeChapterCollectedLabel: Label | null = null;
  private moreBadge: Node | null = null;
  private activityLastSeenEventId = '';
  private activityLastSeenPoints = -1;
  private taskBadge: Node | null = null;
  private taskBadgeLabel: Label | null = null;
  private readonly navSelectedPlates: Node[] = [];
  private selectedNavIndex = -1;
  private guideLoading = false;
  private settingsLoading = false;

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

  // 设置和玩法介绍不阻塞进首页，但首页亮起后立刻预建，避免第一次点开再拉远程图。
  preloadOverlays(onReady?: () => void) {
    this.assets.loadImages([
      ...buildGuideImagePaths(),
      ...buildSettingsImagePaths(),
    ], () => {
      if (this.homeUI) {
        SETTINGS_FRAME_FILES.forEach(([file, key]) => {
          const frame = this.assets.getFrame(`home_settings/${file}`);
          if (frame) this.settingsFrames[key] = frame;
        });
        if (!this.settingsUI) this.buildSettings();
        if (!this.guideUI) this.buildGuide();
      }
      onReady?.();
    });
  }

  setActive(active: boolean) {
    if (!this.homeUI) return;
    this.homeUI.active = active;
    if (!active && this.settingsUI) this.settingsUI.active = false;
    if (!active && this.guideUI) this.guideUI.active = false;
    if (!active && this.moreUI) this.moreUI.active = false;
    if (active) {
      if (this.homeCoinLabel) this.homeCoinLabel.string = `${this.options.getCoins()}`;
      this.refreshLevelBadge();
      this.refreshPlayerName();
      this.refreshChapterBanner();
      this.refreshTaskBadge();
      this.refreshPlayEntries();
      this.refreshMoreEntries();
    }
  }

  destroy() {
    this.homeUI?.destroy();
    this.homeUI = null;
    this.homeCoinLabel = null;
    this.homeLevelLabel = null;
    this.homeNameLabel = null;
    this.settingsUI = null;
    this.settingsPanel = null;
    this.settingsBackdrop = null;
    this.guideUI = null;
    this.guideTabItems = [];
    this.moreUI = null;
    this.morePanel = null;
    this.challengeRewardLabel = null;
    this.challengeRewardCoin = null;
    this.endlessLabel = null;
    this.homeChapterTitleLabel = null;
    this.homeChapterCollectedLabel = null;
    this.moreBadge = null;
    this.taskBadge = null;
    this.taskBadgeLabel = null;
    this.navSelectedPlates.length = 0;
    this.selectedNavIndex = -1;
    this.guideLoading = false;
    this.settingsLoading = false;
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
    this.homeUI.active = false;
    this.image(this.homeUI, 'home/home_bg_river', 0, 0, visibleSize.width, visibleSize.height);
    this.buildPlazaCats();
    this.buildTownEntry();
    this.buildPlayEntries();
    this.buildTopBar(top);
    this.buildGameTitle(top);
    this.buildStartCluster(bottom);
    this.buildBottomNav(bottom);
    this.toastY = bottom + 220;
  }

  // 五只猫咪组图装饰：锚定在 home_bg_river.jpg（864x1536）河岸步道的地面线上，
  // 用归一化坐标定位，保证不同屏幕比例下都贴着步道不漂移。
  // 背景纵向结构：桥面约 0.46 / 河面 0.51~0.67 / 石岸 0.67~0.72 / 步道 0.72 以下。
  private buildPlazaCats() {
    const visibleSize = view.getVisibleSize();
    const catWidth = Math.min(visibleSize.width * 0.74, 560);
    const catHeight = catWidth * (299 / 938);
    const feetV = 0.64;
    const centerY = visibleSize.height / 2 - feetV * visibleSize.height + catHeight / 2;

    const holder = new Node('PlazaCats');
    this.homeUI!.addChild(holder);
    holder.setPosition(8, centerY);
    holder.addComponent(UITransform).setContentSize(catWidth, catHeight);

    const shadow = new Node('PlazaCatsShadow');
    holder.addChild(shadow);
    shadow.setPosition(0, -catHeight / 2 + 6);
    shadow.addComponent(UITransform).setContentSize(catWidth * 0.94, 22);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics.ellipse(0, 0, catWidth * 0.47, 11);
    shadowGraphics.fill();

    this.image(holder, 'home/home_cats_group', 0, 0, catWidth, catHeight);
    this.addTapFeedback(holder, this.options.onOpenCatCollection, 0.98);

    holder.setScale(new Vec3(0, 0, 1));
    const opacity = holder.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(holder)
      .delay(0.55)
      .to(0.36, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity).delay(0.55).to(0.25, { opacity: 255 }).start();
  }

  private sideEntryAnchorY() {
    return view.getVisibleSize().height / 2 - 0.64 * view.getVisibleSize().height + 134;
  }

  private buildTownEntry() {
    const entry = new Node('TownEntry');
    this.homeUI!.addChild(entry);
    entry.setPosition(-304, this.sideEntryAnchorY());
    entry.addComponent(UITransform).setContentSize(124, 148);

    this.image(entry, 'home/house_icon', 0, 18, 84, 80);
    this.sideEntryLabel(entry, '建设小镇', 0, -50);
    this.addTapFeedback(entry, this.options.onOpenTown, 0.97);
    this.popIn(entry, 0.28);
  }

  private buildPlayEntries() {
    const y = this.sideEntryAnchorY();
    const x = 304;

    const challenge = new Node('ChallengeEntry');
    this.homeUI!.addChild(challenge);
    challenge.setPosition(x, y);
    challenge.addComponent(UITransform).setContentSize(124, 148);
    this.homeCrop(challenge, 'side_challenge', 0, 18, 84, 80);
    this.sideEntryLabel(challenge, '超萌挑战', 0, -50);
    const tag = this.creamPanel(
      challenge, 0, -88, 128, 32, 16,
      new Color(255, 224, 108), new Color(166, 110, 34),
    );
    this.challengeRewardCoin = this.image(tag, COMMON_UI_ASSETS.coinIcon, -46, 0, 20, 20);
    this.challengeRewardLabel = this.label(tag, this.challengeRewardText(), 10, -1, 16, new Color(111, 62, 28));
    this.challengeRewardLabel.isBold = true;
    this.challengeRewardLabel.overflow = Label.Overflow.SHRINK;
    this.challengeRewardLabel.enableWrapText = false;
    this.challengeRewardLabel.verticalAlign = Label.VerticalAlign.CENTER;
    this.challengeRewardLabel.node.getComponent(UITransform)!.setContentSize(92, 28);
    this.addTapFeedback(challenge, this.options.onStartChallenge, 0.93);
    this.popIn(challenge, 0.30);
    this.refreshPlayEntries();
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
    const avatar = this.topHomeCrop(this.homeUI!, 'avatar', -292, y, 96, 102);
    avatar.getComponent(UITransform)!.setContentSize(108, 108);
    this.homeLevelLabel = this.label(avatar, '', 0, -39, 16, new Color(91, 53, 34));
    this.homeLevelLabel.isBold = true;
    this.homeNameLabel = this.label(avatar, '', 0, -68, 18, new Color(91, 53, 34));
    this.homeNameLabel.isBold = true;
    this.homeNameLabel.outlineWidth = 4;
    this.homeNameLabel.outlineColor = new Color(255, 248, 226);
    this.homeNameLabel.overflow = Label.Overflow.SHRINK;
    this.homeNameLabel.enableWrapText = false;
    this.homeNameLabel.node.getComponent(UITransform)!.setContentSize(132, 28);
    this.refreshPlayerName();
    this.addTapFeedback(avatar, () => {
      const exp = this.options.getExperienceInfo();
      this.toast(`玩家等级 Lv.${exp.level}（经验 ${exp.exp}/${exp.expToNext}）`);
    });
    this.refreshLevelBadge();

    const coin = this.image(this.homeUI!, COMMON_UI_ASSETS.coinHud, 168, y - 31, 176, 54);
    this.homeCoinLabel = this.label(coin, `${this.options.getCoins()}`, 0, 0, 22, new Color(91, 53, 34));
    this.homeCoinLabel.node.getComponent(UITransform)!.setContentSize(72, 36);
    this.homeCoinLabel.verticalAlign = Label.VerticalAlign.CENTER;
    this.homeCoinLabel.isBold = true;
    this.addTapFeedback(coin, this.options.onOpenShop);

    const settings = this.homeCrop(this.homeUI!, 'hud_settings', 312, y - 31, 72, 72);
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
    const logo = this.homeCrop(this.homeUI!, 'title_logo', 0, top - 268, 540, 126);
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

  private buildStartCluster(bottom: number) {
    const cluster = new Node('StartCluster');
    this.homeUI!.addChild(cluster);
    cluster.setPosition(0, bottom + 380);

    const banner = this.creamPanel(
      cluster, 0, 468, 360, 52, 26,
      new Color(255, 248, 226, 246), new Color(235, 205, 158),
    );
    const title = this.label(banner, '', 0, 0, 22, new Color(111, 62, 28));
    title.isBold = true;
    title.node.getComponent(UITransform)!.setContentSize(320, 32);
    this.homeChapterTitleLabel = title;
    this.homeChapterCollectedLabel = null;
    this.refreshChapterBanner();

    const start = new Node('StartButton');
    cluster.addChild(start);
    start.setPosition(0, 42);
    start.addComponent(UITransform).setContentSize(420, 118);

    const shadow = new Node('StartShadow');
    start.addChild(shadow);
    shadow.setPosition(0, -58);
    shadow.addComponent(UITransform).setContentSize(330, 28);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 80);
    shadowGraphics.ellipse(0, 0, 165, 14);
    shadowGraphics.fill();

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

    tween(inner)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
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
      this.homeChapterTitleLabel.string = `第 ${info.level} 关 · ${info.name}`;
    }
  }

  private challengeRewardText() {
    return this.options.isChallengeRewardClaimed()
      ? '今日已领取'
      : `赢${this.options.challengeCoinReward}金币`;
  }

  private hasMoreBadge() {
    return false;
  }

  private refreshPlayEntries() {
    const claimed = this.options.isChallengeRewardClaimed();
    if (this.challengeRewardLabel) {
      this.challengeRewardLabel.string = this.challengeRewardText();
      this.challengeRewardLabel.node.setPosition(claimed ? 0 : 10, -1);
    }
    if (this.challengeRewardCoin) this.challengeRewardCoin.active = !claimed;
    if (this.endlessLabel) {
      const unlocked = this.options.isEndlessUnlocked();
      this.endlessLabel.string = unlocked ? '无尽模式' : '无尽未解锁';
      this.endlessLabel.color = unlocked ? new Color(255, 251, 238) : new Color(255, 236, 206);
    }
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
      const selectedPlate = this.creamPanel(
        item,
        0,
        3,
        108,
        116,
        24,
        new Color(255, 238, 191, 220),
        new Color(235, 205, 158, 220),
      );
      selectedPlate.active = false;
      selectedPlate.setSiblingIndex(0);
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
      plate.active = index === this.selectedNavIndex;
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
        .to(0.32, { position: new Vec3(0, -view.getVisibleSize().height / 2 + 278) }, { easing: 'cubicOut' })
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
      overlay, 0, -visibleSize.height, 702, 420, 34,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    this.morePanel = panel;
    panel.addComponent(BlockInputEvents);

    const handle = this.roundedShape(
      panel, 'MoreHandle', 0, 182, 72, 8, 4,
      new Color(235, 205, 158), new Color(235, 205, 158), 0,
    );
    handle.addComponent(UITransform).setContentSize(72, 8);

    const title = this.label(panel, '更多', 0, 142, 30, new Color(111, 62, 28));
    title.isBold = true;
    this.buildMoreGrid(panel, 24);
  }

  private buildMoreGrid(parent: Node, y: number) {
    const items: Array<{ name: string; crop: string; onTap: () => void }> = [
      { name: '图鉴', crop: 'nav_cats', onTap: () => { this.toggleMore(false); this.options.onOpenCatCollection(); } },
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
      { title: '获得星星', body: '通关即得星星，是建设小镇的核心资源', icon: COMMON_UI_ASSETS.starIcon },
      { title: '建设小镇', body: '前往小镇，用星星清理/修复/装饰建筑', icon: 'home/house_icon' },
      { title: '解锁猫咪', body: '建筑装饰完成后，对应猫咪加入图鉴', icon: 'guide/step_cat' },
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
    Toast.show(this.homeUI, text, { y: this.toastY });
  }

  private buildSettings() {
    if (this.settingsUI || !this.homeUI) return;
    const overlay = new Node('SettingsOverlay');
    this.homeUI!.addChild(overlay);
    overlay.active = false;
    this.settingsUI = overlay;

    const visibleSize = view.getVisibleSize();
    const backdrop = new Node('SettingsBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 150);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.toggleSettings(false));
    this.settingsBackdrop = backdrop;

    this.roundedShape(
      overlay, 'SettingsShadow', 0, 2, 592, 532, 40,
      new Color(69, 48, 29, 82), new Color(69, 48, 29, 0), 0,
    );
    const panel = new Node('SettingsPanel');
    overlay.addChild(panel);
    panel.setPosition(0, 26);
    panel.addComponent(UITransform).setContentSize(580, 520);
    this.settingsPanel = panel;
    const panelFrame = this.settingsFrames.popupPanel;
    if (panelFrame) {
      this.applySliceInsets(panelFrame, 80, 80);
      const sprite = panel.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.type = Sprite.Type.SLICED;
      sprite.spriteFrame = panelFrame;
    } else {
      this.roundedShape(panel, 'SettingsPanelBg', 0, 0, 580, 520, 38, new Color(255, 247, 224), new Color(205, 165, 102), 4);
    }
    const panelOpacity = panel.addComponent(UIOpacity);
    panelOpacity.opacity = 0;

    // 头部收紧：去掉大标题横幅和头像徽章，改居中标题 + 右上角关闭钮
    const title = this.label(panel, '设置', 0, 222, 30, new Color(100, 69, 43));
    title.isBold = true;
    const titleRule = this.label(panel, '小镇偏好', 0, 188, 17, new Color(125, 154, 89));
    titleRule.isBold = true;

    const close = this.settingsSprite(panel, 'SettingsClose', this.settingsFrames.btnClose, 240, 212, 88, 88);
    if (!this.settingsFrames.btnClose) {
      const closeShadow = close.addComponent(Graphics);
      closeShadow.fillColor = new Color(91, 53, 34, 60);
      closeShadow.ellipse(2, -4, 38, 38);
      closeShadow.fill();
      closeShadow.lineWidth = 3;
      closeShadow.strokeColor = new Color(255, 250, 229);
      closeShadow.fillColor = new Color(244, 103, 92);
      closeShadow.ellipse(0, 2, 38, 38);
      closeShadow.fill();
      closeShadow.stroke();
      closeShadow.lineWidth = 6;
      closeShadow.strokeColor = new Color(255, 250, 236);
      closeShadow.moveTo(-15, 16);
      closeShadow.lineTo(15, -13);
      closeShadow.moveTo(15, 16);
      closeShadow.lineTo(-15, -13);
      closeShadow.stroke();
    }
    this.addTapFeedback(close, () => this.toggleSettings(false));

    this.buildSettingRow(panel, '音乐', '背景音乐', this.settingsFrames.iconMusic, 43, 96, 'music');
    this.buildSettingRow(panel, '音效', '互动音效', this.settingsFrames.iconSound, 44, -26, 'sound');
    this.buildSettingRow(panel, '震动', '震动反馈', this.settingsFrames.iconVibrate, 44, -148, 'vibration');
    const footerRule = new Node('SettingsFooterRule');
    panel.addChild(footerRule);
    footerRule.setPosition(0, -224);
    const footerGraphics = footerRule.addComponent(Graphics);
    footerGraphics.lineWidth = 2;
    footerGraphics.strokeColor = new Color(235, 215, 180, 190);
    footerGraphics.moveTo(-170, 0);
    footerGraphics.lineTo(170, 0);
    footerGraphics.stroke();
    const footer = this.label(panel, '猫爪星球奇遇记', 0, -240, 17, new Color(181, 147, 96));
    footer.isBold = true;
  }

  private buildSettingRow(
    parent: Node,
    name: string,
    caption: string,
    iconFrame: SpriteFrame | undefined,
    iconSize: number,
    y: number,
    kind: 'music' | 'sound' | 'vibration',
  ) {
    const row = this.settingsSprite(parent, `${name}Row`, this.settingsFrames.rowCard, 0, y, 528, 104, 48, 44);
    if (!this.settingsFrames.rowCard) {
      this.roundedShape(row, `${name}RowBg`, 0, 0, 528, 104, 25, new Color(255, 252, 241), new Color(239, 215, 175), 3);
    }

    const tile = this.settingsSprite(row, `${name}IconTile`, this.settingsFrames.iconTile, -208, 0, 72, 72);
    if (!this.settingsFrames.iconTile) {
      this.roundedShape(tile, `${name}TileBg`, 0, 0, 72, 72, 18, new Color(255, 237, 204), new Color(241, 202, 145), 2);
    }
    if (iconFrame) {
      this.settingsSprite(tile, `${name}Icon`, iconFrame, 0, 0, iconSize, iconSize);
    }

    const title = this.label(row, name, -104, 10, 24, new Color(100, 69, 43));
    title.isBold = true;
    const captionLabel = this.label(row, caption, -104, -20, 17, new Color(172, 143, 104));
    captionLabel.isBold = true;

    const toggle = new Node(`${name}Toggle`);
    row.addChild(toggle);
    toggle.setPosition(174, 0);
    toggle.addComponent(UITransform).setContentSize(146, 88);
    if (this.settingsFrames.toggleOff) {
      this.settingsSprite(toggle, 'ToggleArt', this.settingsFrames.toggleOff, 0, 0, 146, 88);
    }
    const button = toggle.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      if (kind === 'music') this.options.onMusicChanged(!this.options.getMusicEnabled());
      else if (kind === 'sound') this.options.onSoundChanged(!this.options.getSoundEnabled());
      else this.options.onVibrationChanged(!this.options.getVibrationEnabled());
      this.refreshSettingRows();
      this.popToggle(toggle);
    });
    if (kind === 'music') this.musicToggle = toggle;
    else if (kind === 'sound') this.soundToggle = toggle;
    else this.vibrationToggle = toggle;
    this.refreshSettingRows();
  }

  private refreshSettingRows() {
    this.refreshToggle(this.musicToggle, this.options.getMusicEnabled());
    this.refreshToggle(this.soundToggle, this.options.getSoundEnabled());
    this.refreshToggle(this.vibrationToggle, this.options.getVibrationEnabled());
  }

  private refreshToggle(toggle: Node | null, enabled: boolean) {
    if (!toggle) return;
    const art = toggle.getChildByName('ToggleArt');
    const sprite = art?.getComponent(Sprite);
    if (sprite) {
      sprite.spriteFrame = (enabled ? this.settingsFrames.toggleOn : this.settingsFrames.toggleOff) ?? null;
      return;
    }
    // 图集缺失时的纯 Graphics 兜底开关。
    toggle.removeAllChildren();
    const track = new Node('ToggleTrack');
    toggle.addChild(track);
    track.addComponent(UITransform).setContentSize(146, 88);
    const trackGraphics = track.addComponent(Graphics);
    trackGraphics.lineWidth = 3;
    trackGraphics.fillColor = enabled ? new Color(143, 190, 79) : new Color(201, 174, 132);
    trackGraphics.strokeColor = enabled ? new Color(109, 157, 51) : new Color(176, 142, 99);
    trackGraphics.roundRect(-73, -44, 146, 88, 44);
    trackGraphics.fill();
    trackGraphics.stroke();
    const knob = new Node('ToggleKnob');
    toggle.addChild(knob);
    knob.setPosition(enabled ? 42 : -42, 0);
    knob.addComponent(UITransform).setContentSize(60, 60);
    const knobGraphics = knob.addComponent(Graphics);
    knobGraphics.fillColor = new Color(96, 62, 36, 48);
    knobGraphics.ellipse(2, -3, 28, 28);
    knobGraphics.fill();
    knobGraphics.fillColor = new Color(255, 249, 226);
    knobGraphics.strokeColor = new Color(247, 225, 179);
    knobGraphics.lineWidth = 2;
    knobGraphics.ellipse(0, 2, 28, 28);
    knobGraphics.fill();
    knobGraphics.stroke();
  }

  private popToggle(toggle: Node) {
    const art = toggle.getChildByName('ToggleArt');
    if (!art) return;
    art.setScale(new Vec3(1.14, 1.14, 1));
    tween(art).to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private settingsSprite(
    parent: Node,
    name: string,
    frame: SpriteFrame | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
    sliceHorizontal = 0,
    sliceVertical = sliceHorizontal,
  ) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    if (frame) {
      if (sliceHorizontal > 0) this.applySliceInsets(frame, sliceHorizontal, sliceVertical);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.type = sliceHorizontal > 0 ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
      sprite.spriteFrame = frame;
    }
    return node;
  }

  private applySliceInsets(frame: SpriteFrame, horizontal: number, vertical: number) {
    frame.insetLeft = horizontal;
    frame.insetRight = horizontal;
    frame.insetTop = vertical;
    frame.insetBottom = vertical;
  }

  private toggleSettings(active = !this.settingsUI?.active) {
    if (!active) {
      if (this.settingsUI) this.settingsUI.active = false;
      return;
    }
    if (!this.settingsUI) {
      if (this.settingsLoading || !this.homeUI) return;
      this.settingsLoading = true;
      this.assets.loadImages(buildSettingsImagePaths(), () => {
        this.settingsLoading = false;
        if (!this.homeUI || !this.homeUI.active) return;
        SETTINGS_FRAME_FILES.forEach(([file, key]) => {
          const frame = this.assets.getFrame(`home_settings/${file}`);
          if (frame) this.settingsFrames[key] = frame;
        });
        if (!this.settingsUI) this.buildSettings();
        this.toggleSettings(true);
      });
      return;
    }
    this.settingsUI.active = true;
    this.refreshSettingRows();
    if (this.settingsPanel) {
      const opacity = this.settingsPanel.getComponent(UIOpacity);
      if (opacity) {
        opacity.opacity = 0;
        tween(opacity).to(0.22, { opacity: 255 }).start();
      }
      this.settingsPanel.setScale(new Vec3(0.9, 0.9, 1));
      tween(this.settingsPanel)
        .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    }
    if (this.settingsBackdrop) {
      const opacity = this.settingsBackdrop.getComponent(UIOpacity) || this.settingsBackdrop.addComponent(UIOpacity);
      opacity.opacity = 0;
      tween(opacity).to(0.2, { opacity: 255 }).start();
    }
  }
}
