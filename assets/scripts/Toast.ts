import { Color, Graphics, Label, Node, tween, Tween, UIOpacity, UITransform, Vec2, Vec3, view } from 'cc';

export interface ToastOptions {
  /** 垂直位置（屏幕中心为原点，y 轴向上），默认在顶部安全区/胶囊下方 */
  y?: number;
  /** 停留时长（毫秒），默认 2000 */
  duration?: number;
}

interface ToastState {
  node: Node;
  opacity: UIOpacity;
  shadow: Graphics;
  panel: Graphics;
  pawNode: Node;
  pawIcon: Graphics;
  label: Label;
  timer: ReturnType<typeof setTimeout> | null;
}

const PANEL_FILL = new Color(64, 46, 33, 242);
const PANEL_STROKE = new Color(255, 224, 158, 160);
const PANEL_INNER_HIGHLIGHT = new Color(255, 255, 255, 38);
const PAW_PAD_COLOR = new Color(255, 176, 150);
const PAW_PAD_HIGHLIGHT = new Color(255, 226, 216, 180);
const TEXT_COLOR = new Color(255, 250, 238);
const TEXT_SHADOW = new Color(38, 24, 14, 140);
const DROP_SHADOW = new Color(60, 36, 16, 75);
const FONT_SIZE = 23;
const PANEL_HEIGHT = 74;
const PAD_X = 30;
const PAW_SIZE = 28;
const PAW_GAP = 12;
const MIN_WIDTH = 240;
const MAX_WIDTH = 640;
// 顶部默认位：避开状态栏 + 微信胶囊（顶部预留 ≥90px），再让出页面顶栏高度
const TOP_INSET = 200;
const DEFAULT_DURATION = 2000;

// 提醒统一挂顶部；位置按调用时的可见尺寸现算，适配不同屏幕高度
function defaultY() {
  return view.getVisibleSize().height / 2 - TOP_INSET;
}

// 每个父节点（页面）同时只保留一条 toast，重复 show 时复用节点并重置计时
const registry = new WeakMap<object, ToastState>();

// 中文等全角字符按 1 个字宽估算，其余按 0.55，用于撑出胶囊底板宽度
function estimateWidth(text: string) {
  let units = 0;
  for (const ch of text) units += ch.codePointAt(0)! > 0x2e7f ? 1 : 0.55;
  return units;
}

export class Toast {
  static show(parent: Node, text: string, options: ToastOptions = {}) {
    if (!parent.isValid || !text) return;
    const state = Toast.acquire(parent);
    const y = options.y ?? defaultY();
    const duration = options.duration ?? DEFAULT_DURATION;

    state.node.setPosition(0, y);
    state.node.setSiblingIndex(parent.children.length - 1);

    const maxWidth = Math.min(MAX_WIDTH, view.getVisibleSize().width - 48);
    const textWidth = estimateWidth(text) * FONT_SIZE;
    const extraPawSpace = PAW_SIZE + PAW_GAP;
    const width = Math.min(maxWidth, Math.max(MIN_WIDTH, textWidth + PAD_X * 2 + extraPawSpace));
    const labelWidth = width - PAD_X * 2 - extraPawSpace;
    const lines = Math.min(3, Math.max(1, Math.ceil(textWidth / Math.max(120, labelWidth))));
    const height = Math.max(PANEL_HEIGHT, lines * (FONT_SIZE + 8) + 24);

    state.node.getComponent(UITransform)!.setContentSize(width, height);
    state.label.node.getComponent(UITransform)!.setContentSize(labelWidth, height - 24);

    // 阴影
    state.shadow.clear();
    state.shadow.fillColor = DROP_SHADOW;
    state.shadow.ellipse(0, -height / 2 - 8, width * 0.45, 14);
    state.shadow.fill();

    // 双层浮雕面板
    state.panel.clear();
    state.panel.lineWidth = 2.5;
    state.panel.fillColor = PANEL_FILL;
    state.panel.strokeColor = PANEL_STROKE;
    state.panel.roundRect(-width / 2, -height / 2, width, height, 24);
    state.panel.fill();
    state.panel.stroke();

    // 内高光微描边
    state.panel.lineWidth = 1.2;
    state.panel.strokeColor = PANEL_INNER_HIGHLIGHT;
    state.panel.roundRect(-width / 2 + 2.5, -height / 2 + 2.5, width - 5, height - 5, 21.5);
    state.panel.stroke();

    // 猫爪肉垫印章徽标（位于文字左侧）
    const pawCenterX = -width / 2 + PAD_X + PAW_SIZE / 2;
    state.pawNode.setPosition(pawCenterX, 0);
    state.pawIcon.clear();

    // 掌心大肉垫
    state.pawIcon.fillColor = PAW_PAD_COLOR;
    state.pawIcon.roundRect(-9, -8, 18, 13, 6);
    state.pawIcon.fill();

    // 掌心微高光
    state.pawIcon.fillColor = PAW_PAD_HIGHLIGHT;
    state.pawIcon.roundRect(-5, -5, 10, 6, 3);
    state.pawIcon.fill();

    // 3 个圆润脚趾
    state.pawIcon.fillColor = PAW_PAD_COLOR;
    state.pawIcon.circle(-8, 6.5, 3.8);
    state.pawIcon.circle(0, 9.2, 4.2);
    state.pawIcon.circle(8, 6.5, 3.8);
    state.pawIcon.fill();

    // 文字位置排在猫爪右侧并居中居左协调排布
    state.label.node.setPosition(pawCenterX + PAW_SIZE / 2 + PAW_GAP + labelWidth / 2, 0);
    state.label.string = text;

    // 缩放 tween 挂在节点、透明度 tween 挂在 UIOpacity 上，两处都要停，避免旧淡出动画销毁新 toast
    Tween.stopAllByTarget(state.node);
    Tween.stopAllByTarget(state.opacity);
    state.opacity.opacity = 0;
    state.node.setScale(new Vec3(0.68, 0.68, 1));
    tween(state.node)
      .to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(state.opacity).to(0.12, { opacity: 255 }).start();

    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (!state.node.isValid) return;
      Tween.stopAllByTarget(state.node);
      Tween.stopAllByTarget(state.opacity);
      const curY = state.node.position.y;
      tween(state.node)
        .to(0.18, { scale: new Vec3(0.85, 0.85, 1), position: new Vec3(0, curY + 16, 0) }, { easing: 'cubicIn' })
        .start();
      tween(state.opacity)
        .to(0.18, { opacity: 0 })
        .call(() => {
          if (state.node.isValid) state.node.destroy();
        })
        .start();
    }, duration);
  }

  static hide(parent: Node) {
    const state = registry.get(parent);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.node.isValid) {
      Tween.stopAllByTarget(state.node);
      Tween.stopAllByTarget(state.opacity);
      state.node.destroy();
    }
    registry.delete(parent);
  }

  private static acquire(parent: Node): ToastState {
    const existing = registry.get(parent);
    if (existing && existing.node.isValid) return existing;

    const node = new Node('Toast');
    parent.addChild(node);
    node.addComponent(UITransform);
    const opacity = node.addComponent(UIOpacity);

    const shadowNode = new Node('ToastShadow');
    node.addChild(shadowNode);
    const shadow = shadowNode.addComponent(Graphics);

    const panelNode = new Node('ToastPanel');
    node.addChild(panelNode);
    const panel = panelNode.addComponent(Graphics);

    const pawNode = new Node('ToastPaw');
    panelNode.addChild(pawNode);
    pawNode.addComponent(UITransform).setContentSize(PAW_SIZE, PAW_SIZE);
    const pawIcon = pawNode.addComponent(Graphics);

    const labelNode = new Node('ToastLabel');
    panelNode.addChild(labelNode);
    const label = labelNode.addComponent(Label);
    label.fontSize = FONT_SIZE;
    label.lineHeight = FONT_SIZE + 8;
    label.color = TEXT_COLOR;
    label.isBold = true;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.enableWrapText = true;
    label.overflow = Label.Overflow.SHRINK;
    label.enableShadow = true;
    label.shadowColor = TEXT_SHADOW;
    label.shadowOffset = new Vec2(0, -2);

    const state: ToastState = { node, opacity, shadow, panel, pawNode, pawIcon, label, timer: null };
    registry.set(parent, state);
    return state;
  }
}
