import {
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
import { CAT_DEFINITIONS } from './GameContent';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { Toast } from './Toast';
import { CatId, CatProgress } from './PlayerTypes';

export interface CatCollectionScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getCats: () => Record<CatId, CatProgress>;
  getEquippedCat: () => CatId | null;
  onOpenCat: (id: CatId) => void;
  onReturnHome: () => void;
}

type CatCardView = {
  card: Node;
  definition: typeof CAT_DEFINITIONS[number];
  portrait: Node;
  name: Label;
  rarity: Label;
  level: Label;
  status: Label;
  detail: Label;
};

const CAT_SHE_PORTRAITS: Record<CatId, string> = {
  orange: 'cat_she/cat_orange',
  white: 'cat_she/cat_white',
  black: 'cat_she/cat_black',
  ragdoll: 'cat_she/cat_ragdoll',
  aurora: 'cat_she/cat_aurora',
};

const CAT_SHE_PAWS = [
  'cat_she/paw_green',
  'cat_she/paw_gold',
  'cat_she/paw_purple',
  'cat_she/paw_blue',
  'cat_she/paw_rainbow',
];

type RarityStyle = { fill: Color; stroke: Color; text: Color };

const RARITY_STYLES: Record<string, RarityStyle> = {
  '新手猫咪': {
    fill: new Color(243, 250, 219),
    stroke: new Color(153, 190, 86),
    text: new Color(78, 139, 50),
  },
  '普通': {
    fill: new Color(255, 246, 216),
    stroke: new Color(226, 176, 95),
    text: new Color(177, 106, 43),
  },
  '稀有': {
    fill: new Color(255, 241, 205),
    stroke: new Color(239, 180, 67),
    text: new Color(226, 132, 24),
  },
  '传说': {
    fill: new Color(246, 238, 255),
    stroke: new Color(183, 140, 235),
    text: new Color(138, 84, 196),
  },
};

const COLORS = {
  title: new Color(111, 62, 28),
  body: new Color(112, 69, 40),
  muted: new Color(112, 96, 77),
  green: new Color(78, 139, 50),
  orange: new Color(234, 117, 21),
  cream: new Color(255, 248, 226, 248),
  border: new Color(235, 205, 158),
  gold: new Color(239, 180, 67),
  spotlight: new Color(255, 243, 211),
};

export class CatCollectionScreen {
  private collectionUI: Node | null = null;
  private toastY = 0;
  private countLabel: Label | null = null;
  private countNumberLabel: Label | null = null;
  private readonly cardViews: CatCardView[] = [];
  private readonly sparkleNodes: Node[] = [];
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: CatCollectionScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImages([
      'home/home_bg',
      COMMON_UI_ASSETS.backButton,
      'cat_she/title_logo',
      'cat_she/cat_locked',
      'cat_she/sparkle_small',
      'cat_she/sparkle_large',
      'cat_she/progress_panel',
      'cat_she/footer_banner',
      ...Object.keys(CAT_SHE_PORTRAITS).map(id => CAT_SHE_PORTRAITS[id as CatId]),
      ...CAT_SHE_PAWS,
    ], () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.collectionUI) return;
    this.collectionUI.active = active;
    if (active) this.refresh();
  }

  destroy() {
    this.sparkleNodes.forEach(sparkle => Tween.stopAllByTarget(sparkle));
    this.sparkleNodes.length = 0;
    this.cardViews.forEach(viewData => Tween.stopAllByTarget(viewData.card));
    this.cardViews.length = 0;
    this.collectionUI?.destroy();
    this.collectionUI = null;
  }

  private create() {
    if (this.collectionUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -top;

    this.collectionUI = new Node('CatCollectionUI');
    this.root.addChild(this.collectionUI);
    this.collectionUI.active = this.active;

    this.image(this.collectionUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);
    this.buildCards(top);
    this.buildFooter(bottom);
    this.toastY = bottom + 150;
    this.refresh();
  }

  private buildHeader(top: number) {
    const y = top - 150;
    this.buildBackButton(this.collectionUI!, -308, y, this.options.onReturnHome);

    // Keep the title between the back button and the progress badge on narrow screens.
    const title = this.image(this.collectionUI!, 'cat_she/title_logo', -37, y + 9, 370, 113);
    title.setScale(new Vec3(0.8, 0.8, 1));
    this.sparkleNodes.push(
      this.image(this.collectionUI!, 'cat_she/sparkle_small', -232, y + 2, 25, 31),
      this.image(this.collectionUI!, 'cat_she/sparkle_large', 170, y + 62, 27, 34),
      this.image(this.collectionUI!, 'cat_she/sparkle_small', -155, y - 58, 18, 22),
    );
    this.sparkleNodes.forEach((sparkle, index) => {
      tween(sparkle)
        .delay(index * 0.22)
        .call(() => {
          tween(sparkle)
            .repeatForever(
              tween()
                .to(0.75, { scale: new Vec3(0.78, 0.78, 1) }, { easing: 'sineInOut' })
                .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
            )
            .start();
        })
        .start();
    });

    const progress = this.image(this.collectionUI!, 'cat_she/progress_panel', 250, y - 2, 203, 88);
    this.countLabel = this.label(progress, '已收集', -19, 0, 24, COLORS.body);
    this.countLabel.isBold = true;
    this.countNumberLabel = this.label(progress, '', 56, 0, 29, COLORS.orange);
    this.countNumberLabel.isBold = true;
  }

  private buildCards(top: number) {
    const cardWidth = 336;
    const cardHeight = 300;
    const cardGap = 20;
    const columnX = cardWidth / 2 + cardGap / 2;
    const rowStep = cardHeight + cardGap;

    // Center the grid between the header and the footer; shrink as a whole on short screens.
    const gridTop = top - 206;
    const gridBottom = -top + 152;
    const gridHeight = gridTop - gridBottom;
    const totalHeight = cardHeight * 3 + cardGap * 2;
    const grid = new Node('CatCardGrid');
    this.collectionUI!.addChild(grid);
    grid.setPosition(0, (gridTop + gridBottom) / 2);
    const gridScale = Math.min(1, gridHeight / totalHeight);
    grid.setScale(new Vec3(gridScale, gridScale, 1));

    const positions: Array<[number, number]> = [
      [-columnX, rowStep],
      [columnX, rowStep],
      [-columnX, 0],
      [columnX, 0],
      [0, -rowStep],
    ];

    CAT_DEFINITIONS.forEach((definition, index) => {
      const [x, y] = positions[index];
      const card = this.creamPanel(
        grid,
        x,
        y,
        cardWidth,
        cardHeight,
        26,
        COLORS.cream,
        COLORS.border,
      );
      this.addInnerBorder(card, cardWidth, cardHeight);

      const spotlight = new Node('PortraitSpotlight');
      card.addChild(spotlight);
      spotlight.setPosition(-84, 2);
      const spotlightGraphics = spotlight.addComponent(Graphics);
      spotlightGraphics.fillColor = COLORS.spotlight;
      spotlightGraphics.strokeColor = COLORS.border;
      spotlightGraphics.lineWidth = 2;
      spotlightGraphics.circle(0, 0, 82);
      spotlightGraphics.fill();
      spotlightGraphics.stroke();

      const portrait = this.image(card, 'cat_she/cat_locked', -84, 2, 148, 214);

      const name = this.label(card, definition.name, 78, 114, 30, COLORS.title);
      name.isBold = true;
      this.image(card, CAT_SHE_PAWS[index], 78 - (definition.name.length * 30) / 2 - 26, 114, 32, 32);

      const rarity = this.buildRarityPill(card, definition.rarity, 78, 68);
      const level = this.label(card, '', 78, 27, 21, COLORS.body);
      level.isBold = true;
      const divider = new Node('CardDivider');
      card.addChild(divider);
      divider.setPosition(78, -13);
      const dividerGraphics = divider.addComponent(Graphics);
      dividerGraphics.strokeColor = new Color(226, 176, 95, 210);
      dividerGraphics.lineWidth = 2;
      this.dashedLine(dividerGraphics, -62, 0, 62, 0, 8, 6);

      const status = this.label(card, '', 78, -60, 24, COLORS.green);
      status.isBold = true;
      const detail = this.label(card, '', 78, -104, 18, COLORS.body);
      detail.node.getComponent(UITransform)!.setContentSize(172, 52);
      detail.lineHeight = 26;
      detail.overflow = Label.Overflow.CLAMP;

      const button = card.addComponent(Button);
      button.transition = Button.Transition.SCALE;
      button.zoomScale = 0.93;
      button.node.on(Button.EventType.CLICK, () => {
        this.options.onPlaySound('click');
        const progress = this.options.getCats()[definition.id];
        if (progress?.unlocked) this.options.onOpenCat(definition.id);
        else this.toast(definition.unlockHint);
      });

      this.cardViews.push({ card, definition, portrait, name, rarity, level, status, detail });
    });
  }

  private buildFooter(bottom: number) {
    // Keep the hint below the last card instead of letting it overlap the card edge.
    const footer = this.image(this.collectionUI!, 'cat_she/footer_banner', 0, bottom + 84, 420, 82);
    const opacity = footer.addComponent(UIOpacity);
    opacity.opacity = 250;
  }

  private refresh() {
    if (!this.collectionUI) return;
    const cats = this.options.getCats();
    const equippedCat = this.options.getEquippedCat();
    let unlockedCount = 0;

    this.cardViews.forEach((viewData, index) => {
      const definition = viewData.definition;
      const progress = cats[definition.id];
      const unlocked = !!progress?.unlocked;
      const equipped = unlocked && equippedCat === definition.id;
      if (unlocked) unlockedCount++;

      const portraitPath = unlocked ? CAT_SHE_PORTRAITS[definition.id] : 'cat_she/cat_locked';
      const frame = this.assets.getFrame(portraitPath);
      const sprite = viewData.portrait.getComponent(Sprite);
      if (frame && sprite) sprite.spriteFrame = frame;
      viewData.portrait.name = portraitPath.replace(/\//g, '_');
      const portraitOpacity = viewData.portrait.getComponent(UIOpacity) || viewData.portrait.addComponent(UIOpacity);
      portraitOpacity.opacity = unlocked ? 255 : 165;
      const portraitScale = unlocked ? 1 : 0.94;
      viewData.portrait.setScale(new Vec3(portraitScale, portraitScale, 1));

      viewData.level.string = unlocked ? `等级：Lv.${progress.level}` : '等级：--';
      viewData.level.color = unlocked ? COLORS.body : COLORS.muted;
      viewData.status.string = equipped ? '已装备' : unlocked ? '已解锁' : '未解锁';
      viewData.status.color = equipped ? COLORS.orange : unlocked ? COLORS.green : COLORS.muted;
      viewData.detail.string = unlocked ? '点击查看详情' : definition.unlockHint;
      viewData.detail.color = unlocked ? COLORS.body : COLORS.muted;

      viewData.card.setScale(new Vec3(0.96, 0.96, 1));
      if (this.active) {
        tween(viewData.card)
          .delay(index * 0.045)
          .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      } else {
        viewData.card.setScale(new Vec3(1, 1, 1));
      }
    });

    if (this.countNumberLabel) this.countNumberLabel.string = `${unlockedCount}/${CAT_DEFINITIONS.length}`;
  }

  private buildRarityPill(parent: Node, rarity: string, x: number, y: number) {
    const style = RARITY_STYLES[rarity] ?? RARITY_STYLES['普通'];
    const text = `稀有度：${rarity}`;
    const width = text.length * 18 + 26;
    const node = new Node('RarityPill');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, 42);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = style.fill;
    graphics.strokeColor = style.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -21, width, 42, 21);
    graphics.fill();
    graphics.stroke();
    const label = this.label(node, text, 0, 0, 18, style.text);
    label.isBold = true;
    return label;
  }

  private buildBackButton(parent: Node, x: number, y: number, callback: () => void) {
    const node = new Node('CatCollectionBackButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(node, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);

    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
    });
  }

  private addInnerBorder(parent: Node, width: number, height: number) {
    const border = new Node('CardInnerBorder');
    parent.addChild(border);
    const graphics = border.addComponent(Graphics);
    graphics.strokeColor = new Color(235, 205, 158, 190);
    graphics.lineWidth = 2;
    this.dashedRoundedRect(graphics, -width / 2 + 13, -height / 2 + 13, width - 26, height - 26, 20, 7, 5);
  }

  private dashedRoundedRect(graphics: Graphics, x: number, y: number, width: number, height: number, radius: number, dash: number, gap: number) {
    const perimeter = 2 * (width - 2 * radius) + 2 * (height - 2 * radius) + 2 * Math.PI * radius;
    const steps = Math.ceil(perimeter / (dash + gap));
    const step = perimeter / steps;
    let distance = 0;
    for (let index = 0; index < steps; index++) {
      const start = distance;
      const end = Math.min(distance + dash, perimeter);
      const from = this.roundedRectPoint(x, y, width, height, radius, start / perimeter);
      const to = this.roundedRectPoint(x, y, width, height, radius, end / perimeter);
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
      distance += step;
    }
    graphics.stroke();
  }

  private roundedRectPoint(x: number, y: number, width: number, height: number, radius: number, progress: number) {
    const straightTop = width - 2 * radius;
    const straightSide = height - 2 * radius;
    const arc = Math.PI * radius / 2;
    const lengths = [straightTop, arc, straightSide, arc, straightTop, arc, straightSide, arc];
    let distance = progress * lengths.reduce((sum, value) => sum + value, 0);
    const segments = [
      { length: straightTop, from: { x: x + radius, y: y + height }, to: { x: x + width - radius, y: y + height } },
      { length: arc, from: { x: x + width - radius, y: y + height }, to: { x: x + width, y: y + height - radius } },
      { length: straightSide, from: { x: x + width, y: y + height - radius }, to: { x: x + width, y: y + radius } },
      { length: arc, from: { x: x + width, y: y + radius }, to: { x: x + width - radius, y } },
      { length: straightTop, from: { x: x + width - radius, y }, to: { x: x + radius, y } },
      { length: arc, from: { x: x + radius, y }, to: { x, y: y + radius } },
      { length: straightSide, from: { x, y: y + radius }, to: { x, y: y + height - radius } },
      { length: arc, from: { x, y: y + height - radius }, to: { x: x + radius, y: y + height } },
    ];
    for (const segment of segments) {
      if (distance <= segment.length) {
        const ratio = segment.length === 0 ? 0 : distance / segment.length;
        return {
          x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
          y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
        };
      }
      distance -= segment.length;
    }
    return { x, y: y + height };
  }

  private dashedLine(graphics: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number) {
    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const dx = (x2 - x1) / length;
    const dy = (y2 - y1) / length;
    for (let distance = 0; distance < length; distance += dash + gap) {
      const end = Math.min(distance + dash, length);
      graphics.moveTo(x1 + dx * distance, y1 + dy * distance);
      graphics.lineTo(x1 + dx * end, y1 + dy * end);
    }
    graphics.stroke();
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.collectionUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 135);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private creamPanel(parent: Node, x: number, y: number, width: number, height: number, radius: number, fill: Color, stroke: Color) {
    const node = new Node('CatCard');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const shadow = new Node('CardShadow');
    node.addChild(shadow);
    shadow.setPosition(0, -height / 2 - 7);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 58);
    shadowGraphics.ellipse(0, 0, width / 2 - 10, 11);
    shadowGraphics.fill();
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
    return node;
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
    if (!this.collectionUI) return;
    Toast.show(this.collectionUI, text, { y: this.toastY });
  }
}
