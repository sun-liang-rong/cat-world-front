import { AdFunnelState, PlayerRun } from './level/LevelTypes';

export type CatId = 'orange' | 'white' | 'black' | 'ragdoll' | 'aurora';

export type ItemId = 'hammer' | 'glove' | 'dice' | 'extra_slot';

export type DailyTaskId = 'clear_3_levels' | 'collect_100_elements' | 'make_5_matches';

export type CatInteraction = 'pet' | 'feed' | 'play';

export type ActivityTaskId = 'complete_levels' | 'make_matches' | 'interact_cats';

export type ActivityRewardId = 'activity_reward_100' | 'activity_reward_300' | 'activity_reward_500'
  | 'activity_reward_800' | 'activity_reward_1000';

export type ActivityStatus = 'locked' | 'scheduled' | 'active' | 'claiming' | 'ended';

export type BuildingId = 'cat_house' | 'cafe' | 'yarn_workshop' | 'cat_society' | 'star_fountain';

export interface CatProgress {
  unlocked: boolean;
  level: number;
  experience: number;
  affection: number;
  interactionDate: string;
  interactionCounts: Record<CatInteraction, number>;
  skillReadyAt: number;
  skillCharge: number;
}

export interface DailyTaskProgress {
  progress: number;
  claimed: boolean;
}

export interface DailyTaskState {
  dateKey: string;
  tasks: Record<DailyTaskId, DailyTaskProgress>;
  chestClaimed: boolean;
  /** 超萌挑战的大额金币奖励每日限领一次，跨天随 DailyState 一起重置 */
  challengeRewardClaimed: boolean;
}

export type DailyState = DailyTaskState;

export interface ShopItemDailyState {
  coinPurchased: boolean;
  adClaims: number;
}

export interface ShopDailyState {
  dateKey: string;
  items: Record<ItemId, ShopItemDailyState>;
}

export interface ShopItemStatus extends ShopItemDailyState {
  totalClaims: number;
  maxClaims: number;
}

export interface ActivityTaskState {
  progress: number;
  claimed: boolean;
}

export interface ActivityState {
  eventId: string;
  points: number;
  dailyPointDateKey: string;
  dailyDirectPoints: number;
  completedLevelIds: number[];
  tasks: Record<ActivityTaskId, ActivityTaskState>;
  claimedRewardIds: ActivityRewardId[];
}

export interface BuildingProgress {
  unlocked: boolean;
  /** 已完成的大节点数 0~3（清理/修复/装饰），语义不变；cat_house 镜像全局 buildStage */
  stage: number;
  /**
   * 当前大节点内已点亮的小格数（小节点机制：1 格 = 3 星 = 1 关）。
   * 旧档缺省为 0——stage 语义就是「已完成大节点数」，已完成阶段无需补格。
   */
  subProgress: number;
}

export interface EndlessProgress {
  bestEliminated: number;
  lastEliminated: number;
  lastDurationMs: number;
  lastStage: number;
  totalRuns: number;
  totalEliminated: number;
  dailyRewardDateKey: string;
}

export interface GamePetPosition {
  x: number;
  y: number;
}

export interface PlayerState {
  version: 2;
  /** 后端生成的展示昵称，加载页拿到后写入本地 */
  userName: string;
  /** 后端生成的用户 ID，排行榜上报和查询都用它 */
  userId: string;
  coins: number;
  stars: number;
  totalStarsEarned: number;
  /** 主线关卡进度（第几关），关卡生成/建筑解锁/活动门槛以它为准 */
  level: number;
  /** 玩家累计经验，经验等级由经验曲线推导（见 PlayerStore 顶部规则） */
  exp: number;
  levelStars: Record<number, number>;
  buildStage: number;
  cats: Record<CatId, CatProgress>;
  equippedCat: CatId | null;
  /** 关卡宠物浮窗的本地位置偏好，不参与任何玩法计算 */
  gamePetPosition: GamePetPosition;
  inventory: Record<ItemId, number>;
  buildings: Record<BuildingId, BuildingProgress>;
  daily: DailyState;
  shop: ShopDailyState;
  activity: ActivityState;
  recentRuns: PlayerRun[];
  /**
   * 主线广告漏斗，只写本机、不上报。
   * 与 recentRuns 拆开：自适应看第一次失败，漏斗看复活后是否通关。
   */
  adFunnel: AdFunnelState;
  /** 无尽模式本地纪录，不上报排行榜 */
  endless: EndlessProgress;
  /**
   * 第 1 关一次性「去建设小镇」引导是否已完成。
   * 跳过引导不置标记（下次回首页可再触发）；点亮过任意一格后也不再弹。
   */
  firstTownGuideDone: boolean;
  /**
   * 第 1 关对局内新手教学是否已完成（第一次三消时写入）。
   * 仅主线 level===1 且该标记为 false 时触发；失败重试不重放。
   */
  boardTutorialDone: boolean;
}

export interface PlayerExperienceInfo {
  /** 经验等级，从 1 开始 */
  level: number;
  /** 当前等级内已积累的经验 */
  exp: number;
  /** 升到下一级还需要的经验 */
  expToNext: number;
}

export interface RewardBundle {
  coins?: number;
  stars?: number;
  items?: Partial<Record<ItemId, number>>;
}

export interface TaskSnapshot {
  id: DailyTaskId;
  progress: number;
  target: number;
  claimed: boolean;
  completed: boolean;
}
