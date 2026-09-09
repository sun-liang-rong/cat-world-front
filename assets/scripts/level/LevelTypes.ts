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

export interface LevelDefinition {
  version: 1;
  level: number;
  seed: number;
  archetype: LevelArchetype;
  slotCapacity: number;
  kindCount: number;
  tiles: TileDefinition[];
  plan: LevelPlan;
  score: LevelScore;
  fingerprint: string;
}

export interface SolverOptions {
  maxStates?: number;
  analyzeBranches?: boolean;
  preferredSolution?: number[];
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
}

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
  reason: 'onboarding' | 'steady' | 'player_struggling' | 'player_mastering' | 'recovery'
    | 'scheduled_breather' | 'scheduled_spike'
    | 'deep_rescue' | 'spike_cancelled_failure' | 'spike_cancelled_mastery' | 'slight_help';
  recoveryStep: number;
}
