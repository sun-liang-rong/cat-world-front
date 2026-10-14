import { AdFunnelState, PlayerRun, LevelDefinition, TileGeometry } from './level/LevelTypes';

export type CatId = 'orange' | 'white' | 'black' | 'ragdoll' | 'aurora';

export type ItemId = 'hammer' | 'glove' | 'dice' | 'extra_slot';

export type DailyTaskId = 'clear_3_levels' | 'collect_100_elements' | 'make_5_matches';

export type CatInteraction = 'pet' | 'feed' | 'play';

export type TownDailyTaskId = 'pet_cat' | 'complete_level' | 'light_cell' | 'enter_building' | 'view_dialogue';

export type ShareCardType = 'level_win' | 'town_stage' | 'cat_unlock' | 'challenge_record'
  | 'endless_record' | 'journey_complete' | 'campaign_complete' | 'tool_request';

export type ActivityTaskId = 'complete_levels' | 'make_matches' | 'interact_cats';

export type ActivityRewardId = 'activity_reward_100' | 'activity_reward_300' | 'activity_reward_500'
  | 'activity_reward_800' | 'activity_reward_1000';

export type ActivityStatus = 'locked' | 'scheduled' | 'active' | 'claiming' | 'ended';

export type BuildingId = 'cat_house' | 'cafe' | 'yarn_workshop' | 'cat_society' | 'star_fountain';

export interface CatJourneyState {
  /** 开启旅程的上海时区日期；空字符串表示尚未开启。 */
  startedDateKey: string;
  /** 下一次可领取的旅程天数，范围 1~7。 */
  currentDay: number;
  /** 上一次领取日期，防止同一天重复领取。 */
  lastClaimDateKey: string;
  /** 已领取的天数，用于展示和幂等校验。 */
  claimedDays: number[];
  /** 第 7 天领取后置为 true。 */
  completed: boolean;
}

export interface CatJourneySnapshot {
  started: boolean;
  currentDay: number;
  claimedDays: number[];
  canClaim: boolean;
  completed: boolean;
  rewardText: string;
}

export interface CatJourneyClaimResult {
  ok: boolean;
  message: string;
  rewardText?: string;
  completed?: boolean;
}

export interface ShareDailyState {
  /** 当前上海时区自然日。 */
  dateKey: string;
  /** 当天是否已经因为成功分享领取过奖励。 */
  rewardClaimed: boolean;
  /** 最近一次成功分享的场景，仅用于幂等与埋点上下文。 */
  lastCardType: ShareCardType | '';
}

export interface ShareRewardResult {
  ok: boolean;
  message: string;
  rewardText?: string;
}

export interface ShareOffer {
  type: ShareCardType;
  label: string;
}

export interface TownDailyState {
  /** 当前自然日（上海时区）的任务日期。 */
  dateKey: string;
  /** 当日随机选择的一件小事。 */
  taskId: TownDailyTaskId;
  /** 当前任务是否已经完成。 */
  completed: boolean;
  /** 奖励是否已经领取。 */
  claimed: boolean;
}

export interface TownDailySnapshot {
  unlocked: boolean;
  taskId: TownDailyTaskId | null;
  title: string;
  description: string;
  actionLabel: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  canClaim: boolean;
  rewardText: string;
}

export interface TownDailyClaimResult {
  ok: boolean;
  message: string;
  rewardText?: string;
}

export interface CatTrialState {
  /** 试住的猫咪；当前只开放大橘，预留 CatId 方便后续扩展。 */
  catId: CatId;
  /** 还可消耗的主线有效对局数。 */
  remainingGames: number;
  /** 是否处于临时装备状态。 */
  active: boolean;
  /** 是否已经展示过首次试住邀请，避免新玩家反复打断。 */
  offerShown: boolean;
  /** 是否至少真正开始过一局试住。 */
  started: boolean;
}

/** 试住状态的只读快照：猫咪社 / 详情页 / 对局浮窗用它区分「试住」与「未解锁」。 */
export interface CatTrialStatus {
  active: boolean;
  catId: CatId;
  remainingGames: number;
}

export interface CatMilestoneSnapshot {
  level: number;
  title: string;
  description: string;
  unlocked: boolean;
  claimed: boolean;
}

export interface CatUpgradeResult {
  ok: boolean;
  message: string;
  newLevel?: number;
  milestoneLevels?: number[];
}

export interface CatSkillFireResult {
  readyAt: number;
  giftCoins: number;
}

export interface CatProgress {
  unlocked: boolean;
  level: number;
  experience: number;
  affection: number;
  interactionDate: string;
  interactionCounts: Record<CatInteraction, number>;
  skillReadyAt: number;
  skillCharge: number;
  /** Lv15 里程碑：当天首次发动技能是否已领取谢礼。 */
  skillGiftDate: string;
}

export interface DailyTaskProgress {
  progress: number;
  claimed: boolean;
}

export interface DailyTaskState {
  dateKey: string;
  /** 主线完成后，同一任务 ID 改为无尽消除目标，保留每日领奖记录。 */
  clearTaskMode: 'main' | 'endless';
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
  /** 当日已获得积分的猫咪互动次数，最多 3 次。 */
  dailyInteractionClaims: number;
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
  side: 'left' | 'right';
  y: number;
}

export interface GameRunCheckpoint {
  version: 1;
  mode: 'main' | 'challenge' | 'endless';
  level: number;
  definition?: LevelDefinition;
  endlessSeed?: number;
  endlessWave?: number;
  board: Array<TileGeometry & { kind: number; layer: number }>;
  tray: Array<TileGeometry & { kind: number; layer: number }>;
  elapsedMs: number;
  extraSlot: boolean;
  usedTools: ItemId[];
  collectedTotal: number;
  collectProgress: number;
  eliminatedCount: number;
  matchCount: number;
  mistakes: number;
  decisionCount: number;
  nearFailureCount: number;
  performanceReported?: boolean;
  reviveUsed: boolean;
  equippedCat: CatId | null;
  catCharge: number;
  catSkillUsed: boolean;
  catSkillPicksLeft: number;
  trialConsumed: boolean;
  trialStartRemaining: number | null;
}

export interface PlayerState {
  currentRun?: GameRunCheckpoint;
  version: 6;
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
  /** 建筑正式解锁前的临时猫咪体验状态。 */
  catTrial: CatTrialState;
  /** 首次通关后开启的、不因漏签清零的 7 日猫咪旅程。 */
  catJourney: CatJourneyState;
  /** 点亮流浪猫小屋第一格后开放的每日小事。 */
  townDaily: TownDailyState;
  /** 微信好友分享每日奖励状态；H5/预览不会发放奖励。 */
  shareDaily: ShareDailyState;
  /** 仅记录非数值的收藏徽章，不参与经济计算。 */
  unlockedBadges: string[];
  /** 每只猫咪已触发过的升级里程碑等级。 */
  claimedCatMilestones: Record<CatId, number[]>;
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
  /**
   * 首次进入收集指定元素关时的一句说明是否已显示。
   * 只弹一次；与第 1 关棋盘教学相互独立。
   */
  collectGoalHintDone: boolean;
  /** 「超萌挑战解锁」一次性提示是否已展示（旧档首次启动补弹一次作功能公告）。 */
  challengeUnlockSeen: boolean;
  /** 各道具最后一次领取本地每日补给的日期；字段名保留旧档兼容。 */
  toolShareDates: Record<ItemId, string>;
  /** 历史首页金币奖励日期；当前界面已取消分享领奖，仅保留旧档兼容。 */
  coinShareDate: string;
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
  title: string;
  description: string;
  rewardText: string;
  action: 'main' | 'endless';
  progress: number;
  target: number;
  claimed: boolean;
  completed: boolean;
}
