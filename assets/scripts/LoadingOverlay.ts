import { _decorator, BlockInputEvents, Color, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';

const { ccclass } = _decorator;

// 猫爪步迹：6 个爪印按节奏逐个落下，走完后整体淡出再重走
const PAW_COUNT = 6;
const PAW_STAGGER = 0.3;

/**
 * 点菜单进入二级页面时的轻量加载动画：「小猫追毛线球」。
 * 毛线球在面板上方来回滚，爪印一串啪嗒啪嗒走过，文案带跳动的省略号。
 * 全部用 Graphics 绘制，不依赖任何图片资源，随时可安全弹出。
 */
@ccclass('LoadingOverlay')
export class LoadingOverlay {
  private overlayNode: Node | null = null;
  private messageLabel: Label | null = null;
  private pawPrints: Node[] = [];
  private baseMessage = '';
  private dotCount = 0;
  private destroyed = false;
  // 两个补间代理：省略号跳字、爪印循环排期。销毁时统一 stop，避免残留补间。
  private readonly dotsProxy = { tick: 0 };
  private readonly loopProxy = { tick: 0 };

  constructor(private parent: Node) {}

  show(message: string = '加载中') {
    if (this.overlayNode?.isValid) return;
    this.destroyed = false;
    this.baseMessage = message.replace(/[.。…]*$/, '');

    const overlay = new Node('LoadingOverlay');
    this.parent.addChild(overlay);
    this.overlayNode = overlay;
    overlay.setSiblingIndex(this.parent.children.length - 1);

    const transform = overlay.addComponent(UITransform);
    const parentTransform = this.parent.getComponent(UITransform);
    const width = parentTransform?.width || 750;
    const height = parentTransform?.height || 1334;
    transform.setContentSize(width, height);
    // 透明遮罩也要吞掉触摸，加载中不能点穿到底下页面
    overlay.addComponent(BlockInputEvents);

    const container = new Node('LoadingContainer');
    overlay.addChild(container);

    this.buildPanel(container);
    this.buildYarnTrail(container);
    this.buildPawPrints(container);
    this.buildMessage(container);

    // 入场：淡入 + 回弹
    const opacity = overlay.addComponent(UIOpacity);
    opacity.opacity = 0;
    container.setScale(new Vec3(0.8, 0.8, 1));
    tween(opacity).to(0.25, { opacity: 255 }).start();
    tween(container).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private buildPanel(container: Node) {
    const panel = new Node('LoadingPanel');
    container.addChild(panel);
    panel.addComponent(UITransform).setContentSize(360, 360);
    const graphics = panel.addComponent(Graphics);
    graphics.fillColor = new Color(255, 248, 226, 255);
    graphics.roundRect(-180, -180, 360, 360, 28);
    graphics.fill();
    graphics.strokeColor = new Color(235, 205, 158, 255);
    graphics.lineWidth = 4;
    graphics.roundRect(-180, -180, 360, 360, 28);
    graphics.stroke();
  }

  // 毛线球沿着地上拖出的线来回滚，滚动方向与位移方向一致
  private buildYarnTrail(container: Node) {
    const thread = new Node('YarnThread');
    container.addChild(thread);
    thread.setPosition(0, 66);
    const threadGraphics = thread.addComponent(Graphics);
    threadGraphics.strokeColor = new Color(200, 132, 64, 160);
    threadGraphics.lineWidth = 4;
    threadGraphics.moveTo(-150, 0);
    for (let x = -150; x < 150; x += 25) {
      threadGraphics.quadraticCurveTo(x + 12.5, x / 25 % 2 === 0 ? 10 : -10, x + 25, 0);
    }
    threadGraphics.stroke();

    const ball = new Node('YarnBall');
    container.addChild(ball);
    ball.setPosition(-118, 96);
    ball.addComponent(UITransform).setContentSize(60, 60);
    const graphics = ball.addComponent(Graphics);
    graphics.fillColor = new Color(255, 224, 108, 255);
    graphics.circle(0, 0, 30);
    graphics.fill();
    graphics.strokeColor = new Color(200, 132, 64, 220);
    graphics.lineWidth = 3;
    graphics.arc(0, 0, 22, -1.2, 1.2, false);
    graphics.stroke();
    graphics.arc(0, 0, 14, 1.8, 4.6, false);
    graphics.stroke();
    graphics.arc(0, 0, 26, 2.7, 3.9, false);
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 110);
    graphics.circle(-9, -11, 6);
    graphics.fill();

    this.startYarnRoll(ball, true);
  }

  private startYarnRoll(ball: Node, toRight: boolean) {
    if (this.destroyed || !ball.isValid) return;
    const targetX = toRight ? 118 : -118;
    // 球往右滚时顺时针转（负角度），位移与旋转同拍，看起来像真的在滚
    tween(ball)
      .to(2.0, {
        position: new Vec3(targetX, ball.position.y, 0),
        angle: ball.angle + (toRight ? -540 : 540),
      }, { easing: 'sineInOut' })
      .call(() => this.startYarnRoll(ball, !toRight))
      .start();
  }

  // 一串小爪印：左右脚交替、微微外八，沿面板中部走过去
  private buildPawPrints(container: Node) {
    this.pawPrints = [];
    for (let i = 0; i < PAW_COUNT; i += 1) {
      const paw = new Node('PawPrint');
      container.addChild(paw);
      const step = i - (PAW_COUNT - 1) / 2;
      paw.setPosition(step * 54, i % 2 === 0 ? -20 : -4);
      paw.angle = i % 2 === 0 ? -9 : 9;
      paw.addComponent(UITransform).setContentSize(34, 34);
      const graphics = paw.addComponent(Graphics);
      graphics.fillColor = new Color(145, 99, 54, 255);
      graphics.ellipse(0, -6, 12, 9);
      graphics.fill();
      graphics.circle(-13, 7, 4.4);
      graphics.fill();
      graphics.circle(-4.5, 13, 4.4);
      graphics.fill();
      graphics.circle(4.5, 13, 4.4);
      graphics.fill();
      graphics.circle(13, 7, 4.4);
      graphics.fill();
      const opacity = paw.addComponent(UIOpacity);
      opacity.opacity = 0;
      paw.setScale(0.4, 0.4, 1);
      this.pawPrints.push(paw);
    }
    this.playPawTrail();
  }

  private playPawTrail() {
    if (this.destroyed) return;
    const prints = this.pawPrints.filter(paw => paw.isValid);
    prints.forEach((paw, i) => {
      paw.setScale(0.4, 0.4, 1);
      const opacity = paw.getComponent(UIOpacity)!;
      opacity.opacity = 0;
      const delay = 0.25 + i * PAW_STAGGER;
      tween(opacity).delay(delay).to(0.18, { opacity: 255 }).start();
      tween(paw).delay(delay).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    });
    // 一串走完后停留片刻，整体淡出，再从头走
    const hold = 0.25 + prints.length * PAW_STAGGER + 1.15;
    tween(this.loopProxy)
      .delay(hold)
      .call(() => {
        if (this.destroyed) return;
        prints.forEach(paw => {
          const opacity = paw.getComponent(UIOpacity)!;
          tween(opacity).to(0.35, { opacity: 0 }).start();
        });
        tween(this.loopProxy)
          .delay(0.55)
          .call(() => this.playPawTrail())
          .start();
      })
      .start();
  }

  private buildMessage(container: Node) {
    const messageNode = new Node('MessageLabel');
    container.addChild(messageNode);
    messageNode.setPosition(0, -96);
    this.messageLabel = messageNode.addComponent(Label);
    this.messageLabel.string = this.baseMessage;
    this.messageLabel.fontSize = 26;
    this.messageLabel.lineHeight = 34;
    this.messageLabel.color = new Color(112, 69, 40);
    this.messageLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.messageLabel.isBold = true;
    this.startDotsLoop();

    const subtitleNode = new Node('SubtitleLabel');
    container.addChild(subtitleNode);
    subtitleNode.setPosition(0, -132);
    const subtitleLabel = subtitleNode.addComponent(Label);
    subtitleLabel.string = '小猫正在赶路，马上就好';
    subtitleLabel.fontSize = 18;
    subtitleLabel.lineHeight = 24;
    subtitleLabel.color = new Color(145, 99, 54, 200);
    subtitleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
  }

  // 文案省略号 0~3 个循环跳动
  private startDotsLoop() {
    if (this.destroyed || !this.messageLabel) return;
    this.dotCount = (this.dotCount + 1) % 4;
    this.messageLabel.string = this.baseMessage + '.'.repeat(this.dotCount);
    tween(this.dotsProxy)
      .delay(0.35)
      .call(() => this.startDotsLoop())
      .start();
  }

  private stopLoops() {
    this.destroyed = true;
    Tween.stopAllByTarget(this.dotsProxy);
    Tween.stopAllByTarget(this.loopProxy);
  }

  hide(callback?: () => void) {
    this.stopLoops();
    if (!this.overlayNode?.isValid) {
      callback?.();
      return;
    }

    const overlay = this.overlayNode;
    const container = overlay.getChildByName('LoadingContainer');
    const opacity = overlay.getComponent(UIOpacity);
    const finish = () => {
      if (overlay?.isValid) overlay.destroy();
      this.overlayNode = null;
      this.pawPrints = [];
      this.messageLabel = null;
      callback?.();
    };

    if (container && opacity) {
      tween(container)
        .to(0.25, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backIn' })
        .start();
      tween(opacity)
        .to(0.3, { opacity: 0 })
        .call(finish)
        .start();
    } else {
      finish();
    }
  }

  destroy() {
    this.stopLoops();
    if (this.overlayNode?.isValid) {
      this.overlayNode.destroy();
    }
    this.overlayNode = null;
    this.pawPrints = [];
    this.messageLabel = null;
  }
}
