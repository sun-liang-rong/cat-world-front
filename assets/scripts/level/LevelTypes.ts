export type LevelArchetype =
  | 'normal'
  | 'stacked'
  | 'hidden'
  | 'order'
  | 'space'
  | 'combo'
  | 'comeback'
  | 'rescue';

export type LevelRhythm = 'pressure' | 'relief';

/**
 * 关卡角色（节拍表）：难度曲线的编排层，与 PlayerRun 驱动的难度自适应正交。
 * - breather 爽关：更少的元素种类 + combo 原型，制造三消连击的释放感（每 5 关一次）。
 * - spike 难关：牌量压短、密度换难度，制造"小高潮"（每个主题 3 次，连败时自动取消）。
 * - normal：按难度自适应目标正常生成。
 */
export type LevelRole = 'normal' | 'breather' | 'spike';

export interface LevelRhythmSegment {
  type: LevelRhythm;
  start: number;
  end: number;
}

export interface TileGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface TileDefinition extends TileGeometry {
  id: number;
  kind: number;
  layer: number;
}

export interface LevelPlan {
  /** A witness path produced during generation. It is useful for QA and hints. */
  solution: number[];
  plannedKinds: number[];
  plannedComboCount: number;
  rhythm?: LevelRhythmSegment[];
}

export interface LevelScore {
  solvability: number;
  difficulty: number;
  tension: number;
  satisfaction: number;
  comeback: number;
  repetition: number;
  forgiveness: number;
  decisionCount: number;
  decisionPoints: number;
  forcedMoves: number;
  maxTrayOccupancy: number;
  failureRisk: number;
  /** 轻度失误策略下，模拟玩家最终填满槽位的估计概率（0-100）。 */
  estimatedFailureRate: number;
  /** 模拟过程中偏离当前最佳选择的比例（0-100）。 */
  wrongChoiceRisk: number;
  /**
   * 模拟玩家失败时的平均棋盘进度（已取走牌数占比，0-100）。
   * 越高说明失败越集中在"快赢"的尾段——失败的可挽回感越强；
   * 中盘就失败的关卡是"绝望型失败"，直接劝退。
   */
  failureProgressAvg: number;
  /** 模拟失败局中，失败瞬间槽内存在 ≥1 对听牌的比例（0-100）。带着对子死 → 复活广告转化最高。 */
  trappedPairRate: number;
  /**
   * 模拟失败局中，复活（按游戏规则清掉槽内最多对子的 2 张，无对子清 1 张）后
   * 剩余棋盘可解的比例（0-100）。玩家看广告复活后必须真能救回来，
   * 否则广告信任会崩。无失败局时记 100。
   */
  reviveRescueRate: number;
  comboOpportunities: number;
  maxCombo: number;
  comebackOpportunities: number;
  wrongChoiceCount: number;
  exploredStates: number;
  pressureMoments: number;
  reliefMoments: number;
  rhythmTransitions: number;
  rhythm: number;
}

/**
 * 主线关卡胜利条件。缺省 / 旧档视为清空棋盘。
 * collect_kind：三消指定种类达到 count 即过关，不必清空；count 必须是 3 的倍数。
 */
export type LevelGoal =
  | { type: 'clear_board' }
  | { type: 'collect_kind'; kind: number; count: number };

export interface LevelDefinition {
  version: 1;
  level: number;
  seed: number;
  archetype: LevelArchetype;
  /**
   * 生成时使用的关卡角色（normal 缺省）。随定义透传给 GameScreen/Main，
   * 便于按角色做差异化结算（如难关的复活策略）。
   */
  role?: LevelRole;
  /**
   * 由 DifficultyPlan 透传的难关免费复活标记（LevelSystem 在生成完成后附上），
   * 仅在 role === 'spike' 且玩家处于连败中时成立。
   */
  freeRevive?: boolean;
  slotCapacity: number;
  kindCount: number;
  tiles: TileDefinition[];
  plan: LevelPlan;
  score: LevelScore;
  fingerprint: string;
  /** 缺省为清空棋盘；仅主线收集关写入 collect_kind */
  goal?: LevelGoal;
}

export interface SolverOptions {
  maxStates?: number;
  analyzeBranches?: boolean;
  preferredSolution?: number[];
  /** Reuse a prebuilt cover graph (generator builds one per candidate). */
  coverGraph?: unknown;
  /**
   * 从对局中间状态求解（复活可解性检查专用）：
   * active 为剩余牌掩码（与 level.tiles 等长），counts 为槽内各 kind 的数量。
   * 提供时跳过见证路径直走，从该状态直接 DFS；pathMetrics 无意义（返回全 0）。
   */
  initialState?: { active: boolean[]; counts: number[] };
}

export interface SolverResult {
  solvable: boolean;
  proven: boolean;
  solution: number[];
  exploredStates: number;
  deadEndStates: number;
  truncated: boolean;
  pathMetrics: SolverPathMetrics;
}

export interface SolverPathMetrics {
  decisionCount: number;
  decisionPoints: number;
  forcedMoves: number;
  maxTrayOccupancy: number;
  failureRisk: number;
  comboOpportunities: number;
  maxCombo: number;
  comebackOpportunities: number;
  wrongChoiceCount: number;
  pressureMoments: number;
  reliefMoments: number;
  rhythmTransitions: number;
}

export interface PlayerRun {
  won: boolean;
  level: number;
  remainingSlots: number;
  mistakes: number;
  elapsedMs: number;
  decisionCount: number;
  nearFailureCount: number;
  collectedElements: number;
  matchCount: number;
  /** 本局关卡角色，旧存档可缺省。 */
  role?: LevelRole;
  /** 失败时已收集牌占总牌的百分比 0-100。 */
  failProgress?: number;
  /** 失败瞬间槽内是否已有听牌对子。 */
  failHadPair?: boolean;
  /** 本局是否用过复活；看广告通关不算连胜。 */
  revived?: boolean;
  /** 本次复活是否为连败难关赠送的免费复活。 */
  reviveFree?: boolean;
}

export type AdFunnelBand = 'l1_5' | 'l6_10' | 'l11_22' | 'l23';

export interface AdFunnelBandStats {
  fails: number;
  pairFails: number;
  failProgressSum: number;
  adRevives: number;
  freeRevives: number;
  reviveWins: number;
  doubleCoins: number;
}

export type AdFunnelState = Record<AdFunnelBand, AdFunnelBandStats>;

export interface PlayerPerformanceSnapshot {
  sampleSize: number;
  winRate: number;
  averageRemainingSlots: number;
  averageMistakes: number;
  averageElapsedMs: number;
  averageDecisionCount: number;
  averageNearFailureCount: number;
  winStreak: number;
  failureStreak: number;
}

export interface DifficultyPlan {
  targetDifficulty: number;
  rescue: boolean;
  role: LevelRole;
  /**
   * 难关免费复活（仅 role === 'spike' 时有意义）：连败中打难关的玩家失败时
   * 不看广告直接复活一次（留存兜底）；无连败时该字段为假，走正常广告复活
   * （难关失败正是复活广告转化最高的场景，不能白送）。
   */
  freeRevive?: boolean;
  reason: 'onboarding' | 'steady' | 'player_struggling' | 'player_mastering' | 'recovery'
    | 'scheduled_breather' | 'scheduled_spike'
    | 'deep_rescue' | 'spike_cancelled_failure' | 'spike_cancelled_mastery' | 'slight_help';
  recoveryStep: number;
}
