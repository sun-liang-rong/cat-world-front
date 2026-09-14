import {
  _decorator,
  BlockInputEvents,
  Button,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  Sprite,
  SpriteFrame,
  Tween,
  tween,
  UITransform,
  UIOpacity,
  Vec2,
  Vec3,
  view,
} from 'cc';
import { AssetStore, COMMON_UI_ASSETS } from './AssetStore';
import { SettlementButton, SettlementButtonTone } from './SettlementButton';
import type { RewardedAdResult } from './RewardedAdService';

const { ccclass } = _decorator;

export interface EndlessSettlementInfo {
  eliminated: number;
  durationMs: number;
  stage: number;
  bestEliminated: number;
  isNewRecord: boolean;
}

export interface SettlementPopupOptions {
  win: boolean;
  /** 超萌挑战胜利：不展示星星，标题用「超萌挑战!」 */
  challenge?: boolean;
  /** 无尽模式结算：不展示星星和通关评价，主数字是消除数 */
  endless?: EndlessSettlementInfo;
  level: number;
  stars: number;
  starReward: number;
  coinReward: number;
  rating: string;
  /** 覆盖分段胶囊左侧主操作文案，缺省「下一关」 */
  nextButtonLabel?: string;
  /** 覆盖分段胶囊右侧文案，缺省为返回首页 */
  homeButtonLabel?: string;
  onNextLevel: () => void;
  onReturnHome: () => void;
  onReplay: () => void;
  /** 激励视频完成后，将本局从失败状态恢复为可继续操作。 */
  onRevive?: () => void;
  /**
   * 免费复活（连败中打难关的留存兜底）：不看广告直接执行 onRevive。
   * 由 DifficultyController 在连败 ≥1 且触发 spike 时随关卡透传，每局仍只复活一次；
   * 无连败的难关失败不附带此标记，正常走广告复活。
   */
  freeRevive?: boolean;
  /** 失败时槽内是否已有听牌对子，用于「就差一对」文案。 */
  hadTrayPair?: boolean;
  /** 激励视频完成后补发与基础通关奖励相同数量的金币。 */
  onDoubleReward?: () => void;
  onWatchAd?: () => Promise<RewardedAdResult>;
  /**
   * 主线成功态的建设目标提示（小节点机制）：星够时整行可点，作为「去建设」入口；
   * 文案由 GameScreen 按 PlayerStore.getNextBuildableInfo 组装。
   */
  buildTarget?: { text: string; canBuild: boolean };
  /** 点击建设目标行（canBuild 时才可点）：关闭对局并跳转小镇 */
  onGoBuild?: () => void;
}

// —— 结算弹窗套件（assets/resources/popup2/，对齐用户设计稿）——
// 单一粉紫描边九宫格面板（底角绿植雏菊），胜败共用；猫咪趴在面板上沿、爪子搭在绶带上；
// 标题是粉/灰绶带底图 + 动态 Label；评价/奖励行带浅粉胶囊底；失败为工具箱信息卡；
// 次操作是两条独立浅粉胶囊，红色广告钮压底。
const POPUP_ASSETS = {
  panel: 'popup2/panel_result',
  catWin: 'popup2/cat_win_wave',
  catFail: 'popup2/cat_fail_lean',
  ribbonWin: 'popup2/ribbon_win2',
  ribbonFail: 'popup2/ribbon_fail2',
  toolbox: 'popup2/icon_toolbox',
} as const;

type PopupFrameKey = keyof typeof POPUP_ASSETS;
type PopupFrames = Record<PopupFrameKey | 'coinIcon', SpriteFrame>;
type PopupMode = 'win' | 'challenge' | 'endless' | 'fail';

const PANEL_WIDTH = 610;
/** 九宫格 insets：需盖住圆角弧线、柔光与底角灌木（面板切图 620 宽） */
const PANEL_INSET = 130;
/** 标题绶带中心到面板顶的距离 */
const RIBBON_OFFSET = 150;
const RIBBON_WIDTH = 460;
const RIBBON_HEIGHT = 120;
const FAIL_RIBBON_HEIGHT = 95;
/** 面板顶到第一个内容区块的距离：需低于绶带下缘（150 偏移 + 60 半高 ≈ 210）并留出间距 */
const HEADER_ZONE = 232;
const SECTION_GAP = 14;
/** 评价/奖励行的浅粉胶囊底 */
const ROW_PILL_WIDTH = 440;
const ROW_PILL_HEIGHT = 56;
/** 次操作胶囊按钮（两条并排） */
const CAPSULE_WIDTH = 200;
const CAPSULE_HEIGHT = 88;
const CAPSULE_GAP = 24;
/** 红色广告主按钮 */
const AD_WIDTH = 440;
const AD_HEIGHT = 134;
const AD_ROW_GAP = 14;
/** 按钮区总高：胶囊行 + 广告钮 */
const BUTTON_SECTION_HEIGHT = CAPSULE_HEIGHT + AD_ROW_GAP + AD_HEIGHT;
const BUTTON_SECTION_CAPSULE_ONLY = CAPSULE_HEIGHT;
/** 失败信息卡（工具箱 + 文案） */
const CARD_WIDTH = 500;
const CARD_HEIGHT = 104;
const BOTTOM_PAD = 56;
/** 内容很少时保底高度，设计稿为近方形面板 */
const MIN_PANEL_HEIGHT = 600;
const CAT_WIDTH = 310;
const CAT_HEIGHT = 280;
/** 猫爪尖垂到绶带上沿（约面板顶下 82px），身体贴在面板边上，不遮挡绶带文字 */
const CAT_PAW_REACH = 82;

/** 一个内容区块：先声明占位高度参与排版，build 时再按中心线落节点 */
interface PopupSection {
  height: number;
  build: (parent: Node, centerY: number) => void;
}

const TITLE_TEXTS: Record<PopupMode, string> = {
  win: '关卡完成!',
  challenge: '超萌挑战!',
  endless: '本局结束',
  fail: '差一点!',
};

@ccclass('SettlementPopup')
export class SettlementPopup extends Component {
  private options!: SettlementPopupOptions;
  private assets!: AssetStore;
  private frames: Partial<PopupFrames> = {};
  private starFrame: SpriteFrame | null = null;
  private contentBuilt = false;
  private adButton: Button | null = null;
  private adButtonLabel: Label | null = null;
  private adBusy = false;
  private readonly tweenTargets = new Set<object>();

  public static open(parent: Node, assets: AssetStore, options: SettlementPopupOptions) {
    const node = new Node('SettlementPopup');
    parent.addChild(node);
    const popup = node.addComponent(SettlementPopup);
    popup.setup(assets, options);
    return popup;
  }

  public close() {
    if (this.node.isValid) this.node.destroy();
  }

  private setup(assets: AssetStore, options: SettlementPopupOptions) {
    this.assets = assets;
    this.options = options;
    this.buildBackdrop();
    this.loadFrames();
  }

  private buildBackdrop() {
    const size = view.getVisibleSize();
    const backdrop = new Node('SettlementBackdrop');
    this.node.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(size.width, size.height);
    const graphics = backdrop.addComponent(Graphics);
    graphics.fillColor = new Color(22, 18, 13, 190);
    graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    graphics.fill();
    backdrop.addComponent(BlockInputEvents);
  }

  private loadFrames() {
    const paths = [
      ...Object.values(POPUP_ASSETS),
      COMMON_UI_ASSETS.coinIcon,
      COMMON_UI_ASSETS.starIcon,
      ...SettlementButton.imagePaths,
    ];
    this.assets.loadImages(paths, () => {
      const panelFrame = this.assets.getFrame(POPUP_ASSETS.panel);
      if (panelFrame) {
        panelFrame.insetTop = PANEL_INSET;
        panelFrame.insetBottom = PANEL_INSET;
        panelFrame.insetLeft = PANEL_INSET;
        panelFrame.insetRight = PANEL_INSET;
      }
      Object.keys(POPUP_ASSETS).forEach(key => {
        const frame = this.assets.getFrame(POPUP_ASSETS[key as PopupFrameKey]);
        if (!frame) return;
        // 装饰切图不要打进动态图集，避免宽高被换成图集尺寸
        frame.packable = false;
        this.frames[key as PopupFrameKey] = frame;
      });
      const coinFrame = this.assets.getFrame(COMMON_UI_ASSETS.coinIcon);
      if (coinFrame) this.frames.coinIcon = coinFrame;
      this.starFrame = this.assets.getFrame(COMMON_UI_ASSETS.starIcon) || null;
      if (this.node.isValid) this.buildContent();
    });
  }

  private resolveMode(): PopupMode {
    if (this.options.endless) return 'endless';
    if (this.options.win) return this.options.challenge ? 'challenge' : 'win';
    return 'fail';
  }

  private buildContent() {
    if (this.contentBuilt) return;
    this.contentBuilt = true;
    const mode = this.resolveMode();
    if (mode !== 'fail') this.buildVictoryFireworks();

    const hasAdRow = this.hasAdRow(mode);
    const buttonSectionHeight = hasAdRow ? BUTTON_SECTION_HEIGHT : BUTTON_SECTION_CAPSULE_ONLY;
    const sections = this.collectSections(mode);
    const sectionsTotal = sections.reduce((sum, section) => sum + section.height, 0)
      + SECTION_GAP * Math.max(0, sections.length - 1);
    const naturalHeight = HEADER_ZONE
      + sectionsTotal
      + SECTION_GAP + buttonSectionHeight
      + BOTTOM_PAD;
    // 保底高度多出来的部分：一半加在标题下方，一半留在内容与按钮区之间
    const headerExtra = Math.floor(Math.max(0, MIN_PANEL_HEIGHT - naturalHeight) / 2);
    const panelHeight = Math.max(naturalHeight, MIN_PANEL_HEIGHT);

    const group = new Node('ResultGroup');
    this.node.addChild(group);
    group.setPosition(0, 15);
    group.setScale(new Vec3(0.94, 0.94, 1));
    this.tweenTargets.add(group);
    tween(group)
      .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    this.buildPanel(group, panelHeight, mode);
    // 猫咪在面板之后添加：爪子搭在面板前面
    this.buildMascot(group, panelHeight, mode);
    this.buildTitle(group, panelHeight, mode);

    let cursor = panelHeight / 2 - HEADER_ZONE - headerExtra;
    sections.forEach((section, index) => {
      if (index > 0) cursor -= SECTION_GAP;
      section.build(group, cursor - section.height / 2);
      cursor -= section.height;
    });

    // 按钮区锚定面板底部：次操作胶囊行在上，广告主按钮压底
    const buttonCenterY = -(panelHeight / 2 - BOTTOM_PAD - buttonSectionHeight / 2);
    this.buildActionButtons(group, buttonCenterY + (hasAdRow ? (AD_HEIGHT + AD_ROW_GAP) / 2 : 0), mode);
    if (hasAdRow) {
      const freeRevive = mode === 'fail' && this.options.freeRevive === true;
      const adText = mode === 'fail'
        ? (freeRevive ? '免费复活清出一对' : '看广告清出一对')
        : '看广告×2金币';
      const adCompleted = mode === 'fail'
        ? () => this.options.onRevive!()
        : () => this.options.onDoubleReward!();
      this.createAdButton(group, adText, 'red', 0, buttonCenterY - (CAPSULE_HEIGHT + AD_ROW_GAP) / 2, adCompleted, freeRevive);
    }
  }

  private hasAdRow(mode: PopupMode) {
    // 激励视频已接入（RewardedAdService）：失败给「看广告清出一对」复活，
    // 胜利/无尽给「看广告×2金币」。回调由 GameScreen 按模式与剩余机会注入。
    // 难关失败例外：freeRevive 时不依赖广告，按钮直接复活（广告总开关关闭时也可用）。
    if (mode === 'fail') {
      return !!this.options.onRevive && (!!this.options.onWatchAd || this.options.freeRevive === true);
    }
    if (!this.options.onWatchAd) return false;
    return !!this.options.onDoubleReward && (mode !== 'endless' || this.options.coinReward > 0);
  }

  private collectSections(mode: PopupMode): PopupSection[] {
    if (mode === 'endless') {
      const info = this.options.endless!;
      return [
        { height: 88, build: (parent, y) => this.buildEndlessStat(parent, y, info) },
        { height: 60, build: (parent, y) => this.buildEndlessDurationRow(parent, y, info) },
        { height: 28, build: (parent, y) => this.buildEndlessRecord(parent, y, info) },
        { height: 60, build: (parent, y) => this.buildRewardRow(parent, y) },
      ];
    }
    if (mode === 'fail') {
      return [
        { height: 112, build: (parent, y) => this.buildFailCard(parent, y) },
      ];
    }
    const sections: PopupSection[] = [];
    const earnedStars = Math.max(0, Math.min(3, this.options.starReward));
    if (earnedStars > 0) {
      sections.push({ height: 84, build: (parent, y) => this.buildStarRow(parent, y, earnedStars) });
    }
    sections.push({ height: 60, build: (parent, y) => this.buildRatingRow(parent, y) });
    sections.push({ height: 60, build: (parent, y) => this.buildRewardRow(parent, y) });
    if (this.options.buildTarget) {
      sections.push({ height: 68, build: (parent, y) => this.buildBuildTargetRow(parent, y) });
    }
    return sections;
  }

  /** 猫咪贴纸：画在面板前面，贴纸底边（爪尖）垂到面板面内 CAT_PAW_REACH 深 */
  private buildMascot(parent: Node, panelHeight: number, mode: PopupMode) {
    const frame = this.frames[mode === 'fail' ? 'catFail' : 'catWin'];
    if (!frame) return;
    const size = this.fitSize(frame, CAT_WIDTH, CAT_HEIGHT);
    const y = panelHeight / 2 - CAT_PAW_REACH + size.height / 2;
    this.image(parent, 'Mascot', frame, 0, y, size.width, size.height);
  }

  private buildPanel(parent: Node, panelHeight: number, mode: PopupMode) {
    const node = new Node('Panel');
    parent.addChild(node);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(PANEL_WIDTH, panelHeight);
    const frame = this.frames.panel;
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.type = Sprite.Type.SLICED;
      sprite.spriteFrame = frame;
    } else {
      const graphics = node.addComponent(Graphics);
      graphics.fillColor = new Color(255, 249, 239);
      graphics.strokeColor = new Color(214, 178, 228);
      graphics.lineWidth = 6;
      graphics.roundRect(-PANEL_WIDTH / 2, -panelHeight / 2, PANEL_WIDTH, panelHeight, 60);
      graphics.fill();
      graphics.stroke();
    }
    transform.setContentSize(PANEL_WIDTH, panelHeight);
    return node;
  }

  /** 标题绶带：粉（胜）/灰（败）底图 + 动态文字，爪子垂搭在绶带上沿 */
  private buildTitle(parent: Node, panelHeight: number, mode: PopupMode) {
    const isFail = mode === 'fail';
    const y = panelHeight / 2 - RIBBON_OFFSET;
    const ribbonFrame = this.frames[isFail ? 'ribbonFail' : 'ribbonWin'];

    // 绶带和标题文字必须共用同一个动画节点。之前只缩放绶带，
    // 入场动画尚未完成时文字会跑到绶带外，视觉上像绶带被横向压扁。
    const titleGroup = new Node('TitleGroup');
    parent.addChild(titleGroup);
    titleGroup.setPosition(0, y);
    titleGroup.setScale(new Vec3(0.7, 0.7, 1));
    this.tweenTargets.add(titleGroup);
    tween(titleGroup)
      .delay(0.05)
      .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    if (ribbonFrame) {
      // 先建绶带再建文字，保证文字在绶带上层
      const size = this.fitSize(
        ribbonFrame,
        RIBBON_WIDTH,
        isFail ? FAIL_RIBBON_HEIGHT : RIBBON_HEIGHT,
      );
      this.image(titleGroup, 'TitleRibbon', ribbonFrame, 0, 0, size.width, size.height);
    }
    const text = this.label(
      titleGroup,
      TITLE_TEXTS[mode],
      0,
      isFail ? -2 : 4,
      40,
      isFail ? Color.WHITE : new Color(255, 187, 61),
    );
    text.isBold = true;
    // 胜：橙黄字白描边；败：白字灰描边
    text.outlineWidth = 4;
    text.outlineColor = isFail ? new Color(116, 122, 144) : Color.WHITE;
    text.enableShadow = true;
    text.shadowColor = isFail ? new Color(70, 76, 100, 130) : new Color(190, 90, 20, 140);
    text.shadowOffset = new Vec2(0, -3);
    if (!ribbonFrame && !isFail) {
      // 无绶带底图时的兜底：橙色字直接排
      text.color = new Color(234, 111, 20);
      text.outlineColor = Color.WHITE;
    }
  }

  private buildStarRow(parent: Node, y: number, stars: number) {
    const spacing = 100;
    const startX = -((stars - 1) * spacing) / 2;
    for (let index = 0; index < stars; index++) {
      const star = this.image(parent, 'Star', this.starFrame, startX + index * spacing, y, 88, 84);
      star.setScale(new Vec3(0, 0, 1));
      this.tweenTargets.add(star);
      tween(star)
        .delay(0.18 + index * 0.12)
        .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    }
  }

  /** 评价行：浅粉胶囊底 + 棕字 + 彩色评价 */
  private buildRatingRow(parent: Node, y: number) {
    this.buildRowPill(parent, y);
    const ratingText = this.options.rating;
    const ratingColors: Record<string, Color> = {
      '完美': new Color(234, 111, 20),
      '表现不错': new Color(244, 73, 105),
      '完成挑战': new Color(121, 83, 59),
    };
    const ratingLabelWidth = this.textWidth('本关评价：', 26);
    const ratingValueWidth = this.textWidth(ratingText, 30);
    const ratingGap = 10;
    const ratingStartX = -(ratingLabelWidth + ratingGap + ratingValueWidth) / 2;
    const rating = this.label(parent, '本关评价：', ratingStartX + ratingLabelWidth / 2, y, 26, new Color(112, 62, 29));
    rating.isBold = true;
    const ratingValue = this.label(
      parent,
      ratingText,
      ratingStartX + ratingLabelWidth + ratingGap + ratingValueWidth / 2,
      y,
      30,
      ratingColors[ratingText] ?? new Color(244, 73, 105),
    );
    ratingValue.isBold = true;
  }

  /** 奖励行：浅粉胶囊底 + 文案 + 金币图标 */
  private buildRewardRow(parent: Node, y: number) {
    this.buildRowPill(parent, y);
    const fontSize = 21;
    const color = new Color(112, 69, 40);
    const coinText = `×${this.options.coinReward}`;
    const prefixWidth = this.textWidth('本次奖励：金币', fontSize);
    const iconSlotWidth = 36;
    const coinTextWidth = Math.max(48, coinText.length * 15);
    const totalWidth = prefixWidth + iconSlotWidth + coinTextWidth;
    const row = new Node('RewardRow');
    parent.addChild(row);
    row.setPosition(0, y);
    row.addComponent(UITransform).setContentSize(totalWidth, 40);

    let cursor = -totalWidth / 2;
    const place = (width: number, render: (x: number) => void) => {
      render(cursor + width / 2);
      cursor += width;
    };

    place(prefixWidth, x => {
      const label = this.label(row, '本次奖励：金币', x, 0, fontSize, color);
      label.isBold = true;
    });
    place(coinTextWidth, x => {
      const label = this.label(row, coinText, x, 0, fontSize, color);
      label.isBold = true;
    });
    place(iconSlotWidth, x => this.image(row, 'CoinIcon', this.frames.coinIcon, x, 0, 30, 30));
  }

  /** 评价/奖励行的浅粉胶囊底 */
  private buildRowPill(parent: Node, y: number) {
    const node = new Node('RowPill');
    parent.addChild(node);
    node.setPosition(0, y);
    node.addComponent(UITransform).setContentSize(ROW_PILL_WIDTH, ROW_PILL_HEIGHT);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(247, 216, 209);
    graphics.roundRect(-ROW_PILL_WIDTH / 2, -ROW_PILL_HEIGHT / 2, ROW_PILL_WIDTH, ROW_PILL_HEIGHT, ROW_PILL_HEIGHT / 2);
    graphics.fill();
  }

  /** 失败信息卡：浅粉圆角卡 + 红色工具箱图标 + 标题与提示（按设计稿定位，整体上移 5px） */
  private buildFailCard(parent: Node, y: number) {
    const node = new Node('FailCard');
    parent.addChild(node);
    node.setPosition(0, y + 5);
    node.addComponent(UITransform).setContentSize(CARD_WIDTH, CARD_HEIGHT);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(247, 216, 209);
    graphics.roundRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 26);
    graphics.fill();

    const iconSize = 88;
    this.image(node, 'Toolbox', this.frames.toolbox, -CARD_WIDTH / 2 + 24 + iconSize / 2, 0, iconSize, iconSize);

    const textLeft = -CARD_WIDTH / 2 + 24 + iconSize + 22;
    const titleText = this.options.hadTrayPair ? '就差一对' : '收集槽位已满';
    const titleWidth = this.textWidth(titleText, 30);
    const title = this.label(node, titleText, textLeft + titleWidth / 2, 20, 30, new Color(233, 64, 57));
    title.isBold = true;
    const messageText = this.options.hadTrayPair
      ? '看广告清出这对，下一手就能消'
      : '再挑战一次，完成本关目标吧!';
    const messageWidth = this.textWidth(messageText, 22);
    const message = this.label(node, messageText, textLeft + messageWidth / 2, -20, 22, new Color(121, 83, 59));
    message.isBold = true;
  }

  /** 建设目标行（小节点机制）：星够时整行可点，轻触直达小镇点亮下一格 */
  private buildBuildTargetRow(parent: Node, y: number) {
    const target = this.options.buildTarget!;
    const canBuild = !!target.canBuild && !!this.options.onGoBuild;
    const node = new Node('BuildTargetRow');
    parent.addChild(node);
    node.setPosition(0, y);
    // 视觉胶囊 56 高，热区按规范补足到 88
    node.addComponent(UITransform).setContentSize(560, 88);

    const pill = new Node('BuildTargetPill');
    node.addChild(pill);
    pill.addComponent(UITransform).setContentSize(500, 56);
    const graphics = pill.addComponent(Graphics);
    graphics.fillColor = canBuild ? new Color(255, 246, 222) : new Color(247, 240, 228, 220);
    graphics.strokeColor = canBuild ? new Color(247, 210, 148) : new Color(233, 223, 205);
    graphics.lineWidth = 3;
    graphics.roundRect(-250, -28, 500, 56, 28);
    graphics.fill();
    graphics.stroke();

    const text = canBuild ? `${target.text}，点击前往 ▸` : target.text;
    const label = this.label(pill, text, 0, 0, 20, canBuild ? new Color(234, 111, 20) : new Color(121, 83, 59));
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(472, 30);

    if (canBuild) {
      const button = node.addComponent(Button);
      button.transition = Button.Transition.SCALE;
      button.zoomScale = 0.96;
      button.node.on(Button.EventType.CLICK, () => this.options.onGoBuild!());
    }
  }

  /** 次操作：两条独立的浅粉胶囊按钮并排 */
  private buildActionButtons(parent: Node, y: number, mode: PopupMode) {
    const leftText = mode === 'fail'
      ? '再玩一次'
      : mode === 'endless' ? '再玩一局' : mode === 'challenge' ? '再挑战一次' : this.options.nextButtonLabel ?? '下一关';
    const leftClick = (mode === 'fail' || mode === 'endless' || mode === 'challenge')
      ? this.options.onReplay
      : this.options.onNextLevel;
    const offset = (CAPSULE_WIDTH + CAPSULE_GAP) / 2;
    this.createActionButton(parent, leftText, 'green', -offset, y, leftClick);
    this.createActionButton(parent, this.options.homeButtonLabel ?? '返回首页', 'orange', offset, y, this.options.onReturnHome);
  }

  private createActionButton(
    parent: Node,
    text: string,
    tone: SettlementButtonTone,
    x: number,
    y: number,
    onClick: () => void,
  ) {
    const node = SettlementButton.create(parent, this.assets, {
      text,
      tone,
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
      scale: 1,
      fontSize: 28,
      onClick,
    });
    node.setPosition(x, y);
  }

  private buildEndlessStat(parent: Node, y: number, info: EndlessSettlementInfo) {
    const eliminated = this.label(parent, `${info.eliminated}`, 0, y + 22, 52, new Color(234, 111, 20));
    eliminated.isBold = true;
    const caption = this.label(parent, '已消除卡片', 0, y - 22, 22, new Color(112, 69, 40));
    caption.isBold = true;
  }

  private buildEndlessRecord(parent: Node, y: number, info: EndlessSettlementInfo) {
    const text = info.isNewRecord ? '新纪录！' : `历史最佳 ${info.bestEliminated} 张`;
    const record = this.label(
      parent,
      text,
      0,
      y,
      22,
      info.isNewRecord ? new Color(244, 73, 105) : new Color(121, 83, 59),
    );
    record.isBold = true;
  }

  private buildEndlessDurationRow(parent: Node, y: number, info: EndlessSettlementInfo) {
    this.buildRowPill(parent, y);
    const prefix = '坚持时长：';
    const value = this.formatDuration(info.durationMs);
    const prefixWidth = this.textWidth(prefix, 26);
    const valueWidth = this.textWidth(value, 30);
    const gap = 10;
    const startX = -(prefixWidth + gap + valueWidth) / 2;
    const prefixLabel = this.label(parent, prefix, startX + prefixWidth / 2, y, 26, new Color(112, 62, 29));
    prefixLabel.isBold = true;
    const valueLabel = this.label(
      parent,
      value,
      startX + prefixWidth + gap + valueWidth / 2,
      y,
      30,
      new Color(234, 111, 20),
    );
    valueLabel.isBold = true;
  }

  private formatDuration(durationMs: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private createAdButton(
    parent: Node,
    text: string,
    tone: SettlementButtonTone,
    x: number,
    y: number,
    onCompleted: () => void,
    skipAd = false,
  ) {
    const node = SettlementButton.create(parent, this.assets, {
      text,
      tone,
      width: AD_WIDTH,
      height: AD_HEIGHT,
      scale: 1,
      fontSize: 30,
      onClick: skipAd ? () => this.completeWithoutAd(onCompleted) : () => this.watchAd(onCompleted),
    });
    node.setPosition(x, y);
    this.adButton = node.getComponent(Button);
    this.adButtonLabel = node.getChildByName('Label')?.getComponent(Label) || null;
  }

  /** 免费复活（难关助力）：不走激励视频，点击直接发放复活。 */
  private completeWithoutAd(onCompleted: () => void) {
    if (this.adBusy || !this.adButton) return;
    this.adBusy = true;
    this.adButton.interactable = false;
    if (this.adButtonLabel) this.adButtonLabel.string = '已领取';
    onCompleted();
  }

  private async watchAd(onCompleted: () => void) {
    if (this.adBusy || !this.options.onWatchAd || !this.adButton) return;
    this.adBusy = true;
    this.adButton.interactable = false;
    if (this.adButtonLabel) this.adButtonLabel.string = '广告中...';

    let result: RewardedAdResult;
    try {
      result = await this.options.onWatchAd();
    } catch (error) {
      console.error('[CatWorld] Settlement rewarded ad failed', error);
      result = { completed: false, simulated: false };
    }
    if (!this.node.isValid) return;

    if (result.completed) {
      if (this.adButtonLabel) this.adButtonLabel.string = '已领取';
      onCompleted();
      return;
    }

    this.adBusy = false;
    this.adButton.interactable = true;
    if (this.adButtonLabel) {
      this.adButtonLabel.string = this.options.onRevive
        ? '看广告清出一对'
        : '看广告×2金币';
    }
  }

  private buildVictoryFireworks() {
    const effect = new Node('VictoryFireworks');
    this.node.addChild(effect);

    const bursts = [
      { x: -330, y: 210, delay: 0.04, radius: 82 },
      { x: 330, y: 190, delay: 0.2, radius: 88 },
      { x: -332, y: -210, delay: 0.4, radius: 76 },
      { x: 332, y: -196, delay: 0.56, radius: 80 },
    ];
    const colors = [
      new Color(255, 224, 108),
      new Color(244, 73, 105),
      new Color(105, 190, 211),
      new Color(255, 167, 69),
      new Color(142, 211, 118),
    ];

    bursts.forEach((burst, burstIndex) => {
      this.buildFireworkBurst(effect, burst.x, burst.y, burst.radius, burst.delay, colors, burstIndex);
    });
  }

  private buildFireworkBurst(
    parent: Node,
    x: number,
    y: number,
    radius: number,
    delay: number,
    colors: Color[],
    burstIndex: number,
  ) {
    const rayNode = new Node(`FireworkRays_${burstIndex}`);
    this.tweenTargets.add(rayNode);
    parent.addChild(rayNode);
    rayNode.setPosition(x, y);
    rayNode.addComponent(UITransform).setContentSize(radius * 2, radius * 2);
    const rayOpacity = rayNode.addComponent(UIOpacity);
    this.tweenTargets.add(rayOpacity);
    rayOpacity.opacity = 0;
    const rays = rayNode.addComponent(Graphics);
    const rayCount = 12;
    for (let index = 0; index < rayCount; index++) {
      const angle = (Math.PI * 2 * index) / rayCount;
      const length = radius * (0.72 + (index % 3) * 0.11);
      rays.strokeColor = colors[(index + burstIndex) % colors.length];
      rays.lineWidth = 4;
      rays.moveTo(0, 0);
      rays.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
      rays.stroke();
    }
    rayNode.setScale(new Vec3(0.18, 0.18, 1));
    tween(rayNode)
      .delay(delay)
      .to(0.16, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'backOut' })
      .to(0.34, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'sineOut' })
      .call(() => {
        if (rayNode.isValid) rayNode.destroy();
      })
      .start();
    tween(rayOpacity)
      .delay(delay)
      .to(0.08, { opacity: 255 })
      .to(0.42, { opacity: 0 }, { easing: 'quadIn' })
      .start();

    const flash = new Node(`FireworkFlash_${burstIndex}`);
    this.tweenTargets.add(flash);
    parent.addChild(flash);
    flash.setPosition(x, y);
    flash.addComponent(UITransform).setContentSize(40, 40);
    const flashGraphics = flash.addComponent(Graphics);
    flashGraphics.fillColor = colors[burstIndex % colors.length];
    flashGraphics.circle(0, 0, 16);
    flashGraphics.fill();
    const flashOpacity = flash.addComponent(UIOpacity);
    this.tweenTargets.add(flashOpacity);
    flashOpacity.opacity = 0;
    flash.setScale(new Vec3(0.35, 0.35, 1));
    tween(flash)
      .delay(delay)
      .to(0.2, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'quadOut' })
      .start();
    tween(flashOpacity)
      .delay(delay)
      .to(0.04, { opacity: 255 })
      .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
      .call(() => {
        if (flash.isValid) flash.destroy();
      })
      .start();

    for (let index = 0; index < rayCount; index++) {
      const angle = (Math.PI * 2 * index) / rayCount + Math.PI / rayCount;
      const distance = radius * (0.72 + (index % 3) * 0.11);
      const particle = new Node(`FireworkParticle_${burstIndex}_${index}`);
      this.tweenTargets.add(particle);
      parent.addChild(particle);
      particle.setPosition(x, y);
      particle.addComponent(UITransform).setContentSize(18, 18);
      const particleGraphics = particle.addComponent(Graphics);
      particleGraphics.fillColor = colors[(index + burstIndex + 1) % colors.length];
      particleGraphics.circle(0, 0, index % 2 === 0 ? 5 : 4);
      particleGraphics.fill();
      const particleOpacity = particle.addComponent(UIOpacity);
      this.tweenTargets.add(particleOpacity);
      particleOpacity.opacity = 0;
      const motion = { ratio: 0 };
      this.tweenTargets.add(motion);
      tween(motion)
        .delay(delay + 0.04)
        .to(0.52, { ratio: 1 }, {
          easing: 'quadOut',
          onUpdate: () => {
            const ratio = motion.ratio;
            const fade = ratio < 0.12 ? ratio / 0.12 : 1 - (ratio - 0.12) / 0.88;
            const gravity = 34 * ratio * ratio;
            particle.setPosition(
              x + Math.cos(angle) * distance * ratio,
              y + Math.sin(angle) * distance * ratio - gravity,
            );
            particle.setScale(new Vec3(1.1 - ratio * 0.5, 1.1 - ratio * 0.5, 1));
            particleOpacity.opacity = Math.max(0, Math.round(255 * fade));
          },
        })
        .call(() => {
          if (particle.isValid) particle.destroy();
        })
        .start();
    }
  }

  private fitSize(frame: SpriteFrame, boxWidth: number, boxHeight: number) {
    // 动态合图后 frame.width/height 会变成图集尺寸（常见为正方形），
    // 用它算比例会把横向绶带压成一团。按切图像素来。
    const rect = frame.rect;
    const original = frame.originalSize;
    const width = rect.width > 0 ? rect.width : original.width;
    const height = rect.height > 0 ? rect.height : original.height;
    if (width <= 0 || height <= 0) {
      return { width: boxWidth, height: boxHeight };
    }
    const ratio = width / height;
    const boxRatio = boxWidth / boxHeight;
    return ratio > boxRatio
      ? { width: boxWidth, height: Math.round(boxWidth / ratio) }
      : { width: Math.round(boxHeight * ratio), height: boxHeight };
  }

  private image(
    parent: Node,
    name: string,
    frame: SpriteFrame | null | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const node = new Node(name); parent.addChild(node); node.setPosition(x, y);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.trim = false;
      sprite.spriteFrame = frame;
    }
    return node;
  }

  private textWidth(text: string, fontSize: number) {
    let units = 0;
    for (const char of text) units += char.charCodeAt(0) > 0xff ? 1 : 0.6;
    return units * fontSize;
  }

  private label(parent: Node, text: string, x: number, y: number, size: number, color: Color) {
    const node = new Node('Label'); parent.addChild(node); node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = text; label.fontSize = size; label.lineHeight = size + 8;
    label.color = color; label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
  }

  onDestroy() {
    this.tweenTargets.forEach(target => Tween.stopAllByTarget(target));
    this.tweenTargets.clear();
  }
}
