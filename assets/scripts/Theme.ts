import { Button, Color, Mask, Node, ScrollView, UITransform } from 'cc';

/**
 * 全局共享调色板：AGENTS.md「色板」一节的唯一代码出处。
 * 各 Screen 用 `...Theme` 展开成自己的 COLORS 后只补充页面专属色，
 * 不要再手写与这里重复的色值，避免多页漂移。
 * 注意：Color 实例是共享引用，任何页面都不得就地修改（改 alpha 请 new Color）。
 */
export const Theme = {
  /** 标题深棕 */
  title: new Color(111, 62, 28),
  /** 正文棕 */
  body: new Color(112, 69, 40),
  /** 辅助小字（暖棕） */
  muted: new Color(136, 94, 63),
  /** 辅助小字（偏灰，用于次要说明） */
  mutedSoft: new Color(150, 137, 121),
  /** 面板底色（微透明，压在插画上用） */
  cream: new Color(255, 248, 226, 246),
  /** 次级卡片底色（更软） */
  creamSoft: new Color(255, 244, 212, 235),
  /** 面板底色（不透明） */
  creamSolid: new Color(255, 248, 226, 255),
  /** 常规描边 */
  border: new Color(235, 205, 158),
  /** 深一档描边 */
  borderDark: new Color(205, 165, 102),
  /** 深金（星标/数字强调） */
  goldDark: new Color(190, 111, 17),
  /** 半透明椭圆投影 */
  shadow: new Color(92, 54, 22, 70),
  /** 强调橙（价格、可领取） */
  orange: new Color(234, 117, 21),
  /** 功能绿（成功态） */
  green: new Color(78, 139, 50),
  /** 可点加号圆底 */
  plusGreen: new Color(139, 196, 74),
  plusGreenDark: new Color(96, 146, 50),
  /** 深色胶囊（深底白字资源条） */
  chipDark: new Color(74, 58, 44, 220),
  /** 强调黄 */
  accentYellow: new Color(255, 224, 108),
  /** 警示红 */
  warnRed: new Color(244, 73, 105),
  /** 文字压插画时的深棕描边 */
  outlineBrown: new Color(90, 61, 38),
};

/**
 * 统一页面标题吊牌：商店 sign_board 素材 + 奶白缎带面 + 30px 标题。
 * 商店/排行榜沿用各自已有吊牌；其余页面（每日任务/猫咪社/小镇/冒险）
 * 一律走这组几何，保证标题头只有一种语言。
 */
export const TITLE_SIGN = {
  path: 'shop/sign_board',
  width: 340,
  height: 220,
  /** 标题文字相对吊牌中心的 y 偏移（缎带面在素材下半部） */
  titleOffsetY: -34,
  titleFontSize: 30,
};

/** 全局 UI 几何：750 宽设计坐标，图标按钮、文字按钮与卡片各保留自己的语义。 */
export const UI_METRICS = {
  pageInset: 32,
  panelInset: 32,
  gap: 16,
  sectionGap: 32,
  buttonHeight: 96,
  minHitSize: 88,
  buttonRadius: 24,
  buttonTextInset: 16,
} as const;

export type ActionAppearance = 'primary' | 'secondary' | 'disabled';

/** 所有可点击控件共享反馈；固定缩放由调用方传入，避免入场动画改变热区。 */
export function ensureButtonControl(button: Button, renderedScale = 1) {
  button.transition = Button.Transition.SCALE;
  button.zoomScale = 0.93;
  const node = button.node;
  const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
  const scale = Math.max(0.1, Math.abs(renderedScale));
  transform.setContentSize(
    Math.max(transform.contentSize.width, UI_METRICS.minHitSize / scale),
    Math.max(transform.contentSize.height, UI_METRICS.minHitSize / scale),
  );
}

/** 内容超出可见高度时滚动，保留字号和触控尺寸，避免整页缩小或遮住底部按钮。 */
export function createVerticalContent(parent: Node, topY: number, bottomY: number, width: number, contentHeight: number) {
  const height = Math.max(88, topY - bottomY);
  const viewport = new Node('ContentViewport');
  parent.addChild(viewport);
  viewport.setPosition(0, (topY + bottomY) / 2);
  viewport.addComponent(UITransform).setContentSize(width, height);
  viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
  const content = new Node('ScrollableContent');
  viewport.addChild(content);
  const transform = content.addComponent(UITransform);
  transform.setAnchorPoint(0.5, 1);
  transform.setContentSize(width, Math.max(height, contentHeight));
  content.setPosition(0, height / 2);
  const scroll = viewport.addComponent(ScrollView);
  scroll.content = content;
  scroll.horizontal = false;
  scroll.vertical = contentHeight > height;
  scroll.inertia = true;
  scroll.elastic = true;
  return content;
}
