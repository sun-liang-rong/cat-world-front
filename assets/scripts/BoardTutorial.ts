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

const STEP_TEXT_COLLECT = '👆 点击任意亮起的卡片';
const STEP_TEXT_MATCH = '✨ 继续点击相同的卡片凑齐3个';
const TEXT_CELEBRATE = '🎉 太棒了！三消成功！';
const TEXT_FINAL = '💪 继续加油，清空所有卡片通关';

// 升级配色：更鲜艳的强调色 + 柔和阴影
const RING_COLOR = new Color(255, 200, 80);        // 更亮的金黄
const RING_GLOW = new Color(255, 240, 180, 100);   // 外发光
const PANEL_FILL = new Color(255, 248, 226);       // 奶油底
const PANEL_STROKE = new Color(235, 205, 158);     // 描边
const PANEL_SHADOW = new Color(92, 54, 22, 120);   // 投影
const TEXT_COLOR = new Color(111, 62, 28);         // 深棕标题色
const CELEBRATE_COLOR = new Color(255, 140, 60);   // 庆祝橙色

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

    // 新逻辑：只在 collect 阶段高亮所有同类卡牌，match 阶段不高亮
    if (this.step !== 'collect') return;

    const exposed = this.host.getExposedTiles();
    const focusKind = this.targetKind;
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

  /** 高亮环挂在牌节点下：卡牌边缘紧贴一圈明显的金色亮光 */
  private buildRing(tile: Node) {
    if (!tile.isValid) return null;
    const transform = tile.getComponent(UITransform);
    const width = transform?.width ?? 104;
    const height = transform?.height ?? 107;
    const ring = new Node('TutorialRing');
    tile.addChild(ring);
    ring.addComponent(UITransform).setContentSize(width, height);

    // 外层柔和发光（造成立体感）
    const glow = new Node('Glow');
    ring.addChild(glow);
    glow.addComponent(UITransform).setContentSize(width + 8, height + 8);
    const glowGraphics = glow.addComponent(Graphics);
    glowGraphics.strokeColor = new Color(255, 220, 120, 180);  // 半透明金黄
    glowGraphics.lineWidth = 4;
    glowGraphics.roundRect(-(width + 8) / 2, -(height + 8) / 2, width + 8, height + 8, 14);
    glowGraphics.stroke();

    // 内层鲜艳金色边框（主视觉）
    const border = new Node('Border');
    ring.addChild(border);
    border.addComponent(UITransform).setContentSize(width, height);
    const graphics = border.addComponent(Graphics);
    graphics.strokeColor = new Color(255, 215, 0);  // 更亮的金黄
    graphics.lineWidth = 8;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.stroke();

    // 呼吸动画：透明度 + 缩放
    tween(ring)
      .repeatForever(
        tween()
          .to(0.5, { scale: new Vec3(1.03, 1.03, 1) }, { easing: 'sineInOut' })
          .to(0.5, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
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
    banner.addComponent(UITransform).setContentSize(480, 80);

    // 投影层（模拟立体感）
    const shadow = new Node('Shadow');
    banner.addChild(shadow);
    shadow.setPosition(0, -6);
    shadow.addComponent(UITransform).setContentSize(480, 80);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = PANEL_SHADOW;
    shadowGraphics.roundRect(-240, -40, 480, 80, 32);
    shadowGraphics.fill();

    // 主面板
    const panel = new Node('Panel');
    banner.addChild(panel);
    panel.addComponent(UITransform).setContentSize(480, 80);
    const graphics = panel.addComponent(Graphics);
    graphics.fillColor = PANEL_FILL;
    graphics.strokeColor = PANEL_STROKE;
    graphics.lineWidth = 4;
    graphics.roundRect(-240, -40, 480, 80, 32);
    graphics.fill();
    graphics.stroke();

    // 内层装饰高光（顶部浅色条）
    const highlight = new Node('Highlight');
    panel.addChild(highlight);
    highlight.setPosition(0, 18);
    highlight.addComponent(UITransform).setContentSize(440, 8);
    const hlGraphics = highlight.addComponent(Graphics);
    hlGraphics.fillColor = new Color(255, 255, 255, 60);
    hlGraphics.roundRect(-220, -4, 440, 8, 4);
    hlGraphics.fill();

    const label = this.label(panel, text, 0, 0, 24, TEXT_COLOR);
    label.isBold = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.node.getComponent(UITransform)!.setContentSize(440, 50);
    this.bannerLabel = label;

    // 更弹性的入场动画
    banner.setScale(new Vec3(0.75, 0.75, 1));
    const opacity = banner.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(banner)
      .to(0.25, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'backOut' })
      .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
      .start();
    tween(opacity)
      .to(0.2, { opacity: 255 })
      .start();
    return banner;
  }

  private setBannerText(text: string) {
    if (!this.bannerLabel || !this.banner?.isValid) return;
    this.bannerLabel.string = text;
    // 步骤切换时更明显的脉冲动画
    Tween.stopAllByTarget(this.banner);
    this.banner.setScale(new Vec3(0.92, 0.92, 1));
    tween(this.banner)
      .to(0.12, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'quadOut' })
      .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  private playCelebrate() {
    const node = new Node('TutorialCelebrate');
    this.host.uiRoot.addChild(node);
    node.setPosition(0, this.host.celebrateY);
    node.addComponent(UITransform).setContentSize(600, 140);

    // 庆祝文字带多层效果：外发光 + 描边 + 阴影
    const label = this.label(node, TEXT_CELEBRATE, 0, 0, 40, CELEBRATE_COLOR);
    label.isBold = true;
    label.outlineWidth = 5;
    label.outlineColor = new Color(90, 61, 38);
    label.enableShadow = true;
    label.shadowColor = new Color(60, 40, 24, 180);
    label.shadowOffset = new Vec2(0, -6);

    const opacity = node.addComponent(UIOpacity);
    node.setScale(new Vec3(0.5, 0.5, 1));
    this.celebrateNode = node;

    // 更夸张的庆祝弹出动画
    tween(node)
      .to(0.28, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
      .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
      .start();
    tween(opacity)
      .delay(1.2)
      .to(0.35, { opacity: 0 }, { easing: 'sineIn' })
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
