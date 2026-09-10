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
import { CAT_DEFINITIONS, CatDefinition, MAX_CAT_LEVEL } from './GameContent';
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
  definition: CatDefinition;
  accent: Graphics;
  accentWidth: number;
  badge: Graphics;
  badgeRadius: number;
  portrait: Node;
  paw: Node;
  name: Label;
  rarityPill: Graphics;
  rarityLabel: Label;
  rarityFontSize: number;
  rarityHeight: number;
  level: Label;
  bar: Graphics;
  barWidth: number;
  barHeight: number;
  status: Label;
  detail: Label;
  columnWidth: number;
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
    fill: new Color(238, 248, 214),
    stroke: new Color(140, 182, 78),
    text: new Color(72, 128, 44),
  },
  '普通': {
    fill: new Color(255, 246, 216),
    stroke: new Color(226, 176, 95),
    text: new Color(170, 102, 38),
  },
  '稀有': {
    fill: new Color(255, 238, 202),
    stroke: new Color(239, 168, 52),
    text: new Color(206, 116, 16),
  },
  '传说': {
    fill: new Color(246, 236, 255),
    stroke: new Color(178, 132, 232),
    text: new Color(126, 72, 190),
  },
};

const COLORS = {
  title: new Color(111, 62, 28),
  body: new Color(112, 69, 40),
  muted: new Color(150, 137, 121),
  green: new Color(78, 139, 50),
  orange: new Color(234, 117, 21),
  cream: new Color(255, 250, 236, 244),
  stroke: new Color(232, 196, 138),
  barTrack: new Color(240, 226, 200),
  barStroke: new Color(224, 202, 166),
  lockedFill: new Color(238, 231, 218, 230),
  lockedStroke: new Color(206, 192, 172),
};

const CARD_WIDTH = 341;
const FEATURED_CARD_WIDTH = 620;
const CARD_HEIGHT = 300;
const CARD_GAP = 22;

export class CatCollectionScreen {
  private collectionUI: Node | null = null;
  private toastY = -150;
  private countLabel: Label | null = null;
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
      'cat_she/cat_collection_bg',
      'cat_she/cat_locked',
      'cat_she/title_logo',
      'cat_she/progress_panel',
      'cat_she/footer_banner',
      'cat_she/sparkle_large',
      'cat_she/sparkle_small',
      COMMON_UI_ASSETS.backButton,
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

    this.image(this.collectionUI, 'cat_she/cat_collection_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);
    this.buildCards(top, bottom);
    this.buildFooter(bottom);
    this.refresh();
  }

  private buildHeader(top: number) {
    const headerY = top - 140;
    this.buildBackButton(this.collectionUI!, -300, headerY, this.options.onReturnHome);

    // 标题徽标夹在返回键与收集进度之间，窄屏也不会互相压到。
    this.image(this.collectionUI!, 'cat_she/title_logo', 0, headerY, 260, 79);

    const chip = this.image(this.collectionUI!, 'cat_she/progress_panel', 250, headerY, 200, 68);
    this.countLabel = this.label(chip, '', 30, 0, 21, COLORS.orange);
    this.countLabel.isBold = true;

    this.sparkleNodes.push(
      this.image(this.collectionUI!, 'cat_she/sparkle_small', -192, headerY + 30, 22, 26),
      this.image(this.collectionUI!, 'cat_she/sparkle_large', 138, headerY + 40, 24, 30),
    );
    this.sparkleNodes.forEach((sparkle, index) => {
      tween(sparkle)
        .delay(index * 0.26)
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
  }

  private buildCards(top: number, bottom: number) {
    const columnX = CARD_WIDTH / 2 + CARD_GAP / 2;
    const rowStep = CARD_HEIGHT + CARD_GAP;

    // 网格居中于顶栏与页脚之间；屏幕偏矮时整体等比缩小，保证三行都放得下。
    const gridTop = top - 197;
    const gridBottom = bottom + 187;
    const gridHeight = gridTop - gridBottom;
    const totalHeight = CARD_HEIGHT * 3 + CARD_GAP * 2;
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
      const featured = index === CAT_DEFINITIONS.length - 1;
      this.buildCard(grid, definition, index, x, y, featured);
    });
  }

  private buildCard(parent: Node, definition: CatDefinition, index: number, x: number, y: number, featured: boolean) {
    const width = featured ? FEATURED_CARD_WIDTH : CARD_WIDTH;
    const radius = featured ? 30 : 26;
    const badgeRadius = featured ? 82 : 64;
    const badgeX = featured ? -212 : -94;
    const columnX = featured ? 92 : 68;
    const columnWidth = featured ? 400 : 172;

    const card = new Node('CatCard');
    parent.addChild(card);
    card.setPosition(x, y);
    card.addComponent(UITransform).setContentSize(width, CARD_HEIGHT);

    this.creamPanel(card, 0, 0, width, CARD_HEIGHT, radius, COLORS.cream, COLORS.stroke);

    // 顶部稀有度色条，用颜色给卡片分档
    const accentWidth = width - 60;
    const accentNode = new Node('CardAccent');
    card.addChild(accentNode);
    accentNode.setPosition(0, CARD_HEIGHT / 2 - 15);
    accentNode.addComponent(UITransform).setContentSize(accentWidth, 8);
    const accent = accentNode.addComponent(Graphics);

    const badgeNode = new Node('PortraitBadge');
    card.addChild(badgeNode);
    badgeNode.setPosition(badgeX, 6);
    badgeNode.addComponent(UITransform).setContentSize((badgeRadius + 14) * 2, (badgeRadius + 14) * 2);
    const badge = badgeNode.addComponent(Graphics);

    const portrait = this.image(
      card,
      'cat_she/cat_locked',
      badgeX,
      featured ? 2 : 4,
      featured ? 186 : 146,
      featured ? 218 : 172,
    );

    const paw = this.image(
      card,
      CAT_SHE_PAWS[index],
      badgeX + badgeRadius * 0.6,
      6 - badgeRadius * 0.82,
      featured ? 36 : 30,
      featured ? 36 : 30,
    );
    paw.addComponent(UIOpacity);

    const name = this.label(card, definition.name, columnX, 100, featured ? 34 : 27, COLORS.title);
    name.isBold = true;
    name.node.getComponent(UITransform)!.setContentSize(columnWidth, featured ? 46 : 38);
    name.overflow = Label.Overflow.SHRINK;

    const rarityHeight = featured ? 42 : 36;
    const rarityNode = new Node('RarityPill');
    card.addChild(rarityNode);
    rarityNode.setPosition(columnX, 48);
    rarityNode.addComponent(UITransform).setContentSize(columnWidth, rarityHeight);
    const rarityPill = rarityNode.addComponent(Graphics);
    const rarityLabel = this.label(rarityNode, '', 0, 0, featured ? 19 : 17, COLORS.body);
    rarityLabel.isBold = true;

    const level = this.label(card, '', columnX, 6, featured ? 22 : 20, COLORS.body);
    level.isBold = true;
    level.node.getComponent(UITransform)!.setContentSize(columnWidth, 30);

    const barWidth = featured ? 340 : 160;
    const barHeight = featured ? 20 : 18;
    const barNode = new Node('LevelBar');
    card.addChild(barNode);
    barNode.setPosition(columnX, -30);
    barNode.addComponent(UITransform).setContentSize(barWidth, barHeight);
    const bar = barNode.addComponent(Graphics);

    const status = this.label(card, '', columnX, -76, featured ? 24 : 22, COLORS.green);
    status.isBold = true;

    const detail = this.label(card, '', columnX, -112, featured ? 18 : 17, COLORS.muted);
    detail.node.getComponent(UITransform)!.setContentSize(columnWidth, 24);
    detail.lineHeight = 22;
    detail.overflow = Label.Overflow.CLAMP;

    if (featured) {
      this.sparkleNodes.push(
        this.image(card, 'cat_she/sparkle_large', -300, 128, 30, 38),
        this.image(card, 'cat_she/sparkle_small', 286, 96, 22, 26),
      );
    }

    const button = card.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const progress = this.options.getCats()[definition.id];
      if (progress?.unlocked) this.options.onOpenCat(definition.id);
      else this.toast(definition.unlockHint);
    });

    this.cardViews.push({
      card,
      definition,
      accent,
      accentWidth,
      badge,
      badgeRadius,
      portrait,
      paw,
      name,
      rarityPill,
      rarityLabel,
      rarityFontSize: featured ? 19 : 17,
      rarityHeight,
      level,
      bar,
      barWidth,
      barHeight,
      status,
      detail,
      columnWidth,
    });
  }

  private buildFooter(bottom: number) {
    const footer = this.image(this.collectionUI!, 'cat_she/footer_banner', 0, bottom + 120, 440, 103);
    footer.addComponent(UIOpacity).opacity = 250;
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
      const style = RARITY_STYLES[definition.rarity] ?? RARITY_STYLES['普通'];
      const accentColor = unlocked ? style.stroke : COLORS.lockedStroke;
      if (unlocked) unlockedCount++;

      this.drawCardAccent(viewData.accent, viewData.accentWidth, accentColor);
      this.drawPortraitBadge(viewData.badge, viewData.badgeRadius, accentColor);

      const portraitPath = unlocked ? CAT_SHE_PORTRAITS[definition.id] : 'cat_she/cat_locked';
      const frame = this.assets.getFrame(portraitPath);
      const sprite = viewData.portrait.getComponent(Sprite);
      if (frame && sprite) sprite.spriteFrame = frame;
      viewData.portrait.name = portraitPath.replace(/\//g, '_');
      const portraitOpacity = viewData.portrait.getComponent(UIOpacity) || viewData.portrait.addComponent(UIOpacity);
      portraitOpacity.opacity = unlocked ? 255 : 215;
      const portraitScale = unlocked ? 1 : 0.94;
      viewData.portrait.setScale(new Vec3(portraitScale, portraitScale, 1));

      const pawOpacity = viewData.paw.getComponent(UIOpacity) || viewData.paw.addComponent(UIOpacity);
      pawOpacity.opacity = unlocked ? 255 : 110;

      viewData.name.color = unlocked ? COLORS.title : COLORS.muted;

      const rarityText = `稀有度：${definition.rarity}`;
      viewData.rarityLabel.string = rarityText;
      viewData.rarityLabel.color = unlocked ? style.text : COLORS.muted;
      const pillWidth = Math.min(
        viewData.columnWidth,
        Math.max(120, this.estimateTextWidth(rarityText, viewData.rarityFontSize) + 28),
      );
      this.drawRarityPill(
        viewData.rarityPill,
        pillWidth,
        viewData.rarityHeight,
        unlocked ? style.fill : COLORS.lockedFill,
        unlocked ? style.stroke : COLORS.lockedStroke,
      );

      viewData.level.string = unlocked ? `等级 Lv.${progress.level}` : '等级 --';
      viewData.level.color = unlocked ? COLORS.body : COLORS.muted;

      const ratio = unlocked ? Math.min(1, progress.level / MAX_CAT_LEVEL) : 0;
      this.drawLevelBar(
        viewData.bar,
        viewData.barWidth,
        viewData.barHeight,
        ratio,
        equipped ? COLORS.orange : style.stroke,
      );

      viewData.status.string = equipped ? '已装备' : unlocked ? '已解锁' : '未解锁';
      viewData.status.color = equipped ? COLORS.orange : unlocked ? COLORS.green : COLORS.muted;
      viewData.detail.string = unlocked ? '点击查看详情' : '';

      viewData.card.setScale(new Vec3(0.96, 0.96, 1));
      if (this.active) {
        tween(viewData.card)
          .delay(index * 0.05)
          .to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      } else {
        viewData.card.setScale(new Vec3(1, 1, 1));
      }
    });

    if (this.countLabel) this.countLabel.string = `已收集 ${unlockedCount}/${CAT_DEFINITIONS.length}`;
  }

  private drawCardAccent(graphics: Graphics, width: number, color: Color) {
    graphics.clear();
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -4, width, 8, 4);
    graphics.fill();
  }

  private drawPortraitBadge(graphics: Graphics, radius: number, accent: Color) {
    graphics.clear();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 58);
    graphics.circle(0, 0, radius + 12);
    graphics.fill();
    graphics.fillColor = new Color(255, 251, 242, 245);
    graphics.circle(0, 0, radius);
    graphics.fill();
    graphics.strokeColor = accent;
    graphics.lineWidth = 4;
    graphics.circle(0, 0, radius);
    graphics.stroke();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 150);
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12 - Math.PI / 2;
      graphics.circle(Math.cos(angle) * (radius - 9), Math.sin(angle) * (radius - 9), 3);
      graphics.fill();
    }
  }

  private drawRarityPill(graphics: Graphics, width: number, height: number, fill: Color, stroke: Color) {
    graphics.clear();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 2.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
  }

  private drawLevelBar(graphics: Graphics, width: number, height: number, ratio: number, fill: Color) {
    graphics.clear();
    graphics.fillColor = COLORS.barTrack;
    graphics.strokeColor = COLORS.barStroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped > 0) {
      const fillWidth = Math.max(height - 4, (width - 6) * clamped);
      graphics.fillColor = fill;
      graphics.roundRect(-width / 2 + 3, -height / 2 + 3, fillWidth, height - 6, (height - 6) / 2);
      graphics.fill();
    }
  }

  private estimateTextWidth(text: string, fontSize: number) {
    let units = 0;
    for (const ch of text) units += ch.codePointAt(0)! > 0x2e7f ? 1 : 0.55;
    return units * fontSize;
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

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.collectionUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(96, 62, 34, 34);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private creamPanel(parent: Node, x: number, y: number, width: number, height: number, radius: number, fill: Color, stroke: Color) {
    const node = new Node('CardPanel');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    // 投影与底板用同一个 Graphics 顺序绘制，避免子节点投影盖在面板上。
    graphics.fillColor = new Color(92, 54, 22, 66);
    graphics.ellipse(0, -height / 2 - 4, width / 2 - 16, 14);
    graphics.fill();
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
