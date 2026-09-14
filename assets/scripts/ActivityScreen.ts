import {
  BlockInputEvents,
  Button,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  UITransform,
  view,
} from 'cc';
import { ActivitySnapshot } from './ActivityContent';
import { AssetStore, BACK_BUTTON_SIZE, belowWeChatCapsule } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { Toast } from './Toast';
import { ActivityRewardId, ActivityTaskId } from './PlayerTypes';

export interface ActivityScreenOptions {
  getActivity: () => ActivitySnapshot;
  onClaimTask: (id: ActivityTaskId) => boolean;
  onClaimReward: (id: ActivityRewardId) => boolean;
  onStartGame: () => void;
  onPlaySound: (effect: AudioEffect) => void;
  onReturnHome: () => void;
}

type LabelBoxOptions = {
  // Cocos exposes these enum values at runtime but not as namespace types in 3.8.8.
  horizontalAlign?: number;
  verticalAlign?: number;
};

type TaskView = {
  id: ActivityTaskId;
  rowGraphics: Graphics;
  progressLabel: Label;
  button: Button;
  buttonLabel: Label;
  buttonGraphics: Graphics;
  progressGraphics: Graphics;
};

type RewardView = {
  id: ActivityRewardId;
  button: Button;
  statusLabel: Label;
  nameLabel: Label;
  markerGraphics: Graphics;
};

type TabView = {
  badgeGraphics: Graphics;
  badgeLabel: Label;
};

const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;
// Generated spring background source size; used to compute a cover fit.
const BG_SOURCE_WIDTH = 1024;
const BG_SOURCE_HEIGHT = 1535;
const BROWN = new Color(91, 53, 34);
const DARK_BROWN = new Color(111, 62, 28);
const MUTED_BROWN = new Color(136, 94, 63);
const CREAM = new Color(255, 248, 226);
const CREAM_SOFT = new Color(255, 244, 212);
const PANEL_STROKE = new Color(235, 205, 158);
const GREEN = new Color(95, 177, 48);
const GREEN_DARK = new Color(54, 124, 48);
const CORAL = new Color(239, 97, 73);
const CORAL_DARK = new Color(191, 65, 49);
const GOLD = new Color(248, 181, 38);
const GOLD_DARK = new Color(205, 132, 25);
const DISABLED_FILL = new Color(206, 199, 178);
const DISABLED_STROKE = new Color(168, 160, 138);

export class ActivityScreen {
  private activityUI: Node | null = null;
  private contentUI: Node | null = null;
  private rulesUI: Node | null = null;
  private countdownLabel: Label | null = null;
  private heroPointsLabel: Label | null = null;
  private heroStatusLabel: Label | null = null;
  private heroProgressGraphics: Graphics | null = null;
  private primaryButton: Button | null = null;
  private primaryButtonLabel: Label | null = null;
  private primaryGraphics: Graphics | null = null;
  private rewardTab: TabView | null = null;
  private taskTab: TabView | null = null;
  private readonly taskViews: TaskView[] = [];
  private readonly rewardViews: RewardView[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: ActivityScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    const definition = this.options.getActivity().definition;
    const visuals = definition.visuals;
    const paths = [
      visuals.backgroundPath,
      visuals.heroTitlePath,
      visuals.backButtonPath,
      'activity/redesign/activity_redesign_cat_gray',
      'activity/redesign/activity_redesign_cat_orange',
      ...definition.tasks.map(task => task.iconPath),
      ...definition.rewards.map(reward => reward.iconPath),
    ];
    this.assets.loadImagesFor(this, paths, () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.activityUI) return;
    this.activityUI.active = active;
    if (active) {
      this.refresh();
      this.startTicker();
    } else {
      this.stopTicker();
      if (this.rulesUI) this.rulesUI.active = false;
    }
  }

  destroy() {
    this.stopTicker();
    this.taskViews.length = 0;
    this.rewardViews.length = 0;
    this.activityUI?.destroy();
    this.activityUI = null;
    this.contentUI = null;
    this.rulesUI = null;
  }

  private create() {
    if (this.activityUI) return;
    const visibleSize = view.getVisibleSize();
    const activity = this.options.getActivity();

    this.activityUI = new Node('ActivityUI');
    this.root.addChild(this.activityUI);
    this.activityUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.activityUI.active = this.active;

    const coverScale = Math.max(
      visibleSize.width / BG_SOURCE_WIDTH,
      visibleSize.height / BG_SOURCE_HEIGHT,
    );
    this.image(
      this.activityUI,
      activity.definition.visuals.backgroundPath,
      0,
      0,
      BG_SOURCE_WIDTH * coverScale,
      BG_SOURCE_HEIGHT * coverScale,
    );
    this.addSceneShade(visibleSize.width, visibleSize.height);

    this.contentUI = new Node('ActivityContent');
    this.activityUI.addChild(this.contentUI);
    const contentScale = Math.min(1, visibleSize.width / DESIGN_WIDTH, visibleSize.height / DESIGN_HEIGHT);
    this.contentUI.setScale(contentScale, contentScale, 1);

    this.buildHeader(activity);
    this.buildHero(activity);
    this.buildRewards(activity);
    this.buildTasks(activity);
    this.buildFooter();

    this.buildRulesOverlay(visibleSize.width, visibleSize.height, activity);

    this.refresh();
    if (this.active) this.startTicker();
  }

  private buildHeader(activity: ActivitySnapshot) {
    const visuals = activity.definition.visuals;
    const headerY = belowWeChatCapsule(DESIGN_HEIGHT / 2, 64);
    // Back button (visual art is smaller than the 88px hit area on purpose).
    this.buildImageButton(
      this.contentUI!,
      visuals.backButtonPath,
      -312,
      592,
      BACK_BUTTON_SIZE.visualWidth,
      BACK_BUTTON_SIZE.visualHeight,
      BACK_BUTTON_SIZE.hitWidth,
      BACK_BUTTON_SIZE.hitHeight,
      () => this.options.onReturnHome(),
    );

    // Wooden title sign: ropes occupy the top ~45% of the art, so the text sits low.
    const sign = this.image(this.contentUI!, visuals.heroTitlePath, -6, 584, 290, 186);
    const title = this.labelBox(sign, activity.definition.title, 2, -44, 200, 40, 26, DARK_BROWN);
    title.isBold = true;

    // Countdown capsule with a small clock icon, matching the reference layout.
    const chip = new Node('CountdownChip');
    this.contentUI!.addChild(chip);
    chip.setPosition(268, headerY);
    chip.addComponent(UITransform).setContentSize(170, 64);
    const chipGraphics = chip.addComponent(Graphics);
    chipGraphics.fillColor = new Color(104, 61, 35, 60);
    chipGraphics.roundRect(-83, -36, 166, 60, 30);
    chipGraphics.fill();
    chipGraphics.fillColor = CREAM;
    chipGraphics.strokeColor = new Color(142, 92, 48);
    chipGraphics.lineWidth = 3;
    chipGraphics.roundRect(-85, -32, 170, 64, 32);
    chipGraphics.fill();
    chipGraphics.stroke();
    chipGraphics.fillColor = GOLD;
    chipGraphics.strokeColor = GOLD_DARK;
    chipGraphics.lineWidth = 3;
    chipGraphics.circle(-58, 0, 16);
    chipGraphics.fill();
    chipGraphics.stroke();
    chipGraphics.strokeColor = DARK_BROWN;
    chipGraphics.lineWidth = 3;
    chipGraphics.moveTo(-58, 0);
    chipGraphics.lineTo(-58, 9);
    chipGraphics.moveTo(-58, 0);
    chipGraphics.lineTo(-51, -3);
    chipGraphics.stroke();
    // Centered in the space right of the clock so varying text lengths stay balanced.
    this.countdownLabel = this.labelBox(chip, '', 20, 0, 114, 34, 15, DARK_BROWN);
    this.countdownLabel.isBold = true;
  }

  private buildHero(activity: ActivitySnapshot) {
    // Clean cream card so the left text column stays readable; cats provide the accent.
    const hero = this.creamPanel(this.contentUI!, 0, 352, 690, 250, 28, new Color(255, 250, 232, 246), new Color(154, 196, 109));

    // Tag straddles the card's top border, same treatment as the section tabs.
    const tag = new Node('HeroTag');
    hero.addChild(tag);
    tag.setPosition(-233, 125);
    tag.addComponent(UITransform).setContentSize(164, 46);
    const tagGraphics = tag.addComponent(Graphics);
    this.drawTabCapsule(tagGraphics, 164, 46);
    const tagLabel = this.labelBox(tag, '春日远征', 0, 0, 150, 30, 20, Color.WHITE);
    tagLabel.isBold = true;

    const title = this.leftLabel(hero, activity.definition.heroTitle, -282, 78, 330, 30, 22, DARK_BROWN);
    title.isBold = true;
    this.leftLabel(hero, activity.definition.description, -282, 48, 330, 22, 15, MUTED_BROWN);

    const caption = this.leftLabel(hero, '当前春游积分', -282, 12, 180, 20, 14, MUTED_BROWN);
    caption.isBold = true;
    // Single label keeps the current and target numbers in one size, tightly grouped.
    this.heroPointsLabel = this.leftLabel(hero, '', -282, -28, 220, 40, 30, CORAL);
    this.heroPointsLabel.isBold = true;
    this.heroPointsLabel.outlineWidth = 2;
    this.heroPointsLabel.outlineColor = CREAM_SOFT;

    const progressNode = new Node('ActivityHeroProgress');
    hero.addChild(progressNode);
    progressNode.setPosition(-142, -62);
    progressNode.addComponent(UITransform).setContentSize(280, 16);
    this.heroProgressGraphics = progressNode.addComponent(Graphics);

    this.heroStatusLabel = this.leftLabel(hero, '', -282, -88, 340, 20, 14, MUTED_BROWN);
    this.heroStatusLabel.isBold = true;

    // Picnic cats on the right side of the card (gray behind, orange in front).
    this.image(hero, 'activity/redesign/activity_redesign_cat_gray', 218, -4, 169, 195);
    this.image(hero, 'activity/redesign/activity_redesign_cat_orange', 118, -2, 138, 165);
  }

  private buildRewards(activity: ActivitySnapshot) {
    const panel = this.creamPanel(this.contentUI!, 0, 82, 700, 232, 28, new Color(255, 248, 226, 238), PANEL_STROKE);
    this.rewardTab = this.buildSectionTab(panel, -238, 116, '奖励路线');

    const rail = new Node('RewardRail');
    panel.addChild(rail);
    rail.addComponent(UITransform).setContentSize(600, 20);
    const railGraphics = rail.addComponent(Graphics);
    railGraphics.lineWidth = 8;
    railGraphics.strokeColor = new Color(219, 205, 168);
    railGraphics.moveTo(-290, 0);
    railGraphics.lineTo(290, 0);
    railGraphics.stroke();

    const rewardXs = [-272, -136, 0, 136, 272];
    activity.definition.rewards.forEach((reward, index) => {
      const x = rewardXs[index] ?? -272 + index * 136;
      const item = new Node(`Reward_${reward.id}`);
      panel.addChild(item);
      item.setPosition(x, 0);
      item.addComponent(UITransform).setContentSize(132, 190);
      this.image(item, reward.iconPath, 0, 54, 64, 64);
      const marker = new Node('RewardMarker');
      item.addChild(marker);
      marker.setPosition(0, 2);
      marker.addComponent(UITransform).setContentSize(32, 32);
      const markerGraphics = marker.addComponent(Graphics);

      const threshold = this.labelBox(item, `${reward.threshold}`, 0, -28, 96, 24, 17, DARK_BROWN);
      threshold.isBold = true;
      const name = this.labelBox(item, reward.name, 0, -56, 132, 24, 16, MUTED_BROWN);
      name.overflow = Label.Overflow.SHRINK;
      const status = this.labelBox(item, '', 0, -82, 132, 22, 14, MUTED_BROWN);
      status.isBold = true;

      const button = item.addComponent(Button);
      button.transition = Button.Transition.SCALE;
      button.zoomScale = 0.93;
      button.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        const success = this.options.onClaimReward(reward.id);
        this.toast(success ? `已领取${reward.name}` : '达到积分后可以领取');
        this.refresh();
      });
      this.rewardViews.push({ id: reward.id, button, statusLabel: status, nameLabel: name, markerGraphics });
    });
  }

  private buildTasks(activity: ActivitySnapshot) {
    const panel = this.creamPanel(this.contentUI!, 0, -250, 700, 372, 28, new Color(255, 248, 226, 242), PANEL_STROKE);
    this.taskTab = this.buildSectionTab(panel, -238, 186, '远征任务');
    this.labelBox(panel, '完成后记得回来领取积分', 135, 156, 236, 24, 14, MUTED_BROWN, {
      horizontalAlign: Label.HorizontalAlign.RIGHT,
    });

    const rowYs = [88, -22, -132];
    activity.definition.tasks.forEach((task, index) => {
      const rowY = rowYs[index] ?? 88 - index * 110;
      const row = new Node(`TaskRow_${task.id}`);
      panel.addChild(row);
      row.setPosition(0, rowY);
      row.addComponent(UITransform).setContentSize(656, 92);
      const rowGraphics = row.addComponent(Graphics);
      this.drawPanelCard(rowGraphics, 656, 92, 20, new Color(255, 252, 235, 242), PANEL_STROKE, 45);

      const plate = new Node('TaskIconPlate');
      row.addChild(plate);
      plate.setPosition(-272, 0);
      plate.addComponent(UITransform).setContentSize(68, 68);
      const plateGraphics = plate.addComponent(Graphics);
      plateGraphics.fillColor = new Color(224, 241, 180);
      plateGraphics.strokeColor = new Color(143, 194, 75);
      plateGraphics.lineWidth = 3;
      plateGraphics.roundRect(-34, -34, 68, 68, 20);
      plateGraphics.fill();
      plateGraphics.stroke();
      this.image(plate, task.iconPath, 0, 0, 50, 50);

      const taskTitle = this.leftLabel(row, task.title, -224, 20, 230, 26, 19, DARK_BROWN);
      taskTitle.isBold = true;
      this.leftLabel(row, task.description, -224, -12, 240, 22, 14, MUTED_BROWN);

      const progressLabel = this.leftLabel(row, '', 36, 22, 120, 22, 15, DARK_BROWN);
      progressLabel.isBold = true;
      const progressNode = new Node('TaskProgress');
      row.addChild(progressNode);
      progressNode.setPosition(96, -6);
      progressNode.addComponent(UITransform).setContentSize(120, 12);
      const progressGraphics = progressNode.addComponent(Graphics);

      const buttonNode = this.actionButton(row, 252, 0, 118, 58, '去完成', CORAL, CORAL_DARK, 17, 24);
      buttonNode.button.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        const current = this.options.getActivity().tasks.find(item => item.id === task.id);
        if (!current) return;
        if (current.completed && !current.claimed) {
          const success = this.options.onClaimTask(task.id);
          this.toast(success ? `获得活动积分 ×${task.pointReward}` : '完成任务后可以领取');
        } else if (!current.claimed) {
          this.options.onStartGame();
        }
        this.refresh();
      });
      this.taskViews.push({
        id: task.id,
        rowGraphics,
        progressLabel,
        button: buttonNode.button,
        buttonLabel: buttonNode.label,
        buttonGraphics: buttonNode.graphics,
        progressGraphics,
      });
    });
  }

  private buildFooter() {
    const buttonNode = this.actionButton(this.contentUI!, -70, -504, 320, 96, '开始挑战', CORAL, CORAL_DARK, 26, 32);
    this.primaryButton = buttonNode.button;
    this.primaryButtonLabel = buttonNode.label;
    this.primaryGraphics = buttonNode.graphics;
    buttonNode.button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.options.onStartGame();
    });

    const rules = new Node('RulesButton');
    this.contentUI!.addChild(rules);
    rules.setPosition(225, -504);
    rules.addComponent(UITransform).setContentSize(100, 100);
    const graphics = rules.addComponent(Graphics);
    this.drawCircleButton(graphics, 0, 0, 46, CREAM, new Color(142, 92, 48));
    this.drawBook(graphics, 0, 2);
    const button = rules.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.toggleRules(true);
    });
    const rulesLabel = this.labelBox(this.contentUI!, '活动规则', 225, -572, 140, 24, 15, CREAM);
    rulesLabel.isBold = true;
    rulesLabel.outlineWidth = 3;
    rulesLabel.outlineColor = GREEN_DARK;
  }

  private buildRulesOverlay(width: number, height: number, activity: ActivitySnapshot) {
    this.rulesUI = new Node('ActivityRules');
    this.activityUI!.addChild(this.rulesUI);
    this.rulesUI.active = false;

    const backdrop = new Node('RulesBackdrop');
    this.rulesUI.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(width, height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 192);
    backdropGraphics.rect(-width / 2, -height / 2, width, height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.toggleRules(false));

    const panel = this.creamPanel(this.rulesUI, 0, 10, 610, 560, 30, CREAM, PANEL_STROKE);
    panel.addComponent(BlockInputEvents);
    const title = this.labelBox(panel, '活动规则', 0, 236, 300, 42, 30, DARK_BROWN);
    title.isBold = true;
    const accent = new Node('RulesAccent');
    panel.addChild(accent);
    accent.setPosition(0, 204);
    accent.addComponent(UITransform).setContentSize(82, 6);
    const accentGraphics = accent.addComponent(Graphics);
    accentGraphics.fillColor = CORAL;
    accentGraphics.roundRect(-41, -3, 82, 6, 3);
    accentGraphics.fill();

    const text = this.labelBox(
      panel,
      `活动时间：${this.formatDate(activity.definition.startAt)} - ${this.formatDate(activity.definition.endAt)}\n\n完成关卡、三消和猫咪互动，收集春游积分。积分达到节点后，可以领取对应奖励。\n\n每天通过玩法直接获得的积分最多 ${activity.definition.dailyDirectPointLimit} 分。活动结束后进入领奖期，只能领取已经解锁的奖励。`,
      0,
      22,
      520,
      340,
      19,
      BROWN,
    );
    text.overflow = Label.Overflow.SHRINK;

    const close = this.actionButton(panel, 0, -218, 200, 74, '知道了', CORAL, CORAL_DARK, 20, 26);
    close.button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.toggleRules(false);
    });
  }

  private refresh() {
    if (!this.activityUI) return;
    const activity = this.options.getActivity();
    const definition = activity.definition;
    if (this.countdownLabel) this.countdownLabel.string = this.countdownText(activity);
    if (this.heroPointsLabel) this.heroPointsLabel.string = `${activity.points} / ${definition.totalPoints}`;
    if (this.heroStatusLabel) {
      this.heroStatusLabel.string =
        activity.status === 'active'
          ? `今日还可获得 ${Math.max(0, definition.dailyDirectPointLimit - activity.todayDirectPoints)} 分`
          : this.statusText(activity);
    }
    const ratio = Math.min(1, activity.points / Math.max(1, definition.totalPoints));
    if (this.heroProgressGraphics) this.drawProgress(this.heroProgressGraphics, 300, 18, ratio, GREEN);

    const canClaim = activity.status === 'active' || activity.status === 'claiming';
    this.taskViews.forEach(viewData => {
      const task = activity.tasks.find(item => item.id === viewData.id);
      if (!task) return;
      const progress = Math.min(task.progress, task.target);
      const claimable = canClaim && task.completed && !task.claimed;
      viewData.progressLabel.string = `${progress} / ${task.target}`;
      viewData.buttonLabel.string = task.claimed ? '已领取' : task.completed ? '领取' : '去完成';
      viewData.button.interactable = canClaim && !task.claimed;
      this.drawProgress(
        viewData.progressGraphics,
        120,
        12,
        progress / Math.max(1, task.target),
        task.completed ? GREEN : new Color(133, 192, 64),
      );
      if (claimable) {
        this.drawActionButton(viewData.buttonGraphics, 118, 58, GOLD, GOLD_DARK, 24);
        viewData.buttonLabel.color = DARK_BROWN;
        viewData.buttonLabel.outlineColor = CREAM;
      } else if (task.claimed) {
        this.drawActionButton(viewData.buttonGraphics, 118, 58, new Color(184, 221, 169), new Color(143, 178, 128), 24);
        viewData.buttonLabel.color = GREEN_DARK;
        viewData.buttonLabel.outlineColor = new Color(184, 221, 169);
      } else {
        this.drawActionButton(viewData.buttonGraphics, 118, 58, CORAL, CORAL_DARK, 24);
        viewData.buttonLabel.color = Color.WHITE;
        viewData.buttonLabel.outlineColor = CORAL_DARK;
      }
      // Highlight rows that have a reward waiting for pickup.
      this.drawPanelCard(
        viewData.rowGraphics,
        656,
        92,
        20,
        claimable ? new Color(239, 249, 224, 245) : new Color(255, 252, 235, 242),
        claimable ? new Color(184, 215, 133) : PANEL_STROKE,
        45,
      );
    });

    activity.rewards.forEach(reward => {
      const viewData = this.rewardViews.find(item => item.id === reward.id);
      if (!viewData) return;
      const claimable = canClaim && reward.unlocked && !reward.claimed;
      viewData.button.interactable = claimable;
      viewData.statusLabel.string = reward.claimed ? '已领取' : reward.unlocked ? '可领取' : '未解锁';
      viewData.statusLabel.color = reward.claimed ? GREEN_DARK : claimable ? CORAL_DARK : MUTED_BROWN;
      viewData.nameLabel.color = reward.claimed ? GREEN_DARK : BROWN;
      this.drawRewardMarker(viewData.markerGraphics, reward.claimed, reward.unlocked);
    });

    if (this.rewardTab) {
      const count = canClaim ? activity.rewards.filter(reward => reward.unlocked && !reward.claimed).length : 0;
      this.drawTabBadge(this.rewardTab, count);
    }
    if (this.taskTab) {
      const count = canClaim ? activity.tasks.filter(task => task.completed && !task.claimed).length : 0;
      this.drawTabBadge(this.taskTab, count);
    }

    if (this.primaryButton && this.primaryButtonLabel && this.primaryGraphics) {
      const playable = activity.status === 'active' || activity.status === 'scheduled';
      this.primaryButton.interactable = playable;
      this.primaryButtonLabel.string =
        activity.status === 'locked' ? '暂未开放' : playable ? '开始挑战' : '活动已结束';
      this.drawActionButton(this.primaryGraphics, 320, 96, playable ? CORAL : DISABLED_FILL, playable ? CORAL_DARK : DISABLED_STROKE, 32);
      this.primaryButtonLabel.outlineColor = playable ? CORAL_DARK : new Color(150, 143, 122);
    }
  }

  private drawProgress(graphics: Graphics, width: number, height: number, ratio: number, fill: Color) {
    graphics.clear();
    graphics.lineWidth = 2;
    graphics.fillColor = new Color(226, 218, 192);
    graphics.strokeColor = new Color(207, 194, 160);
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
    if (ratio <= 0) return;
    graphics.fillColor = fill;
    const fillWidth = Math.max(height, width * ratio);
    graphics.roundRect(-width / 2, -height / 2, Math.min(width, fillWidth), height, height / 2);
    graphics.fill();
  }

  private drawRewardMarker(graphics: Graphics, claimed: boolean, unlocked: boolean) {
    graphics.clear();
    graphics.fillColor = claimed ? GREEN : unlocked ? GOLD : new Color(218, 207, 177);
    graphics.strokeColor = CREAM;
    graphics.lineWidth = 3;
    graphics.circle(0, 0, 15);
    graphics.fill();
    graphics.stroke();
    if (claimed) {
      graphics.strokeColor = Color.WHITE;
      graphics.lineWidth = 3;
      graphics.moveTo(-7, 0);
      graphics.lineTo(-2, -5);
      graphics.lineTo(8, 7);
      graphics.stroke();
    }
  }

  private drawActionButton(graphics: Graphics, width: number, height: number, fill: Color, stroke: Color, radius: number) {
    graphics.clear();
    graphics.fillColor = new Color(104, 61, 35, 60);
    graphics.roundRect(-width / 2 + 2, -height / 2 - 5, width, height, radius);
    graphics.fill();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
  }

  // Shared green capsule style for section tabs and the hero card tag.
  private drawTabCapsule(graphics: Graphics, width: number, height: number) {
    graphics.fillColor = new Color(80, 48, 24, 55);
    graphics.roundRect(-width / 2 + 2, -height / 2 - 6, width, height, height / 2);
    graphics.fill();
    graphics.fillColor = GREEN;
    graphics.strokeColor = GREEN_DARK;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
  }

  private drawPanelCard(graphics: Graphics, width: number, height: number, radius: number, fill: Color, stroke: Color, shadowAlpha: number) {
    graphics.clear();
    graphics.fillColor = new Color(104, 61, 35, shadowAlpha);
    graphics.roundRect(-width / 2 + 3, -height / 2 - 6, width, height, radius);
    graphics.fill();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
  }

  private drawTabBadge(tab: TabView, count: number) {
    const graphics = tab.badgeGraphics;
    graphics.clear();
    graphics.node.active = count > 0;
    if (count <= 0) {
      tab.badgeLabel.string = '';
      return;
    }
    graphics.fillColor = CORAL;
    graphics.strokeColor = CREAM;
    graphics.lineWidth = 2;
    graphics.circle(0, 0, 13);
    graphics.fill();
    graphics.stroke();
    tab.badgeLabel.string = `${Math.min(count, 9)}`;
  }

  private drawCircleButton(graphics: Graphics, x: number, y: number, radius: number, fill: Color, stroke: Color) {
    graphics.fillColor = new Color(104, 61, 35, 75);
    graphics.circle(x + 2, y - 5, radius);
    graphics.fill();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 4;
    graphics.circle(x, y, radius);
    graphics.fill();
    graphics.stroke();
  }

  private drawBook(graphics: Graphics, x: number, y: number) {
    graphics.fillColor = new Color(139, 91, 50);
    graphics.strokeColor = new Color(102, 61, 36);
    graphics.lineWidth = 2;
    graphics.moveTo(x - 22, y - 12);
    graphics.lineTo(x - 3, y - 16);
    graphics.lineTo(x - 3, y + 15);
    graphics.lineTo(x - 22, y + 11);
    graphics.close();
    graphics.moveTo(x + 3, y - 16);
    graphics.lineTo(x + 22, y - 12);
    graphics.lineTo(x + 22, y + 11);
    graphics.lineTo(x + 3, y + 15);
    graphics.close();
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = CREAM_SOFT;
    graphics.lineWidth = 2;
    graphics.moveTo(x, y - 16);
    graphics.lineTo(x, y + 14);
    graphics.stroke();
    graphics.strokeColor = new Color(255, 224, 172, 220);
    graphics.lineWidth = 2;
    graphics.moveTo(x - 17, y + 5);
    graphics.lineTo(x - 7, y + 7);
    graphics.moveTo(x - 17, y - 1);
    graphics.lineTo(x - 7, y + 1);
    graphics.moveTo(x + 7, y + 7);
    graphics.lineTo(x + 17, y + 5);
    graphics.moveTo(x + 7, y + 1);
    graphics.lineTo(x + 17, y - 1);
    graphics.stroke();
  }

  private actionButton(
    parent: Node,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    fill: Color = CORAL,
    stroke: Color = CORAL_DARK,
    fontSize = 18,
    radius = 24,
  ) {
    const node = new Node('ActionButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(Math.max(88, width), Math.max(88, height));
    const graphics = node.addComponent(Graphics);
    this.drawActionButton(graphics, width, height, fill, stroke, radius);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    const label = this.labelBox(node, text, 0, 0, width - 10, height - 10, fontSize, Color.WHITE);
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = stroke;
    return { node, button, label, graphics };
  }

  private buildImageButton(
    parent: Node,
    path: string,
    x: number,
    y: number,
    visualWidth: number,
    visualHeight: number,
    hitWidth: number,
    hitHeight: number,
    onClick: () => void,
  ) {
    const node = new Node(`Button_${path.replace(/\//g, '_')}`);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(Math.max(88, hitWidth), Math.max(88, hitHeight));
    this.image(node, path, 0, 0, visualWidth, visualHeight);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onClick();
    });
    return { node, button };
  }

  private buildSectionTab(parent: Node, x: number, y: number, title: string): TabView {
    const node = new Node('SectionTab');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(164, 46);
    const graphics = node.addComponent(Graphics);
    this.drawTabCapsule(graphics, 164, 46);
    const label = this.labelBox(node, title, 0, 0, 150, 30, 20, Color.WHITE);
    label.isBold = true;

    const badge = new Node('TabBadge');
    node.addChild(badge);
    badge.setPosition(72, 15);
    badge.addComponent(UITransform).setContentSize(30, 30);
    const badgeGraphics = badge.addComponent(Graphics);
    const badgeLabel = this.labelBox(badge, '', 0, 0, 26, 22, 14, Color.WHITE);
    badgeLabel.isBold = true;
    badge.active = false;
    return { badgeGraphics, badgeLabel };
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

  private labelBox(parent: Node, text: string, x: number, y: number, width: number, height: number, size: number, color: Color, options: LabelBoxOptions = {}) {
    const node = new Node('Label');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(Math.max(1, width), Math.max(1, height));
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 8;
    label.color = color;
    label.horizontalAlign = options.horizontalAlign ?? Label.HorizontalAlign.CENTER;
    label.verticalAlign = options.verticalAlign ?? Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private leftLabel(parent: Node, text: string, left: number, y: number, width: number, height: number, size: number, color: Color) {
    return this.labelBox(parent, text, left + width / 2, y, width, height, size, color, {
      horizontalAlign: Label.HorizontalAlign.LEFT,
    });
  }

  private creamPanel(parent: Node, x: number, y: number, width: number, height: number, radius: number, fill: Color, stroke: Color) {
    const node = new Node('Panel');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    this.drawPanelCard(graphics, width, height, radius, fill, stroke, 55);
    return node;
  }

  private addSceneShade(width: number, height: number) {
    const shade = new Node('ActivitySceneShade');
    this.activityUI!.addChild(shade);
    shade.addComponent(UITransform).setContentSize(width, height);
    const graphics = shade.addComponent(Graphics);
    graphics.fillColor = new Color(255, 247, 216, 22);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private toggleRules(active: boolean) {
    if (this.rulesUI) this.rulesUI.active = active;
  }

  private toast(text: string) {
    if (!this.contentUI) return;
    Toast.show(this.contentUI, text);
  }

  private statusText(activity: ActivitySnapshot) {
    if (activity.status === 'locked') return `第 ${activity.definition.minLevel} 关后开放`;
    if (activity.status === 'scheduled') return '活动即将开始';
    if (activity.status === 'claiming') return '活动已结束 · 领奖期';
    return '本期活动已结束';
  }

  private countdownText(activity: ActivitySnapshot) {
    if (activity.status === 'locked') return '未开放';
    if (activity.status === 'ended') return '已结束';
    const prefix = activity.status === 'scheduled' ? '距开始 ' : activity.status === 'claiming' ? '领奖剩 ' : '剩余 ';
    return prefix + this.formatDuration(activity.remainingMs);
  }

  private formatDuration(milliseconds: number) {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}天${hours}时`;
    if (hours > 0) return `${hours}时${minutes}分`;
    return `${minutes}分`;
  }

  private formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  private startTicker() {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => this.refresh(), 1000);
  }

  private stopTicker() {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}
