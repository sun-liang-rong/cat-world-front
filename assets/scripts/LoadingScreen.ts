import {
  BlockInputEvents,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  Tween,
  tween,
  UIOpacity,
  UITransform,
  Vec2,
  Vec3,
  view,
} from 'cc';
import { AssetStore } from './AssetStore';

const LOADING_IMAGE_PATHS = [
  'cat', 'cloud', 'fill', 'paw', 'pillow', 'ribbon', 'track', 'yarn_ball',
].map(name => `loading/${name}`);
const LOADING_BUNDLE_NAME = 'loading_local';

export interface LoadingScreenOptions {
  onFinish: () => void;
}

export class LoadingScreen {
  private loadingUI: Node | null = null;
  private fillSprite: Sprite | null = null;
  private pawThumb: Node | null = null;
  private percentLabel: Label | null = null;
  private readonly progressProxy = { p: 0 };
  private readonly barWidth = 560;
  private readonly fillInset = 15;
  private destroyed = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: LoadingScreenOptions,
  ) {}

  loadAndCreate(onUiReady?: () => void) {
    this.assets.loadImagesFromBundle(LOADING_BUNDLE_NAME, LOADING_IMAGE_PATHS, () => {
      if (this.destroyed) return;
      this.create();
      this.applyProgress(0);
      onUiReady?.();
    });
  }

  setProgress(progress: number) {
    this.onRealProgress(progress, 1);
  }

  finish() {
    this.finishLoading();
  }

  bringToFront() {
    if (!this.loadingUI?.parent) return;
    this.loadingUI.setSiblingIndex(this.loadingUI.parent.children.length - 1);
  }

  setActive(active: boolean) {
    if (!this.loadingUI) return;
    this.loadingUI.active = active;
  }

  destroy() {
    this.destroyed = true;
    Tween.stopAllByTarget(this.progressProxy);
    this.loadingUI?.destroy();
    this.loadingUI = null;
    this.fillSprite = null;
    this.pawThumb = null;
    this.percentLabel = null;
  }

  private create() {
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -visibleSize.height / 2;
    this.loadingUI = new Node('LoadingUI');
    this.root.addChild(this.loadingUI);
    this.loadingUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    const entrance = this.loadingUI.addComponent(UIOpacity);
    entrance.opacity = 0;
    tween(entrance).to(0.25, { opacity: 255 }).start();

    this.buildSky(this.loadingUI, visibleSize.width, visibleSize.height);

    const blocker = new Node('LoadingBlocker');
    this.loadingUI.addChild(blocker);
    blocker.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    blocker.addComponent(BlockInputEvents);

    this.buildClouds(this.loadingUI, top);
    this.buildRibbon(this.loadingUI, top);
    this.buildCatStage(this.loadingUI, bottom);
    this.buildProgressArea(this.loadingUI, bottom);
    this.buildTownScenery(this.loadingUI, bottom);
    this.buildScatteredPaws(this.loadingUI, bottom);
    this.buildYarnBall(this.loadingUI, bottom);
  }

  private onRealProgress(loaded: number, total: number) {
    if (this.destroyed) return;
    this.tweenProgressTo(loaded / total);
  }

  private tweenProgressTo(target: number) {
    Tween.stopAllByTarget(this.progressProxy);
    tween(this.progressProxy)
      .to(0.26, { p: target }, { onUpdate: () => this.applyProgress(this.progressProxy.p) })
      .start();
  }

  private finishLoading() {
    if (this.destroyed) return;
    Tween.stopAllByTarget(this.progressProxy);
    tween(this.progressProxy)
      .to(0.28, { p: 1 }, { onUpdate: () => this.applyProgress(this.progressProxy.p) })
      .delay(0.3)
      .call(() => {
        if (this.destroyed) return;
        this.options.onFinish();
      })
      .start();
  }

  private applyProgress(p: number) {
    if (this.destroyed || !this.loadingUI) return;
    const clamped = Math.min(1, Math.max(0, p));
    const fillWidth = this.barWidth - this.fillInset * 2;
    if (this.fillSprite) this.fillSprite.fillRange = clamped;
    if (this.pawThumb) {
      this.pawThumb.setPosition(-fillWidth / 2 + fillWidth * clamped, this.pawThumb.position.y);
    }
    if (this.percentLabel) {
      this.percentLabel.string = `加载中 ${Math.round(clamped * 100)}%`;
    }
  }

  private buildSky(parent: Node, width: number, height: number) {
    const sky = new Node('LoadingSky');
    parent.addChild(sky);
    sky.addComponent(UITransform).setContentSize(width, height);
    const graphics = sky.addComponent(Graphics);
    const topColor = new Color(252, 201, 150);
    const bottomColor = new Color(255, 247, 216);
    const bands = 26;
    const bandHeight = height / bands;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      graphics.fillColor = this.lerpColor(bottomColor, topColor, t);
      const y = -height / 2 + i * bandHeight;
      graphics.rect(-width / 2, y, width, bandHeight + 1);
      graphics.fill();
    }
  }

  private lerpColor(from: Color, to: Color, t: number) {
    return new Color(
      Math.round(from.r + (to.r - from.r) * t),
      Math.round(from.g + (to.g - from.g) * t),
      Math.round(from.b + (to.b - from.b) * t),
      255,
    );
  }

  private buildClouds(parent: Node, top: number) {
    const clouds: Array<[number, number, number, number, number]> = [
      [-255, 95, 150, 12, 2.8],
      [265, 150, 172, -14, 3.4],
      [282, 430, 112, 10, 2.6],
      [-300, 590, 92, -8, 3.1],
    ];
    clouds.forEach(([offsetY, x, width, distance, duration]) => {
      const cloud = this.image(parent, 'loading/cloud', x, top - offsetY, width, width * 121 / 206);
      this.startCloudDrift(cloud, distance, duration);
    });
  }

  private startCloudDrift(cloud: Node, distance: number, duration: number) {
    tween(cloud)
      .repeatForever(
        tween()
          .by(duration, { position: new Vec3(distance, 0, 0) }, { easing: 'sineInOut' })
          .by(duration, { position: new Vec3(-distance, 0, 0) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private buildRibbon(parent: Node, top: number) {
    const ribbon = this.image(parent, 'loading/ribbon', 0, top - 250, 620, 220);
    this.buildArcTitle(ribbon, '猫爪星球奇遇记', 48, new Color(255, 247, 224));
  }

  // 标题逐字沿内板中线排成弧形：弧参数来自对 ribbon 图内板轮廓的拟合圆
  // （圆心 (0,-662)、半径 687，板中线中点在节点中心上方约 +24，与背景框同一条弧）
  private buildArcTitle(ribbon: Node, text: string, fontSize: number, color: Color) {
    const title = new Node('RibbonTitle');
    ribbon.addChild(title);
    const arcCenterY = -662;
    const radius = 687;
    const chars = Array.from(text);
    chars.forEach((ch, i) => {
      const phi = ((i - (chars.length - 1) / 2) * fontSize) / radius;
      const label = this.label(title, ch, 0, 0, fontSize, color);
      label.node.setPosition(radius * Math.sin(phi), arcCenterY + radius * Math.cos(phi));
      label.node.angle = (-phi * 180) / Math.PI;
      label.isBold = true;
      label.enableShadow = true;
      label.shadowColor = new Color(90, 61, 38, 140);
      label.shadowOffset = new Vec2(0, -4);
    });
  }

  private buildCatStage(parent: Node, bottom: number) {
    const shadow = new Node('CatShadow');
    parent.addChild(shadow);
    shadow.setPosition(25, bottom + 486);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 70);
    shadowGraphics.ellipse(0, 0, 235, 30);
    shadowGraphics.fill();

    this.image(parent, 'loading/pillow', -185, bottom + 590, 208, 174);

    const cat = this.image(parent, 'loading/cat', 40, bottom + 650, 362, 350);
    cat.setScale(0.6, 0.6, 1);
    tween(cat)
      .to(0.36, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .call(() => this.startCatBreathing(cat))
      .start();
  }

  private startCatBreathing(cat: Node) {
    if (this.destroyed || !cat.isValid) return;
    tween(cat)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.02, 1.02, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private buildProgressArea(parent: Node, bottom: number) {
    const barY = bottom + 425;
    const area = new Node('ProgressArea');
    parent.addChild(area);
    area.setPosition(0, barY - 36);
    const areaOpacity = area.addComponent(UIOpacity);
    areaOpacity.opacity = 0;
    tween(areaOpacity).to(0.3, { opacity: 255 }).start();
    tween(area).to(0.3, { position: new Vec3(0, barY) }, { easing: 'cubicOut' }).start();

    this.image(area, 'loading/track', 0, 0, this.barWidth, 78);

    const fillWidth = this.barWidth - this.fillInset * 2;
    const fill = this.image(area, 'loading/fill', 0, 0, fillWidth, 53);
    const fillSprite = fill.getComponent(Sprite)!;
    fillSprite.type = Sprite.Type.FILLED;
    fillSprite.fillType = Sprite.FillType.HORIZONTAL;
    fillSprite.fillStart = 0;
    fillSprite.fillRange = 0;
    this.fillSprite = fillSprite;

    const paw = this.image(area, 'loading/paw', -fillWidth / 2, 2, 64, 61);
    this.pawThumb = paw;
    tween(paw)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    const tipBar = new Node('LoadingTipBar');
    area.addChild(tipBar);
    tipBar.setPosition(0, -96);
    tipBar.addComponent(UITransform).setContentSize(288, 44);
    const tipGraphics = tipBar.addComponent(Graphics);
    tipGraphics.fillColor = new Color(112, 69, 40);
    tipGraphics.roundRect(-144, -22, 288, 44, 22);
    tipGraphics.fill();
    this.percentLabel = this.label(tipBar, '加载中 0%', 0, 0, 24, new Color(255, 246, 224));
    this.percentLabel.isBold = true;
  }

  private buildTownScenery(parent: Node, bottom: number) {
    const scenery = new Node('TownScenery');
    parent.addChild(scenery);
    const g = scenery.addComponent(Graphics);

    g.fillColor = new Color(214, 224, 166);
    g.ellipse(0, bottom + 20, 520, 165);
    g.fill();
    g.fillColor = new Color(196, 210, 142);
    g.ellipse(0, bottom - 30, 560, 150);
    g.fill();

    // 远景一排小屋，下半段被前侧山坡遮住，形成层次
    this.drawHouse(g, -260, bottom + 95, 0.62, new Color(246, 229, 198), new Color(214, 142, 96));
    this.drawHouse(g, -70, bottom + 95, 0.55, new Color(248, 234, 204), new Color(206, 128, 82));
    this.drawTree(g, -160, bottom + 95, 0.55);
    this.drawHouse(g, 120, bottom + 95, 0.6, new Color(246, 229, 198), new Color(214, 142, 96));
    this.drawTree(g, 215, bottom + 95, 0.6);

    g.fillColor = new Color(196, 209, 142);
    g.ellipse(0, bottom - 60, 580, 140);
    g.fill();

    this.drawTree(g, -330, bottom + 35, 0.75);
    this.drawHouse(g, -265, bottom + 35, 0.85, new Color(252, 241, 214), new Color(224, 138, 86));
    this.drawHouse(g, -130, bottom + 35, 0.7, new Color(247, 232, 200), new Color(205, 124, 78));
    this.drawTree(g, -25, bottom + 35, 0.5);
    this.drawHouse(g, 95, bottom + 35, 0.78, new Color(252, 241, 214), new Color(224, 138, 86));
    this.drawHouse(g, 235, bottom + 35, 0.92, new Color(249, 235, 204), new Color(216, 130, 80));
    this.drawTree(g, 345, bottom + 35, 0.7);
  }

  private drawHouse(g: Graphics, x: number, groundY: number, s: number, body: Color, roof: Color) {
    g.fillColor = body;
    g.roundRect(x - 46 * s, groundY, 92 * s, 66 * s, 10 * s);
    g.fill();
    g.fillColor = roof;
    g.moveTo(x - 58 * s, groundY + 62 * s);
    g.lineTo(x, groundY + 112 * s);
    g.lineTo(x + 58 * s, groundY + 62 * s);
    g.close();
    g.fill();
    g.fillColor = new Color(141, 96, 61);
    g.roundRect(x - 11 * s, groundY, 22 * s, 32 * s, 7 * s);
    g.fill();
    g.fillColor = new Color(255, 219, 142);
    g.circle(x, groundY + 48 * s, 11 * s);
    g.fill();
  }

  private drawTree(g: Graphics, x: number, groundY: number, s: number) {
    g.fillColor = new Color(158, 116, 74);
    g.roundRect(x - 5 * s, groundY, 10 * s, 22 * s, 4 * s);
    g.fill();
    g.fillColor = new Color(164, 186, 116);
    g.circle(x - 18 * s, groundY + 32 * s, 18 * s);
    g.fill();
    g.circle(x + 18 * s, groundY + 32 * s, 18 * s);
    g.fill();
    g.fillColor = new Color(176, 196, 128);
    g.circle(x, groundY + 44 * s, 26 * s);
    g.fill();
  }

  private buildScatteredPaws(parent: Node, bottom: number) {
    const paws: Array<[number, number, number]> = [
      [-255, 252, 38],
      [-165, 218, 30],
      [-95, 258, 26],
      [195, 245, 34],
      [285, 210, 28],
      [332, 262, 24],
      [150, 180, 28],
      [-320, 180, 30],
    ];
    paws.forEach(([x, offsetY, size]) => {
      const paw = this.image(parent, 'loading/paw', x, bottom + offsetY, size, size * 93 / 97);
      paw.addComponent(UIOpacity).opacity = 55;
    });
  }

  private buildYarnBall(parent: Node, bottom: number) {
    const yarn = this.image(parent, 'loading/yarn_ball', 265, bottom + 178, 96, 63);
    tween(yarn)
      .repeatForever(
        tween()
          .to(1.1, { angle: 7 }, { easing: 'sineInOut' })
          .to(1.1, { angle: -7 }, { easing: 'sineInOut' }),
      )
      .start();
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
}
