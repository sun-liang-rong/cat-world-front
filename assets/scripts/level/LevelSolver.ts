import {
  LevelDefinition,
  SolverOptions,
  SolverPathMetrics,
  SolverResult,
  TileDefinition,
  TileGeometry,
} from './LevelTypes';

interface SearchResult {
  solvable: boolean;
  path: number[];
  winningChoices: number;
}

interface MoveResult {
  active: boolean[];
  counts: number[];
  trayLength: number;
  cleared: number;
}

/** Pure rules shared by the generator, solver, QA tools and the game adapter. */
export class LevelRules {
  // The card texture has large rounded transparent corners. Using the full
  // UITransform rectangle reports a cover when only those invisible corners
  // touch on screen.
  private static readonly coverCornerRadius = 18;
  // One design pixel becomes roughly half a screen pixel on the target view.
  // Ignore that anti-aliased edge contact so a card is not dimmed when its
  // visible body is clear of the card above it.
  private static readonly coverEdgeTolerance = 4;
  static readonly coverRatioTolerance = 0.03;

  static availableTiles(level: Pick<LevelDefinition, 'tiles'>, active: boolean[]) {
    const available: TileDefinition[] = [];
    level.tiles.forEach((tile, index) => {
      if (!active[index]) return;
      const covered = level.tiles.some((other, otherIndex) => {
        if (!active[otherIndex] || other.layer <= tile.layer) return false;
        return LevelRules.overlaps(tile, other);
      });
      if (!covered) available.push(tile);
    });
    return available;
  }

  static overlaps(a: TileDefinition, b: TileDefinition) {
    return LevelRules.overlapsGeometry(a, b);
  }

  /** Returns the axis-aligned card area covered by b over a. */
  static overlapRatio(a: TileGeometry, b: TileGeometry) {
    const overlapWidth = Math.max(0, Math.min(
      a.x + a.width / 2,
      b.x + b.width / 2,
    ) - Math.max(
      a.x - a.width / 2,
      b.x - b.width / 2,
    ));
    const overlapHeight = Math.max(0, Math.min(
      a.y + a.height / 2,
      b.y + b.height / 2,
    ) - Math.max(
      a.y - a.height / 2,
      b.y - b.height / 2,
    ));
    return overlapWidth * overlapHeight / (a.width * a.height);
  }

  static isAllowedCoverRatio(ratio: number) {
    return ratio > 0 && (
      Math.abs(ratio - 0.25) <= LevelRules.coverRatioTolerance
      || Math.abs(ratio - 0.5) <= LevelRules.coverRatioTolerance
      // 羊了个羊式全叠：上层牌与父层牌完全同位，100% 盖住下面的牌，
      // 收走上层牌后才露出底牌。
      || Math.abs(ratio - 1) <= LevelRules.coverRatioTolerance
    );
  }

  static hasAllowedCoverRatio(a: TileGeometry, b: TileGeometry) {
    return LevelRules.overlapsGeometry(a, b)
      && LevelRules.isAllowedCoverRatio(LevelRules.overlapRatio(a, b));
  }

  static overlapsGeometry(a: TileGeometry, b: TileGeometry) {
    const aGeometry = LevelRules.coverGeometry(a);
    const bGeometry = LevelRules.coverGeometry(b);
    const aRotation = aGeometry.rotation || 0;
    const bRotation = bGeometry.rotation || 0;
    if (aRotation === 0 && bRotation === 0) {
      const overlapWidth = (aGeometry.width + bGeometry.width) / 2
        - Math.abs(aGeometry.x - bGeometry.x);
      const overlapHeight = (aGeometry.height + bGeometry.height) / 2
        - Math.abs(aGeometry.y - bGeometry.y);
      if (overlapWidth <= LevelRules.coverEdgeTolerance
        || overlapHeight <= LevelRules.coverEdgeTolerance) return false;

      const aRadius = Math.min(LevelRules.coverCornerRadius, aGeometry.width / 2, aGeometry.height / 2);
      const bRadius = Math.min(LevelRules.coverCornerRadius, bGeometry.width / 2, bGeometry.height / 2);
      if (overlapWidth >= Math.min(aRadius, bRadius) || overlapHeight >= Math.min(aRadius, bRadius)) {
        return true;
      }
    }

    const aCorners = LevelRules.roundedRectangleCorners(aGeometry);
    const bCorners = LevelRules.roundedRectangleCorners(bGeometry);
    const axes = [
      ...LevelRules.polygonAxes(aCorners),
      ...LevelRules.polygonAxes(bCorners),
    ];
    return !axes.some(axis => {
      const aProjection = LevelRules.project(aCorners, axis);
      const bProjection = LevelRules.project(bCorners, axis);
      return aProjection.max <= bProjection.min || bProjection.max <= aProjection.min;
    });
  }

  private static coverGeometry(rectangle: TileGeometry): TileGeometry {
    return {
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
      rotation: rectangle.rotation,
    };
  }

  private static roundedRectangleCorners(rectangle: TileGeometry) {
    const halfWidth = rectangle.width / 2;
    const halfHeight = rectangle.height / 2;
    const radius = Math.min(LevelRules.coverCornerRadius, halfWidth, halfHeight);
    const radians = (rectangle.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const cornerCenters = [
      [halfWidth - radius, halfHeight - radius, 0],
      [-halfWidth + radius, halfHeight - radius, 90],
      [-halfWidth + radius, -halfHeight + radius, 180],
      [halfWidth - radius, -halfHeight + radius, 270],
    ];
    const corners: number[][] = [];
    cornerCenters.forEach(([centerX, centerY, startAngle]) => {
      for (let step = 0; step <= 3; step += 1) {
        const angle = (startAngle + step * 30) * Math.PI / 180;
        const localX = centerX + radius * Math.cos(angle);
        const localY = centerY + radius * Math.sin(angle);
        corners.push([
          rectangle.x + localX * cos - localY * sin,
          rectangle.y + localX * sin + localY * cos,
        ]);
      }
    });
    return corners;
  }

  private static polygonAxes(corners: number[][]) {
    return corners.map((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      const edgeX = next[0] - corner[0];
      const edgeY = next[1] - corner[1];
      const length = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
      return [-edgeY / length, edgeX / length];
    });
  }

  private static project(corners: number[][], axis: number[]) {
    const values = corners.map(corner => corner[0] * axis[0] + corner[1] * axis[1]);
    return { min: Math.min(...values), max: Math.max(...values) };
  }

  static move(
    level: Pick<LevelDefinition, 'tiles' | 'slotCapacity'>,
    active: boolean[],
    counts: number[],
    tileId: number,
  ): MoveResult | null {
    const index = level.tiles.findIndex(tile => tile.id === tileId);
    if (index < 0 || !active[index]) return null;
    const available = LevelRules.availableTiles(level, active);
    if (!available.some(tile => tile.id === tileId)) return null;

    const nextActive = active.slice();
    nextActive[index] = false;
    const nextCounts = counts.slice();
    nextCounts[level.tiles[index].kind] += 1;
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
  }

  static stateKey(active: boolean[], counts: number[]) {
    return `${active.map(value => value ? '1' : '0').join('')}|${counts.join(',')}`;
  }
}

/**
 * A bounded exhaustive state search. A positive result always contains a
 * concrete winning path. A negative result is definitive only when proven is
 * true; a generation candidate is rejected if the search is truncated.
 */
export class LevelSolver {
  private level!: Pick<LevelDefinition, 'tiles' | 'slotCapacity' | 'kindCount'>;
  private maxStates = 250000;
  private analyzeBranches = true;
  private exploredStates = 0;
  private deadEndStates = 0;
  private truncated = false;
  private memo = new Map<string, SearchResult>();
  private preferredSolution: number[] = [];

  solve(level: LevelDefinition, options: SolverOptions = {}): SolverResult {
    this.level = level;
    this.maxStates = options.maxStates || 250000;
    this.analyzeBranches = options.analyzeBranches !== false;
    this.exploredStates = 0;
    this.deadEndStates = 0;
    this.truncated = false;
    this.memo.clear();
    this.preferredSolution = options.preferredSolution || [];

    const active = level.tiles.map(() => true);
    const counts = Array.from({ length: Math.max(level.kindCount, 1) }, () => 0);
    const root = this.search(active, counts);
    const solution = root.path;
    return {
      solvable: root.solvable,
      proven: root.solvable || (!this.truncated && !root.solvable),
      solution,
      exploredStates: this.exploredStates,
      deadEndStates: this.deadEndStates,
      truncated: this.truncated,
      pathMetrics: root.solvable ? this.measurePath(solution) : this.emptyMetrics(),
    };
  }

  private search(active: boolean[], counts: number[]): SearchResult {
    const key = LevelRules.stateKey(active, counts);
    const cached = this.memo.get(key);
    if (cached) return cached;
    if (this.exploredStates >= this.maxStates) {
      this.truncated = true;
      return { solvable: false, path: [], winningChoices: 0 };
    }
    this.exploredStates += 1;

    if (!active.some(Boolean)) {
      const result = { solvable: true, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    const trayLength = counts.reduce((sum, count) => sum + count, 0);
    if (trayLength >= this.level.slotCapacity) {
      this.deadEndStates += 1;
      const result = { solvable: false, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    const available = LevelRules.availableTiles(this.level, active);
    if (available.length === 0) {
      this.deadEndStates += 1;
      const result = { solvable: false, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    // Complete an almost-full group first. This makes the search fast without
    // changing the set of legal paths.
    const depth = this.level.tiles.length - active.filter(Boolean).length;
    const preferredId = this.preferredSolution[depth];
    available.sort((a, b) => {
      const aPreferred = a.id === preferredId ? 0 : 1;
      const bPreferred = b.id === preferredId ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      const aPair = counts[a.kind] === 2 ? 0 : 1;
      const bPair = counts[b.kind] === 2 ? 0 : 1;
      return aPair - bPair || a.layer - b.layer || a.id - b.id;
    });

    let firstWinningPath: number[] = [];
    let winningChoices = 0;
    for (const tile of available) {
      const move = LevelRules.move(this.level, active, counts, tile.id);
      if (!move) continue;
      const child = this.search(move.active, move.counts);
      if (!child.solvable) continue;
      winningChoices += 1;
      if (firstWinningPath.length === 0) firstWinningPath = [tile.id, ...child.path];
      if (!this.analyzeBranches) break;
    }

    if (winningChoices === 0) this.deadEndStates += 1;
    const result = {
      solvable: winningChoices > 0,
      path: firstWinningPath,
      winningChoices,
    };
    this.memo.set(key, result);
    return result;
  }

  private measurePath(solution: number[]): SolverPathMetrics {
    const active = this.level.tiles.map(() => true);
    const counts = Array.from({ length: Math.max(this.level.kindCount, 1) }, () => 0);
    const metrics = this.emptyMetrics();
    let comboLength = 0;
    let previousBeat: 'pressure' | 'relief' | null = null;

    for (const tileId of solution) {
      const available = LevelRules.availableTiles(this.level, active);
      if (available.length > 1) {
        metrics.decisionPoints += 1;
        metrics.decisionCount += available.length - 1;
      } else if (available.length === 1) {
        metrics.forcedMoves += 1;
      }

      const matchingMoves = available.filter(tile => {
        const preview = LevelRules.move(this.level, active, counts, tile.id);
        return !!preview && preview.cleared > 0;
      }).length;
      metrics.comboOpportunities += matchingMoves;
      const immediateFailures = available.filter(tile => {
        const preview = LevelRules.move(this.level, active, counts, tile.id);
        return !!preview
          && preview.active.some(Boolean)
          && preview.trayLength >= this.level.slotCapacity;
      }).length;
      metrics.failureRisk += available.length > 0 ? immediateFailures / available.length : 0;

      const stateResult = this.search(active, counts);
      // Without branch analysis, only count choices that fail immediately.
      // Unvisited alternatives are unknown, not automatically bad choices.
      metrics.wrongChoiceCount += this.analyzeBranches
        ? Math.max(0, available.length - stateResult.winningChoices)
        : immediateFailures;
      const trayBefore = counts.reduce((sum, count) => sum + count, 0);
      const move = LevelRules.move(this.level, active, counts, tileId);
      if (!move) break;

      // A pressure moment is a nearly full tray with no immediate match.
      // A relief moment is the release of that pressure through a three-match.
      // Neutral moves do not break the rhythm between beats.
      const pressure = trayBefore >= this.level.slotCapacity - 2
        && matchingMoves <= 1
        && move.cleared === 0;
      const relief = move.cleared > 0;
      if (pressure) metrics.pressureMoments += 1;
      if (relief) metrics.reliefMoments += 1;
      const beat = pressure ? 'pressure' : relief ? 'relief' : null;
      if (beat && previousBeat && beat !== previousBeat) metrics.rhythmTransitions += 1;
      if (beat) previousBeat = beat;

      for (let index = 0; index < active.length; index += 1) active[index] = move.active[index];
      for (let index = 0; index < counts.length; index += 1) counts[index] = move.counts[index];
      metrics.maxTrayOccupancy = Math.max(metrics.maxTrayOccupancy, move.trayLength);
      if (move.cleared > 0) {
        comboLength += 1;
        metrics.maxCombo = Math.max(metrics.maxCombo, comboLength);
        if (trayBefore >= this.level.slotCapacity - 2) metrics.comebackOpportunities += 1;
      } else {
        comboLength = 0;
      }
    }
    metrics.failureRisk = solution.length > 0
      ? Math.round((metrics.failureRisk / solution.length) * 100)
      : 0;
    return metrics;
  }

  private emptyMetrics(): SolverPathMetrics {
    return {
      decisionCount: 0,
      decisionPoints: 0,
      forcedMoves: 0,
      maxTrayOccupancy: 0,
      failureRisk: 0,
      comboOpportunities: 0,
      maxCombo: 0,
      comebackOpportunities: 0,
      wrongChoiceCount: 0,
      pressureMoments: 0,
      reliefMoments: 0,
      rhythmTransitions: 0,
    };
  }
}
