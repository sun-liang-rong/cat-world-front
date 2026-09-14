import {
  BlockInputEvents,
  Button,
  Color,
  Graphics,
  Label,
  Layout,
  Mask,
  Node,
  Sprite,
  SpriteFrame,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
  view,
} from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
import { MomentCategory, MomentSnapshot, MOMENT_DEFINITIONS } from './MomentContent';
import { AudioEffect } from './AudioManager';
import { Toast } from './Toast';

export interface MomentScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getMoments: () => MomentSnapshot[];
  onReturnHome: () => void;
}

type MomentCardView = {
  item: Node;
  card: Node;
  photoSprite: Sprite | null;
  thumbnailMask: Mask | null;
  ring: Node | null;
  badgeSprout: Node;
  badgeFlower: Node;
  barSprite: Sprite | null;
  barLabel: Label;
  descLabel: Label;
  hintLabel: Label;
};

type CategoryTab = {
  id: MomentCategory;
  node: Node;
};

const CATEGORY_TABS: Array<{ id: MomentCategory; offPath: string; onPath: string }> = [
  { id: 'all', offPath: 'moment/moment_tab_all_off', onPath: 'moment/moment_tab_all_on' },
  { id: 'town', offPath: 'moment/moment_tab_town', onPath: 'moment/moment_tab_town_on' },
  { id: 'cats', offPath: 'moment/moment_tab_cats', onPath: 'moment/moment_tab_cats_on' },
  { id: 'levels', offPath: 'moment/moment_tab_levels', onPath: 'moment/moment_tab_levels_on' },
];

const MOMENT_ASSETS = [
  'adventure/adventure_bg',
  'moment/moment_title',
  COMMON_UI_ASSETS.backButton,
  'moment/moment_progress',
  'moment/moment_tab_all_off',
  'moment/moment_tab_all_on',
  'moment/moment_tab_town',
  'moment/moment_tab_town_on',
  'moment/moment_tab_cats',
  'moment/moment_tab_cats_on',
  'moment/moment_tab_levels',
  'moment/moment_tab_levels_on',
  'moment/moment_card',
  'moment/moment_badge_sprout',
  'moment/moment_badge_flower',
  'moment/moment_photo_cats',
  'moment/moment_photo_locked',
  'moment/moment_photo_bench',
  'moment/moment_arrow_card',
  'moment/moment_arrow_prev',
  'moment/moment_arrow_next',
  'moment/moment_bar_tan',
  'moment/moment_bar_green',
  'moment/moment_bar_purple',
  'moment/moment_dot_on',
  'moment/moment_dot_off',
];

const COLORS = {
  title: new Color(111, 62, 28),
  body: new Color(112, 69, 40),
  muted: new Color(140, 116, 88),
  barTextLocked: new Color(255, 250, 235),
  ring: new Color(226, 188, 96),
  shelf: new Color(219, 172, 112),
  shelfDark: new Color(178, 128, 76),
  trackEmpty: new Color(240, 221, 186),
  trackFill: new Color(190, 154, 90),
  photoBacking: new Color(255, 243, 210),
  outline: new Color(90, 61, 38),
  shadow: new Color(92, 54, 22, 80),
};

const CATEGORY_NAMES: Record<Exclude<MomentCategory, 'all'>, string> = {
  town: '小镇',
  cats: '猫咪',
  levels: '关卡',
};

const CATEGORY_COLORS: Record<Exclude<MomentCategory, 'all'>, Color> = {
  town: new Color(135, 140, 70),
  cats: new Color(149, 125, 152),
  levels: new Color(242, 167, 112),
};

const MIN_PAGE_SIZE = 4;
const MAX_PAGE_SIZE = 5;
const MIN_CARD_GAP = 8;
const CARD_WIDTH = 656;
const CARD_HEIGHT = 180;
const TAB_OFFSET = 270;
const PHOTO_SIZE = 164;
const PHOTO_MASK_RADIUS = 76;
const PHOTO_RING_RADIUS = 82;
const PHOTO_X = -CARD_WIDTH / 2 + 20 + PHOTO_SIZE / 2;
const TEXT_X = -CARD_WIDTH / 2 + 20 + PHOTO_SIZE + 42;
const TEXT_WIDTH = 300;
const TAB_WIDTH = 132;
const TAB_HEIGHT = 57;
const TAB_STEP = 142;
const PAGE_ARROW_Y_OFFSET = 180;
const ARROW_SIZE = 88;
const DOT_SIZE = 22;
const DOT_GAP = 12;
// 爪印进度条素材 314×105 内的轨道区域（x97-281 / y35-68）换算到 172×57 显示尺寸
const TRACK = { x: -33, y: -9.5, width: 101, height: 18, radius: 9 };
// 这三张圆形照片素材自带手绘描边环，直接整图显示，不套遮罩和自绘环
const RINGED_PHOTO_PATHS = [
  'moment/moment_photo_cats',
  'moment/moment_photo_bench',
  'moment/moment_photo_locked',
];

export class MomentScreen {
  private momentUI: Node | null = null;
  private detailUI: Node | null = null;
  private detailPanel: Node | null = null;
  private detailImage: Node | null = null;
  private detailMask: Mask | null = null;
  private detailRing: Node | null = null;
  private detailPill: Node | null = null;
  private detailTitle: Label | null = null;
  private detailMeta: Label | null = null;
  private detailDescription: Label | null = null;
  private detailHint: Label | null = null;
  private progressFill: Graphics | null = null;
  private progressLabel: Label | null = null;
  private dotsContainer: Node | null = null;
  private prevControl: Node | null = null;
  private nextControl: Node | null = null;
  private prevButton: Button | null = null;
  private nextButton: Button | null = null;
  private listLayout: Layout | null = null;
  private readonly cardViews: MomentCardView[] = [];
  private readonly tabViews: CategoryTab[] = [];
  private active = false;
  private category: MomentCategory = 'all';
  private pageStart = 0;
  private pageSize = MIN_PAGE_SIZE;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: MomentScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    const paths = Array.from(new Set([
      ...MOMENT_ASSETS,
      ...MOMENT_DEFINITIONS.map(moment => moment.imagePath),
    ]));
    this.assets.loadImagesFor(this, paths, () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.momentUI) return;
    this.momentUI.active = active;
    if (!active && this.detailUI) this.detailUI.active = false;
    if (active) this.refresh();
  }

  destroy() {
    this.cardViews.length = 0;
    this.tabViews.length = 0;
    this.momentUI?.destroy();
    this.momentUI = null;
    this.detailUI = null;
    this.detailPanel = null;
    this.detailImage = null;
    this.detailMask = null;
    this.detailRing = null;
    this.detailPill = null;
    this.dotsContainer = null;
    this.progressFill = null;
    this.progressLabel = null;
    this.prevControl = null;
    this.nextControl = null;
    this.prevButton = null;
    this.nextButton = null;
    this.listLayout = null;
  }

  private create() {
    if (this.momentUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -top;

    this.momentUI = new Node('MomentUI');
    this.root.addChild(this.momentUI);
    this.momentUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.momentUI.active = this.active;

    this.buildBackground(visibleSize);
    this.buildHeader(top);
    this.buildTabs(top);
    this.buildCards(top, bottom);
    this.buildPageControls(bottom);
    this.buildDetailOverlay(visibleSize);
    this.refresh();
  }

  private buildBackground(visibleSize: { width: number; height: number }) {
    // 背景按 cover 方式铺满：等比放大裁掉两侧，避免拉伸变形
    const scale = Math.max(visibleSize.width / 1024, visibleSize.height / 1536);
    this.image(this.momentUI!, 'adventure/adventure_bg', 0, 0, 1024 * scale, 1536 * scale);
  }

  private buildHeader(top: number) {
    const rowY = top - 136;
    const back = new Node('MomentBackButton');
    this.momentUI!.addChild(back);
    back.setPosition(-288, rowY);
    back.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(back, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    this.addTapFeedback(back, this.options.onReturnHome);

    const plate = this.image(this.momentUI!, 'moment/moment_title', -30, top - 108, 320, 107);
    const title = this.label(plate, '瞬间', 0, -2, 40, COLORS.title);
    title.isBold = true;

    const progress = this.image(this.momentUI!, 'moment/moment_progress', 258, belowWeChatCapsule(top, 57), 172, 57);
    const fillNode = new Node('MomentProgressFill');
    progress.addChild(fillNode);
    this.progressFill = fillNode.addComponent(Graphics);
    this.progressLabel = this.label(progress, '', TRACK.x + TRACK.width / 2, -1, 15, Color.WHITE);
    this.progressLabel.isBold = true;
    this.progressLabel.outlineWidth = 3;
    this.progressLabel.outlineColor = COLORS.outline;
  }

  private buildTabs(top: number) {
    const y = top - TAB_OFFSET;
    this.buildShelf(y - 34);
    CATEGORY_TABS.forEach((tab, index) => {
      const node = this.image(this.momentUI!, tab.offPath, -213 + index * TAB_STEP, y, TAB_WIDTH, TAB_HEIGHT);
      this.addTapFeedback(node, () => {
        if (this.category === tab.id) return;
        this.category = tab.id;
        this.pageStart = 0;
        this.refreshTabs();
        this.refresh();
      });
      this.tabViews.push({ id: tab.id, node });
    });
    this.refreshTabs();
  }

  private buildShelf(y: number) {
    const node = new Node('MomentTabShelf');
    this.momentUI!.addChild(node);
    node.setPosition(0, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = COLORS.shelf;
    graphics.strokeColor = COLORS.shelfDark;
    graphics.lineWidth = 2;
    graphics.roundRect(-300, -9, 600, 18, 9);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = COLORS.shelfDark;
    graphics.roundRect(-292, -9, 584, 5, 2.5);
    graphics.fill();
  }

  private listBounds(top: number, bottom: number) {
    const tabBottom = top - TAB_OFFSET - TAB_HEIGHT / 2;
    const controlsTop = bottom + PAGE_ARROW_Y_OFFSET + ARROW_SIZE / 2;
    const listTop = tabBottom - 16;
    const listBottom = controlsTop + 16;
    const height = Math.max(CARD_HEIGHT, listTop - listBottom);
    return { listTop, height };
  }

  private pageSizeForHeight(height: number) {
    const needed = MAX_PAGE_SIZE * CARD_HEIGHT + (MAX_PAGE_SIZE - 1) * MIN_CARD_GAP;
    return height >= needed ? MAX_PAGE_SIZE : MIN_PAGE_SIZE;
  }

  private cardGap(height: number, pageSize: number) {
    if (pageSize <= 1) return MIN_CARD_GAP;
    return Math.max(MIN_CARD_GAP, (height - pageSize * CARD_HEIGHT) / (pageSize - 1));
  }

  private buildCards(top: number, bottom: number) {
    const { listTop, height } = this.listBounds(top, bottom);
    this.pageSize = this.pageSizeForHeight(height);
    const gap = this.cardGap(height, this.pageSize);

    const list = new Node('MomentCardList');
    this.momentUI!.addChild(list);
    list.setPosition(0, listTop - height / 2);
    list.addComponent(UITransform).setContentSize(CARD_WIDTH, height);
    const layout = list.addComponent(Layout);
    layout.type = Layout.Type.VERTICAL;
    layout.resizeMode = Layout.ResizeMode.NONE;
    layout.verticalDirection = Layout.VerticalDirection.TOP_TO_BOTTOM;
    layout.alignVertical = true;
    layout.spacingY = gap;
    layout.paddingTop = 0;
    layout.paddingBottom = 0;
    layout.affectedByScale = false;
    this.listLayout = layout;

    for (let index = 0; index < MAX_PAGE_SIZE; index++) {
      this.cardViews.push(this.buildCard(list, index));
    }
    layout.updateLayout();
  }

  private buildCard(parent: Node, index: number): MomentCardView {
    const item = new Node(`MomentCardItem${index}`);
    parent.addChild(item);
    item.addComponent(UITransform).setContentSize(CARD_WIDTH, CARD_HEIGHT);

    this.drawShadow(item, 0, -CARD_HEIGHT / 2 - 6, 520, 28);
    const card = this.image(item, 'moment/moment_card', 0, 0, CARD_WIDTH, CARD_HEIGHT);

    const thumbnail = new Node('MomentThumbnail');
    card.addChild(thumbnail);
    thumbnail.setPosition(PHOTO_X, 0);
    thumbnail.addComponent(UITransform).setContentSize(PHOTO_MASK_RADIUS * 2, PHOTO_MASK_RADIUS * 2);
    const mask = thumbnail.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_ELLIPSE;
    mask.segments = 64;
    const backing = new Node('MomentPhotoBacking');
    thumbnail.addChild(backing);
    const backingGraphics = backing.addComponent(Graphics);
    backingGraphics.fillColor = COLORS.photoBacking;
    backingGraphics.circle(0, 0, PHOTO_MASK_RADIUS - 2);
    backingGraphics.fill();
    const photo = this.image(thumbnail, 'home/home_bg', 0, 0, PHOTO_SIZE, PHOTO_SIZE);

    const ring = new Node('MomentPhotoRing');
    card.addChild(ring);
    ring.setPosition(PHOTO_X, 0);
    const ringGraphics = ring.addComponent(Graphics);
    ringGraphics.lineWidth = 6;
    ringGraphics.strokeColor = COLORS.ring;
    ringGraphics.circle(0, 0, PHOTO_RING_RADIUS);
    ringGraphics.stroke();

    const badgeSprout = this.simpleSprite(card, 'moment/moment_badge_sprout', PHOTO_X - 60, 52, 48);
    const badgeFlower = this.simpleSprite(card, 'moment/moment_badge_flower', PHOTO_X - 60, 52, 48);

    const bar = this.simpleSprite(card, 'moment/moment_bar_green', TEXT_X + 112, 50, 0);
    bar.getComponent(UITransform)!.setContentSize(224, 34);
    const barLabel = this.leftLabel(bar, '', -96, 0, 20, Color.WHITE, 192);
    barLabel.isBold = true;

    const descLabel = this.leftLabel(card, '', TEXT_X, -4, 17, COLORS.body, TEXT_WIDTH);
    descLabel.node.getComponent(UITransform)!.setContentSize(TEXT_WIDTH, 48);
    descLabel.lineHeight = 24;

    const hintLabel = this.leftLabel(card, '', TEXT_X, -64, 16, COLORS.muted, TEXT_WIDTH);
    hintLabel.isBold = true;

    this.simpleSprite(card, 'moment/moment_arrow_card', CARD_WIDTH / 2 - 62, 0, 84);

    this.addTapFeedback(card, () => {
      const moment = this.filteredMoments()[this.pageStart + index];
      if (!moment) return;
      if (!moment.unlocked) {
        this.toast(moment.unlockHint);
        return;
      }
      this.openDetail(moment);
    });

    return {
      item,
      card,
      photoSprite: photo.getComponent(Sprite),
      thumbnailMask: mask,
      ring,
      badgeSprout,
      badgeFlower,
      barSprite: bar.getComponent(Sprite),
      barLabel,
      descLabel,
      hintLabel,
    };
  }

  private buildPageControls(bottom: number) {
    // 锚定屏幕底部（含 Home 条安全区），高分屏下不悬空
    const y = bottom + PAGE_ARROW_Y_OFFSET;
    this.prevControl = this.pageArrow('moment/moment_arrow_prev', -118, y, () => {
      if (this.pageStart <= 0) return;
      this.pageStart = Math.max(0, this.pageStart - this.pageSize);
      this.refresh();
    });
    this.prevButton = this.prevControl.getComponent(Button);
    this.nextControl = this.pageArrow('moment/moment_arrow_next', 118, y, () => {
      const count = this.filteredMoments().length;
      if (this.pageStart + this.pageSize >= count) return;
      this.pageStart += this.pageSize;
      this.refresh();
    });
    this.nextButton = this.nextControl.getComponent(Button);
    this.dotsContainer = new Node('MomentPageDots');
    this.momentUI!.addChild(this.dotsContainer);
    this.dotsContainer.setPosition(0, y);
  }

  private pageArrow(path: string, x: number, y: number, onTap: () => void) {
    const node = this.image(this.momentUI!, path, x, y, ARROW_SIZE, ARROW_SIZE);
    this.addTapFeedback(node, onTap);
    return node;
  }

  private buildDetailOverlay(visibleSize: { width: number; height: number }) {
    const overlay = new Node('MomentDetailOverlay');
    this.momentUI!.addChild(overlay);
    overlay.active = false;
    this.detailUI = overlay;

    const backdrop = new Node('MomentDetailBackdrop');
    overlay.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const backdropGraphics = backdrop.addComponent(Graphics);
    backdropGraphics.fillColor = new Color(22, 18, 13, 190);
    backdropGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    backdropGraphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.closeDetail());

    const panel = this.roundedShape(
      overlay,
      'MomentDetailPanel',
      0,
      12,
      610,
      700,
      32,
      new Color(255, 248, 226, 250),
      new Color(205, 165, 102),
      4,
    );
    this.detailPanel = panel;
    this.addInnerBorder(panel, 610, 700);

    const close = new Node('MomentDetailClose');
    panel.addChild(close);
    close.setPosition(250, 302);
    close.addComponent(UITransform).setContentSize(88, 88);
    const closeGraphics = close.addComponent(Graphics);
    closeGraphics.fillColor = new Color(244, 103, 92);
    closeGraphics.strokeColor = Color.WHITE;
    closeGraphics.lineWidth = 3;
    closeGraphics.circle(0, 0, 34);
    closeGraphics.fill();
    closeGraphics.stroke();
    closeGraphics.lineWidth = 6;
    closeGraphics.moveTo(-12, -12);
    closeGraphics.lineTo(12, 12);
    closeGraphics.moveTo(12, -12);
    closeGraphics.lineTo(-12, 12);
    closeGraphics.stroke();
    this.addTapFeedback(close, () => this.closeDetail());

    const photo = new Node('MomentDetailPhoto');
    panel.addChild(photo);
    photo.setPosition(0, 148);
    photo.addComponent(UITransform).setContentSize(252, 252);
    const photoMask = photo.addComponent(Mask);
    photoMask.type = Mask.Type.GRAPHICS_ELLIPSE;
    photoMask.segments = 64;
    const photoBacking = new Node('MomentPhotoBacking');
    photo.addChild(photoBacking);
    const photoBackingGraphics = photoBacking.addComponent(Graphics);
    photoBackingGraphics.fillColor = COLORS.photoBacking;
    photoBackingGraphics.circle(0, 0, 124);
    photoBackingGraphics.fill();
    this.detailImage = this.image(photo, 'home/home_bg', 0, 0, 272, 272);
    this.detailMask = photoMask;
    this.detailRing = this.drawPhotoFrame(panel, 0, 148);

    this.detailPill = this.buildCategoryPill(panel, 0, -60, 120, 36, 18);
    this.detailTitle = this.label(panel, '', 0, -106, 36, COLORS.title);
    this.detailTitle.isBold = true;
    this.detailMeta = this.label(panel, '', 0, -146, 18, COLORS.muted);
    this.detailMeta.isBold = true;
    this.detailDescription = this.label(panel, '', 0, -196, 22, COLORS.body);
    this.detailDescription.node.getComponent(UITransform)!.setContentSize(510, 64);
    this.detailDescription.lineHeight = 30;
    this.detailDescription.overflow = Label.Overflow.CLAMP;
    this.detailHint = this.label(panel, '这段回忆会一直留在小镇里', 0, -266, 17, COLORS.muted);
    this.detailHint.isBold = true;
  }

  private isRingedFrame(frame: SpriteFrame | undefined) {
    if (!frame) return false;
    return RINGED_PHOTO_PATHS.some(path => this.assets.getFrame(path) === frame);
  }

  private refresh() {
    if (!this.momentUI) return;
    const moments = this.filteredMoments();
    const total = moments.length;
    const pageSize = this.pageSize;
    const maxStart = Math.max(0, Math.floor(Math.max(0, total - 1) / pageSize) * pageSize);
    this.pageStart = Math.min(this.pageStart, maxStart);

    const allMoments = this.options.getMoments();
    const allUnlocked = allMoments.filter(moment => moment.unlocked).length;
    this.refreshProgress(allUnlocked, allMoments.length);
    this.refreshDots(Math.max(1, Math.ceil(total / pageSize)), Math.floor(this.pageStart / pageSize));
    this.updateControlState(this.prevControl, this.prevButton, this.pageStart > 0);
    this.updateControlState(this.nextControl, this.nextButton, this.pageStart + pageSize < total);

    this.cardViews.forEach((viewData, index) => {
      const moment = index < pageSize ? moments[this.pageStart + index] : undefined;
      viewData.item.active = !!moment;
      viewData.card.active = !!moment;
      if (!moment) return;
      const frame = moment.unlocked
        ? this.assets.getFrame(moment.imagePath) || this.assets.getFrame('moment/moment_photo_locked')
        : this.assets.getFrame('moment/moment_photo_locked');
      if (frame && viewData.photoSprite) viewData.photoSprite.spriteFrame = frame;
      // 自带描边环的照片整图显示；普通照片用遮罩裁圆并叠加自绘金环
      const ringed = this.isRingedFrame(frame);
      if (viewData.thumbnailMask) viewData.thumbnailMask.enabled = !!frame && !ringed;
      if (viewData.ring) viewData.ring.active = !!frame && !ringed;
      viewData.badgeSprout.active = moment.unlocked && index % 2 === 0;
      viewData.badgeFlower.active = moment.unlocked && index % 2 === 1;
      const barFrame = this.assets.getFrame(
        moment.unlocked ? (index % 2 === 0 ? 'moment/moment_bar_green' : 'moment/moment_bar_purple') : 'moment/moment_bar_tan',
      );
      if (barFrame && viewData.barSprite) viewData.barSprite.spriteFrame = barFrame;
      viewData.barLabel.string = moment.unlocked ? moment.title : '尚未解锁';
      viewData.barLabel.color = moment.unlocked ? Color.WHITE : COLORS.barTextLocked;
      viewData.descLabel.string = moment.unlocked ? moment.description : moment.unlockHint;
      viewData.descLabel.color = moment.unlocked ? COLORS.body : COLORS.muted;
      viewData.hintLabel.string = moment.unlocked
        ? `${moment.dateLabel} · ${CATEGORY_NAMES[moment.category]}记忆`
        : '解锁后可查看照片';
      viewData.card.setScale(new Vec3(0.92, 0.92, 1));
      if (this.active) {
        tween(viewData.card)
          .delay(index * 0.05)
          .to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      } else {
        viewData.card.setScale(new Vec3(1, 1, 1));
      }
    });
    this.listLayout?.updateLayout();
  }

  private refreshProgress(unlocked: number, total: number) {
    if (this.progressFill) {
      const graphics = this.progressFill;
      graphics.clear();
      graphics.fillColor = COLORS.trackEmpty;
      graphics.roundRect(TRACK.x, TRACK.y, TRACK.width, TRACK.height, TRACK.radius);
      graphics.fill();
      const ratio = total > 0 ? unlocked / total : 0;
      if (ratio > 0) {
        const fillWidth = Math.max(TRACK.radius * 2, (TRACK.width - 4) * ratio);
        graphics.fillColor = COLORS.trackFill;
        graphics.roundRect(TRACK.x + 2, TRACK.y + 2, fillWidth, TRACK.height - 4, TRACK.radius - 2);
        graphics.fill();
      }
    }
    if (this.progressLabel) this.progressLabel.string = `${unlocked}/${total}`;
  }

  private refreshDots(pageCount: number, activeIndex: number) {
    if (!this.dotsContainer) return;
    this.dotsContainer.destroyAllChildren();
    const onFrame = this.assets.getFrame('moment/moment_dot_on');
    const offFrame = this.assets.getFrame('moment/moment_dot_off');
    for (let i = 0; i < pageCount; i++) {
      const dot = this.simpleSprite(this.dotsContainer, '', (i - (pageCount - 1) / 2) * (DOT_SIZE + DOT_GAP), 0, DOT_SIZE);
      const sprite = dot.getComponent(Sprite);
      const frame = i === activeIndex ? onFrame : offFrame;
      if (sprite && frame) sprite.spriteFrame = frame;
    }
  }

  private filteredMoments() {
    const moments = this.options.getMoments();
    const filtered = this.category === 'all'
      ? moments.slice()
      : moments.filter(moment => moment.category === this.category);

    // 解锁项优先展示；同一状态保留原定义顺序，避免翻页时内容跳动。
    return filtered
      .map((moment, index) => ({ moment, index }))
      .sort((left, right) => Number(right.moment.unlocked) - Number(left.moment.unlocked) || left.index - right.index)
      .map(item => item.moment);
  }

  private refreshTabs() {
    this.tabViews.forEach(tab => {
      const definition = CATEGORY_TABS.find(item => item.id === tab.id);
      const sprite = tab.node.getComponent(Sprite);
      if (!definition || !sprite) return;
      const frame = this.assets.getFrame(tab.id === this.category ? definition.onPath : definition.offPath);
      if (frame) sprite.spriteFrame = frame;
    });
  }

  private openDetail(moment: MomentSnapshot) {
    if (!this.detailUI || !this.detailPanel || !this.detailPill) return;
    this.detailUI.active = true;
    const frame = this.assets.getFrame(moment.imagePath);
    const sprite = this.detailImage?.getComponent(Sprite);
    if (frame && sprite) sprite.spriteFrame = frame;
    const ringed = this.isRingedFrame(frame);
    if (this.detailMask) this.detailMask.enabled = !!frame && !ringed;
    if (this.detailRing) this.detailRing.active = !!frame && !ringed;
    this.refreshCategoryPill(this.detailPill, moment.category, true);
    if (this.detailTitle) this.detailTitle.string = moment.title;
    if (this.detailMeta) {
      this.detailMeta.string = `${moment.dateLabel} · ${CATEGORY_NAMES[moment.category]}记忆`;
    }
    if (this.detailDescription) this.detailDescription.string = moment.description;
    this.detailPanel.setScale(new Vec3(0.9, 0.9, 1));
    const opacity = this.detailPanel.getComponent(UIOpacity) || this.detailPanel.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(this.detailPanel).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    tween(opacity).to(0.2, { opacity: 255 }).start();
  }

  private closeDetail() {
    if (this.detailUI) this.detailUI.active = false;
  }

  private updateControlState(node: Node | null, button: Button | null, enabled: boolean) {
    if (!node || !button) return;
    button.interactable = enabled;
    const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    opacity.opacity = enabled ? 255 : 140;
  }

  private buildCategoryPill(parent: Node, x: number, y: number, width: number, height: number, fontSize: number) {
    const node = new Node('MomentCategoryPill');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    node.addComponent(Graphics);
    const label = this.label(node, '', 0, -1, fontSize, Color.WHITE);
    label.isBold = true;
    return node;
  }

  private refreshCategoryPill(node: Node, category: Exclude<MomentCategory, 'all'>, unlocked: boolean) {
    const graphics = node.getComponent(Graphics);
    const transform = node.getComponent(UITransform);
    const label = node.children.find(child => child.name === 'Label')?.getComponent(Label);
    if (!graphics || !transform || !label) return;
    const { width, height } = transform.contentSize;
    const color = CATEGORY_COLORS[category];
    graphics.clear();
    graphics.fillColor = unlocked ? color : new Color(220, 211, 188, 235);
    graphics.strokeColor = unlocked
      ? new Color(Math.max(0, color.r - 26), Math.max(0, color.g - 26), Math.max(0, color.b - 26), 235)
      : new Color(235, 205, 158);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
    label.string = CATEGORY_NAMES[category];
    label.color = unlocked ? Color.WHITE : COLORS.muted;
  }

  private drawPhotoFrame(parent: Node, x: number, y: number) {
    const node = new Node('MomentDetailPhotoFrame');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(280, 280);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = 6;
    graphics.strokeColor = COLORS.ring;
    graphics.circle(0, 0, 132);
    graphics.stroke();
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(255, 252, 239, 245);
    graphics.circle(0, 0, 126);
    graphics.stroke();
    return node;
  }

  private drawShadow(parent: Node, x: number, y: number, width: number, height: number) {
    const node = new Node('MomentCardShadow');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = COLORS.shadow;
    graphics.ellipse(0, 0, width / 2, height / 2);
    graphics.fill();
  }

  private addInnerBorder(parent: Node, width: number, height: number) {
    const node = new Node('InnerBorder');
    parent.addChild(node);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(245, 223, 181, 190);
    graphics.roundRect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24, 18);
    graphics.stroke();
  }

  private roundedShape(
    parent: Node,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: Color,
    stroke: Color,
    lineWidth = 3,
  ) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.lineWidth = lineWidth;
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
    return node;
  }

  private simpleSprite(parent: Node, path: string, x: number, y: number, size: number) {
    return this.image(parent, path, x, y, size, size);
  }

  private image(parent: Node, path: string, x: number, y: number, width: number, height: number) {
    const node = new Node(path ? path.replace(/\//g, '_') : 'Sprite');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = this.assets.getFrame(path);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    if (frame) {
      sprite.spriteFrame = frame;
    } else if (path) {
      console.error(`[CatWorld] Missing sprite frame: ${path}`);
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
    return label;
  }

  private leftLabel(parent: Node, text: string, leftX: number, y: number, size: number, color: Color, boxWidth: number) {
    const node = new Node('Label');
    parent.addChild(node);
    node.setPosition(leftX + boxWidth / 2, y);
    node.addComponent(UITransform).setContentSize(boxWidth, size + 8);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 8;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.overflow = Label.Overflow.CLAMP;
    return label;
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

  private toast(text: string) {
    if (!this.momentUI) return;
    Toast.show(this.momentUI, text);
  }
}
