import { Color, Graphics, Label, Node, tween, Tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';

export interface ToastOptions {
  /** 垂直位置（屏幕中心为原点，y 轴向上），默认 -150 */
  y?: number;
  /** 停留时长（毫秒），默认 2000 */
  duration?: number;
}

interface ToastState {
  node: Node;
  opacity: UIOpacity;
  shadow: Graphics;
  panel: Graphics;
  label: Label;
  timer: ReturnType<typeof setTimeout> | null;
}

const PANEL_FILL = new Color(74, 58, 44, 236);
const PANEL_STROKE = new Color(255, 248, 226, 90);
const TEXT_COLOR = new Color(255, 250, 235);
const TEXT_SHADOW = new Color(0, 0, 0, 110);
const DROP_SHADOW = new Color(92, 54, 22, 80);
const FONT_SIZE = 23;
const PANEL_HEIGHT = 74;
const PAD_X = 34;
const MIN_WIDTH = 220;
const MAX_WIDTH = 640;
const DEFAULT_Y = -150;
const DEFAULT_DURATION = 2000;

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
    const y = options.y ?? DEFAULT_Y;
    const duration = options.duration ?? DEFAULT_DURATION;

    state.node.setPosition(0, y);
    state.node.setSiblingIndex(parent.children.length - 1);

    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, estimateWidth(text) * FONT_SIZE + PAD_X * 2));
    state.shadow.clear();
    state.shadow.fillColor = DROP_SHADOW;
    state.shadow.ellipse(0, -PANEL_HEIGHT / 2 - 8, width * 0.44, 13);
    state.shadow.fill();
    state.panel.clear();
    state.panel.lineWidth = 3;
    state.panel.fillColor = PANEL_FILL;
    state.panel.strokeColor = PANEL_STROKE;
    state.panel.roundRect(-width / 2, -PANEL_HEIGHT / 2, width, PANEL_HEIGHT, PANEL_HEIGHT / 2);
    state.panel.fill();
    state.panel.stroke();
    state.label.string = text;

    // 缩放 tween 挂在节点、透明度 tween 挂在 UIOpacity 上，两处都要停，避免旧淡出动画销毁新 toast
    Tween.stopAllByTarget(state.node);
    Tween.stopAllByTarget(state.opacity);
    state.opacity.opacity = 0;
    state.node.setScale(new Vec3(0.72, 0.72, 1));
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
      tween(state.node)
        .to(0.16, { scale: new Vec3(0.85, 0.85, 1) }, { easing: 'cubicIn' })
        .start();
      tween(state.opacity)
        .to(0.16, { opacity: 0 })
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
    const labelNode = new Node('ToastLabel');
    panelNode.addChild(labelNode);
    const label = labelNode.addComponent(Label);
    label.fontSize = FONT_SIZE;
    label.lineHeight = FONT_SIZE + 8;
    label.color = TEXT_COLOR;
    label.isBold = true;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.enableShadow = true;
    label.shadowColor = TEXT_SHADOW;
    label.shadowOffset = new Vec2(0, -3);

    const state: ToastState = { node, opacity, shadow, panel, label, timer: null };
    registry.set(parent, state);
    return state;
  }
}
