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

  /**
   * Compact memo key: pack active flags into base-36 words instead of a
   * 1-bit-per-char string. Late-game boards have ~90 tiles and the search
   * creates this key at every node.
   */
  static stateKey(active: boolean[], counts: number[]) {
    let key = '';
    for (let start = 0; start < active.length; start += 15) {
      let word = 0;
      const end = Math.min(active.length, start + 15);
      for (let index = start; index < end; index += 1) {
        if (active[index]) word |= 1 << (index - start);
      }
      key += word.toString(36);
      key += '.';
    }
    key += counts.join(',');
    return key;
  }
}

/**
 * Precomputed cover topology for a board. Used by the solver and the
 * generator's player-risk model so each step is O(edges) instead of
 * recomputing O(n²) geometric overlaps.
 */
export class TileCoverGraph {
  /** blockers[i] = indices of tiles that fully cover tile i */
  readonly blockers: number[][];
  /** dependents[i] = indices of tiles covered by tile i */
  readonly dependents: number[][];
  readonly idToIndex = new Map<number, number>();

  constructor(level: Pick<LevelDefinition, 'tiles'>) {
    const tiles = level.tiles;
    const count = tiles.length;
    this.blockers = Array.from({ length: count }, () => []);
    this.dependents = Array.from({ length: count }, () => []);
    tiles.forEach((tile, index) => this.idToIndex.set(tile.id, index));
    for (let lower = 0; lower < count; lower += 1) {
      const lowerTile = tiles[lower];
      for (let upper = 0; upper < count; upper += 1) {
        if (upper === lower) continue;
        const upperTile = tiles[upper];
        if (upperTile.layer <= lowerTile.layer) continue;
        if (!LevelRules.overlaps(lowerTile, upperTile)) continue;
        this.blockers[lower].push(upper);
        this.dependents[upper].push(lower);
      }
    }
  }
}

/**
 * Mutable board occupancy with O(1) available checks after O(n²) graph build.
 * take/untake keep blocker counts in sync for DFS backtracking.
 */
export class CoverBoardState {
  readonly active: boolean[];
  readonly blockerCount: number[];
  remaining: number;

  constructor(
    private readonly graph: TileCoverGraph,
    active?: boolean[],
  ) {
    const count = graph.blockers.length;
    this.active = active ? active.slice() : Array.from({ length: count }, () => true);
    this.blockerCount = Array.from({ length: count }, (_, index) => {
      let blockers = 0;
      const list = graph.blockers[index];
      for (let i = 0; i < list.length; i += 1) {
        if (this.active[list[i]]) blockers += 1;
      }
      return blockers;
    });
    this.remaining = 0;
    for (let index = 0; index < count; index += 1) {
      if (this.active[index]) this.remaining += 1;
    }
  }

  isAvailable(index: number) {
    return this.active[index] && this.blockerCount[index] === 0;
  }

  availableIndices() {
    const list: number[] = [];
    for (let index = 0; index < this.active.length; index += 1) {
      if (this.active[index] && this.blockerCount[index] === 0) list.push(index);
    }
    return list;
  }

  availableTiles(tiles: TileDefinition[]) {
    const list: TileDefinition[] = [];
    for (let index = 0; index < this.active.length; index += 1) {
      if (this.active[index] && this.blockerCount[index] === 0) list.push(tiles[index]);
    }
    return list;
  }

  take(index: number) {
    if (!this.active[index]) return;
    this.active[index] = false;
    this.remaining -= 1;
    const dependents = this.graph.dependents[index];
    for (let i = 0; i < dependents.length; i += 1) {
      this.blockerCount[dependents[i]] -= 1;
    }
  }

  untake(index: number) {
    if (this.active[index]) return;
    this.active[index] = true;
    this.remaining += 1;
    const dependents = this.graph.dependents[index];
    for (let i = 0; i < dependents.length; i += 1) {
      this.blockerCount[dependents[i]] += 1;
    }
  }
}

/**
 * A bounded exhaustive state search. A positive result always contains a
 * concrete winning path. A negative result is definitive only when proven is
 * true; a generation candidate is rejected if the search is truncated.
 */
export class LevelSolver {
  private level!: Pick<LevelDefinition, 'tiles' | 'slotCapacity' | 'kindCount'>;
  private graph!: TileCoverGraph;
  private maxStates = 250000;
  private analyzeBranches = true;
  private exploredStates = 0;
  private deadEndStates = 0;
  private truncated = false;
  private memo = new Map<string, SearchResult>();
  private preferredSolution: number[] = [];
  private board!: CoverBoardState;
  private counts!: number[];
  private trayLength = 0;
  private pathStack: number[] = [];

  solve(level: LevelDefinition, options: SolverOptions = {}): SolverResult {
    this.level = level;
    this.maxStates = options.maxStates || 250000;
    this.analyzeBranches = options.analyzeBranches !== false;
    this.exploredStates = 0;
    this.deadEndStates = 0;
    this.truncated = false;
    this.memo.clear();
    this.preferredSolution = options.preferredSolution || [];
    this.graph = (options.coverGraph as TileCoverGraph | undefined) instanceof TileCoverGraph
      ? (options.coverGraph as TileCoverGraph)
      : new TileCoverGraph(level);
    const initial = options.initialState;
    const hasInitialState = !!initial && initial.active.length === level.tiles.length;
    if (hasInitialState) {
      // 中间状态求解：跳过见证路径（它假设从满盘开局），直接以给定掩码和槽位起步。
      this.board = new CoverBoardState(this.graph, initial.active);
      this.counts = Array.from(
        { length: Math.max(level.kindCount, 1) },
        (_, index) => initial.counts[index] || 0,
      );
      this.trayLength = this.counts.reduce((sum, count) => sum + count, 0);
      this.pathStack = [];
    } else {
      this.board = new CoverBoardState(this.graph);
      this.counts = Array.from({ length: Math.max(level.kindCount, 1) }, () => 0);
      this.trayLength = 0;
      this.pathStack = [];

      const preferred = this.tryFollowPreferredPath();
      if (preferred) {
        return preferred;
      }

      // Reset after a failed preferred walk; start clean DFS from the root.
      this.board = new CoverBoardState(this.graph);
      this.counts = Array.from({ length: Math.max(level.kindCount, 1) }, () => 0);
      this.trayLength = 0;
      this.pathStack = [];
    }

    const root = this.search();
    const solution = root.path;
    return {
      solvable: root.solvable,
      proven: root.solvable || (!this.truncated && !root.solvable),
      solution,
      exploredStates: this.exploredStates,
      deadEndStates: this.deadEndStates,
      truncated: this.truncated,
      // measurePath 从满盘重放路径，对中间状态求解无意义，直接给空指标。
      pathMetrics: root.solvable && !hasInitialState ? this.measurePath(solution) : this.emptyMetrics(),
    };
  }

  /**
   * Generation already stores a witness removal order. Walking it first is
   * O(n) with incremental cover updates and usually accepts the candidate
   * without any DFS.
   */
  private tryFollowPreferredPath(): SolverResult | null {
    if (this.preferredSolution.length !== this.level.tiles.length) return null;
    const seen = new Set<number>();
    for (const tileId of this.preferredSolution) {
      const index = this.graph.idToIndex.get(tileId);
      if (index === undefined || seen.has(tileId)) return null;
      seen.add(tileId);
      if (!this.board.isAvailable(index)) return null;
      if (this.trayLength >= this.level.slotCapacity) return null;
      const kind = this.level.tiles[index].kind;
      this.board.take(index);
      this.counts[kind] += 1;
      this.trayLength += 1;
      while (this.counts[kind] >= 3) {
        this.counts[kind] -= 3;
        this.trayLength -= 3;
      }
      this.pathStack.push(tileId);
    }
    if (this.board.remaining !== 0) return null;
    this.exploredStates += this.level.tiles.length;
    const solution = this.pathStack.slice();
    return {
      solvable: true,
      proven: true,
      solution,
      exploredStates: this.exploredStates,
      deadEndStates: 0,
      truncated: false,
      pathMetrics: this.measurePath(solution),
    };
  }

  private search(): SearchResult {
    const key = LevelRules.stateKey(this.board.active, this.counts);
    const cached = this.memo.get(key);
    if (cached) return cached;
    if (this.exploredStates >= this.maxStates) {
      this.truncated = true;
      return { solvable: false, path: [], winningChoices: 0 };
    }
    this.exploredStates += 1;

    if (this.board.remaining === 0) {
      const result = { solvable: true, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    if (this.trayLength >= this.level.slotCapacity) {
      this.deadEndStates += 1;
      const result = { solvable: false, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    const available = this.board.availableIndices();
    if (available.length === 0) {
      this.deadEndStates += 1;
      const result = { solvable: false, path: [], winningChoices: 0 };
      this.memo.set(key, result);
      return result;
    }

    // Complete an almost-full group first. This makes the search fast without
    // changing the set of legal paths.
    const depth = this.level.tiles.length - this.board.remaining;
    const preferredId = this.preferredSolution[depth];
    const tiles = this.level.tiles;
    const counts = this.counts;
    available.sort((a, b) => {
      const aPreferred = tiles[a].id === preferredId ? 0 : 1;
      const bPreferred = tiles[b].id === preferredId ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      const aPair = counts[tiles[a].kind] === 2 ? 0 : 1;
      const bPair = counts[tiles[b].kind] === 2 ? 0 : 1;
      return aPair - bPair || tiles[a].layer - tiles[b].layer || tiles[a].id - tiles[b].id;
    });

    let firstWinningPath: number[] = [];
    let winningChoices = 0;
    for (const index of available) {
      const tileId = tiles[index].kind >= 0 ? tiles[index].id : -1;
      if (tileId < 0) continue;
      const kind = tiles[index].kind;
      if (this.trayLength >= this.level.slotCapacity) break;
      if (!this.board.isAvailable(index)) continue;

      this.board.take(index);
      this.counts[kind] += 1;
      this.trayLength += 1;
      let cleared = 0;
      while (this.counts[kind] >= 3) {
        this.counts[kind] -= 3;
        this.trayLength -= 3;
        cleared += 1;
      }
      this.pathStack.push(tileId);

      const child = this.search();

      this.pathStack.pop();
      if (cleared > 0) {
        this.counts[kind] += cleared * 3;
        this.trayLength += cleared * 3;
      }
      this.counts[kind] -= 1;
      this.trayLength -= 1;
      this.board.untake(index);

      if (!child.solvable) continue;
      winningChoices += 1;
      if (firstWinningPath.length === 0) firstWinningPath = [tileId, ...child.path];
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
    const board = new CoverBoardState(this.graph);
    const counts = Array.from({ length: Math.max(this.level.kindCount, 1) }, () => 0);
    const metrics = this.emptyMetrics();
    let comboLength = 0;
    let previousBeat: 'pressure' | 'relief' | null = null;
    let trayLength = 0;
    const tiles = this.level.tiles;
    const slotCapacity = this.level.slotCapacity;

    for (const tileId of solution) {
      const index = this.graph.idToIndex.get(tileId);
      if (index === undefined || !board.isAvailable(index)) break;
      const available = board.availableIndices();
      if (available.length > 1) {
        metrics.decisionPoints += 1;
        metrics.decisionCount += available.length - 1;
      } else if (available.length === 1) {
        metrics.forcedMoves += 1;
      }

      let matchingMoves = 0;
      let immediateFailures = 0;
      for (const candidateIndex of available) {
        const kind = tiles[candidateIndex].kind;
        const nextTrayRaw = trayLength + 1;
        let nextCounts = counts[kind] + 1;
        let cleared = 0;
        while (nextCounts >= 3) {
          nextCounts -= 3;
          cleared += 1;
        }
        const nextTray = nextTrayRaw - cleared * 3;
        if (cleared > 0) matchingMoves += 1;
        if (board.remaining > 1 && nextTray >= slotCapacity) immediateFailures += 1;
      }
      metrics.comboOpportunities += matchingMoves;
      metrics.failureRisk += available.length > 0 ? immediateFailures / available.length : 0;
      // Without branch analysis, only count choices that fail immediately.
      // Unvisited alternatives are unknown, not automatically bad choices.
      metrics.wrongChoiceCount += immediateFailures;

      const trayBefore = trayLength;
      const kind = tiles[index].kind;
      board.take(index);
      counts[kind] += 1;
      trayLength += 1;
      let cleared = 0;
      while (counts[kind] >= 3) {
        counts[kind] -= 3;
        trayLength -= 3;
        cleared += 1;
      }

      // A pressure moment is a nearly full tray with no immediate match.
      // A relief moment is the release of that pressure through a three-match.
      // Neutral moves do not break the rhythm between beats.
      const pressure = trayBefore >= slotCapacity - 2
        && matchingMoves <= 1
        && cleared === 0;
      const relief = cleared > 0;
      if (pressure) metrics.pressureMoments += 1;
      if (relief) metrics.reliefMoments += 1;
      const beat = pressure ? 'pressure' : relief ? 'relief' : null;
      if (beat && previousBeat && beat !== previousBeat) metrics.rhythmTransitions += 1;
      if (beat) previousBeat = beat;

      metrics.maxTrayOccupancy = Math.max(metrics.maxTrayOccupancy, trayLength);
      if (cleared > 0) {
        comboLength += 1;
        metrics.maxCombo = Math.max(metrics.maxCombo, comboLength);
        if (trayBefore >= slotCapacity - 2) metrics.comebackOpportunities += 1;
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
