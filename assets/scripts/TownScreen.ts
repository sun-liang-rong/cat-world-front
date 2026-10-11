import { SettlementButton } from './SettlementButton';
import { ensureButtonControl, Theme, TITLE_SIGN } from './Theme';
import {
  BlockInputEvents,
  Button,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  tween,
  Tween,
  UIOpacity,
  UITransform,
  Vec2,
  Vec3,
  view,
} from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { getCatDefinition } from './GameContent';
import { BuildCellResult, BuildingView, CELL_STAR_COST } from './TownContent';
import { ShareCardType, ShareOffer, TownDailyClaimResult, TownDailySnapshot, TownDailyTaskId } from './PlayerTypes';
import { Toast } from './Toast';

export interface TownScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getStars: () => number;
  getCoins: () => number;
  getBuildings: () => BuildingView[];
  /** 点亮当前大节点的下一格（小节点机制：每格 3 星） */
  onLightCell: (id: BuildingView['id']) => BuildCellResult;
  /** 第 1 关一次性引导：从未点亮过格子时，小镇页高亮「点亮」按钮并给指引文案 */
  shouldShowCellGuide?: () => boolean;
  /** 建成庆祝弹窗的「去装备」入口：跳猫咪社 */
  onOpenCatCollection?: () => void;
  /** 一次性读取 Main 暂存的目标建筑 id（结算页「去建设」跳转用），读后即清 */
  consumeFocusBuilding?: () => BuildingView['id'] | null;
  getTownDaily: () => TownDailySnapshot;
  onClaimTownDaily: () => TownDailyClaimResult;
  onTownDailyAction?: (taskId: TownDailyTaskId, buildingId?: BuildingView['id']) => void;
  /** 建筑/阶段完成时显示的好友分享入口；仅微信环境返回 offer。 */
  getShareOffer?: (type: ShareCardType) => ShareOffer | null;
  onShare?: (type: ShareCardType) => void;
  onStartGame?: () => void;
  onReturnHome: () => void;
}

type StageView = {
  card: Node;
  cardGraphics: Graphics;
  activeIcon: Node;
  lockedIcon: Node;
  checkMark: Node;
  lockMark: Node;
  title: Label;
};

type SlotView = {
  node: Node;
  slotGraphics: Graphics;
  thumb: Node;
  nameColor: Label;
  checkMark: Node;
  lockMark: Node;
};

const STAGE_ICONS_ACTIVE = ['town/broom', 'town/hammer_active', 'town/flower_active', 'town/sparkle'];
const STAGE_ICONS_LOCKED = ['town/broom', 'town/hammer_locked', 'town/flower_locked', 'town/flower_locked'];

export class TownScreen {
  private townUI: Node | null = null;
  private townPanel: Node | null = null;
  private displayLayer: Node | null = null;
  private displayImage: Node | null = null;
  private displayKey = '';
  private displayLockVeil: Node | null = null;
  private statusNode: Node | null = null;
  private statusLabel: Label | null = null;
  private titleLabel: Label | null = null;
  private subtitleLabel: Label | null = null;
  private conditionLabel: Label | null = null;
  private actionNode: Node | null = null;
  private actionButton: Button | null = null;
  private actionLabel: Label | null = null;
  private rewardLabel: Label | null = null;
  private starLabel: Label | null = null;
  private coinLabel: Label | null = null;
  private stageRow: Node | null = null;
  private readonly stageViews: StageView[] = [];
  // 小节点格子行：每大节点拆成 BUILDING_STAGE_CELLS[stage] 格，1 格 = 3 星 = 1 关
  private cellRow: Node | null = null;
  private readonly cellNodes: Node[] = [];
  private cellHit: Node | null = null;
  private cellsKey = '';
  private actionGuideRing: Node | null = null;
  private celebrationNode: Node | null = null;
  private readonly slotViews: SlotView[] = [];
  private selectedBuilding = 0;
  private selectedStage = 0;
  private stagedBuilding = -1;
  private constructionFx: Node | null = null;
  private dailyCard: Node | null = null;
  private dailyTitle: Label | null = null;
  private dailyDescription: Label | null = null;
  private dailyProgress: Label | null = null;
  private dailyReward: Label | null = null;
  private dailyActionNode: Node | null = null;
  private dailyActionButton: Button | null = null;
  private dailyActionLabel: Label | null = null;
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: TownScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    const paths = [
      'town/town_bg',
      COMMON_UI_ASSETS.backButton,
      COMMON_UI_ASSETS.coinIcon,
      TITLE_SIGN.path,
      'town/panel',
      'town/button_action',
      COMMON_UI_ASSETS.starIcon,
      'town/broom',
      'town/hammer_active',
      'town/hammer_locked',
      'town/flower_active',
      'town/flower_locked',
      'town/sparkle',
      'town/dust',
      'town/house_stage_0',
      'town/house_stage_1',
      'town/house_stage_2',
      'town/house_stage_3',
      'town/cafe_stage_0',
      'town/cafe_stage_1',
      'town/cafe_stage_2',
      'town/cafe_stage_3',
      'town/workshop_stage_0',
      'town/workshop_stage_1',
      'town/workshop_stage_2',
      'town/workshop_stage_3',
      'town/society_stage_0',
      'town/society_stage_1',
      'town/society_stage_2',
      'town/society_stage_3',
      'town/fountain_stage_0',
      'town/fountain_stage_1',
      'town/fountain_stage_2',
      'town/fountain_stage_3',
      'cats/cat_orange',
    ];
    this.assets.loadImagesFor(this, paths, () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.townUI) return;
    this.townUI.active = active;
    if (active) {
      // 从结算页「去建设」跳转过来时，Main 会塞入目标建筑 id（一次性读取）
      const focusId = this.options.consumeFocusBuilding?.();
      if (focusId) this.selectBuildingById(focusId);
      this.focusBuildableStage();
      this.refresh();
    } else {
      this.celebrationNode?.destroy();
      this.celebrationNode = null;
    }
  }

  destroy() {
    this.townUI?.destroy();
    this.townUI = null;
  }

  // 供 Main 在「结算 → 去建设」链路中定位目标建筑；找不到时保持当前选择
  private selectBuildingById(id: BuildingView['id']) {
    const index = this.buildings.findIndex(building => building.id === id);
    if (index >= 0) {
      this.selectedBuilding = index;
      this.stagedBuilding = -1;
      this.cellsKey = '';
    }
  }

  private get buildings(): BuildingView[] {
    return this.options.getBuildings();
  }

  private get selected(): BuildingView {
    const buildings = this.buildings;
    return buildings[Math.min(this.selectedBuilding, buildings.length - 1)];
  }

  private create() {
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -visibleSize.height / 2;

    this.townUI = new Node('TownUI');
    this.root.addChild(this.townUI);
    this.townUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.townUI.active = this.active;

    this.image(this.townUI, 'town/town_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildDisplay();
    this.buildSelector(bottom);
    this.buildConstructionPanel(bottom);
    this.buildHeader(top);
    this.buildDailyCard(top);
    this.focusBuildableStage();
    this.refresh();
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('TownWarmVeil');
    this.townUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 238, 194, 28);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private buildHeader(top: number) {
    const y = top - 120;
    this.buildBackButton(this.townUI!, -322, y);
    // 统一标题吊牌：偏左放（右缘 86），给星星/金币资源胶囊让位。
    const sign = this.image(this.townUI!, TITLE_SIGN.path, -84, top - 106, TITLE_SIGN.width, TITLE_SIGN.height);
    const signTitle = this.label(sign, '小镇建设', 0, TITLE_SIGN.titleOffsetY, TITLE_SIGN.titleFontSize, Theme.title);
    signTitle.isBold = true;

    this.buildResourceChip(
      this.townUI!,
      104,
      belowWeChatCapsule(top, 62),
      152,
      COMMON_UI_ASSETS.starIcon,
      () => '' + this.options.getStars(),
      () => this.toast('星星来自三消通关'),
    );
    this.buildResourceChip(
      this.townUI!,
      268,
      belowWeChatCapsule(top, 62),
      192,
      COMMON_UI_ASSETS.coinIcon,
      () => '' + this.options.getCoins(),
      () => this.toast('金币可在商店购买道具'),
    );
  }

  private buildDailyCard(top: number) {
    // 保持卡片顶边不变，向下扩展，为完整的两行说明留出空间。
    this.dailyCard = this.roundPanel(
      this.townUI!,
      0,
      top - 336,
      660,
      176,
      26,
      new Color(255, 248, 226, 246),
      new Color(235, 205, 158),
    );
    // 下移后卡片与建筑展示热区有重叠：卡片自身吞掉触摸，防止点卡片空隙误触建筑对白
    this.dailyCard.addComponent(BlockInputEvents);
    const iconGraphics = this.dailyCard.getComponent(Graphics);
    if (iconGraphics) {
      iconGraphics.lineWidth = 4;
      iconGraphics.strokeColor = new Color(244, 185, 63);
    }
    // 左侧大橘立绘：每日问候的「猫在等你」视觉锚点，轻轻呼吸
    const dailyCat = this.image(this.dailyCard, 'cats/cat_orange', -296, 2, 68, 68);
    tween(dailyCat)
      .repeatForever(
        tween()
          .to(1.2, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
          .to(1.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
    // 文案列统一「左锚点 + 左对齐」，从立绘右侧 16px 起，任何状态都不会压到猫身上
    this.dailyTitle = this.label(this.dailyCard, '', -246, 56, 22, new Color(111, 62, 28));
    this.dailyTitle.isBold = true;
    this.dailyTitle.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.dailyTitle.overflow = Label.Overflow.CLAMP;
    this.dailyTitle.enableWrapText = false;
    this.anchorLeft(this.dailyTitle, 400, 36);
    this.dailyDescription = this.label(this.dailyCard, '', -246, 0, 20, new Color(136, 94, 63));
    this.dailyDescription.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.dailyDescription.overflow = Label.Overflow.CLAMP;
    this.dailyDescription.enableWrapText = true;
    this.anchorLeft(this.dailyDescription, 400, 60);
    this.dailyProgress = this.label(this.dailyCard, '', -246, -56, 18, new Color(157, 112, 74));
    this.dailyProgress.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.dailyProgress.overflow = Label.Overflow.SHRINK;
    this.dailyProgress.enableWrapText = false;
    this.anchorLeft(this.dailyProgress, 224, 32);
    this.dailyReward = this.label(this.dailyCard, '', -6, -56, 18, new Color(191, 125, 27));
    this.dailyReward.isBold = true;
    this.dailyReward.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.dailyReward.overflow = Label.Overflow.CLAMP;
    this.dailyReward.enableWrapText = false;
    this.anchorLeft(this.dailyReward, 160, 32);

    this.dailyActionNode = this.roundPanel(
      this.dailyCard,
      246,
      0,
      146,
      64,
      22,
      new Color(255, 224, 108),
      new Color(214, 151, 38),
    );
    this.dailyActionLabel = this.label(this.dailyActionNode, '', 0, -1, 20, new Color(112, 69, 40));
    SettlementButton.apply(this.dailyActionNode, 'primary', 146, 88);
    SettlementButton.styleLabel(this.dailyActionLabel, 146, 88, 22);
    this.dailyActionButton = this.dailyActionNode.addComponent(Button);
    ensureButtonControl(this.dailyActionButton);
    this.dailyActionButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.handleDailyAction();
    });
  }

  private renderDailyCard() {
    if (!this.dailyCard || !this.dailyTitle || !this.dailyDescription || !this.dailyProgress
      || !this.dailyReward || !this.dailyActionLabel || !this.dailyActionButton) return;
    const snapshot = this.options.getTownDaily();
    this.dailyCard.active = !snapshot.claimed;
    if (snapshot.claimed) {
      Tween.stopAllByTarget(this.dailyActionLabel.node);
      this.dailyActionLabel.node.setScale(new Vec3(1, 1, 1));
      return;
    }
    this.dailyTitle.string = snapshot.unlocked ? `今日小事 · ${snapshot.title}` : snapshot.title;
    this.dailyDescription.string = snapshot.description;
    this.dailyProgress.string = snapshot.unlocked
      ? snapshot.completed ? '小事办完啦，可以领奖' : '进行中，去完成它'
      : '点亮流浪猫小屋第一格后开启';
    this.dailyReward.string = `奖励：${snapshot.rewardText}`;
    this.dailyActionLabel.string = snapshot.actionLabel;
    this.dailyActionButton.interactable = snapshot.unlocked;
    const graphics = this.dailyActionNode?.getComponent(Graphics);
    if (graphics) {
      SettlementButton.draw(graphics, 146, 88, this.dailyActionButton.interactable ? 'primary' : 'disabled');
    }
    // 可以领奖时按钮里的文字轻轻呼吸（循环动画放内层节点，不和按钮按压缩放打架）
    if (this.dailyActionLabel) {
      Tween.stopAllByTarget(this.dailyActionLabel.node);
      this.dailyActionLabel.node.setScale(new Vec3(1, 1, 1));
      if (snapshot.canClaim) {
        tween(this.dailyActionLabel.node)
          .repeatForever(
            tween()
              .to(0.75, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
              .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
          )
          .start();
      }
    }
  }

  private handleDailyAction() {
    const snapshot = this.options.getTownDaily();
    if (!snapshot.unlocked) {
      this.toast('先点亮流浪猫小屋第一格，开启小镇每日生活');
      return;
    }
    if (snapshot.canClaim) {
      const result = this.options.onClaimTownDaily();
      this.toast(result.message);
      this.refresh();
      return;
    }
    if (snapshot.claimed) return;
    switch (snapshot.taskId) {
      case 'pet_cat':
        this.options.onOpenCatCollection?.();
        break;
      case 'complete_level':
        this.options.onStartGame?.();
        break;
      case 'light_cell':
        this.lightCell();
        break;
      case 'enter_building':
      case 'view_dialogue':
        this.options.onTownDailyAction?.(snapshot.taskId, this.selected.id);
        this.toast(snapshot.taskId === 'enter_building' ? '逛完啦，今天的小镇也很热闹' : this.buildingDialogue(this.selected));
        this.refresh();
        break;
      default:
        break;
    }
  }

  private buildingDialogue(building: BuildingView) {
    if (building.id === 'cat_house') return '大橘：今天的小屋也要晒到太阳呀！';
    if (building.id === 'cafe') return '白猫：来杯热牛奶，顺便看看今天的星星。';
    if (building.id === 'yarn_workshop') return '黑猫：毛线团滚到哪里，快乐就跟到哪里。';
    if (building.id === 'cat_society') return '布偶猫：欢迎回来，大家都在等你呢。';
    return '极光猫：喷泉的星光，记得留一盏给明天。';
  }

  private buildBackButton(parent: Node, x: number, y: number) {
    const buttonNode = new Node('TownBackButton');
    parent.addChild(buttonNode);
    buttonNode.setPosition(x, y);
    buttonNode.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(buttonNode, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);

    const button = buttonNode.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.options.onReturnHome();
    });
  }

  private buildResourceChip(
    parent: Node,
    x: number,
    y: number,
    width: number,
    iconPath: string,
    formatValue: () => string,
    onTap: () => void,
  ) {
    const chipScale = 0.85;
    const hitArea = new Node('ResourceChip');
    parent.addChild(hitArea);
    hitArea.setPosition(x, y);
    hitArea.addComponent(UITransform).setContentSize(width * chipScale, 88);

    const chip = this.roundPanel(
      hitArea,
      0,
      0,
      width,
      62,
      28,
      new Color(255, 248, 226, 250),
      new Color(238, 174, 51),
    );
    const iconScale = 0.75 / chipScale;
    chip.setScale(new Vec3(chipScale, chipScale, 1));
    const iconSize = (iconPath === COMMON_UI_ASSETS.starIcon ? 48 : 46) * iconScale;
    const iconX = -width / 2 + 32;
    const plusX = width / 2 - 25;
    // 数字区域由两侧图标的边界计算，各留 8px 间距，长数字只在区域内缩放。
    const valueLeft = iconX + iconSize / 2 + 8;
    const valueRight = plusX - 22 * iconScale - 8;
    this.image(chip, iconPath, iconX, 0, iconSize, iconSize);
    const label = this.label(chip, formatValue(), (valueLeft + valueRight) / 2, -2, 25, new Color(112, 69, 40));
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.node.getComponent(UITransform)!.setContentSize(valueRight - valueLeft, 40);
    this.drawPlus(chip, plusX, 0, iconScale);

    const button = hitArea.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      onTap();
    });
    if (iconPath === COMMON_UI_ASSETS.starIcon) this.starLabel = label;
    else this.coinLabel = label;
  }

  private drawPlus(parent: Node, x: number, y: number, scale = 1) {
    const node = new Node('ResourceAdd');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(44 * scale, 44 * scale);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(255, 187, 47);
    graphics.strokeColor = new Color(221, 140, 30);
    graphics.lineWidth = 3 * scale;
    graphics.circle(0, 0, 18 * scale);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = 4 * scale;
    graphics.moveTo(-9 * scale, 0);
    graphics.lineTo(9 * scale, 0);
    graphics.moveTo(0, -9 * scale);
    graphics.lineTo(0, 9 * scale);
    graphics.stroke();
  }

  private buildDisplay() {
    this.displayLayer = new Node('TownBuildingDisplay');
    this.townUI!.addChild(this.displayLayer);
    this.displayLayer.setPosition(0, 180);
    this.displayLayer.addComponent(UITransform).setContentSize(480, 400);
    const button = this.displayLayer.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const building = this.selected;
      this.options.onTownDailyAction?.('view_dialogue', building.id);
      this.toast(this.buildingDialogue(building));
      this.refresh();
    });
  }

  private buildSelector(bottom: number) {
    const strip = new Node('TownBuildingStrip');
    this.townUI!.addChild(strip);
    // 槽位条位置：在面板顶部上方，留出更大的间距
    strip.setPosition(0, bottom + 756);

    const slotWidth = 116;
    const gap = 20;
    const total = this.buildings.length;
    this.buildings.forEach((building, index) => {
      const x = (index - (total - 1) / 2) * (slotWidth + gap);
      const slotNode = new Node('BuildingSlot_' + building.id);
      strip.addChild(slotNode);
      slotNode.setPosition(x, 0);
      slotNode.addComponent(UITransform).setContentSize(116, 100);
      const slotGraphics = slotNode.addComponent(Graphics);

      const thumb = this.image(
        slotNode,
        'town/' + building.artPrefix + '_stage_' + building.maxStage,
        0,
        16,
        84,
        62,
      );
      const nameColor = this.label(slotNode, building.name, 0, -38, 18, new Color(112, 69, 40));
      nameColor.isBold = true;
      const checkMark = this.makeCheckMark(slotNode, 43, 40);
      const lockMark = this.makeLockMark(slotNode, 43, 40);

      this.slotViews.push({
        node: slotNode,
        slotGraphics,
        thumb,
        nameColor,
        checkMark,
        lockMark,
      });

      const button = slotNode.addComponent(Button);
      ensureButtonControl(button);
      button.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        this.selectBuilding(index);
      });
    });
  }

  private buildConstructionPanel(bottom: number) {
    this.townPanel = this.image(
      this.townUI!,
      'town/panel',
      0,
      bottom + 372,
      660,
      608,
      { left: 58, right: 58, top: 62, bottom: 46 },
    );

    this.titleLabel = this.label(this.townPanel, '', -38, 244, 29, new Color(111, 62, 28));
    this.titleLabel.isBold = true;
    this.titleLabel.outlineWidth = 2;
    this.titleLabel.outlineColor = new Color(255, 248, 226);

    this.subtitleLabel = this.label(this.townPanel, '', 0, 206, 18, new Color(136, 94, 63));
    this.subtitleLabel.isBold = true;

    // 状态角标用动态文字胶囊，避免美术图上"施工中"常驻误导
    this.statusNode = this.roundPanel(
      this.townPanel,
      232,
      244,
      132,
      46,
      23,
      new Color(255, 246, 222, 245),
      new Color(238, 174, 51),
    );
    this.statusLabel = this.label(this.statusNode, '', 0, -1, 18, new Color(112, 69, 40));
    this.statusLabel.isBold = true;
    // 进度角标只展示状态；阶段卡片已提供详情，避免角标热区与第一排阶段卡重叠。

    this.stageRow = new Node('StageRow');
    this.townPanel.addChild(this.stageRow);
    this.stageRow.setPosition(0, 112);

    // 小节点格子行：点击「下一格」与主按钮行为一致，都是点亮一格
    this.cellRow = new Node('CellRow');
    this.townPanel.addChild(this.cellRow);
    this.cellRow.setPosition(0, -10);

    this.conditionLabel = this.label(this.townPanel, '', 0, -90, 20, new Color(112, 69, 40));
    this.conditionLabel.isBold = true;

    this.actionNode = this.image(this.townPanel, 'town/button_action', 0, -172, 450, 74);
    SettlementButton.apply(this.actionNode, 'primary', 450, 96);
    this.actionLabel = this.label(this.actionNode, '', 0, 0, 33, new Color(255, 251, 238));
    this.actionLabel.isBold = true;
    this.actionLabel.outlineWidth = 4;
    this.actionLabel.outlineColor = new Color(184, 74, 10);
    this.actionLabel.enableShadow = true;
    this.actionLabel.shadowColor = new Color(150, 66, 14, 150);
    this.actionLabel.shadowOffset = new Vec2(0, -3);
    SettlementButton.styleLabel(this.actionLabel, 450, 96, 32);
    this.actionButton = this.actionNode.addComponent(Button);
    ensureButtonControl(this.actionButton);
    this.actionButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.lightCell();
    });

    // 首次建设引导：围绕「点亮」按钮的脉冲光环（文案由 conditionLabel 承担）
    this.actionGuideRing = new Node('ActionGuideRing');
    this.actionNode.addChild(this.actionGuideRing);
    this.actionGuideRing.addComponent(UITransform).setContentSize(478, 102);
    this.actionGuideRing.setPosition(0, 0);
    const ringGraphics = this.actionGuideRing.addComponent(Graphics);
    ringGraphics.strokeColor = new Color(255, 224, 108);
    ringGraphics.lineWidth = 6;
    ringGraphics.roundRect(-235, -43, 470, 86, 34);
    ringGraphics.stroke();
    this.actionGuideRing.active = false;
    const ringOpacity = this.actionGuideRing.addComponent(UIOpacity);
    ringOpacity.opacity = 200;
    tween(ringOpacity)
      .repeatForever(
        tween()
          .to(0.75, { opacity: 255 }, { easing: 'sineInOut' })
          .to(0.75, { opacity: 140 }, { easing: 'sineInOut' }),
      )
      .start();
    tween(this.actionGuideRing)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.04, 1.1, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    this.rewardLabel = this.label(this.townPanel, '', 0, -256, 20, new Color(136, 94, 63));
    this.rewardLabel.isBold = true;
  }

  private refresh() {
    if (!this.townUI) return;
    const building = this.selected;
    const maxSelectable = Math.max(0, building.maxStage - 1);
    // 面板内容（进度/按钮/格子行）只展示当前施工阶段，高亮框必须同步跟随，
    // 否则大节点完成后内容已切到下一阶段，黄框还留在已完成节点上
    this.selectedStage = Math.min(building.stage, maxSelectable);

    if (this.starLabel) this.starLabel.string = '' + this.options.getStars();
    if (this.coinLabel) this.coinLabel.string = '' + this.options.getCoins();

    this.renderDisplay(building);
    this.renderSelector();
    this.renderPanel(building);
    this.renderDailyCard();
  }

  private stageArtPath(building: BuildingView, stage: number) {
    return 'town/' + building.artPrefix + '_stage_' + stage;
  }

  private renderDisplay(building: BuildingView) {
    if (!this.displayLayer) return;
    const key = building.id + ':' + building.stage + ':' + building.subProgress;
    if (this.displayImage && this.displayKey !== key) {
      this.displayImage.destroy();
      this.displayImage = null;
      this.displayKey = '';
    }
    if (!this.displayImage) {
      this.displayImage = this.image(
        this.displayLayer,
        this.stageArtPath(building, building.stage),
        0,
        0,
        440,
        380,
      );
      this.displayImage.name = 'BuildingArtwork';
      // 每点亮一格都添一束花，阶段完成后保留已获得的花朵。
      const completedCells = [0, 5, 12, 20][building.stage] ?? 20;
      const flowers = Math.min(20, completedCells + building.subProgress);
      const decoration = new Node('ProgressFlowers');
      this.displayImage.addChild(decoration);
      const art = decoration.addComponent(Graphics);
      for (let index = 0; index < flowers; index += 1) {
        const x = -168 + (index % 8) * 48;
        const y = -143 + Math.floor(index / 8) * 22;
        art.strokeColor = new Color(112, 126, 69); art.lineWidth = 3;
        art.moveTo(x, y - 19); art.lineTo(x, y); art.stroke();
        art.fillColor = new Color(255, 224, 108);
        for (let petal = 0; petal < 5; petal += 1) {
          const angle = Math.PI * 2 * petal / 5;
          art.circle(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6, 5); art.fill();
        }
        art.fillColor = new Color(177, 106, 43); art.circle(x, y, 3); art.fill();
      }

      this.displayKey = key;
      if (this.active) {
        this.displayImage.setScale(new Vec3(0.96, 0.96, 1));
        tween(this.displayImage)
          .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      }
    }

    if (!this.displayLockVeil) {
      this.displayLockVeil = new Node('DisplayLockVeil');
      this.displayLayer.addChild(this.displayLockVeil);
      this.displayLockVeil.addComponent(UITransform).setContentSize(440, 380);
      const graphics = this.displayLockVeil.addComponent(Graphics);
      graphics.fillColor = new Color(64, 52, 40, 150);
      graphics.roundRect(-220, -190, 440, 380, 28);
      graphics.fill();
      this.makeLockMark(this.displayLockVeil, 0, 24).setScale(new Vec3(1.6, 1.6, 1));
      const hint = this.label(
        this.displayLockVeil,
        '',
        0,
        -62,
        22,
        new Color(255, 246, 222),
      );
      hint.isBold = true;
      hint.name = 'LockHint';
    }
    const locked = !building.unlocked;
    this.displayLockVeil.active = locked;
    if (locked) {
      const hint = this.displayLockVeil.getChildByName('LockHint');
      if (hint) {
        const label = hint.getComponent(Label);
        if (label) {
          label.string = building.unlockHint;
          // 文案最长的一条约为 16 个字，超出时缩小字号避免溢出遮罩
          label.fontSize = building.unlockHint.length > 12 ? 19 : 22;
          label.lineHeight = label.fontSize + 8;
        }
      }
    }
  }

  private renderSelector() {
    this.buildings.forEach((building, index) => {
      const slotView = this.slotViews[index];
      if (!slotView) return;
      const selected = index === this.selectedBuilding;
      const locked = !building.unlocked;
      slotView.lockMark.active = locked;
      slotView.checkMark.active = building.completed;
      const thumbSprite = slotView.thumb.getComponent(Sprite);
      if (thumbSprite) {
        thumbSprite.color = building.unlocked
          ? new Color(255, 255, 255)
          : new Color(188, 181, 171);
      }
      slotView.nameColor.color = building.unlocked
        ? new Color(112, 69, 40)
        : new Color(158, 145, 130);

      slotView.node.setScale(new Vec3(selected ? 1.05 : 1, selected ? 1.05 : 1, 1));
      slotView.slotGraphics.clear();
      slotView.slotGraphics.lineWidth = selected ? 5 : 3;
      slotView.slotGraphics.fillColor = building.unlocked
        ? new Color(255, 249, 230, 235)
        : new Color(243, 236, 222, 225);
      slotView.slotGraphics.strokeColor = selected
        ? new Color(247, 181, 38)
        : new Color(233, 210, 170);
      slotView.slotGraphics.roundRect(-58, -50, 116, 100, 18);
      slotView.slotGraphics.fill();
      slotView.slotGraphics.stroke();
    });
  }

  private renderPanel(building: BuildingView) {
    if (this.titleLabel) this.titleLabel.string = building.name;
    if (this.subtitleLabel) this.subtitleLabel.string = building.flavor;
    this.renderStatus(building);
    this.renderStageRow(building);
    this.renderCellRow(building);

    const stageName = building.stageNames[Math.min(building.stage, building.maxStage - 1)] ?? '';
    const guideCell = this.options.shouldShowCellGuide?.() === true
      && building.unlocked && !building.completed && building.subProgress === 0;
    if (this.conditionLabel) {
      this.conditionLabel.string = !building.unlocked
        ? '解锁条件'
        : building.completed
          ? this.completedConditionText(building)
          : guideCell
            ? '用 3 颗星星点亮第一格吧！'
            : `${stageName} ${building.subProgress}/${building.cellCount} · 每格 ${building.cellCost} 颗星星`;
    }
    if (this.rewardLabel) this.rewardLabel.string = building.reward;
    this.renderAction(building);
  }

  private renderStatus(building: BuildingView) {
    if (this.statusLabel) {
      this.statusLabel.string = building.completed
        ? '已建成'
        : `阶段 ${building.stage + 1}/${building.maxStage}`;
    }
    if (this.statusNode) {
      const graphics = this.statusNode.getComponent(Graphics);
      if (graphics) {
        graphics.clear();
        graphics.lineWidth = 3;
        graphics.fillColor = building.completed
          ? new Color(233, 244, 210, 245)
          : new Color(255, 246, 222, 245);
        graphics.strokeColor = building.completed
          ? new Color(151, 190, 94)
          : new Color(238, 174, 51);
        graphics.roundRect(-70, -25, 140, 50, 25);
        graphics.fill();
        graphics.stroke();
      }
    }
  }

  private renderStageRow(building: BuildingView) {
    if (!this.stageRow) return;
    if (this.stagedBuilding !== this.selectedBuilding) {
      this.rebuildStageRow(building);
    }
    const selectedIsDone = this.isStageDone(building, this.selectedStage);
    this.stageViews.forEach((stageView, index) => {
      const locked = index > building.stage;
      const completed = index < building.stage;
      const selected = !locked && this.selectedStage === index;
      stageView.activeIcon.active = !locked;
      stageView.lockedIcon.active = locked;
      stageView.checkMark.active = completed || (selected && selectedIsDone);
      stageView.lockMark.active = locked;
      stageView.title.string = building.stageNames[index] ?? '';
      stageView.title.color = locked
        ? new Color(150, 137, 121)
        : selected
          ? new Color(112, 69, 40)
          : new Color(135, 104, 76);
      stageView.card.setScale(new Vec3(selected ? 1.04 : 1, selected ? 1.04 : 1, 1));

      stageView.cardGraphics.clear();
      stageView.cardGraphics.lineWidth = selected ? 5 : 3;
      stageView.cardGraphics.fillColor = locked
        ? new Color(245, 238, 222, 215)
        : completed
          ? new Color(255, 248, 226, 225)
          : new Color(255, 249, 230, 255);
      stageView.cardGraphics.strokeColor = selected
        ? new Color(247, 181, 38)
        : completed
          ? new Color(225, 206, 168)
          : new Color(228, 215, 193);
      const halfWidth = this.stageCardWidth(building) / 2;
      stageView.cardGraphics.roundRect(-halfWidth, -52, halfWidth * 2, 104, 18);
      stageView.cardGraphics.fill();
      stageView.cardGraphics.stroke();
    });
  }

  private stageCardWidth(building: BuildingView) {
    return building.maxStage > 3 ? 120 : 142;
  }

  private rebuildStageRow(building: BuildingView) {
    if (!this.stageRow) return;
    this.stageViews.forEach(stageView => stageView.card.destroy());
    this.stageViews.length = 0;
    this.stagedBuilding = this.selectedBuilding;

    const cardWidth = this.stageCardWidth(building);
    const gap = building.maxStage > 3 ? 16 : 48;
    const step = cardWidth + gap;
    building.stageNames.forEach((stageName, index) => {
      const x = (index - (building.maxStage - 1) / 2) * step;
      const card = new Node('StageCard_' + (index + 1));
      this.stageRow!.addChild(card);
      card.setPosition(x, 0);
      card.addComponent(UITransform).setContentSize(cardWidth, 124);
      const cardGraphics = card.addComponent(Graphics);

      const iconPath = STAGE_ICONS_ACTIVE[index] ?? 'town/sparkle';
      const lockedPath = STAGE_ICONS_LOCKED[index] ?? 'town/flower_locked';
      const activeIcon = this.image(card, iconPath, 0, 10, 44, 52);
      const lockedIcon = this.image(card, lockedPath, 0, 10, 44, 52);
      const checkMark = this.makeCheckMark(card, cardWidth / 2 - 20, 36);
      const lockMark = this.makeLockMark(card, cardWidth / 2 - 20, 36);
      const title = this.label(card, stageName, 0, -38, 20, new Color(112, 69, 40));
      title.isBold = true;

      this.stageViews.push({
        card,
        cardGraphics,
        activeIcon,
        lockedIcon,
        checkMark,
        lockMark,
        title,
      });

      const button = card.addComponent(Button);
      ensureButtonControl(button);
      button.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        this.selectStage(index);
      });
    });
  }

  private isStageDone(building: BuildingView, stage: number) {
    return stage < building.stage || building.completed;
  }

  /** 小节点格子行：亮格 / 下一格（可点）/ 未点亮 三种状态 */
  private renderCellRow(building: BuildingView) {
    if (!this.cellRow) return;
    this.cellRow.active = building.unlocked;
    if (!building.unlocked) {
      if (this.cellHit) this.cellHit.active = false;
      return;
    }
    const key = building.id + ':' + building.stage + ':' + building.cellCount;
    if (this.cellsKey !== key) {
      this.rebuildCellNodes(building.cellCount);
      this.cellsKey = key;
    }
    const nextIndex = building.completed ? -1 : building.subProgress;
    this.cellNodes.forEach((cell, index) => {
      const lit = index < building.subProgress || building.completed;
      const isNext = index === nextIndex;
      Tween.stopAllByTarget(cell);
      cell.setScale(new Vec3(1, 1, 1));
      const graphics = cell.getComponent(Graphics)!;
      graphics.clear();
      graphics.lineWidth = lit || isNext ? 4 : 3;
      graphics.fillColor = lit
        ? new Color(255, 224, 108)
        : isNext
          ? new Color(255, 239, 178)
          : new Color(255, 248, 226);
      graphics.strokeColor = lit || isNext
        ? new Color(184, 119, 36)
        : new Color(235, 205, 158);
      graphics.roundRect(-22, -22, 44, 44, 12);
      graphics.fill();
      graphics.stroke();
      if (lit) {
        graphics.strokeColor = Color.WHITE;
        graphics.lineWidth = 4;
        graphics.moveTo(-9, 0);
        graphics.lineTo(-2, -7);
        graphics.lineTo(10, 8);
        graphics.stroke();
      } else if (isNext) {
        graphics.strokeColor = new Color(150, 96, 40);
        graphics.lineWidth = 4;
        graphics.moveTo(-7, 0);
        graphics.lineTo(7, 0);
        graphics.moveTo(0, -7);
        graphics.lineTo(0, 7);
        graphics.stroke();
        // 下一格待点亮：轻微呼吸提醒可点（点亮推进后由上面的 stopAllByTarget 挪到新格子）
        tween(cell)
          .repeatForever(
            tween()
              .to(0.75, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'sineInOut' })
              .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
          )
          .start();
      }
    });
    this.refreshCellHit(building, nextIndex);
  }

  private rebuildCellNodes(count: number) {
    this.cellNodes.forEach(cell => cell.destroy());
    this.cellNodes.length = 0;
    this.cellHit?.destroy();
    this.cellHit = null;
    if (!this.cellRow) return;
    const step = 52; // 44px 格子 + 8px 间距
    for (let index = 0; index < count; index += 1) {
      const cell = new Node('BuildCell_' + index);
      this.cellRow.addChild(cell);
      cell.setPosition((index - (count - 1) / 2) * step, 0);
      cell.addComponent(UITransform).setContentSize(44, 44);
      cell.addComponent(Graphics);
      this.cellNodes.push(cell);
    }
    // 下一格的命中区：44px 视觉外扩到 88px 热区（规范要求），只挂一个节点避免相邻热区重叠
    const hit = new Node('CellHit');
    this.cellRow.addChild(hit);
    hit.addComponent(UITransform).setContentSize(88, 88);
    const button = hit.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.lightCell();
    });
    this.cellHit = hit;
  }

  private refreshCellHit(building: BuildingView, nextIndex: number) {
    if (!this.cellHit) return;
    const actionable = building.unlocked && !building.completed && nextIndex >= 0;
    this.cellHit.active = actionable;
    if (!actionable) return;
    this.cellHit.setPosition((nextIndex - (building.cellCount - 1) / 2) * 52, 0);
  }

  private popCell(index: number) {
    const cell = this.cellNodes[index];
    if (!cell || !cell.isValid) return;
    cell.setScale(new Vec3(1.45, 1.45, 1));
    tween(cell)
      .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  private focusBuildableStage(building = this.selected) {
    if (!building) return;
    this.selectedStage = Math.min(building.stage, Math.max(0, building.maxStage - 1));
  }

  private completedConditionText(building: BuildingView) {
    return `${getCatDefinition(building.catId).name}已入住`;
  }

  private renderAction(building: BuildingView) {
    if (!this.actionLabel || !this.actionButton) return;
    this.actionLabel.string = this.actionText(building);
    const canAct = building.unlocked && !building.completed;
    this.actionButton.interactable = canAct;
    this.actionLabel.color = canAct
      ? Theme.title
      : Theme.mutedSoft;
    if (this.actionNode) SettlementButton.apply(this.actionNode, canAct ? 'primary' : 'disabled', 450, 96);
    if (this.actionGuideRing) {
      // 首次建设引导：只对小屋、当前大节点一格未亮时出现
      this.actionGuideRing.active = canAct
        && this.options.shouldShowCellGuide?.() === true
        && building.subProgress === 0;
    }
  }

  private actionText(building: BuildingView) {
    if (!building.unlocked) return '未解锁';
    if (building.completed) return '已建成';
    const stageName = building.stageNames[building.stage] ?? '';
    return `点亮「${stageName}」一格`;
  }

  private selectBuilding(index: number) {
    const building = this.buildings[index];
    if (!building) return;
    if (index === this.selectedBuilding) {
      if (building.unlocked) this.options.onTownDailyAction?.('enter_building', building.id);
      return;
    }
    this.selectedBuilding = index;
    this.focusBuildableStage(building);
    if (building.unlocked) this.options.onTownDailyAction?.('enter_building', building.id);
    if (!building.unlocked) {
      this.toast(building.unlockHint);
    }
    this.refresh();
  }

  private selectStage(index: number) {
    const building = this.selected;
    if (index > building.stage) {
      const previousName = building.stageNames[index - 1] ?? '前一阶段';
      this.toast('完成' + previousName + '后解锁');
      return;
    }
    if (index < building.stage) {
      this.toast(`「${building.stageNames[index] ?? ''}」已完成`);
      return;
    }
    this.refresh();
  }

  // 点亮当前大节点的下一格（与格子行命中区同一入口）：
  // 普通点亮只弹格动画；亮满大节点补施工特效 + Toast；建成弹猫咪解锁庆祝。
  private lightCell() {
    const building = this.selected;
    if (!building.unlocked) {
      this.toast(building.unlockHint);
      return;
    }
    if (building.completed) {
      const catName = getCatDefinition(building.catId).name;
      this.toast(`${building.name}建设完成，「${catName}」已入住小镇`);
      return;
    }
    const litIndex = building.subProgress;
    const result = this.options.onLightCell(building.id);
    if (!result.ok) {
      this.toast(result.message);
      return;
    }
    this.refresh();
    if (result.buildingCompleted) {
      this.playConstructionFx();
      this.showCatUnlockCelebration();
    } else if (result.stageJustCompleted) {
      this.playConstructionFx();
      this.toast(result.message);
    } else {
      this.popCell(litIndex);
    }
  }

  /** 建成庆祝：全屏遮罩 + 建筑完成外观 + 猫咪头像弹入 + 去装备入口 */
  private showCatUnlockCelebration() {
    const building = this.selected;
    if (!this.townUI) return;
    this.closeCelebration();
    const shareOffer = this.options.getShareOffer?.('cat_unlock');
    const overlay = new Node('CatUnlockCelebration');
    this.townUI.addChild(overlay);
    this.celebrationNode = overlay;

    const size = view.getVisibleSize();
    const backdrop = new Node('CelebrationBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(size.width, size.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);

    const panelHeight = shareOffer ? 816 : 620;
    const panel = this.roundPanel(
      overlay, 0, 0, 580, panelHeight, 34,
      new Color(255, 248, 226), new Color(235, 205, 158),
    );
    panel.setScale(new Vec3(0.8, 0.8, 1));
    tween(panel)
      .to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    this.image(panel, 'town/' + building.artPrefix + '_stage_' + building.maxStage, 0, 170, 300, 220);
    const title = this.label(panel, `${building.name}建成！`, 0, 24, 30, new Color(111, 62, 28));
    title.isBold = true;

    const catDefinition = getCatDefinition(building.catId);
    const catNode = new Node('CelebrationCat');
    panel.addChild(catNode);
    catNode.setPosition(0, -70);
    catNode.addComponent(UITransform).setContentSize(132, 132);
    const catSprite = catNode.addComponent(Sprite);
    catSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const catFrame = this.assets.getFrame(catDefinition.portraitPath);
    if (catFrame) catSprite.spriteFrame = catFrame;
    catNode.setScale(new Vec3(0, 0, 1));
    tween(catNode)
      .delay(0.16)
      .to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    // 小镇页不预载猫咪头像：弹窗内兜底加载，落盘后补图
    this.assets.loadImagesFor(this, [catDefinition.portraitPath], () => {
      const frame = this.assets.getFrame(catDefinition.portraitPath);
      if (frame && catNode.isValid) catSprite.spriteFrame = frame;
    });

    const catLabel = this.label(panel, `「${catDefinition.name}」加入了你的小镇！`, 0, -158, 22, new Color(136, 94, 63));
    catLabel.isBold = true;

    if (shareOffer) {
      const shareNode = this.roundPanel(
        panel, 0, -236, 440, 72, 36,
        new Color(244, 131, 165), new Color(184, 74, 110),
      );
      const shareLabel = this.label(shareNode, shareOffer.label, 0, -1, 25, Color.WHITE);
      SettlementButton.apply(shareNode, 'secondary', 440, 88);
      SettlementButton.styleLabel(shareLabel, 440, 88, 24);
      const shareButton = shareNode.addComponent(Button);
      ensureButtonControl(shareButton);
      shareButton.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        this.options.onShare?.(shareOffer.type);
      });
    }

    const actionY = shareOffer ? -340 : -244;
    const primary = this.roundPanel(
      panel, -116, actionY, 208, 88, 38,
      new Color(255, 224, 108), new Color(201, 148, 47),
    );
    const primaryLabel = this.label(primary, '去装备', 0, -1, 27, new Color(111, 62, 28));
    SettlementButton.apply(primary, 'primary', 208, 88);
    SettlementButton.styleLabel(primaryLabel, 208, 88, 24);
    const primaryButton = primary.addComponent(Button);
    ensureButtonControl(primaryButton);
    primaryButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.closeCelebration();
      this.options.onOpenCatCollection?.();
    });

    const secondary = this.roundPanel(
      panel, 116, actionY, 208, 88, 38,
      new Color(255, 252, 241), new Color(228, 215, 193),
    );
    const secondaryLabel = this.label(secondary, '留在这里', 0, -1, 24, new Color(135, 104, 76));
    SettlementButton.apply(secondary, 'secondary', 208, 88);
    SettlementButton.styleLabel(secondaryLabel, 208, 88, 24);
    const secondaryButton = secondary.addComponent(Button);
    ensureButtonControl(secondaryButton);
    secondaryButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.closeCelebration();
    });
  }

  private closeCelebration() {
    this.celebrationNode?.destroy();
    this.celebrationNode = null;
  }

  private playConstructionFx() {
    this.constructionFx?.destroy();
    const fx = new Node('ConstructionFx');
    this.displayLayer!.addChild(fx);
    fx.setPosition(0, 0);
    this.constructionFx = fx;

    const dust = this.image(fx, 'town/dust', -146, -116, 43, 69);
    const sparkleLeft = this.image(fx, 'town/sparkle', -190, 70, 32, 32);
    const sparkleRight = this.image(fx, 'town/sparkle', 182, 96, 32, 32);
    [dust, sparkleLeft, sparkleRight].forEach((node, index) => {
      const opacity = node.addComponent(UIOpacity);
      opacity.opacity = 0;
      const finalY = node.position.y;
      node.setPosition(node.position.x, finalY - 20);
      tween(opacity).delay(index * 0.08).to(0.18, { opacity: 255 }).start();
      tween(node)
        .delay(index * 0.08)
        .to(0.3, { position: new Vec3(node.position.x, finalY, 0) }, { easing: 'backOut' })
        .to(0.42, { position: new Vec3(node.position.x, finalY + 22, 0) }, { easing: 'sineInOut' })
        .start();
    });
    tween(fx).delay(0.78).to(0.12, { scale: new Vec3(0.7, 0.7, 1) }).call(() => {
      if (fx.isValid) fx.destroy();
      if (this.constructionFx === fx) this.constructionFx = null;
    }).start();
  }

  private makeCheckMark(parent: Node, x: number, y: number) {
    const node = new Node('StageCheck');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(38, 38);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(112, 178, 71);
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = 3;
    graphics.circle(0, 0, 16);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = 4;
    graphics.moveTo(-8, 0);
    graphics.lineTo(-2, -6);
    graphics.lineTo(9, 7);
    graphics.stroke();
    return node;
  }

  private makeLockMark(parent: Node, x: number, y: number) {
    const node = new Node('StageLock');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(40, 44);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(133, 133, 133);
    graphics.strokeColor = new Color(244, 239, 225);
    graphics.lineWidth = 3;
    graphics.roundRect(-13, -12, 26, 23, 5);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = new Color(133, 133, 133);
    graphics.lineWidth = 5;
    graphics.arc(0, 5, 10, Math.PI, 0, false);
    graphics.stroke();
    graphics.fillColor = new Color(255, 229, 145);
    graphics.circle(0, -3, 3);
    graphics.fill();
    return node;
  }

  private roundPanel(
    parent: Node,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: Color,
    stroke: Color,
  ) {
    const node = new Node('RoundPanel');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = 3;
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
    return node;
  }

  private image(
    parent: Node,
    path: string,
    x: number,
    y: number,
    width: number,
    height: number,
    insets?: { left: number; right: number; top: number; bottom: number },
  ) {
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = this.assets.getFrame(path);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
      if (insets) {
        const slicedFrame = frame as any;
        slicedFrame.insetLeft = insets.left;
        slicedFrame.insetRight = insets.right;
        slicedFrame.insetTop = insets.top;
        slicedFrame.insetBottom = insets.bottom;
        sprite.type = Sprite.Type.SLICED;
      }
    }
    return node;
  }

  // 左锚点行：文本从节点 x 向右排，多状态切换时不会因居中锚点向两侧外溢
  private anchorLeft(label: Label, width: number, height: number) {
    const transform = label.node.getComponent(UITransform)!;
    transform.anchorX = 0;
    transform.anchorY = 0.5;
    transform.setContentSize(width, height);
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
    if (!this.townUI) return;
    Toast.show(this.townUI, text);
  }
}
