import { ActionAppearance, ensureButtonControl, Theme } from './Theme';
import { Button, Color, Graphics, Label, Node, Sprite, UITransform, Vec2, Vec3 } from 'cc';
import { AssetStore } from './AssetStore';

export type SettlementButtonTone = 'orange' | 'green' | 'pink' | 'purple' | 'red';
export type SettlementButtonIcon = 'replay' | 'next' | 'video' | 'home' | 'paw' | 'share';

const TONE_PATHS: Record<SettlementButtonTone, string> = {
  orange: 'popup/btn_orange',
  green: 'popup/btn_green',
  pink: 'popup/btn_pink',
  purple: 'popup/btn_purple',
  red: 'popup2/btn_red',
};

export interface SettlementButtonOptions {
  text: string;
  tone: SettlementButtonTone;
  onClick: () => void;
  /** 布局盒尺寸（设计像素），统一 Graphics 圆角底板 */
  width?: number;
  height?: number;
  /** 整体等比缩放；主操作至少 96px 高，次操作至少 88px 高。 */
  scale?: number;
  fontSize?: number;
  /** 橙金木纹主操作 / 浅金木纹次操作。 */
  appearance?: 'primary' | 'secondary';
  /** 可选语义图标，以 Graphics 绘制，保持不同分辨率下的清晰度。 */
  icon?: SettlementButtonIcon;
}

interface ActionButtonVisualState {
  appearance: ActionAppearance;
  width: number;
  height: number;
  labels: Set<Label>;
}

/**
 * 结算操作组件：橙金主按钮、浅金次按钮和动态文案。旧 tone 参数保留调用兼容。
 */
export class SettlementButton {
  private static readonly visualStates = new WeakMap<Node, ActionButtonVisualState>();
  /** 按钮素材路径；宿主页面需把这些路径加入 AssetStore.loadImages 预加载 */
  static readonly imagePaths: string[] = Object.values(TONE_PATHS);
  /** 默认布局盒宽（设计像素） */
  static readonly WIDTH = 200;
  /** 默认布局盒高（设计像素） */
  static readonly HEIGHT = 80;
  /** 默认缩放下限；create 会按主次操作补足实际高度。 */
  static readonly SCALE = 1.12;

  static create(parent: Node, assets: AssetStore, options: SettlementButtonOptions): Node {
    const width = options.width ?? SettlementButton.WIDTH;
    const height = options.height ?? SettlementButton.HEIGHT;
    const fontSize = options.fontSize ?? 28;

    const node = new Node(`SettlementButton_${options.tone}`);
    parent.addChild(node);
    node.addComponent(UITransform).setContentSize(width, height);
    const appearance = options.appearance ?? (options.tone === 'orange' || options.tone === 'green' ? 'primary' : 'secondary');
    SettlementButton.draw(node.addComponent(Graphics), width, height, appearance);

    const hasIcon = !!options.icon && appearance === 'secondary';
    if (hasIcon) {
      const iconNode = new Node(`Icon_${options.icon}`);
      node.addChild(iconNode);
      const size = 36;
      iconNode.addComponent(UITransform).setContentSize(size, size);
      iconNode.setPosition(-width / 2 + 32, 2);
      SettlementButton.drawIcon(iconNode.addComponent(Graphics), options.icon, size, appearance);
    }

    const labelNode = new Node('Label');
    node.addChild(labelNode);
    labelNode.addComponent(UITransform);
    const label = labelNode.addComponent(Label);
    label.string = options.text;
    SettlementButton.styleLabel(label, width, height, fontSize);

    const scale = Math.max(options.scale ?? SettlementButton.SCALE, (appearance === 'primary' ? 96 : 88) / height);
    node.setScale(new Vec3(scale, scale, 1));
    const button = node.addComponent(Button);
    ensureButtonControl(button, scale);
    button.node.on(Button.EventType.CLICK, options.onClick);
    return node;
  }

  /** 接入已有按钮节点，保留位置、点击回调、内层动画及页面持有的引用。 */
  static apply(node: Node, appearance: ActionAppearance = 'primary', width?: number, height?: number): Graphics {
    const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
    const previous = SettlementButton.visualStates.get(node);
    const w = width ?? previous?.width ?? transform.width;
    const h = height ?? previous?.height ?? transform.height;
    const sprite = node.getComponent(Sprite);
    if (sprite) sprite.enabled = false;
    // Sprite / Label 已占用节点的 UIRenderer 槽位时，在内层绘制底板。
    let surface = node;
    if (sprite || node.getComponent(Label)) {
      surface = node.getChildByName('ActionSurface') || new Node('ActionSurface');
      if (!surface.parent) node.addChild(surface);
      surface.setSiblingIndex(0);
      const surfaceTransform = surface.getComponent(UITransform) || surface.addComponent(UITransform);
      surfaceTransform.setContentSize(w, h);
    }
    const graphics = surface.getComponent(Graphics) || surface.addComponent(Graphics);
    SettlementButton.draw(graphics, w, h, appearance);
    SettlementButton.visualStates.set(node, SettlementButton.visualStates.get(surface)!);
    transform.setContentSize(Math.max(88, w), Math.max(88, h));
    const iconNode = node.children.find(child => child.name.startsWith('Icon_'));
    if (iconNode) {
      SettlementButton.drawIcon(
        iconNode.getComponent(Graphics)!,
        iconNode.name.substring(5) as SettlementButtonIcon,
        iconNode.getComponent(UITransform)!.width,
        appearance,
      );
    }
    return graphics;
  }

  /** 广告、购买、领取等状态更新共用同一个入口。 */
  static setAppearance(node: Node, appearance: ActionAppearance): void {
    SettlementButton.apply(node, appearance);
  }

  /** 旧页面持有 Graphics 引用时，也使用组件底板并同步已登记的文字样式。 */
  static draw(graphics: Graphics, width: number, height: number, appearance: ActionAppearance = 'primary'): void {
    let state = SettlementButton.visualStates.get(graphics.node);
    if (!state) {
      state = { appearance, width, height, labels: new Set<Label>() };
      SettlementButton.visualStates.set(graphics.node, state);
    }
    state.appearance = appearance;
    state.width = width;
    state.height = height;
    SettlementButton.drawSurface(graphics, width, height, appearance);
    for (const label of state.labels) {
      if (!label.isValid) state.labels.delete(label);
      else SettlementButton.applyLabelAppearance(label, state);
    }
  }

  static styleLabel(label: Label, width: number, height: number, fontSize = 24): void {
    label.fontSize = Math.max(20, fontSize);
    label.lineHeight = label.fontSize + 8;
    label.isBold = true;
    label.enableWrapText = false;
    label.overflow = Label.Overflow.SHRINK;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    let owner: Node | null = label.node;
    while (owner && !SettlementButton.visualStates.has(owner)) owner = owner.parent;
    const state = owner ? SettlementButton.visualStates.get(owner)! : {
      appearance: 'primary' as ActionAppearance, width, height, labels: new Set<Label>(),
    };
    state.labels.add(label);
    SettlementButton.applyLabelAppearance(label, state);
  }

  private static applyLabelAppearance(label: Label, state: ActionButtonVisualState): void {
    const hasIcon = label.node.parent?.children.some(child => child.name.startsWith('Icon_')) ?? false;
    if (state.appearance === 'primary') SettlementButton.stylePrimaryLabel(label, state.width, state.height);
    else SettlementButton.styleSecondaryLabel(label, state.width, state.height, hasIcon, state.appearance === 'disabled');
  }

  private static styleSecondaryLabel(label: Label, width: number, height: number, hasIcon: boolean, disabled = false): void {
    label.color = disabled ? new Color(245, 239, 224) : new Color(255, 253, 225);
    label.outlineColor = disabled ? new Color(159, 135, 102) : new Color(194, 108, 35);
    label.outlineWidth = 3;
    label.enableShadow = true;
    label.shadowColor = disabled ? new Color(115, 94, 66, 100) : new Color(149, 74, 24, 165);
    label.shadowOffset = new Vec2(0, -3);
    label.shadowBlur = 0;
    label.node.setPosition(hasIcon ? 20 : 0, 3);
    label.node.getComponent(UITransform)!.setContentSize(width - (hasIcon ? 80 : width < 180 ? 32 : 64), height - 24);
  }

  private static stylePrimaryLabel(label: Label, width: number, height: number): void {
    label.color = new Color(255, 253, 225);
    label.outlineColor = new Color(202, 100, 21);
    label.outlineWidth = 4;
    label.enableShadow = true;
    label.shadowColor = new Color(145, 65, 17, 200);
    label.shadowOffset = new Vec2(0, -4);
    label.node.setPosition(0, 5);
    // 宽按钮两端留给星星和云朵；窄按钮保留完整文字空间。
    label.node.getComponent(UITransform)!.setContentSize(width - (width >= 320 ? 136 : width < 180 ? 32 : 40), height - 32);
  }

  private static addPanel(graphics: Graphics, x: number, y: number, width: number, height: number, radius: number, fill: Color, stroke?: Color): void {
    graphics.fillColor = fill;
    graphics.roundRect(x, y, width, height, radius);
    graphics.fill();
    if (stroke) {
      graphics.strokeColor = stroke;
      graphics.lineWidth = 3;
      graphics.stroke();
    }
  }

  private static drawSurface(graphics: Graphics, width: number, height: number, appearance: ActionAppearance): void {
    if (appearance === 'primary') {
      SettlementButton.drawPrimarySurface(graphics, width, height);
      return;
    }
    SettlementButton.drawSecondarySurface(graphics, width, height, appearance === 'disabled');
  }

  /** 浅蜂蜜色木牌：圆润厚边、细木纹和右上角两颗小星星。 */
  private static drawSecondarySurface(graphics: Graphics, width: number, height: number, disabled: boolean): void {
    const bottom = -height / 2;
    graphics.clear();
    graphics.fillColor = new Color(92, 54, 22, disabled ? 16 : 30);
    graphics.ellipse(0, bottom + 3, width / 2 - 12, 7);
    graphics.fill();

    // 下沿焦糖色厚边托住较浅的木面，与主按钮共享圆润的轮廓。
    SettlementButton.addPanel(graphics, -width / 2, bottom, width, height - 3, (height - 3) / 2,
      disabled ? new Color(159, 135, 105) : new Color(176, 91, 36),
      disabled ? new Color(223, 208, 182) : new Color(255, 222, 163));
    SettlementButton.addPanel(graphics, -width / 2 + 3, bottom + 6, width - 6, height - 8, (height - 8) / 2,
      disabled ? new Color(195, 177, 146) : new Color(232, 162, 91),
      disabled ? new Color(213, 198, 172) : new Color(249, 193, 120));
    SettlementButton.addPanel(graphics, -width / 2 + 8, bottom + 11, width - 16, height - 18, (height - 18) / 2,
      disabled ? new Color(185, 165, 136) : new Color(201, 119, 55),
      disabled ? new Color(173, 152, 123) : new Color(212, 131, 65));
    SettlementButton.addPanel(graphics, -width / 2 + 12, bottom + 15, width - 24, height - 26, (height - 26) / 2,
      disabled ? new Color(218, 203, 175) : new Color(249, 194, 120),
      disabled ? new Color(168, 145, 113) : new Color(174, 93, 36));

    const faceWidth = width - 28;
    const faceHeight = height - 30;
    const radius = faceHeight / 2;
    const centerY = 2;
    SettlementButton.addPanel(graphics, -faceWidth / 2, centerY - radius, faceWidth, faceHeight, radius,
      disabled ? new Color(238, 226, 204, 70) : new Color(255, 227, 164, 85));
    for (let row = 0; row < 10; row++) {
      const y = (row / 9 - 0.5) * (faceHeight - 8);
      const halfLine = (faceWidth - faceHeight) / 2 + Math.sqrt(Math.max(0, radius * radius - y * y)) - 3;
      const bend = Math.sin(row * 2.1) * 2;
      graphics.strokeColor = row % 2 === 0
        ? new Color(169, 111, 57, disabled ? 22 : 48)
        : new Color(255, 241, 193, disabled ? 50 : 150);
      graphics.lineWidth = 1;
      graphics.moveTo(-halfLine, y + centerY);
      graphics.bezierCurveTo(-halfLine * 0.5, y + centerY + bend, halfLine * 0.45, y + centerY - bend, halfLine, y + centerY);
      graphics.stroke();
    }

    // 细亮边勾出木面嵌入外框的层次。
    graphics.strokeColor = new Color(255, 234, 184, disabled ? 85 : 195);
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2 + 6, bottom + 9, width - 12, height - 14, (height - 14) / 2);
    graphics.stroke();

    const decorationScale = Math.min(1, height / 96);
    const starX = width / 2 - 29 * decorationScale;
    SettlementButton.drawStar(graphics, starX - 8 * decorationScale, 23 * decorationScale, 5 * decorationScale,
      disabled ? new Color(185, 187, 175) : new Color(124, 211, 221));
    SettlementButton.drawStar(graphics, starX, 10 * decorationScale, 8 * decorationScale,
      disabled ? new Color(200, 177, 167) : new Color(255, 159, 179),
      disabled ? new Color(173, 150, 136) : new Color(211, 118, 119));
  }

  /** 参考图的橙金木牌：圆润厚边、双层缝线、横向木纹和两端挂饰。 */
  private static drawPrimarySurface(graphics: Graphics, width: number, height: number): void {
    graphics.clear();
    const bottom = -height / 2;
    graphics.fillColor = new Color(92, 54, 22, 38);
    graphics.ellipse(0, bottom + 3, width / 2 - 14, 9);
    graphics.fill();

    // 暗色底座露出下沿，亮金外唇包住焦糖色边框。
    SettlementButton.addPanel(graphics, -width / 2, bottom, width, height - 4, (height - 4) / 2,
      new Color(164, 77, 20), new Color(255, 241, 183));
    SettlementButton.addPanel(graphics, -width / 2 + 3, bottom + 8, width - 6, height - 10, (height - 10) / 2,
      new Color(242, 154, 54), new Color(255, 226, 140));
    SettlementButton.addPanel(graphics, -width / 2 + 8, bottom + 11, width - 16, height - 18, (height - 18) / 2,
      new Color(202, 102, 27), new Color(235, 138, 43));
    SettlementButton.addPanel(graphics, -width / 2 + 15, bottom + 18, width - 30, height - 32, (height - 32) / 2,
      new Color(247, 173, 67), new Color(160, 78, 22));

    const faceWidth = width - 36;
    const faceHeight = height - 38;
    const faceRadius = faceHeight / 2;
    const faceY = 3;
    // 嵌套的柔光层模拟琥珀色木面，底部保留更深的橙色。
    for (let layer = 0; layer < 5; layer++) {
      const inset = layer * 2;
      SettlementButton.addPanel(graphics, -faceWidth / 2 + inset, faceY - faceHeight / 2 + inset,
        faceWidth - inset * 2, faceHeight - inset * 2, faceRadius - inset,
        new Color(255, 199 + layer * 4, 98 + layer * 7, 40));
    }

    // 木纹按胶囊的弧形边界收口，不需要额外遮罩或纹理资源。
    for (let row = 0; row < 13; row++) {
      const y = (row / 12 - 0.5) * (faceHeight - 10);
      const halfLine = (faceWidth - faceHeight) / 2 + Math.sqrt(Math.max(0, faceRadius * faceRadius - y * y)) - 3;
      const bend = Math.sin(row * 2.3) * 3;
      graphics.strokeColor = row % 2 === 0 ? new Color(187, 103, 26, 48) : new Color(255, 242, 169, 110);
      graphics.lineWidth = row % 3 === 0 ? 1.5 : 1;
      graphics.moveTo(-halfLine, y + faceY);
      graphics.bezierCurveTo(-halfLine * 0.45, y + faceY + bend, halfLine * 0.4, y + faceY - bend, halfLine, y + faceY);
      graphics.stroke();
    }

    SettlementButton.drawStitches(graphics, width - 22, height - 24, 3);
    // 顶部细亮边与下沿反光强调厚度，压在缝线外侧。
    graphics.strokeColor = new Color(255, 249, 205, 220);
    graphics.lineWidth = 2;
    graphics.moveTo(-width / 2 + height / 2, height / 2 - 5);
    graphics.lineTo(width / 2 - height / 2, height / 2 - 5);
    graphics.stroke();

    if (width >= 320) {
      const decorationScale = Math.min(1, height / 136);
      const left = -width / 2 + 48;
      const right = width / 2 - 48;
      SettlementButton.drawStar(graphics, left, 23 * decorationScale, 14 * decorationScale, new Color(255, 231, 82), new Color(209, 123, 25));
      SettlementButton.drawStar(graphics, right, 26 * decorationScale, 13 * decorationScale, new Color(255, 146, 176), new Color(212, 96, 102));
      SettlementButton.drawStar(graphics, left - 22, -3, 6 * decorationScale, new Color(180, 166, 238));
      SettlementButton.drawStar(graphics, left + 26, 39 * decorationScale, 5 * decorationScale, new Color(255, 165, 192));
      SettlementButton.drawStar(graphics, right + 24, 0, 6 * decorationScale, new Color(107, 212, 172));
      SettlementButton.drawCoin(graphics, left, -27 * decorationScale, 11 * decorationScale);
      SettlementButton.drawCloud(graphics, right, -28 * decorationScale, decorationScale);
    }
  }

  private static drawStitches(graphics: Graphics, width: number, height: number, centerY: number): void {
    const radius = height / 2;
    const straightHalf = width / 2 - radius;
    graphics.strokeColor = new Color(255, 219, 150, 225);
    graphics.lineWidth = 1.5;
    for (const direction of [-1, 1]) {
      for (let x = -straightHalf; x < straightHalf; x += 10) {
        graphics.moveTo(x, centerY + direction * radius);
        graphics.lineTo(Math.min(x + 5, straightHalf), centerY + direction * radius);
      }
      // 两端半圆上的短针脚，与水平针脚保持同样的间距。
      const startAngle = direction === 1 ? -Math.PI / 2 : Math.PI / 2;
      const step = 10 / radius;
      for (let angle = startAngle; angle < startAngle + Math.PI; angle += step) {
        const end = Math.min(angle + 5 / radius, startAngle + Math.PI);
        const cx = direction * straightHalf;
        graphics.moveTo(cx + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        graphics.lineTo(cx + Math.cos(end) * radius, centerY + Math.sin(end) * radius);
      }
    }
    graphics.stroke();
  }

  private static drawStar(graphics: Graphics, x: number, y: number, radius: number, fill: Color, stroke?: Color): void {
    graphics.fillColor = fill;
    for (let point = 0; point < 10; point++) {
      const angle = Math.PI / 2 + point * Math.PI / 5;
      const r = point % 2 === 0 ? radius : radius * 0.48;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (point === 0) graphics.moveTo(px, py);
      else graphics.lineTo(px, py);
    }
    graphics.close();
    graphics.fill();
    if (stroke) {
      graphics.strokeColor = stroke;
      graphics.lineWidth = 1.5;
      graphics.stroke();
    }
  }

  private static drawCoin(graphics: Graphics, x: number, y: number, radius: number): void {
    graphics.fillColor = new Color(255, 222, 94);
    graphics.strokeColor = new Color(215, 135, 29);
    graphics.lineWidth = 2;
    graphics.circle(x, y, radius);
    graphics.fill();
    graphics.stroke();
    graphics.strokeColor = new Color(255, 245, 168);
    graphics.lineWidth = 1;
    graphics.circle(x, y, radius - 3);
    graphics.stroke();
    graphics.strokeColor = new Color(220, 154, 42);
    graphics.moveTo(x - radius * 0.25, y + radius * 0.4);
    graphics.lineTo(x + radius * 0.25, y - radius * 0.4);
    graphics.stroke();
  }

  private static drawCloud(graphics: Graphics, x: number, y: number, scale: number): void {
    const puffs = [{ x: -16, y: -2, r: 8 }, { x: -5, y: 4, r: 11 }, { x: 9, y: 6, r: 12 }, { x: 22, y: 0, r: 7 }];
    for (const shadow of [true, false]) {
      graphics.fillColor = shadow ? new Color(190, 125, 75, 55) : new Color(255, 253, 240);
      const offset = shadow ? -3 : 0;
      graphics.ellipse(x + 3 * scale, y - 4 * scale + offset, 28 * scale, 7 * scale);
      graphics.fill();
      for (const puff of puffs) {
        graphics.circle(x + puff.x * scale, y + puff.y * scale + offset, puff.r * scale);
        graphics.fill();
      }
    }
  }

  private static drawPaw(graphics: Graphics, x: number, y: number, scale: number, color: Color): void {
    graphics.fillColor = color;
    graphics.ellipse(x, y - 6 * scale, 12 * scale, 10 * scale);
    graphics.fill();
    for (const toe of [{ x: -15, y: 7 }, { x: -6, y: 17 }, { x: 6, y: 17 }, { x: 15, y: 7 }]) {
      graphics.ellipse(x + toe.x * scale, y + toe.y * scale, 4.5 * scale, 6 * scale);
      graphics.fill();
    }
  }

  private static drawIcon(graphics: Graphics, icon: SettlementButtonIcon, size: number, appearance: ActionAppearance): void {
    graphics.clear();
    const primary = appearance === 'primary';
    const disabled = appearance === 'disabled';
    const radius = size / 2;
    graphics.fillColor = primary ? new Color(255, 248, 226, 155) : new Color(255, 235, 188, disabled ? 70 : 155);
    graphics.circle(0, 0, radius);
    graphics.fill();
    graphics.strokeColor = primary ? new Color(255, 255, 255, 195) : new Color(235, 205, 158, 150);
    graphics.lineWidth = 2;
    graphics.stroke();
    const ink = disabled ? Theme.mutedSoft : Theme.body;
    graphics.strokeColor = ink;
    graphics.fillColor = ink;
    graphics.lineWidth = primary ? 4 : 2.5;
    const r = size * 0.23;
    if (icon === 'paw') {
      SettlementButton.drawPaw(graphics, 0, -2, size / 54, ink);
    } else if (icon === 'replay') {
      // 使用同一条折线近似圆弧，避免依赖平台对 arc 的差异处理。
      for (let i = 0; i <= 28; i++) {
        const angle = (-35 + i * 290 / 28) * Math.PI / 180;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.stroke();
      graphics.moveTo(r * 0.82, -r * 0.57);
      graphics.lineTo(r * 0.82, -r * 0.57 + 8);
      graphics.lineTo(r * 0.82 - 8, -r * 0.57 + 1);
      graphics.close();
      graphics.fill();
    } else if (icon === 'video') {
      graphics.roundRect(-r * 1.2, -r * 0.85, r * 2.4, r * 1.7, 3);
      graphics.stroke();
      graphics.moveTo(-r * 0.25, -r * 0.5);
      graphics.lineTo(r * 0.6, 0);
      graphics.lineTo(-r * 0.25, r * 0.5);
      graphics.close();
      graphics.fill();
    } else if (icon === 'home') {
      graphics.moveTo(-r * 1.25, 0);
      graphics.lineTo(0, r * 1.1);
      graphics.lineTo(r * 1.25, 0);
      graphics.stroke();
      graphics.moveTo(-r * 0.9, r * 0.2);
      graphics.lineTo(-r * 0.9, -r);
      graphics.lineTo(r * 0.9, -r);
      graphics.lineTo(r * 0.9, r * 0.2);
      graphics.stroke();
      graphics.rect(-r * 0.25, -r, r * 0.5, r * 0.75);
      graphics.fill();
    } else {
      graphics.moveTo(-r * 0.4, -r * 0.85);
      graphics.lineTo(r * 0.5, 0);
      graphics.lineTo(-r * 0.4, r * 0.85);
      graphics.stroke();
      if (icon === 'share') {
        graphics.moveTo(-r, 0);
        graphics.lineTo(r * 0.5, 0);
        graphics.stroke();
      }
    }
  }
}
