import { drawActionSurface, ensureButtonControl, styleActionLabel } from './Theme';
import { Button, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { AssetStore } from './AssetStore';

export type SettlementButtonTone = 'orange' | 'green' | 'pink' | 'purple' | 'red';

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
  /** 整体等比缩放；缺省 1.12（渲染约 224x90，热区高度 ≥88） */
  scale?: number;
  fontSize?: number;
  /** 主、次操作统一使用奶油圆角按钮。 */
  appearance?: 'primary' | 'secondary';
}

/**
 * 统一文字按钮：共享主题底板与 Label 动态文案。旧 tone 参数保留调用兼容。
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
    const appearance = options.appearance ?? (options.tone === 'orange' || options.tone === 'green' ? 'primary' : 'secondary');
    drawActionSurface(node.addComponent(Graphics), width, height, appearance);

    const labelNode = new Node('Label');
    node.addChild(labelNode);
    labelNode.addComponent(UITransform);
    const label = labelNode.addComponent(Label);
    label.string = options.text;
    styleActionLabel(label, width, height, fontSize);

    const scale = Math.max(options.scale ?? SettlementButton.SCALE, 88 / height);
    node.setScale(new Vec3(scale, scale, 1));
    const button = node.addComponent(Button);
    ensureButtonControl(button, scale);
    button.node.on(Button.EventType.CLICK, options.onClick);
    return node;
  }
}
