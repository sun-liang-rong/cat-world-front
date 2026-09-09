import {
  Button,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  UITransform,
  view,
} from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { DAILY_CHEST_REWARD, DAILY_TASK_DEFINITIONS } from './GameContent';
import { DailyTaskId, TaskSnapshot } from './PlayerTypes';
import { Toast } from './Toast';

export interface DailyTaskScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getDateKey: () => string;
  getTasks: () => TaskSnapshot[];
  isChestReady: () => boolean;
  isChestClaimed: () => boolean;
  onClaimTask: (id: DailyTaskId) => boolean;
  onClaimChest: () => boolean;
  onStartGame: () => void;
  onReturnHome: () => void;
}

type TaskCardView = {
  id: DailyTaskId;
  progressLabel: Label;
  button: Button;
  buttonLabel: Label;
  buttonBackground: Sprite | null;
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
  'tasks/daily_hammer',
  COMMON_UI_ASSETS.starIcon,
];

export class DailyTaskScreen {
  private taskUI: Node | null = null;
  private dateLabel: Label | null = null;
  private chestButton: Button | null = null;
  private chestLabel: Label | null = null;
  private chestButtonBackground: Sprite | null = null;
  private readonly cardViews: TaskCardView[] = [];
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: DailyTaskScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImages([
      'home/home_bg',
      'shop/item_dice',
      COMMON_UI_ASSETS.backButton,
      'tasks/daily_date',
      'tasks/daily_panel',
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
    if (active) this.refresh();
  }

  destroy() {
    this.cardViews.length = 0;
    this.taskUI?.destroy();
    this.taskUI = null;
  }

  private create() {
    if (this.taskUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    this.taskUI = new Node('DailyTaskUI');
    this.root.addChild(this.taskUI);
    this.taskUI.active = this.active;

    this.image(this.taskUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);

    const taskStep = TASK_CARD_HEIGHT + 36;
    const positions = [top - 360, top - 360 - taskStep, top - 360 - taskStep * 2];
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

    const title = this.label(this.taskUI!, '每日任务', -50, y + 4, 49, new Color(111, 62, 28));
    title.isBold = true;
    title.outlineWidth = 2;
    title.outlineColor = new Color(255, 222, 153, 190);
    this.drawTitleLine(this.taskUI!, -50, y - 61);
    this.drawPawDecoration(this.taskUI!, -205, y + 3, -0.9);
    this.drawPawDecoration(this.taskUI!, 112, y + 3, 0.9);

    const dateChip = this.image(this.taskUI!, 'tasks/daily_date', 228, y, 264, 74);
    this.dateLabel = this.label(dateChip, '', 22, -1, 22, new Color(112, 69, 40));
    this.dateLabel.isBold = true;
    this.dateLabel.node.getComponent(UITransform)!.setContentSize(206, 48);
  }

  private buildTaskCard(id: DailyTaskId, index: number, y: number) {
    const definition = DAILY_TASK_DEFINITIONS[index];
    const card = this.image(this.taskUI!, 'tasks/daily_panel', 0, y, PANEL_WIDTH, TASK_CARD_HEIGHT);
    this.image(card, TASK_ICON_PATHS[index], TASK_ICON_X, 2, 140, 141);

    const title = this.label(card, definition.title, -139, 53, 30, new Color(111, 62, 28));
    title.isBold = true;
    title.horizontalAlign = Label.HorizontalAlign.LEFT;
    title.node.setPosition(10, 53);
    title.node.getComponent(UITransform)!.setContentSize(320, 44);

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
    const card = this.image(this.taskUI!, 'tasks/daily_chest_panel', 0, y, PANEL_WIDTH, 312);
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
    this.buildChestReward(card, 'tasks/daily_hammer', `锤子 ×${DAILY_CHEST_REWARD.items.hammer}`, 95, -7, 50);
    this.buildChestReward(card, 'shop/item_dice', `骰子 ×${DAILY_CHEST_REWARD.items.dice}`, 240, -7, 46);

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
    const node = new Node('ActionButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(Math.max(width, 88), Math.max(height, 88));
    const visual = this.image(node, 'tasks/daily_button_primary', 0, 0, width, height);
    const background = visual.getComponent(Sprite);
    if (!background) this.drawButtonFallback(visual, true, width, height);

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

    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    return { button, label, background };
  }

  private setButtonVisual(background: Sprite | null, active: boolean) {
    if (!background) return;
    background.spriteFrame = this.assets.getFrame(
      active ? 'tasks/daily_button_primary' : 'tasks/daily_button_disabled',
    ) || background.spriteFrame;
  }

  private drawButtonFallback(parent: Node, active: boolean, width: number, height: number) {
    const graphics = parent.addComponent(Graphics);
    graphics.fillColor = active ? new Color(241, 139, 47) : new Color(255, 221, 153);
    graphics.strokeColor = active ? new Color(184, 102, 26) : new Color(226, 176, 93);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 20);
    graphics.fill();
    graphics.stroke();
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
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
    });
  }

  private drawTitleLine(parent: Node, x: number, y: number) {
    const node = new Node('TitleLine');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(320, 16);
    const graphics = node.addComponent(Graphics);
    graphics.strokeColor = new Color(241, 139, 47);
    graphics.lineWidth = 4;
    graphics.moveTo(-145, 0);
    graphics.lineTo(145, 0);
    graphics.stroke();
    graphics.fillColor = new Color(241, 139, 47);
    graphics.circle(-145, 0, 3);
    graphics.circle(145, 0, 3);
    graphics.fill();
  }

  private drawPawDecoration(parent: Node, x: number, y: number, scaleX: number) {
    const node = new Node('TitlePaw');
    parent.addChild(node);
    node.setPosition(x, y);
    node.setScale(scaleX, 1, 1);
    node.addComponent(UITransform).setContentSize(72, 58);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(193, 190, 167, 220);
    graphics.circle(0, -10, 15);
    graphics.circle(-21, 11, 8);
    graphics.circle(-5, 25, 8);
    graphics.circle(12, 25, 8);
    graphics.circle(27, 11, 8);
    graphics.fill();
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
    Toast.show(this.taskUI, text, { y: -610 });
  }
}
