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
import { CAT_DEFINITIONS, CatDefinition } from './GameContent';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
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

type CatSlotView = {
  slot: Node;
  definition: CatDefinition;
  portrait: Node;
  name: Label;
  status: Label;
  plaque: Graphics;
  plaqueWidth: number;
  catBox: { width: number; height: number };
};

const CAT_SHE_PORTRAITS: Record<CatId, string> = {
  orange: 'cat_she/cat_orange',
  white: 'cat_she/cat_white',
  black: 'cat_she/cat_black',
  ragdoll: 'cat_she/cat_ragdoll',
  aurora: 'cat_she/cat_aurora',
};

type RarityStyle = { fill: Color; stroke: Color; text: Color };
const RARITY_STYLES: Record<string, RarityStyle> = {
  '新手猫咪': {
    fill: new Color(240, 249, 220),
    stroke: new Color(140, 182, 78),
    text: new Color(78, 128, 46),
  },
  '普通': {
    fill: new Color(255, 247, 222),
    stroke: new Color(226, 176, 95),
    text: new Color(170, 102, 38),
  },
  '稀有': {
    fill: new Color(255, 240, 208),
    stroke: new Color(239, 168, 52),
    text: new Color(199, 111, 12),
  },
  '传说': {
    fill: new Color(248, 239, 255),
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
  wood: new Color(206, 158, 104),
  woodTop: new Color(234, 197, 145),
  woodStroke: new Color(150, 100, 56),
  shadow: new Color(92, 54, 22, 70),
  lockedPlague: new Color(241, 235, 224),
  lockedStroke: new Color(206, 192, 172),
};

const PLAQUE_HEIGHT = 52;
// 台面要够高才能露出木头：名牌嵌在台面前 2/3，猫脚踩在台沿上。
const SHELF_BOARD_HEIGHT = 104;
// 猫脚跟踩进台面 15px，贴纸才有"站在台上"的感觉而不是浮在空中。
const FOOT_SINK = 15;
// 素材统一按 ~0.72 的竖长比例估位，避免逐帧换图时名牌上下跳动。
const NOMINAL_CAT_ASPECT = 0.72;

type ShelfTier = {
  indices: number[];
  boardTop: number;
  boardWidth: number;
  slots: number[];
  catBox: { width: number; height: number };
  plaqueWidth: number;
};

// 上层摆稀有度更高的两只进阶猫，下层摆三只基础猫：稀有度顺着展台往上走。
const SHELF_TIERS: ShelfTier[] = [
  {
    indices: [3, 4],
    boardTop: 96,
    boardWidth: 620,
    slots: [-150, 150],
    catBox: { width: 250, height: 320 },
    plaqueWidth: 240,
  },
  {
    indices: [0, 1, 2],
    boardTop: -306,
    boardWidth: 690,
    slots: [-230, 0, 230],
    catBox: { width: 200, height: 280 },
    plaqueWidth: 200,
  },
];

export class CatCollectionScreen {
  private collectionUI: Node | null = null;
  private toastY = -150;
  private countLabel: Label | null = null;
  private readonly slotViews: CatSlotView[] = [];
  private readonly sparkleNodes: Node[] = [];
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: CatCollectionScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImagesFor(this, [
      'cat_she/cat_collection_bg',
      'cat_she/cat_locked',
      'cat_she/title_logo',
      'cat_she/progress_panel',
      'cat_she/footer_banner',
      'cat_she/sparkle_large',
      'cat_she/sparkle_small',
      COMMON_UI_ASSETS.backButton,
      ...Object.keys(CAT_SHE_PORTRAITS).map(id => CAT_SHE_PORTRAITS[id as CatId]),
    ], () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.collectionUI) return;
    this.collectionUI.active = active;
    if (active) {
      if (this.collectionUI.parent) {
        this.collectionUI.setSiblingIndex(this.collectionUI.parent.children.length - 1);
      }
      this.refresh();
    }
  }

  destroy() {
    this.sparkleNodes.forEach(sparkle => Tween.stopAllByTarget(sparkle));
    this.sparkleNodes.length = 0;
    this.slotViews.forEach(viewData => Tween.stopAllByTarget(viewData.slot));
    this.slotViews.length = 0;
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
    this.collectionUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.collectionUI.active = this.active;

    this.image(this.collectionUI, 'cat_she/cat_collection_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);
    this.buildShelves(top, bottom);
    this.buildFooter(bottom);
    this.refresh();
  }

  private buildHeader(top: number) {
    const headerY = top - 140;
    this.buildBackButton(this.collectionUI!, -300, headerY, this.options.onReturnHome);

    // 标题徽标夹在返回键与收集进度之间，窄屏也不会互相压到。
    this.image(this.collectionUI!, 'cat_she/title_logo', 0, headerY, 260, 79);

    const chip = this.image(this.collectionUI!, 'cat_she/progress_panel', 250, belowWeChatCapsule(top, 68), 200, 68);
    this.countLabel = this.label(chip, '', 30, 0, 21, COLORS.orange);
    this.countLabel.isBold = true;
  }

  private buildShelves(top: number, bottom: number) {
    // 展台整体居中在顶栏与页脚之间；屏幕偏矮时等比缩小，保证两层都放得下。
    const availableTop = top - 200;
    const availableBottom = bottom + 175;
    const contentHeight = this.measureContentHeight();
    const scale = Math.min(1, (availableTop - availableBottom) / contentHeight);

    const shelf = new Node('CatShelf');
    this.collectionUI!.addChild(shelf);
    shelf.setPosition(0, (availableTop + availableBottom) / 2);
    shelf.setScale(new Vec3(scale, scale, 1));

    SHELF_TIERS.forEach(tier => {
      // 台面先画，猫咪后放：猫脚要压在台沿之上。
      this.buildShelfBoard(shelf, tier);
      tier.indices.forEach((definitionIndex, slotIndex) => {
        this.buildCatSlot(shelf, tier, definitionIndex, slotIndex);
      });
    });

    this.buildShelfSparkles(shelf);
  }

  private measureContentHeight() {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    SHELF_TIERS.forEach(tier => {
      const catBottom = tier.boardTop - FOOT_SINK;
      const catTop = catBottom + tier.catBox.height;
      minY = Math.min(minY, tier.boardTop - SHELF_BOARD_HEIGHT);
      maxY = Math.max(maxY, catTop);
    });
    return maxY - minY;
  }

  private buildShelfBoard(parent: Node, tier: ShelfTier) {
    const node = new Node('ShelfBoard');
    parent.addChild(node);
    node.setPosition(0, tier.boardTop - SHELF_BOARD_HEIGHT / 2);
    node.addComponent(UITransform).setContentSize(tier.boardWidth, SHELF_BOARD_HEIGHT);
    this.drawShelfBoard(node.addComponent(Graphics), tier.boardWidth, SHELF_BOARD_HEIGHT);
  }

  private drawShelfBoard(graphics: Graphics, width: number, height: number) {
    graphics.clear();
    // 投影直接画在同一张 Graphics 上，避免子节点投影盖住台面。
    graphics.fillColor = COLORS.shadow;
    graphics.ellipse(0, -height / 2 - 8, width / 2 - 24, 18);
    graphics.fill();

    graphics.fillColor = COLORS.wood;
    graphics.strokeColor = COLORS.woodStroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();

    // 台沿高光把平面读成"有厚度的架子"；名牌挂在它下面的前板上。
    graphics.fillColor = COLORS.woodTop;
    graphics.roundRect(-width / 2 + 10, height / 2 - 20, width - 20, 13, 7);
    graphics.fill();

    // 立柱阴影暗示台面前方有支撑，不再是一块飘着的板。
    graphics.fillColor = new Color(0, 0, 0, 26);
    graphics.roundRect(-width / 2 + 34, -height / 2 + 10, 14, height - 30, 7);
    graphics.fill();
    graphics.roundRect(width / 2 - 48, -height / 2 + 10, 14, height - 30, 7);
    graphics.fill();
  }

  private buildCatSlot(parent: Node, tier: ShelfTier, definitionIndex: number, slotIndex: number) {
    const definition = CAT_DEFINITIONS[definitionIndex];
    const slotX = tier.slots[slotIndex];
    const catBottom = tier.boardTop - FOOT_SINK;
    const nominalHeight = this.fitInto(NOMINAL_CAT_ASPECT, tier.catBox.width, tier.catBox.height).height;
    const catCenterY = catBottom + nominalHeight / 2;
    // 名牌嵌在台面前板上（台面顶部往下 26px 起），所以木头在名牌上下都能露出来。
    const plaqueY = tier.boardTop - 26 - PLAQUE_HEIGHT / 2;

    const slot = new Node(`CatSlot_${definition.id}`);
    parent.addChild(slot);
    slot.setPosition(slotX, 0);
    slot.addComponent(UITransform).setContentSize(tier.catBox.width, tier.catBox.height);

    const portrait = this.imageFit(slot, 'cat_she/cat_locked', 0, catCenterY, tier.catBox);
    portrait.addComponent(UIOpacity);

    const plaqueNode = new Node('Plaque');
    slot.addChild(plaqueNode);
    plaqueNode.setPosition(0, plaqueY);
    plaqueNode.addComponent(UITransform).setContentSize(tier.plaqueWidth, PLAQUE_HEIGHT);
    const plaque = plaqueNode.addComponent(Graphics);

    const name = this.label(plaqueNode, '', 0, 11, 21, COLORS.title);
    name.isBold = true;
    name.node.getComponent(UITransform)!.setContentSize(tier.plaqueWidth - 20, 28);
    name.overflow = Label.Overflow.SHRINK;

    const status = this.label(plaqueNode, '', 0, -13, 14, COLORS.body);
    status.node.getComponent(UITransform)!.setContentSize(tier.plaqueWidth - 16, 22);
    status.overflow = Label.Overflow.SHRINK;

    const button = slot.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const progress = this.options.getCats()[definition.id];
      if (progress?.unlocked) this.options.onOpenCat(definition.id);
      else this.toast(definition.unlockHint);
    });

    this.slotViews.push({
      slot,
      definition,
      portrait,
      name,
      status,
      plaque,
      plaqueWidth: tier.plaqueWidth,
      catBox: tier.catBox,
    });
  }

  private buildShelfSparkles(parent: Node) {
    const sparkles = [
      this.image(parent, 'cat_she/sparkle_large', -268, 372, 30, 38),
      this.image(parent, 'cat_she/sparkle_small', 254, 402, 22, 26),
      this.image(parent, 'cat_she/sparkle_small', -330, 120, 20, 24),
    ];
    this.sparkleNodes.push(...sparkles);
    sparkles.forEach((sparkle, index) => {
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

  private buildFooter(bottom: number) {
    const footer = this.image(this.collectionUI!, 'cat_she/footer_banner', 0, bottom + 120, 440, 103);
    footer.addComponent(UIOpacity).opacity = 250;
  }

  private refresh() {
    if (!this.collectionUI) return;
    const cats = this.options.getCats();
    const equippedCat = this.options.getEquippedCat();
    let unlockedCount = 0;

    this.slotViews.forEach((viewData, index) => {
      const definition = viewData.definition;
      const progress = cats[definition.id];
      const unlocked = !!progress?.unlocked;
      const equipped = unlocked && equippedCat === definition.id;
      const style = RARITY_STYLES[definition.rarity] ?? RARITY_STYLES['普通'];
      const plaqueStroke = unlocked ? style.stroke : COLORS.lockedStroke;
      if (unlocked) unlockedCount++;

      this.drawPlaque(viewData.plaque, viewData.plaqueWidth, PLAQUE_HEIGHT, unlocked ? style.fill : COLORS.lockedPlague, plaqueStroke);

      const portraitPath = unlocked ? CAT_SHE_PORTRAITS[definition.id] : 'cat_she/cat_locked';
      const frame = this.assets.getFrame(portraitPath);
      const sprite = viewData.portrait.getComponent(Sprite);
      if (frame && sprite) {
        sprite.spriteFrame = frame;
        const fitted = this.fitInto(
          this.frameAspect(frame, NOMINAL_CAT_ASPECT),
          viewData.catBox.width,
          viewData.catBox.height,
        );
        viewData.portrait.getComponent(UITransform)!.setContentSize(fitted.width, fitted.height);
      }
      const portraitOpacity = viewData.portrait.getComponent(UIOpacity)!;
      portraitOpacity.opacity = unlocked ? 255 : 205;
      // 未解锁的剪影原图更饱满，收一点比例，解锁的猫才读得出"被点亮"。
      const emphasis = unlocked ? 1 : 0.9;
      viewData.portrait.setScale(new Vec3(emphasis, emphasis, 1));

      viewData.name.string = `${definition.name} · ${definition.rarity}`;
      viewData.name.color = unlocked ? COLORS.title : COLORS.muted;

      // 未解锁用短条件（名牌一行放得下），完整提示交给点击后的 Toast。
      viewData.status.string = unlocked
        ? `Lv.${progress.level} · ${equipped ? '已装备' : '已解锁'}`
        : definition.unlockShort;
      viewData.status.color = equipped ? COLORS.orange : unlocked ? COLORS.green : COLORS.muted;

      viewData.slot.setScale(new Vec3(0.96, 0.96, 1));
      if (this.active) {
        tween(viewData.slot)
          .delay(index * 0.05)
          .to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      } else {
        viewData.slot.setScale(new Vec3(1, 1, 1));
      }
    });

    if (this.countLabel) this.countLabel.string = `已收集 ${unlockedCount}/${CAT_DEFINITIONS.length}`;
  }

  private drawPlaque(graphics: Graphics, width: number, height: number, fill: Color, stroke: Color) {
    graphics.clear();
    graphics.fillColor = new Color(92, 54, 22, 46);
    graphics.roundRect(-width / 2 + 3, -height / 2 - 3, width, height, 14);
    graphics.fill();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    graphics.stroke();
  }

  private frameAspect(frame: { originalSize?: { width: number; height: number } } | undefined, fallback: number) {
    const size = frame?.originalSize;
    if (!size || !size.width || !size.height) return fallback;
    return size.width / size.height;
  }

  private fitInto(aspect: number, boxWidth: number, boxHeight: number) {
    const width = Math.min(boxWidth, boxHeight * aspect);
    return { width, height: width / aspect };
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

  /** 按素材原始比例在 box 内等比缩放，避免贴纸猫被拉扁。 */
  private imageFit(
    parent: Node,
    path: string,
    x: number,
    y: number,
    box: { width: number; height: number },
    addSprite = true,
  ) {
    const frame = this.assets.getFrame(path);
    const fitted = this.fitInto(this.frameAspect(frame, NOMINAL_CAT_ASPECT), box.width, box.height);
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(fitted.width, fitted.height);
    if (addSprite && frame) {
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
