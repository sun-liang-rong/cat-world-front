import { Button, Color, Label, Node, Sprite, UITransform, Vec2, Vec3 } from 'cc';
import { AssetStore } from './AssetStore';

export type SettlementButtonTone = 'orange' | 'green' | 'pink' | 'purple' | 'red';

const TONE_PATHS: Record<SettlementButtonTone, string> = {
  orange: 'popup/btn_orange',
  green: 'popup/btn_green',
  pink: 'popup/btn_pink',
  purple: 'popup/btn_purple',
  red: 'popup2/btn_red',
};

// 白字压在彩色胶囊上，描边/阴影取各色系的深色保证可读
const TONE_OUTLINES: Record<SettlementButtonTone, Color> = {
  orange: new Color(184, 74, 10),
  green: new Color(64, 118, 26),
  pink: new Color(150, 28, 62),
  purple: new Color(84, 58, 150),
  red: new Color(168, 40, 34),
};

export interface SettlementButtonOptions {
  text: string;
  tone: SettlementButtonTone;
  onClick: () => void;
  /** 布局盒尺寸（设计像素），Sprite 拉伸铺满；缺省 200x80，宽高比与按钮素材一致 */
  width?: number;
  height?: number;
  /** 整体等比缩放；缺省 1.12（渲染约 224x90，热区高度 ≥88） */
  scale?: number;
  fontSize?: number;
}

/**
 * 结算弹窗统一按钮：空胶囊底图（AI 生成，四种色系）+ Label 动态文案。
 * 文案不再烤进图片里，任何页面都能用同一套底图拼出需要的按钮。
 */
export class SettlementButton {
  /** 按钮素材路径；宿主页面需把这些路径加入 AssetStore.loadImages 预加载 */
  static readonly imagePaths: string[] = Object.values(TONE_PATHS);
  /** 默认布局盒宽（设计像素） */
  static readonly WIDTH = 200;
  /** 默认布局盒高（设计像素） */
  static readonly HEIGHT = 80;
  /** 默认等比缩放（渲染约 224x90） */
  static readonly SCALE = 1.12;

  static create(parent: Node, assets: AssetStore, options: SettlementButtonOptions): Node {
    const width = options.width ?? SettlementButton.WIDTH;
    const height = options.height ?? SettlementButton.HEIGHT;
    const fontSize = options.fontSize ?? 28;

    const node = new Node(`SettlementButton_${options.tone}`);
    parent.addChild(node);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = assets.getFrame(TONE_PATHS[options.tone]);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
    } else {
      console.error('[CatWorld] SettlementButton sprite not loaded:', TONE_PATHS[options.tone]);
    }

    const labelNode = new Node('Label');
    node.addChild(labelNode);
    const label = labelNode.addComponent(Label);
    label.string = options.text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.color = Color.WHITE;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.isBold = true;
    const outline = TONE_OUTLINES[options.tone];
    label.outlineWidth = 3;
    label.outlineColor = outline;
    label.enableShadow = true;
    label.shadowColor = new Color(outline.r, outline.g, outline.b, 150);
    label.shadowOffset = new Vec2(0, -3);

    const scale = Math.max(options.scale ?? SettlementButton.SCALE, 88 / height);
    node.setScale(new Vec3(scale, scale, 1));
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, options.onClick);
    return node;
  }
}
