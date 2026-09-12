import { CoverBoardState, LevelRules, LevelSolver, TileCoverGraph } from './LevelSolver';
import {
  LevelArchetype,
  LevelDefinition,
  LevelPlan,
  LevelRhythm,
  LevelRhythmSegment,
  LevelRole,
  LevelScore,
  TileDefinition,
} from './LevelTypes';

type PlayerRiskEstimate = {
  estimatedFailureRate: number;
  wrongChoiceRisk: number;
  /** 失败时平均棋盘进度（已取走牌数占比，0-100）。 */
  failureProgressAvg: number;
  /** 失败瞬间槽内存在 ≥1 对听牌的失败局占比（0-100）。 */
  trappedPairRate: number;
  /** 复活（按游戏规则清一对/最右 1 张）后剩余棋盘可解的失败局占比（0-100），无失败局时 100。 */
  reviveRescueRate: number;
};

type GenerationContext = {
  target: number;
  /** Accept/distance target after role density correction (spike boards are short). */
  acceptTarget: number;
  failureRateBand: { min: number; max: number };
  role: LevelRole;
  attempts: number;
  solverMaxStates: number;
  recentFingerprints: string[];
  recentArchetypes: LevelArchetype[];
  best: LevelDefinition | null;
  bestDistance: number;
  bestBrutality: number;
};

export interface LevelGenerationOptions {
  level: number;
  seed: number;
  targetDifficulty?: number;
  rescue?: boolean;
  role?: LevelRole;
  /** 收集槽容量，可解性验证与压力指标都用它；缺省 6 */
  slotCapacity?: number;
  /**
   * 贴满压力档（超萌挑战专用）：序列规划永远走高压节奏、槽位 3/5 时优先凑对
   * 把最优路径顶在满槽边缘；候选按"残酷度"（槽位峰值/失败风险/诱错数）挑选，
   * 不做提前验收，全部尝试跑完取最残酷者。
   */
  fullTrayPressure?: boolean;
  recentFingerprints?: string[];
  recentArchetypes?: LevelArchetype[];
  maxAttempts?: number;
  solverAnalyzeBranches?: boolean;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed | 0) || 0x6d2b79f5;
  }

  next() {
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.state = value | 0;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: T[]) {
    return values[this.int(0, values.length - 1)];
  }

  shuffle<T>(values: T[]) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  }
}

export class AsyncGenerationCancelledError extends Error {
  constructor() {
    super('[LevelGenerator] Async generation cancelled');
    this.name = 'AsyncGenerationCancelledError';
  }
}

export class LevelGenerator {
  private readonly solver = new LevelSolver();
  private asyncQueue: Promise<void> = Promise.resolve();
  private activeAbort: { cancelled: boolean } | null = null;

  generate(options: LevelGenerationOptions): LevelDefinition {
    const context = this.createGenerationContext(options);
    for (let attempt = 0; attempt < context.attempts; attempt += 1) {
      const evaluation = this.evaluateAttempt(options, attempt, context);
      if (evaluation?.accepted) return evaluation.candidate;
    }
    const extra = this.extraAttemptsForFailFeel(options, context);
    for (let attempt = context.attempts; attempt < context.attempts + extra; attempt += 1) {
      const evaluation = this.evaluateAttempt(options, attempt, context);
      if (evaluation?.accepted) return evaluation.candidate;
    }

    if (context.best) return this.finalizeBestScore(context.best);
    throw new Error(`[LevelGenerator] Unable to create a solvable level for seed ${options.seed}`);
  }

  cancelAsync() {
    if (this.activeAbort) this.activeAbort.cancelled = true;
  }

  generateAsync(options: LevelGenerationOptions): Promise<LevelDefinition> {
    const abort = { cancelled: false };
    const run = () => {
      this.activeAbort = abort;
      return this.runGenerateAsync(options, abort).finally(() => {
        if (this.activeAbort === abort) this.activeAbort = null;
      });
    };
    const pending = this.asyncQueue.then(run, run);
    this.asyncQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private runGenerateAsync(
    options: LevelGenerationOptions,
    abort: { cancelled: boolean },
  ): Promise<LevelDefinition> {
    const context = this.createGenerationContext(options);
    // 微信小游戏 JS 比桌面慢一个数量级：墙钟预算兜底，有 best 就提前交付，
    // 避免高关为了「更接近目标」把 24 次 attempt 跑满。
    // 超萌挑战必须跑满候选再按残酷度挑选；墙钟截断会让再玩一次明显变简单。
    const wallClockBudgetMs = options.fullTrayPressure === true
      ? Number.POSITIVE_INFINITY
      : options.level >= 40 ? 1200 : 800;
    const startedAt = Date.now();
    return new Promise<LevelDefinition>((resolve, reject) => {
      let attempt = 0;
      const runAttempt = () => {
        if (abort.cancelled) {
          reject(new AsyncGenerationCancelledError());
          return;
        }
        const extra = this.extraAttemptsForFailFeel(options, context);
        if (attempt >= context.attempts + extra) {
          if (context.best) {
            resolve(this.finalizeBestScore(context.best));
          } else {
            reject(new Error(`[LevelGenerator] Unable to create a solvable level for seed ${options.seed}`));
          }
          return;
        }

        try {
          const evaluation = this.evaluateAttempt(options, attempt, context);
          attempt += 1;
          if (evaluation?.accepted) {
            resolve(evaluation.candidate);
            return;
          }
        } catch (error) {
          reject(error);
          return;
        }

        if (context.best && Date.now() - startedAt >= wallClockBudgetMs) {
          resolve(this.finalizeBestScore(context.best));
          return;
        }

        // Yield between candidates so generation never monopolizes the Cocos
        // frame loop while the player is entering a level.
        setTimeout(runAttempt, 0);
      };

      setTimeout(runAttempt, 0);
    });
  }

  private createGenerationContext(options: LevelGenerationOptions): GenerationContext {
    // 主线默认 24 次：配合见证路径快路径 + 结构预筛，足够收敛；
    // L11+ 失败质量门槛更严，多给几次用来卡尾段失败 / 听牌 / 复活可解，而不是把门槛往回松；
    // 超萌挑战仍跑满 48 次以挑最残酷候选。
    const attempts = options.maxAttempts
      || (options.fullTrayPressure === true ? 48 : options.level >= 23 ? 48 : 40);
    // 高关棋盘更大，给 DFS 多一点预算；挑战保持上限。
    const solverMaxStates = options.fullTrayPressure === true
      ? 250000
      : options.level >= 40 ? 120000 : 80000;
    const target = options.targetDifficulty === undefined
      ? LevelGenerator.baseDifficulty(options.level)
      : options.targetDifficulty;
    const role = options.rescue ? 'normal' : options.role ?? 'normal';
    // Spike 关刻意把牌量压到普通关一半左右，共享难度分被棋盘规模主导，
    // 再硬的密度也顶不进 base+9 的目标带。验收按密度校正后的目标进行，
    // 保证能提前 accept，而不是 24 次全跑完再拿兜底候选。
    // 普通关同理：难度分在 L70 之后饱和在 54，验收目标不能继续跟着 baseDifficulty
    // 往上爬，否则高关进不了容差带、只能空转跑满 attempt。
    const acceptTarget = role === 'spike'
      ? Math.max(30, target - 12)
      : Math.min(target, LevelGenerator.difficultySaturation);
    return {
      target,
      acceptTarget,
      failureRateBand: LevelGenerator.failureRateBand(options.level, options.rescue === true),
      role,
      attempts,
      solverMaxStates,
      recentFingerprints: options.recentFingerprints || [],
      recentArchetypes: options.recentArchetypes || [],
      best: null,
      bestDistance: Number.POSITIVE_INFINITY,
      bestBrutality: Number.NEGATIVE_INFINITY,
    };
  }

  private evaluateAttempt(
    options: LevelGenerationOptions,
    attempt: number,
    context: GenerationContext,
  ) {
    const attemptSeed = LevelGenerator.mixSeed(options.seed, attempt);
    const random = new SeededRandom(attemptSeed);
    const archetype = options.rescue
      ? 'rescue'
      : this.chooseArchetype(options.level, random, context.recentArchetypes, context.role);
    let candidate: LevelDefinition;
    try {
      candidate = this.createCandidate(
        options.level,
        attemptSeed,
        archetype,
        random,
        context.role,
        options.slotCapacity,
        options.fullTrayPressure === true,
      );
    } catch (_error) {
      // A strict geometry candidate may not fit this seed. Let the next
      // deterministic attempt try a different layout instead of weakening
      // the cover rule.
      return null;
    }
    // 一次候选只建一张遮挡图：Solver 与玩家风险模拟共用。
    const coverGraph = new TileCoverGraph(candidate);
    const result = this.solver.solve(candidate, {
      maxStates: context.solverMaxStates,
      analyzeBranches: options.solverAnalyzeBranches === true,
      preferredSolution: candidate.plan.solution,
      coverGraph,
    });
    if (!result.solvable) return null;

    // 结构分（不跑玩家风险模拟）先做粗筛：难度明显不达标时直接丢弃，
    // 避免每个候选都付 estimatePlayerRisk 的全盘模拟成本。
    const structuralScore = this.scoreCandidate(
      candidate,
      result,
      context.target,
      context.recentFingerprints,
      context.recentArchetypes,
      null,
    );
    candidate.plan = this.makePlan(candidate, result.solution);
    candidate.score = structuralScore;
    const difficultyGap = Math.abs(structuralScore.difficulty - context.target);
    const needsRisk = options.fullTrayPressure === true
      || difficultyGap <= LevelGenerator.targetTolerance + 1
      // 验收带按 acceptTarget 判定（不再只认 target）：
      // 高关普通关的难度分饱和在 54，而 baseDifficulty 已爬到 60+，只按 target 判断会让
      // 这些候选跳过风险模拟、estimatedFailureRate 恒为 0，被 failureRateBand 的 30 下限
      // 挡在门外，于是永远验收不通过、只能烧满 24 次 attempt。
      || Math.abs(structuralScore.difficulty - context.acceptTarget) <= LevelGenerator.targetTolerance + 1
      // 广告门槛关多跑风险模拟，避免未打分候选用默认 revive=100 抢走兜底席位。
      || (context.failureRateBand.max > 15
        && Math.abs(structuralScore.difficulty - context.acceptTarget) <= LevelGenerator.targetTolerance + 4);
    const score = needsRisk
      ? this.scoreCandidate(
          candidate,
          result,
          context.target,
          context.recentFingerprints,
          context.recentArchetypes,
          this.estimatePlayerRisk(candidate, coverGraph),
        )
      : structuralScore;
    candidate.score = score;
    if (options.fullTrayPressure === true) {
      // 贴满压力档：难度分被"棋盘规模"主导、对小棋盘失真，改按残酷度挑选——
      // 最优路径槽位峰值（封顶 capacity-1）为主、失败风险与诱错数为辅，
      // 不做提前验收，全部尝试跑完取最残酷者。
      const brutality = result.pathMetrics.maxTrayOccupancy * 300
        + result.pathMetrics.failureRisk * 3
        + result.pathMetrics.wrongChoiceCount * 2;
      if (score.repetition < 100 && brutality > context.bestBrutality) {
        context.best = candidate;
        context.bestBrutality = brutality;
      }
      return { candidate, accepted: false };
    }
    const distance = this.candidateDistance(
      score,
      context.acceptTarget,
      context.failureRateBand,
      context.role,
      options.rescue === true,
      candidate.slotCapacity,
    );
    // 爽关的结构难度天然被棋盘规模顶高，往往进不了 base-14 的容差带；
    // 兜底候选必须优先保住连击链（验收要求 maxCombo ≥ 2）。
    const rankedDistance = context.role === 'breather' && score.maxCombo < 2
      ? distance + 1000
      : distance;
    if (score.repetition < 100 && rankedDistance < context.bestDistance) {
      context.best = candidate;
      context.bestDistance = rankedDistance;
    }
    return {
      candidate,
      accepted: this.accept(
        candidate,
        score,
        context.acceptTarget,
        archetype,
        candidate.fingerprint,
        context.recentFingerprints,
        context.role,
        context.failureRateBand,
      ),
    };
  }

  static baseDifficulty(level: number) {
    if (level <= 1) return 22;
    // Level 2 starts at the measured mid-game baseline, then rises to the
    // existing late-game cap by level 100.
    const progress = Math.min(Math.max(level - 2, 0), 98) / 98;
    return Math.round((42.3 + progress * 22.7) * 10) / 10;
  }

  /**
   * 无尽补波：只生成几何和种类配额，不跑 Solver。
   * 失败时回退到更少层 / 更少牌，保证至少能放出一波可点击牌。
   */
  createWaveTiles(options: {
    seed: number;
    tileCount: number;
    kindCount: number;
    layerCount: number;
    archetype?: LevelArchetype;
    slotCapacity?: number;
    fullTrayPressure?: boolean;
    trayCounts?: number[];
  }): TileDefinition[] {
    const requestedCount = Math.max(3, Math.round(options.tileCount / 3) * 3);
    const kindCount = Math.max(1, Math.min(15, Math.floor(options.kindCount)));
    const requestedLayers = Math.max(2, Math.min(9, Math.floor(options.layerCount)));
    const archetype = options.archetype ?? 'normal';
    const slotCapacity = options.slotCapacity ?? 6;
    const trayCounts = this.normalizedTrayCounts(options.trayCounts, kindCount);
    const attempts = [
      { tileCount: requestedCount, layerCount: requestedLayers },
      { tileCount: requestedCount, layerCount: Math.max(2, requestedLayers - 1) },
      { tileCount: Math.max(30, Math.round((requestedCount - 12) / 3) * 3), layerCount: requestedLayers },
      { tileCount: Math.max(24, Math.round((requestedCount - 24) / 3) * 3), layerCount: Math.max(2, requestedLayers - 1) },
    ];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const random = new SeededRandom(LevelGenerator.mixSeed(options.seed, index + 1));
      try {
        const tiles = this.createLayout(attempt.tileCount, attempt.layerCount, archetype, random, 'dense');
        const order = this.createRemovalOrder(tiles, archetype, random);
        const layerOfPosition = order.map(tileId => tiles.find(tile => tile.id === tileId)!.layer);
        const plannedKinds = this.createKindSequence(
          attempt.tileCount,
          kindCount,
          archetype,
          random,
          slotCapacity,
          layerOfPosition,
          options.fullTrayPressure === true,
        );
        order.forEach((tileId, kindIndex) => {
          const tile = tiles.find(candidate => candidate.id === tileId)!;
          tile.kind = plannedKinds[kindIndex];
        });
        this.biasWaveTowardTray(tiles, trayCounts, kindCount, random);
        this.breakTopLayerTriples(tiles, random);
        return tiles;
      } catch (_error) {
        continue;
      }
    }
    throw new Error(`[LevelGenerator] Unable to create endless wave for seed ${options.seed}`);
  }

  private normalizedTrayCounts(trayCounts: number[] | undefined, kindCount: number) {
    const counts = Array.from({ length: kindCount }, () => 0);
    (trayCounts || []).forEach((count, kind) => {
      if (kind < 0 || kind >= kindCount) return;
      counts[kind] = Math.max(0, Math.min(2, Math.floor(count)));
    });
    return counts;
  }

  /**
   * 无尽垫层看当前槽位：只改这一波最顶层的种类，让顶上新露出的牌
   * 能和槽里已有的单张/一对衔接。不改几何、不改 3 的倍数。
   */
  private biasWaveTowardTray(
    tiles: TileDefinition[],
    trayCounts: number[],
    kindCount: number,
    random: SeededRandom,
  ) {
    const helpful = trayCounts
      .map((count, kind) => ({ kind, count }))
      .filter(item => item.count > 0 && item.kind < kindCount);
    if (helpful.length === 0 || tiles.length === 0) return;
    const topLayer = tiles.reduce((max, tile) => Math.max(max, tile.layer), tiles[0].layer);
    const topTiles = tiles.filter(tile => tile.layer === topLayer);
    if (topTiles.length === 0) return;
    const singles = helpful.filter(item => item.count === 1);
    const pairs = helpful.filter(item => item.count >= 2);
    const preferred = (singles.length > 0 ? singles : pairs).map(item => item.kind);
    topTiles.forEach((tile, offset) => {
      const target = preferred[offset % preferred.length];
      if (tile.kind === target) return;
      const donors = tiles.filter(candidate =>
        candidate !== tile && candidate.layer !== topLayer && candidate.kind === target);
      const donor = donors.length > 0
        ? random.pick(donors)
        : tiles.find(candidate =>
          candidate !== tile && candidate.layer !== topLayer && preferred.indexOf(candidate.kind) < 0);
      if (!donor) return;
      const swapped = tile.kind;
      tile.kind = donor.kind;
      donor.kind = swapped;
    });
  }

  /**
   * 无尽顶层尽量不要三张同色摊开，避免一眼白捡。只和更低层交换，保持 3 的倍数。
   */
  private breakTopLayerTriples(tiles: TileDefinition[], random: SeededRandom) {
    if (tiles.length === 0) return;
    const topLayer = tiles.reduce((max, tile) => Math.max(max, tile.layer), tiles[0].layer);
    const topTiles = tiles.filter(tile => tile.layer === topLayer);
    const lowerTiles = tiles.filter(tile => tile.layer !== topLayer);
    if (topTiles.length === 0 || lowerTiles.length === 0) return;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const counts = new Map<number, number>();
      topTiles.forEach(tile => counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1));
      const triple = Array.from(counts.entries()).find(([, count]) => count >= 3);
      if (!triple) return;
      const extras = topTiles.filter(tile => tile.kind === triple[0]).slice(2);
      const tile = extras[0];
      const donor = random.pick(lowerTiles.filter(candidate =>
        candidate.kind !== triple[0]
        && (counts.get(candidate.kind) || 0) < 2));
      if (!donor) return;
      const swapped = tile.kind;
      tile.kind = donor.kind;
      donor.kind = swapped;
    }
  }

  private createCandidate(
    level: number,
    seed: number,
    archetype: LevelArchetype,
    random: SeededRandom,
    role: LevelRole = 'normal',
    slotCapacity = 6,
    fullTrayPressure = false,
  ): LevelDefinition {
    const tileCount = archetype === 'rescue'
      ? LevelGenerator.rescueTileCount(level, random)
      : LevelGenerator.tileCount(level, random, role);
    const kindCount = LevelGenerator.kindCount(level, role);
    const layerCount = archetype === 'rescue'
      ? Math.max(2, this.layerCount(level) - 3)
      : fullTrayPressure
        // 超萌挑战不要顶到主线后期的 9 层：6～7 层配 45～55 张，每层更密、遮挡仍够狠
        ? 6 + random.int(0, 1)
        : this.layerCount(level);
    const tiles = this.createLayout(tileCount, layerCount, archetype, random);
    const order = this.createRemovalOrder(tiles, archetype, random);
    const layerOfPosition = order.map(tileId => tiles.find(tile => tile.id === tileId)!.layer);
    const plannedKinds = this.createKindSequence(
      tileCount,
      kindCount,
      archetype,
      random,
      slotCapacity,
      layerOfPosition,
      fullTrayPressure,
    );
    order.forEach((tileId, index) => {
      const tile = tiles.find(candidate => candidate.id === tileId)!;
      tile.kind = plannedKinds[index];
    });

    const fingerprint = this.fingerprint(level, archetype, tiles);
    const emptyPlan: LevelPlan = {
      solution: order,
      plannedKinds,
      plannedComboCount: 0,
      rhythm: this.rhythmSegments(tileCount),
    };
    const emptyScore = this.emptyScore();
    return {
      version: 1,
      level,
      seed,
      archetype,
      role,
      slotCapacity,
      kindCount,
      tiles,
      plan: emptyPlan,
      score: emptyScore,
      fingerprint,
    };
  }

  private createLayout(
    total: number,
    layerCount: number,
    archetype: LevelArchetype,
    random: SeededRandom,
    pack: 'cone' | 'dense' = 'cone',
  ) {
    const layerSizes = pack === 'dense'
      ? this.denseLayerSizes(total, layerCount)
      : this.layerSizes(total, layerCount, archetype);
    const tiles: TileDefinition[] = [];
    // 羊了个羊式全叠柱的深度记录（key "x,y"）：上层牌与父层牌完全同位叠放，
    // 深度跨层累积，用来把同一根柱子堆成 2~4 张的"塔"。
    const stackDepths = new Map<string, number>();
    let nextId = 0;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const count = layerSizes[layer];
      const parents = tiles.filter(tile => tile.layer === layer - 1);
      const positions = this.createSymmetricLayerPositions(count, parents, archetype, random, stackDepths);
      if (positions.length !== count) {
        throw new Error(`[LevelGenerator] Layer placement drifted: ${positions.length}/${count}`);
      }
      positions.forEach(([x, y]) => {
        const tile: TileDefinition = {
          id: nextId++,
          kind: 0,
          x,
          y,
          layer,
          width: 104,
          height: 107,
        };
        tiles.push(tile);
      });
    }
    if (tiles.length !== total) {
      throw new Error(`[LevelGenerator] Tile count drifted: ${tiles.length}/${total}`);
    }
    return tiles;
  }

  /**
   * Creates a layer from mirrored pairs. Keeping the mirror operation here,
   * before kinds are assigned, makes symmetry a geometry invariant rather
   * than a visual coincidence caused by a particular item distribution.
   */
  private createSymmetricLayerPositions(
    count: number,
    parents: TileDefinition[],
    archetype: LevelArchetype,
    random: SeededRandom,
    stackDepths: Map<string, number>,
  ): Array<[number, number]> {
    const positions: Array<[number, number]> = [];
    const pairCount = Math.floor(count / 2);
    // Keep cards on one layer on a continuous grid while preserving a 25%
    // intersection between cards on adjacent layers.
    const cardWidth = 104;
    const cardHeight = 107;
    const layerOverlapRatio = 0.25;
    const sameLayerGap = 0;
    const layerStepX = Math.round((cardWidth + sameLayerGap) / 2);
    const overlapWidth = cardWidth - layerStepX;
    const overlapHeight = cardWidth * cardHeight * layerOverlapRatio / overlapWidth;
    const layerStepY = Math.round(cardHeight - overlapHeight);
    const halfStepY = Math.round(cardHeight / 2);
    const placementJitter = 0;
    const geometry = (x: number, y: number) => ({
      x,
      y,
      width: cardWidth + sameLayerGap,
      height: cardHeight + sameLayerGap,
    });
    const hasOverlap = (candidate: Array<[number, number]>) => {
      for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
        for (let otherIndex = candidateIndex + 1; otherIndex < candidate.length; otherIndex += 1) {
          if (LevelRules.overlapsGeometry(
            geometry(candidate[candidateIndex][0], candidate[candidateIndex][1]),
            geometry(candidate[otherIndex][0], candidate[otherIndex][1]),
          )) return true;
        }
        for (const [existingX, existingY] of positions) {
          if (LevelRules.overlapsGeometry(
            geometry(candidate[candidateIndex][0], candidate[candidateIndex][1]),
            geometry(existingX, existingY),
          )) return true;
        }
      }
      return false;
    };
    const hasIrregularParentOverlap = (candidate: Array<[number, number]>) => candidate.some(([x, y]) =>
      parents.some(parent => {
        const child = geometry(x, y);
        if (!LevelRules.overlapsGeometry(child, parent)) return false;
        return !LevelRules.isAllowedCoverRatio(LevelRules.overlapRatio(child, parent));
      }));
    const hasParentCoverage = (candidate: Array<[number, number]>) => candidate.every(([x, y]) => {
      const child = geometry(x, y);
      return parents.some(parent => LevelRules.hasAllowedCoverRatio(child, parent));
    });
    const canPlace = (candidate: Array<[number, number]>) =>
      !hasOverlap(candidate)
      && hasParentCoverage(candidate)
      && !hasIrregularParentOverlap(candidate);

    // Keep cards on the same layer on one continuous grid. The old half-grid
    // used 88x75 spacing, which made its gaps visible between neighboring
    // cards even though the reference layout uses edge-to-edge cells.
    if (parents.length === 0) {
      const halfGrid: Array<[number, number]> = [];
      for (let row = 0; row < 5; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          halfGrid.push([
            layerStepX + column * (cardWidth + sameLayerGap),
            -300 + row * (cardHeight + sameLayerGap),
          ]);
        }
      }
      random.shuffle(halfGrid);
      let centerY: number | null = null;
      if (count % 2 === 1) {
        centerY = halfGrid[halfGrid.length - 1][1];
        positions.push([0, centerY]);
      }
      const supportPair = halfGrid.find(([x, y]) => x === layerStepX && y !== centerY);
      const pairCandidates = halfGrid
        .filter(([x, y]) => !(x === layerStepX && y === centerY)
          && !(supportPair && x === supportPair[0] && y === supportPair[1]));
      if (supportPair) pairCandidates.unshift(supportPair);
      for (let index = 0; index < pairCount; index += 1) {
        const [x, y] = pairCandidates[index];
        positions.push([-x, y], [x, y]);
      }
      return positions;
    }

    // A center tile is deliberately anchored near a center-ish parent when
    // possible. This keeps odd-sized upper layers visually connected without
    // giving up the exact x=0 axis position.
    if (count % 2 === 1) {
      const quarterParents = parents.filter(parent => Math.abs(parent.x) === layerStepX);
      const centeredParents = parents.filter(parent => parent.x === 0);
      const centerParents = quarterParents.length > 0
        ? quarterParents
        : centeredParents.length > 0 ? centeredParents : parents;
      const shuffledParents = random.shuffle(centerParents.slice());
      for (const parent of shuffledParents) {
        const stepY = parent.x === 0 ? halfStepY : layerStepY;
        const yCandidates = [parent.y - stepY, parent.y + stepY]
          .filter(y => y >= -320 && y <= 180);
        random.shuffle(yCandidates);
        const y = yCandidates.find(candidateY => canPlace([[0, candidateY]]));
        if (y !== undefined) {
          positions.push([0, y]);
          break;
        }
      }
    }

    // Keep a mirrored near-center pair as an anchor for a future center tile.
    if (count % 2 === 0 && parents.length > 0) {
      const alignedParents = parents.filter(parent => Math.abs(parent.x) === layerStepX);
      const offsetParents = parents.filter(parent =>
        Math.abs(parent.x) === 0 || Math.abs(parent.x) === layerStepX * 2);
      const supportParents = alignedParents.length > 0 ? alignedParents : offsetParents;
      const shuffledParents = random.shuffle(supportParents.slice());
      for (const parent of shuffledParents) {
        const supportStepY = Math.abs(parent.x) === layerStepX
          ? halfStepY
          : layerStepY;
        const yCandidates = [parent.y - supportStepY, parent.y + supportStepY]
          .filter(y => y >= -320 && y <= 180);
        random.shuffle(yCandidates);
        const y = yCandidates.find(candidateY =>
          canPlace([[-layerStepX, candidateY], [layerStepX, candidateY]]));
        if (y !== undefined) {
          positions.push([-layerStepX, y], [layerStepX, y]);
          break;
        }
      }
    }

    // 羊了个羊式全叠：按配额把一部分镜像对直接压在父层同位牌上，100% 盖住
    // 下面的牌，收走上层牌才露出底牌。优先延续已有叠柱（堆出 2~4 张的"塔"），
    // 柱子到深度上限后再开新柱。canPlace 复用同层互斥与父子遮挡校验，全叠
    // 比例 1.0 由 LevelRules.isAllowedCoverRatio 放行。
    const maxStackDepth = archetype === 'stacked' ? 4 : 3;
    const stackQuota = this.fullStackPairQuota(count, archetype, random);
    if (stackQuota > 0 && parents.length > 0) {
      const deepColumns: string[] = [];
      const freshColumns: string[] = [];
      parents.forEach(parent => {
        // 只叠 x>0 的镜像对柱（x=0 的中轴牌沿用原锚位逻辑），并要求镜像父牌
        // 存在，保持"布局左右镜像"的不变量。
        if (parent.x <= 0) return;
        if (!parents.some(mirror => mirror.x === -parent.x && mirror.y === parent.y)) return;
        const key = `${parent.x},${parent.y}`;
        const depth = stackDepths.get(key) ?? 0;
        if (depth === 0) freshColumns.push(key);
        else if (depth < maxStackDepth) deepColumns.push(key);
      });
      random.shuffle(deepColumns);
      random.shuffle(freshColumns);
      for (const key of [...deepColumns, ...freshColumns]) {
        if (positions.length + 2 > count) break;
        const [x, y] = key.split(',').map(Number);
        if (!canPlace([[x, y], [-x, y]])) continue;
        positions.push([x, y], [-x, y]);
        stackDepths.set(key, (stackDepths.get(key) ?? 0) + 1);
        stackDepths.set(`${-x},${y}`, (stackDepths.get(`${-x},${y}`) ?? 0) + 1);
      }
    }

    // Both sides of a pair are sampled from the same parent and share the
    // same y coordinate. This preserves useful parent overlap on both sides.
    let attempts = 0;
    while (positions.length < count && attempts < 5000) {
      attempts += 1;
      const parent = random.pick(parents);
      const x = this.clamp(
        this.offsetFromParent(Math.abs(parent.x), layerStepX, layerStepX, 280, random)
          + random.int(-placementJitter, placementJitter),
        layerStepX,
        280,
      );
      const y = this.clamp(
        this.offsetFromParent(parent.y, layerStepY, -320, 180, random)
          + random.int(-placementJitter, placementJitter),
        -320,
        180,
      );
      const candidate: Array<[number, number]> = [[-x, y], [x, y]];
      if (!canPlace(candidate)) {
        continue;
      }
      positions.push(...candidate);
    }

    if (positions.length >= count) return positions.slice(0, count);
    const fallbackPositions: Array<[number, number]> = [];
    const hasCenterAnchor = count % 2 === 1 && positions.length > 0 && positions[0][0] === 0;
    const hasSupportAnchor = count % 2 === 0 && positions.length >= 2;
    const anchorCount = hasCenterAnchor ? 1 : hasSupportAnchor ? 2 : 0;
    const anchors = positions.slice(0, anchorCount);
    positions.length = 0;
    positions.push(...anchors);
    for (let y = -320; y <= 180; y += cardHeight + sameLayerGap) {
      for (let x = layerStepX; x <= 280; x += 104 + sameLayerGap) {
        fallbackPositions.push([x, y]);
      }
    }
    let fallbackIndex = 0;
    while (positions.length < count && fallbackIndex < fallbackPositions.length) {
      const [x, y] = fallbackPositions[fallbackIndex];
      fallbackIndex += 1;
      const candidate: Array<[number, number]> = [[-x, y], [x, y]];
      if (!canPlace(candidate)) continue;
      positions.push(...candidate);
    }
    if (positions.length < count) {
      throw new Error(`[LevelGenerator] Unable to place a non-overlapping layer: ${positions.length}/${count}`);
    }
    return positions.slice(0, count);
  }

  /**
   * 全叠配额：本层拿多少镜像对直接压在父层同位牌上（占本层镜像对的比例）。
   * stacked 原型叠得最密，hidden/order 次之，其余原型走基础比例——
   * 全叠只是把"能看见底牌的一角"变成"完全藏住"，机制上两者都不可点。
   */
  private fullStackPairQuota(count: number, archetype: LevelArchetype, random: SeededRandom) {
    const pairCount = Math.floor(count / 2);
    if (pairCount <= 0) return 0;
    const minRatio = archetype === 'stacked'
      ? 0.4
      : archetype === 'hidden' || archetype === 'order'
        ? 0.3
        : 0.22;
    const ratio = minRatio + random.next() * 0.25;
    return Math.min(pairCount, Math.max(1, Math.round(pairCount * ratio)));
  }

  private offsetFromParent(value: number, distance: number, min: number, max: number, random: SeededRandom) {
    const candidates = [value - distance, value + distance]
      .filter(candidate => candidate >= min && candidate <= max);
    if (candidates.length > 0) return random.pick(candidates);
    return this.clamp(value + (value < (min + max) / 2 ? distance : -distance), min, max);
  }

  private denseLayerSizes(total: number, layers: number) {
    const sizes = Array.from({ length: layers }, () => Math.floor(total / layers));
    let remainder = total - sizes.reduce((sum, size) => sum + size, 0);
    for (let index = 0; remainder > 0; index += 1) {
      sizes[index % layers] += 1;
      remainder -= 1;
    }
    for (let layer = layers - 1; layer >= 1; layer -= 1) {
      let overflow = sizes[layer] - 14;
      if (overflow <= 0) continue;
      sizes[layer] = 14;
      for (let lower = layer - 1; lower >= 0 && overflow > 0; lower -= 1) {
        const capacity = lower === 0 ? 30 : 14;
        const moved = Math.min(capacity - sizes[lower], overflow);
        if (moved > 0) {
          sizes[lower] += moved;
          overflow -= moved;
        }
      }
    }
    return sizes;
  }

  private layerSizes(total: number, layers: number, _archetype: LevelArchetype) {
    // 底重顶轻的锥形分布：把"宽平板"改成"高瘦塔"。棋盘若是每层数量均等的板，
    // 任意时刻同时可见 12~16 张牌，同种元素容易一起露面，槽位压力起不来；
    // 锥形塔让同一时刻只有 4~10 张牌可收，同种元素被迫分散在不同深堆里。
    const weights = Array.from({ length: layers }, (_, index) => Math.pow(layers - index, 0.8));
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const sizes = weights.map(weight => Math.max(1, Math.floor((total * weight) / weightSum)));
    let remainder = total - sizes.reduce((sum, size) => sum + size, 0);
    // 圆整余数从底层开始逐层 +1，保持底重顶轻
    for (let index = 0; remainder > 0; index = (index + 1) % layers) {
      sizes[index] += 1;
      remainder -= 1;
    }
    // 布局引擎容量约束：非底层单层最多 14 张（父子遮挡比例必须落在 0.25/0.5
    // 格点上，更密的层会放不下），底层最多 30 张；超出部分依次并入更低的层。
    for (let layer = layers - 1; layer >= 1; layer -= 1) {
      let overflow = sizes[layer] - 14;
      if (overflow <= 0) continue;
      sizes[layer] = 14;
      for (let lower = layer - 1; lower >= 0 && overflow > 0; lower -= 1) {
        const capacity = lower === 0 ? 30 : 14;
        const moved = Math.min(capacity - sizes[lower], overflow);
        if (moved > 0) {
          sizes[lower] += moved;
          overflow -= moved;
        }
      }
    }
    return sizes;
  }

  private createRemovalOrder(tiles: TileDefinition[], archetype: LevelArchetype, random: SeededRandom) {
    const active = tiles.map(() => true);
    const order: number[] = [];
    while (order.length < tiles.length) {
      const available = LevelRules.availableTiles({ tiles }, active);
      if (available.length === 0) throw new Error('[LevelGenerator] Generated layout has no exposed tile');
      let candidates = available;
      if (archetype === 'stacked' || archetype === 'hidden' || archetype === 'order') {
        const highestLayer = Math.max(...available.map(tile => tile.layer));
        candidates = available.filter(tile => tile.layer === highestLayer);
      }
      const tile = random.pick(candidates);
      const index = tiles.findIndex(candidate => candidate.id === tile.id);
      active[index] = false;
      order.push(tile.id);
    }
    return order;
  }

  private createKindSequence(
    total: number,
    kindCount: number,
    archetype: LevelArchetype,
    random: SeededRandom,
    capacity: number,
    layerOfPosition: number[],
    fullPressure = false,
  ) {
    const groups = total / 3;
    const remaining = Array.from({ length: groups }, () => 3);
    const tray = Array.from({ length: kindCount }, () => 0);
    const layersByKind: number[][] = Array.from({ length: kindCount }, () => []);
    const result: number[] = [];
    let trayLength = 0;
    let lastCleared = false;
    let overflowRewinds = 0;

    // 分散度选择：在候选池里优先挑与该 kind 已出现实例"层距"最远的，
    // 把同种三张牌拆进不同深度的层，避免挖开一层就同时看到三张。
    // combo/rescue 原型不启用：连击链依赖同种元素近距离重复，两个目标互斥，
    // 爽关要的就是"聚堆连消"的手感。
    const useDispersal = archetype !== 'combo' && archetype !== 'rescue';
    const pickDispersed = (pool: Array<{ group: number; value: number; kind: number }>) => {
      if (!useDispersal) return random.pick(pool);
      const position = result.length;
      const layer = layerOfPosition[position] ?? 0;
      let best = pool[0];
      let bestScore = -1;
      let ties = 0;
      for (const item of pool) {
        const layers = layersByKind[item.kind];
        const score = layers.length === 0
          ? Number.MAX_SAFE_INTEGER
          : Math.min(...layers.map(previous => Math.abs(previous - layer)));
        if (score > bestScore) {
          best = item;
          bestScore = score;
          ties = 1;
        } else if (score === bestScore) {
          ties += 1;
          if (random.next() < 1 / ties) best = item;
        }
      }
      return best;
    };

    while (result.length < total) {
      // 普通关/难关用高压节奏（relief 仅 24%），爽关/救援用标准节奏（relief 52%，
      // 连击链依赖放松段）；这是普通关槽位压力的主旋钮。
      // 贴满压力档（超萌挑战）永远走高压节奏：序列里不安排任何放松段，
      // 槽位长期骑在 capacity-1 上，三消只在 mustClear 逼到墙角时发生。
      const phase = fullPressure
        ? 'pressure'
        : useDispersal
          ? this.denseRhythmAt(result.length, total)
          : this.rhythmAt(result.length, total);
      const candidates = remaining
        .map((value, group) => ({ group, value, kind: group % kindCount }))
        .filter(item => item.value > 0);
      const mustClear = trayLength >= capacity - 1;
      const mustPair = trayLength === capacity - 2 && !tray.some(value => value === 2);
      let safe = candidates.filter(item => {
        const clears = tray[item.kind] >= 2;
        const nextTrayLength = clears ? trayLength - 2 : trayLength + 1;
        if (mustClear && !clears && result.length < total - 1) return false;
        if (mustPair && item.value > 0 && tray[item.kind] !== 1 && result.length < total - 1) return false;
        if (result.length < total - 1 && nextTrayLength >= capacity) return false;
        return true;
      });
      if (safe.length === 0) safe = candidates;

      const completing = safe.filter(item => tray[item.kind] === 2);
      const pressureCandidates = safe.filter(item => tray[item.kind] < 2);
      const newKinds = pressureCandidates.filter(item => tray[item.kind] === 0);
      const pairing = safe.filter(item => tray[item.kind] === 1);
      let choice: { group: number; value: number; kind: number };
      // 尾段（≥80% 进度）进入"困对"区：与贴满压力档同一套凑对逻辑，
      // 但只作用于普通关/难关的尾声——让玩家失败时"带着对子死"，
      // "再来一张就消了"的听牌感是复活广告转化的最高点。
      // combo/rescue 原型（爽关/救援关）走 useDispersal=false，天然不受影响。
      const endgameTrap = !fullPressure && (result.length + 0.5) / Math.max(total, 1) >= 0.8;
      if (useDispersal && trayLength >= capacity - 2) {
        // 分散模式下槽位吃紧（≥4 张）时优先"完成 > 配对"，分散目标让位：
        // 否则"挑新元素"的策略会把槽位堆满互不相同的单张，序列模拟进入死局，
        // 只能退化到兜底序列，产出的关卡会因脆弱状态过多被 forgiveness 门槛拒绝。
        // 贴满压力档与尾段困对反过来：3/5 时优先"凑对"把槽位顶到 4/5 再消——
        // 最优路径也要长期骑在满槽边缘，这是超萌挑战残酷度的核心。
        if ((fullPressure || endgameTrap) && trayLength < capacity - 1 && pairing.length > 0) {
          choice = pickDispersed(pairing);
        } else if (completing.length > 0) {
          choice = pickDispersed(completing);
        } else if (pairing.length > 0) {
          choice = pickDispersed(pairing);
        } else {
          choice = pickDispersed(safe);
        }
      } else if (phase === 'pressure' && newKinds.length > 0) {
        choice = pickDispersed(newKinds);
      } else if (phase === 'pressure' && pressureCandidates.length > 0) {
        choice = pickDispersed(pressureCandidates);
      } else if ((phase === 'relief' || lastCleared || archetype === 'combo' || archetype === 'rescue')
        && completing.length > 0) {
        choice = pickDispersed(completing);
      } else if (phase === 'relief' && pairing.length > 0) {
        choice = pickDispersed(pairing);
      } else {
        choice = pickDispersed(safe);
      }
      remaining[choice.group] -= 1;
      if (tray[choice.kind] === 2) {
        tray[choice.kind] = 0;
        trayLength -= 2;
        lastCleared = true;
      } else {
        tray[choice.kind] += 1;
        trayLength += 1;
        lastCleared = false;
      }
      layersByKind[choice.kind].push(layerOfPosition[result.length] ?? 0);
      result.push(choice.kind);

      if (trayLength < capacity) continue;
      overflowRewinds += 1;
      const rewind = Math.min(result.length, Math.max(6, Math.floor(total * 0.3)));
      if (overflowRewinds > 8 || !this.rewindKindSequence(
        result,
        remaining,
        tray,
        layersByKind,
        rewind,
        kindCount,
      )) {
        throw new Error('[LevelGenerator] Kind sequence overflowed the tray');
      }
      trayLength = tray.reduce((sum, count) => sum + count, 0);
      lastCleared = false;
    }

    return result;
  }

  private rewindKindSequence(
    result: number[],
    remaining: number[],
    tray: number[],
    layersByKind: number[][],
    rewind: number,
    kindCount: number,
  ) {
    if (rewind <= 0 || result.length < rewind) return false;
    const removed = result.splice(result.length - rewind, rewind);
    removed.forEach(kind => {
      for (let group = kind; group < remaining.length; group += kindCount) {
        if (remaining[group] < 3) {
          remaining[group] += 1;
          break;
        }
      }
      layersByKind[kind].pop();
    });
    tray.forEach((_, kind) => {
      tray[kind] = 0;
    });
    result.forEach(kind => {
      if (tray[kind] >= 2) tray[kind] = 0;
      else tray[kind] += 1;
    });
    return true;
  }

  private makePlan(level: LevelDefinition, solution: number[]): LevelPlan {
    const plannedKinds = solution.map(tileId => level.tiles.find(tile => tile.id === tileId)!.kind);
    let combo = 0;
    let current = 0;
    const counts = Array.from({ length: level.kindCount }, () => 0);
    plannedKinds.forEach(kind => {
      counts[kind] += 1;
      if (counts[kind] >= 3) {
        counts[kind] -= 3;
        current += 1;
        combo = Math.max(combo, current);
      } else {
        current = 0;
      }
    });
    return {
      solution,
      plannedKinds,
      plannedComboCount: combo,
      rhythm: level.plan.rhythm,
    };
  }

  private scoreCandidate(
    level: LevelDefinition,
    result: { exploredStates: number; pathMetrics: any },
    target: number,
    recentFingerprints: string[],
    recentArchetypes: LevelArchetype[],
    risk: PlayerRiskEstimate | null,
  ): LevelScore {
    const metrics = result.pathMetrics;
    const maxLayer = Math.max(...level.tiles.map(tile => tile.layer));
    // Keep the score on the same scale as baseDifficulty. Raw decision counts
    // grow with board size, so normalize them before combining the signals.
    const structural = level.tiles.length * 0.12 + maxLayer * 2.2;
    const decisions = metrics.decisionPoints / Math.max(level.tiles.length, 1) * 8
      + Math.min(metrics.decisionCount / Math.max(level.tiles.length, 1), 12) * 0.45;
    const pressure = metrics.maxTrayOccupancy / Math.max(level.slotCapacity, 1) * 12
      + metrics.failureRisk * 0.1;
    const difficulty = this.clamp(Math.round(structural + decisions + pressure), 0, 100);
    const tension = this.clamp(Math.round(
      metrics.maxTrayOccupancy / level.slotCapacity * 70
      + metrics.failureRisk * 0.22
      + metrics.decisionPoints / Math.max(level.tiles.length, 1) * 40,
    ), 0, 100);
    const satisfaction = this.clamp(Math.round(
      30
      + metrics.comboOpportunities / Math.max(level.tiles.length, 1) * 42
      + metrics.maxCombo * 9
      + metrics.comebackOpportunities * 8,
    ), 0, 100);
    const comeback = this.clamp(Math.round(
      metrics.comebackOpportunities * 34
      + Math.max(0, metrics.maxTrayOccupancy - level.slotCapacity + 2) * 10,
    ), 0, 100);
    const repetition = recentFingerprints.indexOf(level.fingerprint) >= 0
      ? 100
      : recentArchetypes.slice(-2).indexOf(level.archetype) >= 0 ? 25 : 0;
    const wrongChoiceRate = metrics.wrongChoiceCount / Math.max(level.tiles.length, 1);
    // forgiveness 只拦截真正极端的关卡：immediateFailures（分析关闭时）与
    // failureRisk 是同一个高压信号，高槽压设计下天然偏高，不去重会错杀
    // stacked/hidden/order 压力原型（双重扣分直接钳到 0）。
    const forgiveness = risk
      ? this.clamp(Math.round(
          100 - risk.estimatedFailureRate * 1.1 - risk.wrongChoiceRisk * 0.15
            - Math.min(wrongChoiceRate, 1) * 15,
        ), 0, 100)
      : this.clamp(Math.round(100 - Math.min(wrongChoiceRate, 1) * 15), 0, 100);
    const rhythmRequirement = level.tiles.length <= 24 ? 1 : 2;
    // 压力为主、转化为节奏拍、relief 为加分项：高压节奏（denseRhythmAt）下
    // relief 稀缺是设计意图，不能让 relief 缺失把压力原型挡在门外。
    const rhythm = this.clamp(Math.round(
      Math.min(metrics.pressureMoments / rhythmRequirement, 1) * 50
      + Math.min(metrics.rhythmTransitions / Math.max(1, rhythmRequirement * 2 - 1), 1) * 30
      + Math.min(metrics.reliefMoments / rhythmRequirement, 1) * 20,
    ), 0, 100);
    return {
      solvability: 100,
      difficulty,
      tension,
      satisfaction,
      comeback,
      repetition,
      forgiveness,
      decisionCount: metrics.decisionCount,
      decisionPoints: metrics.decisionPoints,
      forcedMoves: metrics.forcedMoves,
      maxTrayOccupancy: metrics.maxTrayOccupancy,
      failureRisk: metrics.failureRisk,
      estimatedFailureRate: risk ? risk.estimatedFailureRate : 0,
      wrongChoiceRisk: risk ? risk.wrongChoiceRisk : 0,
      failureProgressAvg: risk ? risk.failureProgressAvg : 0,
      trappedPairRate: risk ? risk.trappedPairRate : 0,
      reviveRescueRate: risk ? risk.reviveRescueRate : 100,
      comboOpportunities: metrics.comboOpportunities,
      maxCombo: metrics.maxCombo,
      comebackOpportunities: metrics.comebackOpportunities,
      wrongChoiceCount: metrics.wrongChoiceCount,
      exploredStates: result.exploredStates,
      pressureMoments: metrics.pressureMoments,
      reliefMoments: metrics.reliefMoments,
      rhythmTransitions: metrics.rhythmTransitions,
      rhythm,
    };
  }

  private accept(
    level: LevelDefinition,
    score: LevelScore,
    target: number,
    archetype: LevelArchetype,
    fingerprint: string,
    recentFingerprints: string[],
    role: LevelRole = 'normal',
    failureRateBand = { min: 0, max: 100 },
  ) {
    if (score.solvability !== 100 || score.repetition >= 100) return false;
    // 容差带下限：允许比目标略低，打破"只准比目标难"的单调爬坡；
    // 未进带的候选由 bestDistance 兜底回退到最接近者。
    if (score.difficulty < target - LevelGenerator.targetTolerance
      || score.difficulty > target + LevelGenerator.targetTolerance) return false;
    if (score.estimatedFailureRate < failureRateBand.min
      || score.estimatedFailureRate > failureRateBand.max) return false;
    // 失败可挽回感（广告变现硬指标）：失败必须发生在尾段、槽内带着听牌，
    // 并且看广告清对子后残局真可解。失败率太低的关（爽关/救援/新手关）
    // 没什么复活场景，不卡这三条。
    if (LevelGenerator.needsFailFeelGates(score, role, failureRateBand, archetype === 'rescue')) {
      if (score.reviveRescueRate < LevelGenerator.minReviveRescueRate) return false;
      if (score.failureProgressAvg < LevelGenerator.minFailureProgress) return false;
      if (score.trappedPairRate < LevelGenerator.minTrappedPairRate) return false;
    }
    if (score.forgiveness < 25) return false;
    if ((archetype === 'combo' || archetype === 'rescue') && score.satisfaction < 40) return false;
    if (role === 'breather') {
      // 爽关的记忆点：必须至少有一次连续三消链，且整体体验评价达标
      if (score.satisfaction < 45 || score.maxCombo < 2) return false;
    }
    const minimumRhythm = archetype === 'rescue'
      ? 45
      : level.tiles.length <= 24 ? 40 : 55;
    if (score.rhythm < minimumRhythm) return false;
    return recentFingerprints.indexOf(fingerprint) < 0;
  }

  private static readonly targetTolerance = 6;
  static readonly minFailureProgress = 80;
  static readonly minTrappedPairRate = 60;
  static readonly minReviveRescueRate = 55;

  static needsFailFeelGates(
    score: Pick<LevelScore, 'estimatedFailureRate'>,
    role: LevelRole,
    band: { min: number; max: number } = { min: 0, max: 100 },
    rescue = false,
  ) {
    if (role === 'breather' || rescue) return false;
    // 新手保护带太窄（L1-5 上限 ≤15%），卡广告门槛会把失败率顶出带。
    if (band.max <= 15) return false;
    return score.estimatedFailureRate >= Math.max(10, band.min * 0.5);
  }

  // 难度分的实测饱和上限。structural 分量被棋盘规模（牌量上限 90、层数上限 9）封顶，
  // decisions / pressure 两个分量都按每格归一化，因此 difficulty 在 L70 之后稳定停在
  // 54.0，而 baseDifficulty 会一路爬到 65。若不封顶，高关永远进不了 ±targetTolerance
  // 的验收带，只能把 24 次 attempt 跑满再兜底 —— 实测 L80 单关生成 86~113ms，
  // 是 L50（6ms）的十几倍，进关时会明显顿一下。验收目标同样封顶即可提前 accept。
  private static readonly difficultySaturation = 54;

  static failureRateBand(level: number, rescue = false) {
    if (rescue) return { min: 5, max: 15 };
    if (level <= 1) return { min: 0, max: 8 };
    // 新手保护期（L2-5）：失败率压到 8-15%。D1/D3 留存死在头几关，
    // 此时玩家还没形成"失败→看广告复活"的行为习惯，少赚的广告费远小于
    // 流失损失；变现档位（30-45%）推迟到 L23+ 才进入。
    if (level <= 5) return { min: 8, max: 15 };
    if (level <= 10) return { min: 15, max: 25 };
    if (level <= 22) return { min: 25, max: 40 };
    return { min: 30, max: 45 };
  }

  private candidateDistance(
    score: LevelScore,
    target: number,
    failureRateBand: { min: number; max: number },
    role: LevelRole = 'normal',
    rescue = false,
    slotCapacity = 6,
  ) {
    const difficultyDistance = score.difficulty < target - LevelGenerator.targetTolerance
      ? target - LevelGenerator.targetTolerance - score.difficulty
      : score.difficulty > target + LevelGenerator.targetTolerance
        ? score.difficulty - target - LevelGenerator.targetTolerance
        : 0;
    const riskDistance = score.estimatedFailureRate < failureRateBand.min
      ? failureRateBand.min - score.estimatedFailureRate
      : score.estimatedFailureRate > failureRateBand.max
        ? score.estimatedFailureRate - failureRateBand.max
        : 0;
    let failFeelDistance = 0;
    const riskUnscored = score.estimatedFailureRate === 0 && score.failureProgressAvg === 0;
    if (riskUnscored && failureRateBand.min >= 8 && role !== 'breather' && !rescue) {
      // 没跑玩家风险模拟的候选不能靠默认 revive=100 抢兜底席位。
      failFeelDistance += 40;
    } else if (LevelGenerator.needsFailFeelGates(score, role, failureRateBand, rescue)) {
      failFeelDistance += Math.max(0, LevelGenerator.minReviveRescueRate - score.reviveRescueRate) * 1.2;
      failFeelDistance += Math.max(0, LevelGenerator.minFailureProgress - score.failureProgressAvg) * 8;
      failFeelDistance += Math.max(0, LevelGenerator.minTrappedPairRate - score.trappedPairRate);
    }
    // 普通关/难关通关不能太空：见证路径峰值占用过低说明这关几乎不压槽，广告没人看。
    // 只作距离惩罚，不做硬拒绝，避免 1000 seed 被规模分打死。爽关和救援关不罚。
    let occupancyDistance = 0;
    if (role !== 'breather' && !rescue) {
      const spareSlots = Math.max(0, slotCapacity - score.maxTrayOccupancy);
      occupancyDistance = Math.max(0, spareSlots - 2) * 4;
    }
    // 失败率带必须压过失败质量：否则兜底会发出「尾段很好、但失败率出带」的关。
    return difficultyDistance + riskDistance * 4 + failFeelDistance * 1.6 + occupancyDistance;
  }

  private extraAttemptsForFailFeel(options: LevelGenerationOptions, context: GenerationContext) {
    if (options.fullTrayPressure === true) return 0;
    if (!context.best) return 48;
    this.finalizeBestScore(context.best);
    if (!LevelGenerator.needsFailFeelGates(
      context.best.score,
      context.role,
      context.failureRateBand,
      options.rescue === true,
    )) return 0;
    if (context.best.score.failureProgressAvg >= LevelGenerator.minFailureProgress
      && context.best.score.trappedPairRate >= LevelGenerator.minTrappedPairRate
      && context.best.score.reviveRescueRate >= LevelGenerator.minReviveRescueRate) {
      return 0;
    }
    return 48;
  }

  /**
   * 风险模拟局数必须能命中当前关卡的失败率验收带。
   * estimatedFailureRate = round(failures/n*100)，n=4 时只能取 0/25/50/75/100，
   * 与 L22+ 的 30–45 带完全没有交集——高关 accept 永远失败，只能跑满全部 attempt。
   */
  private static riskTrialCount(level: number, tileCount: number, rescue: boolean) {
    const band = LevelGenerator.failureRateBand(level, rescue);
    const candidates = tileCount >= 72 ? [10, 8, 12] : [10, 8, 12, 6];
    for (const trialCount of candidates) {
      for (let failures = 0; failures <= trialCount; failures += 1) {
        const rate = Math.round((failures / trialCount) * 100);
        if (rate >= band.min && rate <= band.max) return trialCount;
      }
    }
    return 10;
  }

  /**
   * Estimates failure pressure with a bounded, deterministic player model.
   * The model prefers an immediate match or a pair, but occasionally picks a
   * near-best visible card to represent an ordinary player's mistake.
   * Uses a precomputed cover graph so each step is O(edges), not O(n² geometry).
   *
   * 除失败率外还产出"失败画像"三指标（可挽回感量化）：
   * - failureProgressAvg：失败发生在多晚——越晚越是"差一点就赢"；
   * - trappedPairRate：失败时槽内是否有听牌对子——有对子玩家才想复活；
   * - reviveRescueRate：复活（清一对）后棋盘是否真可解——广告价值的硬保证。
   */
  private estimatePlayerRisk(level: LevelDefinition, coverGraph?: TileCoverGraph): PlayerRiskEstimate {
    const trialCount = LevelGenerator.riskTrialCount(
      level.level,
      level.tiles.length,
      level.archetype === 'rescue',
    );
    // This is the chance of a meaningful misclick at one decision point, not
    // every card tap. Small values keep the estimate close to normal play.
    // 真人看不见被盖住的牌：隐藏信息（记忆与推理负担）是真人失误的主要来源，
    // 而模拟器对全棋盘种类全知。按原型给失误率分档补偿，否则 hidden/stacked
    // 原型的 estimatedFailureRate 被系统性低估，验收带对它们失准。
    const hiddenMistakeFactor = level.archetype === 'hidden'
      ? 3
      : level.archetype === 'stacked' ? 1.5 : 1;
    const baseMistakeChance = (level.level <= 8 ? 0.004 : 0.008) * hiddenMistakeFactor;
    const graph = coverGraph ?? new TileCoverGraph(level);
    const tiles = level.tiles;
    const dependents = graph.dependents;
    let failures = 0;
    let wrongChoices = 0;
    let decisions = 0;
    let failureProgressSum = 0;
    let trappedPairFailures = 0;
    let reviveRescues = 0;

    for (let trial = 0; trial < trialCount; trial += 1) {
      const random = new SeededRandom(level.seed ^ Math.imul(trial + 1, 0x45d9f3b));
      const board = new CoverBoardState(graph);
      const counts = Array.from({ length: level.kindCount }, () => 0);
      const trayIndices: number[] = [];
      let trayLength = 0;
      let availableCount = board.availableIndices().length;
      let won = false;

      for (let step = 0; step < level.tiles.length + 1; step += 1) {
        const available = board.availableIndices();
        if (available.length === 0) break;
        availableCount = available.length;
        const choices = available.map(index => {
          const tile = tiles[index];
          const kind = tile.kind;
          board.take(index);
          counts[kind] += 1;
          let nextTray = trayLength + 1;
          let cleared = 0;
          while (counts[kind] >= 3) {
            counts[kind] -= 3;
            nextTray -= 3;
            cleared += 1;
          }
          // Incremental available count: removing one free tile unblocks only
          // its dependents that still had exactly one live blocker.
          let afterAvailable = availableCount - 1;
          const unlocked = dependents[index];
          for (let i = 0; i < unlocked.length; i += 1) {
            const child = unlocked[i];
            if (board.active[child] && board.blockerCount[child] === 0) afterAvailable += 1;
          }
          // Undo preview.
          if (cleared > 0) {
            counts[kind] += cleared * 3;
          }
          counts[kind] -= 1;
          board.untake(index);

          const pairBonus = counts[kind] === 1 ? 80 : 0;
          const clearBonus = cleared > 0 ? 1000 : 0;
          const trayPenalty = nextTray * 6;
          return {
            index,
            tileId: tile.id,
            kind,
            cleared,
            nextTray,
            score: clearBonus + pairBonus + afterAvailable * 2 - trayPenalty,
          };
        });
        const bestScore = Math.max(...choices.map(choice => choice.score));
        let idealChoice: (typeof choices)[number] | undefined;
        for (const tileId of level.plan.solution) {
          const found = choices.find(choice => choice.tileId === tileId);
          if (found) {
            idealChoice = found;
            break;
          }
        }
        const nearBest = choices.filter(choice => choice.score >= bestScore - 120);
        const mistakePool = nearBest.filter(choice => choice !== idealChoice);
        const taken = tiles.length - board.remaining;
        const progress = taken / Math.max(tiles.length, 1);
        // 80% 进度前几乎不失手，失败才会堆在尾段。L6-10 尾段加权更轻，避免顶出 15-25% 带。
        const lateFactor = level.level < 6
          ? 1
          : progress < 0.8
            ? 0.12
            : (level.level <= 10 ? 3.4 : 4.2);
        const mistakeChance = baseMistakeChance * lateFactor;
        const useMistake = mistakePool.length > 0
          && available.length > 1
          && random.next() < mistakeChance;
        const choice = useMistake
          ? random.pick(mistakePool)
          : idealChoice || random.pick(choices.filter(item => item.score === bestScore));
        if (choice !== idealChoice) wrongChoices += 1;
        if (available.length > 1) decisions += 1;

        board.take(choice.index);
        counts[choice.kind] += 1;
        trayIndices.push(choice.index);
        trayLength += 1;
        while (counts[choice.kind] >= 3) {
          counts[choice.kind] -= 3;
          trayLength -= 3;
          // 三消离槽：该 kind 的三张全部从槽序中移除（复活检查要按真实槽序复盘）
          let toDrop = 3;
          for (let i = trayIndices.length - 1; i >= 0 && toDrop > 0; i -= 1) {
            if (tiles[trayIndices[i]].kind === choice.kind) {
              trayIndices.splice(i, 1);
              toDrop -= 1;
            }
          }
        }
        if (board.remaining === 0) {
          won = true;
          break;
        }
        if (trayLength >= level.slotCapacity) break;
      }
      if (won) continue;
      failures += 1;
      // 失败画像：进度（玩家视角"棋盘快空了"= 已取走牌数占比）与槽内听牌。
      failureProgressSum += Math.round(((tiles.length - board.remaining) / tiles.length) * 100);
      if (counts.some(count => count >= 2)) trappedPairFailures += 1;
      if (this.canReviveRescue(level, graph, board.active, trayIndices)) reviveRescues += 1;
    }

    return {
      estimatedFailureRate: Math.round(failures / trialCount * 100),
      wrongChoiceRisk: decisions > 0 ? Math.round(wrongChoices / decisions * 100) : 0,
      failureProgressAvg: failures > 0 ? Math.round(failureProgressSum / failures) : 0,
      trappedPairRate: failures > 0 ? Math.round(trappedPairFailures / failures * 100) : 0,
      reviveRescueRate: failures > 0 ? Math.round(reviveRescues / failures * 100) : 100,
    };
  }

  /**
   * 复活可解性检查：完整复刻 GameScreen.reviveFromAd 的真实机制后验证可解性。
   * 游戏实际规则（不是笼统的"清 3 张"）：
   * 1. 清掉槽内数量最多的对子 kind 的 2 张（平手取最靠右的）；无对子只清最右 1 张；
   * 2. 若清走一对后该 kind 在棋盘可用牌中已绝迹，最后 1 张会被放回棋盘。
   * 残局规模小（失败多发生在尾段），2 万状态预算足够；
   * 搜索被截断按不可救处理（保守，不高估复活价值）。
   */
  private canReviveRescue(
    level: LevelDefinition,
    graph: TileCoverGraph,
    activeBase: boolean[],
    trayIndices: number[],
  ) {
    if (trayIndices.length === 0) return false;
    const tiles = level.tiles;
    // 与 GameScreen.pickRevivePairKind 一致：数量最多的对子 kind，平手取槽内最靠右
    const trayCounts = Array.from({ length: level.kindCount }, () => 0);
    trayIndices.forEach(index => {
      trayCounts[tiles[index].kind] += 1;
    });
    let pairKind = -1;
    let bestCount = 1;
    let bestRight = -1;
    trayCounts.forEach((count, kind) => {
      if (count < 2) return;
      let right = -1;
      trayIndices.forEach((index, position) => {
        if (tiles[index].kind === kind) right = position;
      });
      if (count > bestCount || (count === bestCount && right > bestRight)) {
        pairKind = kind;
        bestCount = count;
        bestRight = right;
      }
    });
    const removed = pairKind >= 0
      ? trayIndices.filter(index => tiles[index].kind === pairKind).slice(-2)
      : trayIndices.slice(-1);
    if (removed.length === 0) return false;

    const board = new CoverBoardState(graph, activeBase);
    const active = activeBase.slice();
    const revivedTray = trayIndices.filter(index => removed.indexOf(index) === -1);
    // 返还逻辑：清走一对后该 kind 在棋盘可用牌里绝迹 → 最后一张放回棋盘
    const needReturn = removed.length >= 2
      && !board.availableIndices().some(index => tiles[index].kind === tiles[removed[0]].kind);
    if (needReturn) {
      const returned = removed[removed.length - 1];
      active[returned] = true;
    }
    const counts = Array.from({ length: level.kindCount }, () => 0);
    revivedTray.forEach(index => {
      counts[tiles[index].kind] += 1;
    });
    const result = this.solver.solve(level, {
      maxStates: 20000,
      analyzeBranches: false,
      coverGraph: graph,
      initialState: { active, counts },
    });
    return result.solvable;
  }

  /** Fill in player-risk fields on the fallback winner that skipped risk scoring. */
  private finalizeBestScore(best: LevelDefinition) {
    const risk = this.estimatePlayerRisk(best, new TileCoverGraph(best));
    const wrongChoiceRate = best.score.wrongChoiceCount / Math.max(best.tiles.length, 1);
    best.score.estimatedFailureRate = risk.estimatedFailureRate;
    best.score.wrongChoiceRisk = risk.wrongChoiceRisk;
    best.score.failureProgressAvg = risk.failureProgressAvg;
    best.score.trappedPairRate = risk.trappedPairRate;
    best.score.reviveRescueRate = risk.reviveRescueRate;
    best.score.forgiveness = this.clamp(Math.round(
      100 - risk.estimatedFailureRate * 1.1 - risk.wrongChoiceRisk * 0.15
        - Math.min(wrongChoiceRate, 1) * 15,
    ), 0, 100);
    return best;
  }

  private chooseArchetype(level: number, random: SeededRandom, recent: LevelArchetype[], role: LevelRole = 'normal') {
    // 爽关固定 combo 原型：见证路径在缓解段优先完成三消，制造连锁
    if (role === 'breather') return 'combo';
    // 难关用压力原型：见证路径强制从最高层拆起，遮挡决策更严苛
    if (role === 'spike') {
      const spikeChoices: LevelArchetype[] = ['stacked', 'hidden', 'order'];
      const recentLast = recent.slice(-1)[0];
      const filtered = spikeChoices.filter(choice => choice !== recentLast);
      return random.pick(filtered.length > 0 ? filtered : spikeChoices);
    }
    const choices: LevelArchetype[] = level <= 5
      ? ['normal', 'normal', 'combo']
      : level <= 15
        ? ['normal', 'stacked', 'hidden', 'combo']
        : level <= 30
          ? ['normal', 'stacked', 'hidden', 'order', 'space', 'comeback']
          : ['normal', 'stacked', 'hidden', 'order', 'space', 'combo', 'comeback'];
    const recentLast = recent.slice(-1)[0];
    const filtered = choices.filter(choice => choice !== recentLast);
    return random.pick(filtered.length > 0 ? filtered : choices);
  }

  private rhythmAt(index: number, total: number): LevelRhythm {
    const progress = (index + 0.5) / Math.max(total, 1);
    if (progress < 0.12 || (progress >= 0.30 && progress < 0.46)
      || (progress >= 0.64 && progress < 0.80) || progress >= 0.92) {
      return 'relief';
    }
    return 'pressure';
  }

  // 高压节奏：relief 窗口从 52% 压到约 18%，三消完成集中在少数释放点，
  // 其余大部分时间玩家要在槽位里憋着配不成对的牌。
  // 尾段（≥80%）不再安排解压窗口（原 94% relief 已撤销）：
  // 失败的可挽回感来自"差一点就赢"——把槽压峰值逼到棋盘尾声，
  // 让失败集中发生在高进度处，而不是中盘绝望崩盘。
  private denseRhythmAt(index: number, total: number): LevelRhythm {
    const progress = (index + 0.5) / Math.max(total, 1);
    if (progress < 0.06 || (progress >= 0.42 && progress < 0.62)) {
      return 'relief';
    }
    return 'pressure';
  }

  private rhythmSegments(total: number): LevelRhythmSegment[] {
    const boundaries = [0, 0.12, 0.30, 0.46, 0.64, 0.80, 0.92, 1];
    const types: LevelRhythm[] = [
      'relief',
      'pressure',
      'relief',
      'pressure',
      'relief',
      'pressure',
      'relief',
    ];
    return types.map((type, index) => ({
      type,
      start: Math.floor(boundaries[index] * total),
      end: index === types.length - 1 ? total : Math.floor(boundaries[index + 1] * total),
    }));
  }

  private layerCount(level: number) {
    if (level <= 1) return 2;
    // 层叠更深、可见牌更少：L2 就 5 层，L18 起到顶 9 层
    return Math.min(9, 5 + Math.floor((level - 2) / 4));
  }

  private static kindCount(level: number, role: LevelRole = 'normal') {
    // 优先级2：延缓种类数增长 - 拉长难度曲线，给玩家更长的学习期
    // 🆕 再次优化：进一步增加前期种类数，解决"还是太简单"问题
    // 新曲线：L2=8种 → L3=9种 → L5=10种 → L10=11种 → L20=13种 → L35=15种
    let normal: number;
    if (level <= 1) {
      normal = 4;
    } else if (level <= 10) {
      // L2=8 → L3=9 → L5=10 → L10=11（前期增加 1-2 种）
      if (level === 2) normal = 8;
      else if (level <= 4) normal = 9;
      else if (level <= 6) normal = 10;
      else normal = 11;
    } else if (level <= 20) {
      // L11=11 → L20=13（中期稳定）
      normal = Math.min(13, 11 + Math.floor((level - 10) / 5));
    } else {
      // L21=13 → L35=15（后期达到上限）
      normal = Math.min(15, 13 + Math.floor((level - 20) / 5));
    }
    // 爽关减少两种元素：同类更密集，三消更容易凑齐、连消更连贯。
    // 注意几何轮廓（层数/牌量）与普通关保持一致：上层每层只能容纳约 17 张
    // （遮挡比例必须落在 0.25/0.5 格点上），"更多牌+更少层"会超出布局容量。
    if (role === 'breather') return Math.max(4, normal - 2);
    return normal;
  }

  private static tileCount(level: number, random?: SeededRandom, role: LevelRole = 'normal') {
    if (level <= 1) return 18;

    const kindCount = LevelGenerator.kindCount(level);
    const minimum = kindCount * 3;

    // 🆕 优化前 10 关：让每种元素保持在 7-8 张（策略性甜蜜点）
    // 解决"无脑点"问题：6 种 × 9.5 张 → 8 种 × 7.5 张
    if (level <= 10) {
      const targetPerKind = 7.5;
      const targetTotal = Math.round(kindCount * targetPerKind / 3) * 3;
      const variation = random ? random.int(-1, 1) * 3 : 0;
      return Math.max(minimum, targetTotal + variation);
    }

    // L11+ 保持原逻辑
    const progress = Math.min(Math.max(level - 2, 0), 55);
    const base = 57 + progress * 0.6;
    const variation = random ? random.int(-2, 2) * 3 : 0;
    const maxTiles = 90;
    const candidate = Math.round((base + variation) / 3) * 3;
    const normal = Math.max(minimum, Math.min(maxTiles, candidate));
    if (role === 'spike') {
      // 难关必须短：牌量压到普通关一半左右，靠"同类更少、等待更长"换难度。
      // 下限 36 与验收脚本一致，避免 accept 提前命中时落到 33（11 种×3）过短。
      const spikeCandidate = Math.round((normal * 0.55 + (random ? random.int(-1, 1) * 3 : 0)) / 3) * 3;
      return Math.max(Math.max(minimum, 36), Math.min(60, spikeCandidate));
    }
    return normal;
  }

  private static rescueTileCount(level: number, random: SeededRandom) {
    const normalCount = LevelGenerator.tileCount(level, random);
    const minimum = LevelGenerator.kindCount(level) * 3;
    return Math.max(minimum, Math.round((normalCount * 0.60) / 3) * 3);
  }

  private fingerprint(level: number, archetype: LevelArchetype, tiles: TileDefinition[]) {
    const canonical = `${level}:${archetype}:${tiles.map(tile => `${tile.layer},${tile.x},${tile.y},${tile.kind}`).join(';')}`;
    let hash = 2166136261;
    for (let index = 0; index < canonical.length; index += 1) {
      hash ^= canonical.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16);
    return '00000000'.slice(hex.length) + hex;
  }

  private emptyScore(): LevelScore {
    return {
      solvability: 0, difficulty: 0, tension: 0, satisfaction: 0, comeback: 0,
      repetition: 0, forgiveness: 0, decisionCount: 0, decisionPoints: 0, forcedMoves: 0,
      maxTrayOccupancy: 0, failureRisk: 0, estimatedFailureRate: 0, wrongChoiceRisk: 0,
      failureProgressAvg: 0, trappedPairRate: 0, reviveRescueRate: 100,
      comboOpportunities: 0, maxCombo: 0,
      comebackOpportunities: 0, wrongChoiceCount: 0, exploredStates: 0,
      pressureMoments: 0, reliefMoments: 0, rhythmTransitions: 0, rhythm: 0,
    };
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private static mixSeed(seed: number, attempt: number) {
    let value = (seed + Math.imul(attempt + 1, 0x9e3779b9)) | 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    return value | 0;
  }
}
