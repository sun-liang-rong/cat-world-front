import { Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';

// 第 1 关开场新手教学（方案 A）：3 步状态机，全程不拦截点击。
// 设计文档见工作区《第1关新手教学设计.md》。核心约束：
// - 高亮集合永远是「当前棋盘暴露牌 ∩ 目标种类」的纯函数，每次棋盘变动后重算，
//   状态机不持有具体牌引用，牌被收走/移除/重排都不会悬挂；
// - 玩家点了非目标种类的暴露牌时顺着他引导（targetKind 切换），不强制特定牌；
// - 完成点必然是玩家的第一次三消（教学不可能晚于第一次三消完成）。

export interface BoardTutorialHost {
  /** 教学覆盖层挂载点（GameScreen 的 gameUI，教学层在其最上） */
  uiRoot: Node;
  /** 引导文案条的 y（目标栏下方，由 GameScreen 按 header 排版计算） */
  bannerY: number;
  /** 三消庆祝提示的 y（棋盘几何中心） */
  celebrateY: number;
  /** 当前完全暴露、未入槽的牌（含种类），每次棋盘变动后由 GameScreen 提供 */
  getExposedTiles: () => Array<{ node: Node; kind: number }>;
  /** 第一次三消时回调一次（GameScreen 转写存档标记） */
  onDone: () => void;
}

const STEP_TEXT_COLLECT = '点击亮起的卡片，收到底部槽位';
const STEP_TEXT_MATCH = '再收集相同的卡片，凑齐 3 个';
const TEXT_CELEBRATE = '三个相同，自动消除！';
const TEXT_FINAL = '清空所有卡片即可通关';

const RING_COLOR = new Color(255, 224, 108);
const PANEL_FILL = new Color(255, 248, 226, 242);
const PANEL_STROKE = new Color(235, 205, 158);
const TEXT_COLOR = new Color(112, 69, 40);

/** 单屏高亮环上限：目标种类暴露牌再多也不铺满屏 */
const MAX_RINGS = 6;

type Step = 'collect' | 'match' | 'celebrate' | 'final';

export class BoardTutorial {
  private step: Step = 'collect';
  private started = false;
  private destroyed = false;
  private targetKind: number | null = null;
  private lastCollectedKind: number | null = null;
  private readonly rings: Node[] = [];
  private banner: Node | null = null;
  private bannerLabel: Label | null = null;
  private celebrateNode: Node | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: BoardTutorialHost) {}

  /** 棋盘入场动画完成后调用（GameScreen.finishBoardIntroIfIdle） */
  begin() {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.targetKind = this.pickTargetKind();
    this.banner = this.buildBanner(STEP_TEXT_COLLECT);
    this.refreshHighlight();
  }

  /** 玩家从棋盘收走一张牌（无论是否目标种类，不拦截原则） */
  notifyTileCollected(kind: number) {
    if (!this.started || this.destroyed) return;
    if (this.step === 'collect') {
      // 顺着他点的种类继续教学
      this.step = 'match';
      this.targetKind = kind;
    }
    this.lastCollectedKind = kind;
    this.setBannerText(STEP_TEXT_MATCH);
    this.refreshHighlight();
  }

  /** 任意一次三消结算成功：教学完成，写存档标记 */
  notifyMatch() {
    if (!this.started || this.destroyed || this.step === 'celebrate' || this.step === 'final') return;
    this.step = 'celebrate';
    this.host.onDone();
    this.clearRings();
    this.banner?.destroy();
    this.banner = null;
    this.bannerLabel = null;
    this.playCelebrate();
  }

  /** 棋盘变动后重算高亮（GameScreen.refreshBoardTileStates 汇聚点，含入场/收集/道具/补波） */
  refreshHighlight() {
    if (!this.started || this.destroyed) return;
    this.clearRings();
    const exposed = this.host.getExposedTiles();
    const focusKind = this.step === 'match' ? this.lastCollectedKind : this.targetKind;
    const sameKind = focusKind === null
      ? []
      : exposed.filter(tile => tile.kind === focusKind);
    // 目标种类的暴露牌一枚不剩时（被道具清掉等），放宽为全部暴露牌
    const targets = sameKind.length > 0 ? sameKind : exposed;
    targets.slice(0, MAX_RINGS).forEach(tile => {
      const ring = this.buildRing(tile.node);
      if (ring) this.rings.push(ring);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.finalTimer) clearTimeout(this.finalTimer);
    this.finalTimer = null;
    this.clearRings();
    this.banner?.destroy();
    this.banner = null;
    this.bannerLabel = null;
    if (this.celebrateNode) {
      Tween.stopAllByTarget(this.celebrateNode);
      this.celebrateNode.destroy();
      this.celebrateNode = null;
    }
  }

  // 目标种类 = 开局暴露牌中数量最多的种类（并列取先出现者）
  private pickTargetKind() {
    const counts = new Map<number, number>();
    this.host.getExposedTiles().forEach(tile => {
      counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1);
    });
    let best: number | null = null;
    let bestCount = 0;
    counts.forEach((count, kind) => {
      if (count > bestCount) {
        best = kind;
        bestCount = count;
      }
    });
    return best;
  }

  /** 高亮环挂在牌节点下：牌被收走时环跟随飞行动画，牌销毁时环随之销毁 */
  private buildRing(tile: Node) {
    if (!tile.isValid) return null;
    const transform = tile.getComponent(UITransform);
    const width = (transform?.width ?? 104) + 24;
    const height = (transform?.height ?? 107) + 24;
    const ring = new Node('TutorialRing');
    tile.addChild(ring);
    ring.addComponent(UITransform).setContentSize(width, height);
    const graphics = ring.addComponent(Graphics);
    graphics.strokeColor = RING_COLOR;
    graphics.lineWidth = 6;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.stroke();
    const opacity = ring.addComponent(UIOpacity);
    opacity.opacity = 235;
    tween(ring)
      .repeatForever(
        tween()
          .to(0.75, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
          .to(0.75, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
    return ring;
  }

  private clearRings() {
    this.rings.forEach(ring => {
      if (!ring.isValid) return;
      Tween.stopAllByTarget(ring);
      ring.destroy();
    });
    this.rings.length = 0;
  }

  private buildBanner(text: string) {
    const banner = new Node('TutorialBanner');
    this.host.uiRoot.addChild(banner);
    banner.setPosition(0, this.host.bannerY);
    banner.addComponent(UITransform).setContentSize(440, 64);
    const graphics = banner.addComponent(Graphics);
    graphics.fillColor = PANEL_FILL;
    graphics.strokeColor = PANEL_STROKE;
    graphics.lineWidth = 3;
    graphics.roundRect(-220, -32, 440, 64, 24);
    graphics.fill();
    graphics.stroke();

    const label = this.label(banner, text, 0, 0, 22, TEXT_COLOR);
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(412, 32);
    this.bannerLabel = label;

    banner.setScale(new Vec3(0.8, 0.8, 1));
    tween(banner)
      .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    return banner;
  }

  private setBannerText(text: string) {
    if (!this.bannerLabel || !this.banner?.isValid) return;
    this.bannerLabel.string = text;
    // 步骤切换时轻缩放提醒一次
    Tween.stopAllByTarget(this.banner);
    this.banner.setScale(new Vec3(0.94, 0.94, 1));
    tween(this.banner)
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  private playCelebrate() {
    const node = new Node('TutorialCelebrate');
    this.host.uiRoot.addChild(node);
    node.setPosition(0, this.host.celebrateY);
    node.addComponent(UITransform).setContentSize(560, 120);
    const label = this.label(node, TEXT_CELEBRATE, 0, 0, 34, RING_COLOR);
    label.isBold = true;
    label.outlineWidth = 4;
    label.outlineColor = new Color(90, 61, 38);
    label.enableShadow = true;
    label.shadowColor = new Color(60, 40, 24, 140);
    label.shadowOffset = new Vec2(0, -4);
    const opacity = node.addComponent(UIOpacity);
    node.setScale(new Vec3(0.6, 0.6, 1));
    this.celebrateNode = node;
    tween(node)
      .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(opacity)
      .delay(1.0)
      .to(0.3, { opacity: 0 })
      .call(() => this.playFinalTip())
      .start();
  }

  private playFinalTip() {
    if (this.destroyed) return;
    if (this.celebrateNode) {
      Tween.stopAllByTarget(this.celebrateNode);
      this.celebrateNode.destroy();
      this.celebrateNode = null;
    }
    this.step = 'final';
    this.banner = this.buildBanner(TEXT_FINAL);
    this.finalTimer = setTimeout(() => {
      this.finalTimer = null;
      this.destroy();
    }, 3000);
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
}
