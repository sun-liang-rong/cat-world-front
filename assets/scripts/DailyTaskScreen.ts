import { SettlementButton } from './SettlementButton';
import { createVerticalContent, ensureButtonControl, Theme, TITLE_SIGN } from './Theme';
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
  UIOpacity,
  UITransform,
  Vec3,
  view,
} from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { DAILY_CHEST_REWARD, DAILY_TASK_DEFINITIONS } from './GameContent';
import { CatJourneyClaimResult, CatJourneySnapshot, DailyTaskId, ShareCardType, ShareOffer, TaskSnapshot } from './PlayerTypes';
import { Toast } from './Toast';

export interface DailyTaskScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getDateKey: () => string;
  getTasks: () => TaskSnapshot[];
  isChestReady: () => boolean;
  isChestClaimed: () => boolean;
  onClaimTask: (id: DailyTaskId) => boolean;
  onClaimChest: () => boolean;
  getCatJourney: () => CatJourneySnapshot;
  onClaimCatJourney: () => CatJourneyClaimResult;
  onJourneyOpened?: () => void;
  getShareOffer?: () => ShareOffer | null;
  onShare?: (type: ShareCardType) => void;
  onStartGame: () => void;
  onReturnHome: () => void;
}

type TaskCardView = {
  id: DailyTaskId;
  progressLabel: Label;
  button: Button;
  buttonLabel: Label;
  buttonBackground: Graphics | null;
  progressFill: Graphics;
};

const PANEL_WIDTH = 680;
const TASK_CARD_HEIGHT = 184;
const TASK_ICON_X = -255;
const PROGRESS_X = -40;
const PROGRESS_WIDTH = 221;
const PROGRESS_HEIGHT = 42;
const MODULE_GAP = 32;
const REWARD_ICON_X = 175;
const REWARD_LABEL_X = 266;
const TASK_ICON_PATHS = [
  'tasks/daily_icon_clear',
  'tasks/daily_icon_collect',
  'tasks/daily_icon_match',
];
const REWARD_ICON_PATHS = [
  COMMON_UI_ASSETS.coinIcon,
  'shop/icon_hammer',
  COMMON_UI_ASSETS.starIcon,
];

export class DailyTaskScreen {
  private taskUI: Node | null = null;
  private taskContent: Node | null = null;
  private dateLabel: Label | null = null;
  private chestButton: Button | null = null;
  private chestLabel: Label | null = null;
  private chestButtonBackground: Graphics | null = null;
  private journeyButton: Button | null = null;
  private journeyButtonLabel: Label | null = null;
  private journeyButtonBackground: Graphics | null = null;
  private journeyBadge: Node | null = null;
  private journeyUI: Node | null = null;
  private readonly cardViews: TaskCardView[] = [];
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: DailyTaskScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImagesFor(this, [
      'home/home_bg',
      TITLE_SIGN.path,
      'shop/icon_hammer',
      'shop/icon_glove',
      'shop/icon_dice',
      'shop/icon_extra_slot',
      'shop/hint_ribbon',
      COMMON_UI_ASSETS.backButton,
      'tasks/daily_date',
      'tasks/daily_panel',
      'cats/cat_orange',
      ...TASK_ICON_PATHS,
      'tasks/daily_progress_track',
      ...REWARD_ICON_PATHS,
      'tasks/daily_button_primary',
      'tasks/daily_button_disabled',
      'tasks/daily_chest_panel',
      'tasks/daily_chest_new',
      'tasks/daily_sparkle_large',
      'tasks/daily_sparkle_small',
      'tasks/daily_sparkle_wide',
      'tasks/daily_paw_sparkle',
      'tasks/daily_paw_cluster',
      'tasks/daily_sparkle_tiny',
    ], () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.taskUI) return;
    this.taskUI.active = active;
    if (!active) this.closeJourneyPanel();
    if (active) this.refresh();
  }

  destroy() {
    this.closeJourneyPanel();
    this.cardViews.length = 0;
    this.taskUI?.destroy();
    this.taskUI = null;
    this.taskContent = null;
    this.journeyButton = null;
    this.journeyButtonLabel = null;
    this.journeyButtonBackground = null;
    this.journeyBadge = null;
  }

  private create() {
    if (this.taskUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    this.taskUI = new Node('DailyTaskUI');
    this.root.addChild(this.taskUI);
    this.taskUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.taskUI.active = this.active;

    this.image(this.taskUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);

    const taskStep = TASK_CARD_HEIGHT + 36;
    // 任务卡与宝箱整体下移（旅程按钮下移后跟随，再留 10px 余量）
    this.taskContent = createVerticalContent(this.taskUI, top - 324, -top + 88, 686, 992);
    const positions = [-96, -96 - taskStep, -96 - taskStep * 2];
    DAILY_TASK_DEFINITIONS.forEach((definition, index) => {
      this.buildTaskCard(definition.id, index, positions[index]);
    });
    const thirdCardBottom = positions[2] - TASK_CARD_HEIGHT / 2;
    this.buildChest(thirdCardBottom - MODULE_GAP - 312 / 2 + 8);
    this.refresh();
  }

  private buildHeader(top: number) {
    const y = top - 150;
    this.buildBackButton(this.taskUI!, -304, y, this.options.onReturnHome);

    // 统一标题吊牌（与商店/猫咪社/小镇/冒险同款）：日期与旅程按钮改为
    // 吊牌下方一行横排，右上不再留悬浮的孤块。
    const sign = this.image(this.taskUI!, TITLE_SIGN.path, -15, top - 106, TITLE_SIGN.width, TITLE_SIGN.height);
    const signTitle = this.label(sign, '每日任务', 0, TITLE_SIGN.titleOffsetY, TITLE_SIGN.titleFontSize, Theme.title);
    signTitle.isBold = true;

    const dateChip = this.image(this.taskUI!, 'tasks/daily_date', -112, top - 262, 264, 74);
    this.dateLabel = this.label(dateChip, '', 22, -1, 22, new Color(112, 69, 40));
    this.dateLabel.isBold = true;
    this.dateLabel.node.getComponent(UITransform)!.setContentSize(206, 48);

    // 旅程按钮与日期胶囊同一行横排（右侧），红点角标随按钮一起移动
    const journeyView = this.actionButton(this.taskUI!, 124, top - 262, 190, 68, '');
    journeyView.label.fontSize = 20;
    journeyView.label.lineHeight = 28;
    journeyView.label.node.getComponent(UITransform)!.setContentSize(180, 56);
    journeyView.button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.openJourneyPanel();
    });
    this.journeyButton = journeyView.button;
    this.journeyButtonLabel = journeyView.label;
    this.journeyButtonBackground = journeyView.background;

    // 可领取提醒：按钮右上角的红点 + 感叹号，领完当天奖励自动消失
    this.journeyBadge = new Node('JourneyBadge');
    journeyView.button.node.addChild(this.journeyBadge);
    this.journeyBadge.setPosition(84, -26);
    this.journeyBadge.addComponent(UITransform).setContentSize(32, 32);
    const badgeGraphics = this.journeyBadge.addComponent(Graphics);
    badgeGraphics.fillColor = new Color(244, 72, 74);
    badgeGraphics.strokeColor = Color.WHITE;
    badgeGraphics.lineWidth = 3;
    badgeGraphics.circle(0, 0, 14);
    badgeGraphics.fill();
    badgeGraphics.stroke();
    const badgeLabel = this.label(this.journeyBadge, '!', 0, 0, 20, Color.WHITE);
    badgeLabel.isBold = true;
    badgeLabel.node.getComponent(UITransform)!.setContentSize(24, 24);
    this.journeyBadge.active = false;
    tween(this.journeyBadge)
      .repeatForever(
        tween()
          .delay(1.2)
          .to(0.2, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'sineOut' })
          .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }),
      )
      .start();
  }

  private buildTaskCard(id: DailyTaskId, index: number, y: number) {
    const definition = DAILY_TASK_DEFINITIONS[index];
    const card = this.image(this.taskContent!, 'tasks/daily_panel', 0, y, PANEL_WIDTH, TASK_CARD_HEIGHT);
    this.image(card, TASK_ICON_PATHS[index], TASK_ICON_X, 2, 140, 141);

    const title = this.label(card, definition.title, -139, 53, 26, new Color(111, 62, 28));
    title.isBold = true;
    title.horizontalAlign = Label.HorizontalAlign.LEFT;
    title.node.setPosition(-14, 53);
    title.node.getComponent(UITransform)!.setContentSize(272, 44);

    const description = this.label(card, definition.description, -137, 15, 21, new Color(136, 94, 63));
    description.horizontalAlign = Label.HorizontalAlign.LEFT;
    description.node.setPosition(10, 15);
    description.node.getComponent(UITransform)!.setContentSize(320, 34);

    const progressNode = this.image(card, 'tasks/daily_progress_track', PROGRESS_X, -37, PROGRESS_WIDTH, PROGRESS_HEIGHT);
    const progressFill = new Node('ProgressFill').addComponent(Graphics);
    progressNode.addChild(progressFill.node);
    progressFill.node.addComponent(UITransform).setContentSize(PROGRESS_WIDTH, PROGRESS_HEIGHT);
    const progressLabel = this.label(card, '', PROGRESS_X, -74, 22, new Color(112, 69, 40));
    progressLabel.isBold = true;

    this.image(card, REWARD_ICON_PATHS[index], REWARD_ICON_X, 47, 62, 62);
    const rewardLabel = this.label(card, definition.rewardText, REWARD_LABEL_X, 47, 22, new Color(112, 69, 40));
    rewardLabel.isBold = true;
    rewardLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    rewardLabel.node.getComponent(UITransform)!.setContentSize(100, 44);

    const buttonView = this.actionButton(card, 226, -42, 174, 72, '');
    buttonView.button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const task = this.options.getTasks().find(item => item.id === id);
      if (!task) return;
      if (task.completed && !task.claimed) {
        const success = this.options.onClaimTask(id);
        this.toast(success ? '任务奖励已领取' : '完成任务后可以领取奖励');
      } else if (!task.completed) {
        this.options.onStartGame();
      }
      this.refresh();
    });

    this.cardViews.push({
      id,
      progressLabel,
      button: buttonView.button,
      buttonLabel: buttonView.label,
      buttonBackground: buttonView.background,
      progressFill,
    });
  }

  private buildChest(y: number) {
    const card = this.image(this.taskContent!, 'tasks/daily_chest_panel', 0, y, PANEL_WIDTH, 312);
    this.image(card, 'tasks/daily_chest_new', -224, 8, 214, 172);
    this.image(card, 'tasks/daily_sparkle_large', -299, 102, 36, 42);
    this.image(card, 'tasks/daily_sparkle_small', -278, -85, 22, 26);
    this.image(card, 'tasks/daily_sparkle_wide', -111, 103, 34, 40);
    this.image(card, 'tasks/daily_paw_sparkle', 284, 90, 23, 27);
    this.image(card, 'tasks/daily_paw_cluster', 291, -88, 32, 43);

    const title = this.label(card, '每日宝箱', 63, 98, 35, new Color(111, 62, 28));
    title.isBold = true;
    const hint = this.label(card, '完成全部任务后领取', 63, 56, 22, new Color(112, 69, 40));
    hint.isBold = true;

    this.buildChestReward(card, COMMON_UI_ASSETS.coinIcon, `金币 ×${DAILY_CHEST_REWARD.coins}`, -55, -7, 48);
    this.buildChestReward(card, 'shop/icon_hammer', `锤子 ×${DAILY_CHEST_REWARD.items.hammer}`, 95, -7, 50);
    this.buildChestReward(card, 'shop/icon_dice', `骰子 ×${DAILY_CHEST_REWARD.items.dice}`, 240, -7, 46);

    const buttonView = this.actionButton(card, 63, -95, 254, 78, '');
    this.chestButton = buttonView.button;
    this.chestLabel = buttonView.label;
    this.chestButtonBackground = buttonView.background;
    this.chestButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const success = this.options.onClaimChest();
      this.toast(success ? '每日宝箱已领取' : '完成全部任务后开启宝箱');
      this.refresh();
    });
  }

  private buildChestReward(parent: Node, iconPath: string, text: string, x: number, y: number, size: number) {
    this.image(parent, iconPath, x - 40, y, size, size);
    const label = this.label(parent, text, x + 30, y - 1, 18, new Color(112, 69, 40));
    label.isBold = true;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
  }

  private refresh() {
    if (!this.taskUI) return;
    const tasks = this.options.getTasks();
    this.cardViews.forEach(viewData => {
      const task = tasks.find(item => item.id === viewData.id);
      if (!task) return;
      const ratio = Math.min(1, task.progress / task.target);
      viewData.progressLabel.string = `${Math.min(task.progress, task.target)} / ${task.target}`;
      viewData.buttonLabel.string = this.taskButtonText(viewData.id, task);
      viewData.button.interactable = task.claimed
        ? false
        : task.completed || viewData.id !== 'collect_100_elements' || task.progress === 0;
      this.setButtonVisual(viewData.buttonBackground, viewData.button.interactable);
      this.updateProgress(viewData, ratio);
    });

    if (this.dateLabel) {
      this.dateLabel.string = `今日 ${this.options.getDateKey().replace(/-/g, '/')}`;
    }
    if (this.chestButton && this.chestLabel) {
      const ready = this.options.isChestReady();
      const claimed = this.options.isChestClaimed();
      this.chestButton.interactable = ready && !claimed;
      this.chestLabel.string = claimed ? '已领取' : ready ? '领取宝箱' : '完成全部任务';
      this.setButtonVisual(this.chestButtonBackground, this.chestButton.interactable);
    }
    this.refreshJourneyButton();
  }

  private refreshJourneyButton() {
    if (!this.journeyButton || !this.journeyButtonLabel) return;
    const journey = this.options.getCatJourney();
    this.journeyButton.interactable = journey.started;
    this.journeyButtonLabel.string = !journey.started
      ? '第 1 关后开启'
      : journey.completed
        ? '猫咪旅程 · 已完成'
        : journey.canClaim
          ? `领取第 ${journey.currentDay} 天`
          : '猫咪旅程 · 明天再来';
    this.setButtonVisual(this.journeyButtonBackground, journey.started);
    // 可领取时红点亮起 + 按钮文字呼吸，把「今天还没领」这件事顶到玩家眼前
    if (this.journeyBadge) this.journeyBadge.active = journey.canClaim;
    Tween.stopAllByTarget(this.journeyButtonLabel.node);
    this.journeyButtonLabel.node.setScale(new Vec3(1, 1, 1));
    if (journey.canClaim) {
      tween(this.journeyButtonLabel.node)
        .repeatForever(
          tween()
            .to(0.75, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
            .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
        )
        .start();
    }
  }

  private openJourneyPanel() {
    if (this.journeyUI || !this.taskUI) return;
    const journey = this.options.getCatJourney();
    if (!journey.started) {
      this.toast('通关第 1 关后开启猫咪 7 日旅程');
      return;
    }
    this.options.onJourneyOpened?.();
    const shareOffer = journey.completed ? this.options.getShareOffer?.() : null;
    this.journeyUI = new Node('CatJourneyPanel');
    this.taskUI.addChild(this.journeyUI);
    const visibleSize = view.getVisibleSize();
    const mask = new Node('CatJourneyMask');
    this.journeyUI.addChild(mask);
    mask.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const maskGraphics = mask.addComponent(Graphics);
    maskGraphics.fillColor = new Color(22, 18, 13, 190);
    maskGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    maskGraphics.fill();
    mask.addComponent(BlockInputEvents);
    // 点蒙层空白处直接关闭，与首页各弹窗的交互一致
    mask.on(Node.EventType.TOUCH_END, () => this.closeJourneyPanel());

    const panelWidth = 610;
    const panelHeight = shareOffer ? 760 : 650;
    // 面板投影：与首页弹窗同一套「垫影」画法
    const shadow = new Node('CatJourneyShadow');
    this.journeyUI.addChild(shadow);
    shadow.setPosition(0, -6);
    shadow.addComponent(UITransform).setContentSize(panelWidth + 24, panelHeight + 16);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(69, 48, 29, 88);
    shadowGraphics.roundRect(-(panelWidth + 24) / 2, -(panelHeight + 16) / 2, panelWidth + 24, panelHeight + 16, 36);
    shadowGraphics.fill();

    const panel = new Node('CatJourneyCard');
    this.journeyUI.addChild(panel);
    panel.setPosition(0, -12);
    panel.addComponent(UITransform).setContentSize(panelWidth, panelHeight);
    const panelGraphics = panel.addComponent(Graphics);
    panelGraphics.fillColor = new Color(255, 248, 226);
    panelGraphics.strokeColor = new Color(235, 205, 158);
    panelGraphics.lineWidth = 4;
    panelGraphics.roundRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 32);
    panelGraphics.fill();
    panelGraphics.stroke();
    // 入场回弹：与首页各弹窗同一套节奏
    panel.setScale(new Vec3(0.86, 0.86, 1));
    tween(panel).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    // 底部两角的小爪印/星光：低透明度装饰，打破面板下方的空旷感
    const cornerPaw = this.image(panel, 'tasks/daily_paw_cluster', -270, -panelHeight / 2 + 48, 32, 43);
    cornerPaw.addComponent(UIOpacity).opacity = 150;
    const cornerSpark = this.image(panel, 'tasks/daily_paw_sparkle', 270, -panelHeight / 2 + 48, 23, 27);
    cornerSpark.addComponent(UIOpacity).opacity = 150;

    // 垂直节奏（自上而下等比留白）：大橘 → 缎带标题 → 副标题 → 进度条 → 礼物卡 → 按钮
    const half = panelHeight / 2;
    const mascotY = half - 64;
    const mascot = this.image(panel, 'cats/cat_orange', 0, mascotY, 108, 108);
    tween(mascot)
      .repeatForever(
        tween()
          .to(1, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
          .to(1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
    const sparkleLeft = this.image(panel, 'tasks/daily_sparkle_small', -96, mascotY + 26, 26, 30);
    const sparkleRight = this.image(panel, 'tasks/daily_sparkle_tiny', 102, mascotY - 14, 20, 22);
    [sparkleLeft, sparkleRight].forEach((sparkle, index) => {
      tween(sparkle)
        .delay(index * 0.35)
        .repeatForever(
          tween()
            .to(0.75, { scale: new Vec3(0.78, 0.78, 1) }, { easing: 'sineInOut' })
            .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
        )
        .start();
    });

    // 标题压缎带（与猫咪详情页名牌同款素材），替代孤零零的一行字
    const ribbonY = mascotY - 96;
    const ribbon = this.image(panel, 'shop/hint_ribbon', 0, ribbonY, 320, 72);
    if (!this.assets.getFrame('shop/hint_ribbon')) {
      const fallback = ribbon.addComponent(Graphics);
      fallback.fillColor = new Color(255, 248, 226);
      fallback.strokeColor = new Color(224, 154, 51);
      fallback.lineWidth = 3;
      fallback.roundRect(-160, -34, 320, 68, 34);
      fallback.fill();
      fallback.stroke();
    }
    const title = this.label(panel, '猫咪 7 日旅程', 0, ribbonY + 2, 30, new Color(111, 62, 28));
    title.isBold = true;
    const subtitleY = ribbonY - 62;
    const subtitle = this.label(
      panel,
      journey.completed ? '大橘为你准备了纪念徽章' : '每天回来看看，带走一份猫咪礼物',
      0,
      subtitleY,
      18,
      new Color(136, 94, 63),
    );
    subtitle.node.getComponent(UITransform)!.setContentSize(560, 26);

    // 旅程进度条：已领天数一目了然，也是弹窗里唯一的数据锚点
    const progressY = subtitleY - 40;
    const trackNode = new Node('JourneyProgress');
    panel.addChild(trackNode);
    trackNode.setPosition(0, progressY);
    trackNode.addComponent(UITransform).setContentSize(360, 20);
    const trackGraphics = trackNode.addComponent(Graphics);
    trackGraphics.fillColor = new Color(246, 232, 204);
    trackGraphics.strokeColor = new Color(235, 205, 158);
    trackGraphics.lineWidth = 2;
    trackGraphics.roundRect(-180, -10, 360, 20, 10);
    trackGraphics.fill();
    trackGraphics.stroke();
    const claimedCount = journey.claimedDays.length;
    if (claimedCount > 0) {
      const fillNode = new Node('JourneyProgressFill');
      trackNode.addChild(fillNode);
      const fillGraphics = fillNode.addComponent(Graphics);
      fillGraphics.fillColor = new Color(255, 176, 59);
      fillGraphics.roundRect(-177, -7, Math.max(12, 354 * Math.min(1, claimedCount / 7)), 14, 7);
      fillGraphics.fill();
    }
    const progressLabel = this.label(
      trackNode,
      claimedCount >= 7 ? '旅程全部完成' : `旅程进度 ${claimedCount}/7 天`,
      0,
      0,
      18,
      Theme.title,
    );
    progressLabel.isBold = true;
    progressLabel.outlineWidth = 0;
    progressLabel.outlineColor = new Color(190, 120, 40);

    // 礼物卡：日签胶囊 + 奖励图标 + 短文案，替代纯文字格
    const rewardShort = ['金币×50', '锤子×1', '槽位×1', '金币×100', '骰子×1', '手套+锤子', '金币×300+徽章'];
    const rewardIcons = [
      COMMON_UI_ASSETS.coinIcon,
      'shop/icon_hammer',
      'shop/icon_extra_slot',
      COMMON_UI_ASSETS.coinIcon,
      'shop/icon_dice',
      'shop/icon_glove',
      COMMON_UI_ASSETS.coinIcon,
    ];
    const gridTop = progressY - 73;
    const gridStep = 116;
    for (let index = 0; index < rewardShort.length; index += 1) {
      const day = index + 1;
      const row = Math.floor(index / 4);
      const column = index % 4;
      // 四列卡片两侧各留 25px，横向格间距 16px；第二行居中。
      const x = row === 0 ? -216 + column * 144 : -144 + column * 144;
      const y = gridTop - row * gridStep;
      const cell = new Node(`JourneyDay${day}`);
      panel.addChild(cell);
      cell.setPosition(x, y);
      cell.addComponent(UITransform).setContentSize(128, 100);
      const cellGraphics = cell.addComponent(Graphics);
      const claimed = journey.claimedDays.indexOf(day) >= 0;
      const current = !journey.completed && journey.currentDay === day;
      cellGraphics.fillColor = claimed
        ? new Color(205, 238, 175)
        : current ? new Color(255, 224, 108) : new Color(255, 252, 241);
      cellGraphics.strokeColor = current ? new Color(201, 148, 47) : new Color(235, 205, 158);
      cellGraphics.lineWidth = current ? 4 : 2;
      cellGraphics.roundRect(-64, -50, 128, 100, 20);
      cellGraphics.fill();
      cellGraphics.stroke();

      // 日签胶囊：今天这一格用白签反衬金底，其余用金签
      const tag = new Node('DayTag');
      cell.addChild(tag);
      tag.setPosition(0, 33);
      tag.addComponent(UITransform).setContentSize(70, 26);
      const tagGraphics = tag.addComponent(Graphics);
      tagGraphics.fillColor = current ? new Color(255, 255, 250) : new Color(255, 224, 108);
      tagGraphics.strokeColor = new Color(214, 151, 38);
      tagGraphics.lineWidth = 2;
      tagGraphics.roundRect(-35, -13, 70, 26, 13);
      tagGraphics.fill();
      tagGraphics.stroke();
      const tagLabel = this.label(tag, `第 ${day} 天`, 0, 0, 17, new Color(111, 62, 28));
      tagLabel.isBold = true;
      tagLabel.overflow = Label.Overflow.SHRINK;
      tagLabel.node.getComponent(UITransform)!.setContentSize(64, 26);

      // 奖励图标 + 短文案
      this.image(cell, rewardIcons[index], 0, -4, 44, 44);
      const rewardLabel = this.label(cell, claimed ? '已领取' : rewardShort[index], 0, -38, 17, new Color(112, 69, 40));
      rewardLabel.overflow = Label.Overflow.SHRINK;
      rewardLabel.node.getComponent(UITransform)!.setContentSize(116, 26);

      // 已领取：右上角补一枚绿勾，扫一眼就能分清新旧格子
      if (claimed) {
        const check = new Node('ClaimedCheck');
        cell.addChild(check);
        check.setPosition(49, 33);
        const checkGraphics = check.addComponent(Graphics);
        checkGraphics.strokeColor = new Color(78, 139, 50);
        checkGraphics.lineWidth = 4;
        checkGraphics.moveTo(-6, 0);
        checkGraphics.lineTo(-1, -5);
        checkGraphics.lineTo(7, 6);
        checkGraphics.stroke();
      }
      // 第 7 天终章大奖：金色粗边 + 星光角标，和普通格子拉开层级
      if (day === rewardShort.length) {
        cellGraphics.strokeColor = new Color(214, 151, 38);
        cellGraphics.lineWidth = 4;
        cellGraphics.roundRect(-64, -50, 128, 100, 20);
        cellGraphics.stroke();
        this.image(cell, 'tasks/daily_sparkle_large', -49, 33, 26, 30);
      }
      // 今日可领取的格子轻微呼吸，把视线引到「今天该点的那一格」
      if (current) {
        tween(cell)
          .repeatForever(
            tween()
              .to(0.75, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
              .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
          )
          .start();
      }
    }

    // 底部操作排成一行：主操作居左、稍后查看居右（次级灰底）；按钮收窄并整体下移
    const row1Bottom = gridTop - gridStep - 50;
    const shareY = row1Bottom - 52;
    const buttonsY = (shareOffer ? shareY - 104 : row1Bottom - 57) - 20;
    const claimView = this.actionButton(panel, -116, buttonsY, 208, 88, journey.canClaim ? '领取今日奖励' : journey.completed ? '旅程已完成' : '明天再来');
    claimView.button.interactable = journey.canClaim;
    this.setButtonVisual(claimView.background, journey.canClaim);
    claimView.button.node.on(Button.EventType.CLICK, () => {
      const result = this.options.onClaimCatJourney();
      this.toast(result.ok ? `${result.message}：${result.rewardText ?? ''}` : result.message);
      this.refresh();
      this.closeJourneyPanel();
      if (result.ok && result.completed) this.openJourneyPanel();
    });

    if (shareOffer) {
      const shareView = this.actionButton(panel, 0, shareY, 400, 88, shareOffer.label);
      SettlementButton.draw(shareView.background, 400, 88, 'secondary');
      shareView.button.node.on(Button.EventType.CLICK, () => {
        this.options.onShare?.(shareOffer.type);
      });
    }

    const close = this.actionButton(panel, 116, buttonsY, 208, 88, '稍后查看');
    SettlementButton.draw(close.background, 208, 88, 'secondary');
    close.button.node.on(Button.EventType.CLICK, () => this.closeJourneyPanel());
  }

  private closeJourneyPanel() {
    this.journeyUI?.destroy();
    this.journeyUI = null;
  }

  private taskButtonText(id: DailyTaskId, task: TaskSnapshot) {
    if (task.claimed) return '已领取';
    if (task.completed) return '领取';
    if (id === 'collect_100_elements' && task.progress > 0) return '进行中';
    return '前往';
  }

  private updateProgress(viewData: TaskCardView, ratio: number) {
    const innerInset = 8;
    const fillWidth = Math.max(0, (PROGRESS_WIDTH - innerInset * 2) * ratio);
    viewData.progressFill.clear();
    if (fillWidth <= 0) return;
    viewData.progressFill.fillColor = new Color(87, 190, 67, 255);
    viewData.progressFill.roundRect(-PROGRESS_WIDTH / 2 + innerInset, -10, fillWidth, 20, 10);
    viewData.progressFill.fill();
  }

  private actionButton(parent: Node, x: number, y: number, width: number, height: number, text: string) {
    height = Math.max(88, height);
    const node = new Node('ActionButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(Math.max(width, 88), Math.max(height, 88));
    const background = SettlementButton.apply(node, 'primary', width, height);
    const labelNode = new Node('Label');
    node.addChild(labelNode);
    labelNode.addComponent(UITransform).setContentSize(width - 10, height - 10);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = height >= 78 ? 30 : 28;
    label.lineHeight = label.fontSize + 8;
    label.color = new Color(255, 251, 238);
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = new Color(184, 74, 10);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;

    SettlementButton.styleLabel(label, width, height, 24);
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    return { button, label, background };
  }

  private setButtonVisual(background: Graphics | null, active: boolean) {
    if (!background) return;
    const size = background.node.getComponent(UITransform)!.contentSize;
    SettlementButton.draw(background, size.width, size.height, active ? 'primary' : 'disabled');
  }

  private buildBackButton(parent: Node, x: number, y: number, callback: () => void) {
    const node = new Node('DailyTaskBackButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(node, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    if (!this.assets.getFrame(COMMON_UI_ASSETS.backButton)) {
      const graphics = node.addComponent(Graphics);
      graphics.fillColor = new Color(255, 248, 226);
      graphics.strokeColor = new Color(239, 180, 67);
      graphics.lineWidth = 4;
      graphics.roundRect(-42, -42.5, 84, 85, 25);
      graphics.fill();
      graphics.stroke();
    }
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
    });
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.taskUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 38);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private image(parent: Node, path: string, x: number, y: number, width: number, height: number) {
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = this.assets.getFrame(path);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
    }
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
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
  }

  private toast(text: string) {
    if (!this.taskUI) return;
    Toast.show(this.taskUI, text);
  }
}
