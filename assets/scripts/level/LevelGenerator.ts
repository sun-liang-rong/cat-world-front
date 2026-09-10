import { LevelRules, LevelSolver } from './LevelSolver';
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

type GenerationContext = {
  target: number;
  failureRateBand: { min: number; max: number };
  role: LevelRole;
  attempts: number;
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

    if (context.best) return context.best;
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
    return new Promise<LevelDefinition>((resolve, reject) => {
      let attempt = 0;
      const runAttempt = () => {
        if (abort.cancelled) {
          reject(new AsyncGenerationCancelledError());
          return;
        }
        if (attempt >= context.attempts) {
          if (context.best) {
            resolve(context.best);
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

        // Yield between candidates so generation never monopolizes the Cocos
        // frame loop while the player is entering a level.
        setTimeout(runAttempt, 0);
      };

      setTimeout(runAttempt, 0);
    });
  }

  private createGenerationContext(options: LevelGenerationOptions): GenerationContext {
    return {
      target: options.targetDifficulty === undefined
        ? LevelGenerator.baseDifficulty(options.level)
        : options.targetDifficulty,
      failureRateBand: LevelGenerator.failureRateBand(options.level, options.rescue === true),
      role: options.rescue ? 'normal' : options.role ?? 'normal',
      attempts: options.maxAttempts || 48,
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
    const result = this.solver.solve(candidate, {
      maxStates: 250000,
      analyzeBranches: options.solverAnalyzeBranches === true,
      preferredSolution: candidate.plan.solution,
    });
    if (!result.solvable) return null;

    const score = this.scoreCandidate(
      candidate,
      result,
      context.target,
      context.recentFingerprints,
      context.recentArchetypes,
    );
    candidate.plan = this.makePlan(candidate, result.solution);
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
    const distance = this.candidateDistance(score, context.target, context.failureRateBand);
    if (score.repetition < 100 && distance < context.bestDistance) {
      context.best = candidate;
      context.bestDistance = distance;
    }
    return {
      candidate,
      accepted: this.accept(
        candidate,
        score,
        context.target,
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
      if (useDispersal && trayLength >= capacity - 2) {
        // 分散模式下槽位吃紧（≥4 张）时优先"完成 > 配对"，分散目标让位：
        // 否则"挑新元素"的策略会把槽位堆满互不相同的单张，序列模拟进入死局，
        // 只能退化到兜底序列，产出的关卡会因脆弱状态过多被 forgiveness 门槛拒绝。
        // 贴满压力档反过来：3/5 时优先"凑对"把槽位顶到 4/5 再消——
        // 最优路径也要长期骑在满槽边缘，这是超萌挑战残酷度的核心。
        if (fullPressure && trayLength < capacity - 1 && pairing.length > 0) {
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
  ): LevelScore {
    const metrics = result.pathMetrics;
    const maxLayer = Math.max(...level.tiles.map(tile => tile.layer));
    const risk = this.estimatePlayerRisk(level);
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
    const forgiveness = this.clamp(Math.round(
      100 - risk.estimatedFailureRate * 1.1 - risk.wrongChoiceRisk * 0.15
        - Math.min(wrongChoiceRate, 1) * 15,
    ), 0, 100);
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
      estimatedFailureRate: risk.estimatedFailureRate,
      wrongChoiceRisk: risk.wrongChoiceRisk,
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

  private static failureRateBand(level: number, rescue: boolean) {
    if (rescue) return { min: 5, max: 15 };
    if (level <= 1) return { min: 0, max: 8 };
    if (level <= 8) return { min: 15, max: 25 };
    if (level <= 22) return { min: 25, max: 40 };
    return { min: 30, max: 45 };
  }

  private candidateDistance(
    score: LevelScore,
    target: number,
    failureRateBand: { min: number; max: number },
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
    return difficultyDistance + riskDistance * 0.8;
  }

  /**
   * Estimates failure pressure with a bounded, deterministic player model.
   * The model prefers an immediate match or a pair, but occasionally picks a
   * near-best visible card to represent an ordinary player's mistake.
   */
  private estimatePlayerRisk(level: LevelDefinition) {
    const trialCount = 6;
    // This is the chance of a meaningful misclick at one decision point, not
    // every card tap. Small values keep the estimate close to normal play.
    const mistakeChance = level.level <= 8 ? 0.004 : 0.008;
    const blockers = level.tiles.map((tile, index) => level.tiles
      .map((other, otherIndex) => ({ other, otherIndex }))
      .filter(({ other, otherIndex }) => otherIndex !== index
        && other.layer > tile.layer
        && LevelRules.overlaps(tile, other))
      .map(({ otherIndex }) => otherIndex));
    const availableTiles = (active: boolean[]) => level.tiles.filter((_, index) =>
      active[index] && !blockers[index].some(blockerIndex => active[blockerIndex]));
    const tileIndexById = new Map(level.tiles.map((tile, index) => [tile.id, index]));
    const move = (active: boolean[], counts: number[], tile: TileDefinition) => {
      const index = tileIndexById.get(tile.id);
      if (index === undefined || !active[index]) return null;
      const nextActive = active.slice();
      nextActive[index] = false;
      const nextCounts = counts.slice();
      nextCounts[tile.kind] += 1;
      let cleared = 0;
      let trayLength = nextCounts.reduce((sum, count) => sum + count, 0);
      for (let kind = 0; kind < nextCounts.length; kind += 1) {
        while (nextCounts[kind] >= 3) {
          nextCounts[kind] -= 3;
          trayLength -= 3;
          cleared += 1;
        }
      }
      return { active: nextActive, counts: nextCounts, trayLength, cleared };
    };
    let failures = 0;
    let wrongChoices = 0;
    let decisions = 0;

    for (let trial = 0; trial < trialCount; trial += 1) {
      const random = new SeededRandom(level.seed ^ Math.imul(trial + 1, 0x45d9f3b));
      let active = level.tiles.map(() => true);
      let counts = Array.from({ length: level.kindCount }, () => 0);
      let won = false;

      for (let step = 0; step < level.tiles.length + 1; step += 1) {
        const available = availableTiles(active);
        if (available.length === 0) break;
        const choices = available.map(tile => {
          const nextMove = move(active, counts, tile)!;
          const afterAvailable = nextMove
            ? availableTiles(nextMove.active).length
            : 0;
          const pairBonus = counts[tile.kind] === 1 ? 80 : 0;
          const clearBonus = nextMove?.cleared ? 1000 : 0;
          const trayPenalty = nextMove ? nextMove.trayLength * 6 : 1000;
          return {
            tile,
            move: nextMove,
            score: clearBonus + pairBonus + afterAvailable * 2 - trayPenalty,
          };
        });
        const bestScore = Math.max(...choices.map(choice => choice.score));
        const idealChoice = level.plan.solution
          .map(tileId => choices.find(choice => choice.tile.id === tileId))
          .find(choice => !!choice);
        const nearBest = choices.filter(choice => choice.score >= bestScore - 120);
        const mistakePool = nearBest.filter(choice => choice !== idealChoice);
        const useMistake = mistakePool.length > 0
          && available.length > 1
          && random.next() < mistakeChance;
        const choice = useMistake
          ? random.pick(mistakePool)
          : idealChoice || random.pick(choices.filter(item => item.score === bestScore));
        if (choice !== idealChoice) wrongChoices += 1;
        if (available.length > 1) decisions += 1;
        if (!choice.move) break;

        active = choice.move.active;
        counts = choice.move.counts;
        if (!active.some(Boolean)) {
          won = true;
          break;
        }
        if (choice.move.trayLength >= level.slotCapacity) break;
      }
      if (!won) failures += 1;
    }

    return {
      estimatedFailureRate: Math.round(failures / trialCount * 100),
      wrongChoiceRisk: decisions > 0 ? Math.round(wrongChoices / decisions * 100) : 0,
    };
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

  // 高压节奏：relief 窗口从 52% 压到 24%，三消完成集中在少数释放点，
  // 其余大部分时间玩家要在槽位里憋着配不成对的牌。
  private denseRhythmAt(index: number, total: number): LevelRhythm {
    const progress = (index + 0.5) / Math.max(total, 1);
    if (progress < 0.06 || (progress >= 0.48 && progress < 0.60) || progress >= 0.94) {
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
      // 难关必须短：牌量压到普通关一半左右，靠"同类更少、等待更长"换难度
      const spikeCandidate = Math.round((normal * 0.55 + (random ? random.int(-1, 1) * 3 : 0)) / 3) * 3;
      return Math.max(minimum, Math.min(60, spikeCandidate));
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
