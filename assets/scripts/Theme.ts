import { Color } from 'cc';

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
