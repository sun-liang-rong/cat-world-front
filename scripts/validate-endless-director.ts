import { ENDLESS_BOARD_CAP, ENDLESS_REFILL_REMAINING, EndlessDirector } from '../assets/scripts/level/EndlessDirector';
import { LevelRules } from '../assets/scripts/level/LevelSolver';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[EndlessDirector] ${message}`);
}

function testStagesFollowRefills() {
  const director = new EndlessDirector(1, Date.now());
  const opening = director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
  assert(!!opening && opening.stage === 0, 'opening uses stage 0');
  assert(director.currentStage().kindCount === 8, 'after the opening wave the next pad is stage 1');

  const firstPad = director.nextWave({
    activeCount: ENDLESS_REFILL_REMAINING,
    minLayer: 0,
    maxLayer: 6,
    trayCounts: [1, 2],
  });
  assert(!!firstPad && firstPad.stage === 1, 'first refill uses stage 1');
  assert(director.currentStage().kindCount === 10, 'the next pad is stage 2');

  for (let index = 2; index <= 7; index += 1) {
    const wave = director.nextWave({
      activeCount: ENDLESS_REFILL_REMAINING,
      minLayer: -index,
      maxLayer: 2,
      trayCounts: [2],
    });
    assert(!!wave && wave.stage === index, `refill ${index} uses stage ${index}`);
  }
  const overflow = director.nextWave({
    activeCount: ENDLESS_REFILL_REMAINING,
    minLayer: -10,
    maxLayer: -4,
    trayCounts: [2],
  });
  assert(!!overflow && overflow.stage === 7, 'later refills stay on the last stage');
}

function testRefillByRemainingCount() {
  const director = new EndlessDirector(2, Date.now());
  const opening = director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
  assert(!!opening, 'opening wave exists');
  assert(opening!.tiles.length >= 84, 'opening pile should stay near 90 tiles');

  assert(
    !director.shouldRefill({
      activeCount: ENDLESS_REFILL_REMAINING + 1,
      minLayer: 0,
      maxLayer: 6,
    }),
    `${ENDLESS_REFILL_REMAINING + 1} remaining tiles do not refill`,
  );
  assert(
    director.shouldRefill({
      activeCount: ENDLESS_REFILL_REMAINING,
      minLayer: 0,
      maxLayer: 6,
    }),
    `${ENDLESS_REFILL_REMAINING} remaining tiles start a bottom pad`,
  );
}

function testBottomPadDoesNotCoverTop() {
  const director = new EndlessDirector(987654, Date.now());
  const first = director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
  assert(!!first && first.tiles.length >= 30, 'opening wave should spawn a dense pile');
  assert(first!.tiles.length % 3 === 0, 'wave size stays a multiple of three');
  const remaining = first!.tiles.slice(0, ENDLESS_REFILL_REMAINING);
  const remainingMin = Math.min(...remaining.map(tile => tile.layer));
  const remainingMax = Math.max(...remaining.map(tile => tile.layer));
  const second = director.nextWave({
    activeCount: remaining.length,
    minLayer: remainingMin,
    maxLayer: remainingMax,
    trayCounts: [1, 2],
  });
  assert(!!second && second.tiles.length >= 12, '50 remaining tiles pad from the bottom');
  const padMax = Math.max(...second!.tiles.map(tile => tile.layer));
  assert(padMax < remainingMin, 'new layers stay strictly below the current bottom');

  const combined = [...remaining, ...second!.tiles];
  const exposedBefore = new Set(
    LevelRules.availableTiles({ tiles: remaining }, remaining.map(() => true)).map(tile => tile.id),
  );
  const exposedAfter = new Set(
    LevelRules.availableTiles(
      { tiles: combined },
      combined.map(() => true),
    ).map(tile => tile.id),
  );
  exposedBefore.forEach(id => {
    assert(exposedAfter.has(id), `previously exposed tile ${id} must stay exposed after a bottom pad`);
  });
}

function testPadMatchesTray() {
  const director = new EndlessDirector(424242, Date.now());
  const first = director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
  assert(!!first, 'opening wave exists');
  const remaining = first!.tiles.slice(0, ENDLESS_REFILL_REMAINING);
  const pad = director.nextWave({
    activeCount: remaining.length,
    minLayer: Math.min(...remaining.map(tile => tile.layer)),
    maxLayer: Math.max(...remaining.map(tile => tile.layer)),
    trayCounts: [1, 2],
  });
  assert(!!pad, 'tray-aware pad exists');
  const topLayer = Math.max(...pad!.tiles.map(tile => tile.layer));
  const topKinds = new Set(pad!.tiles.filter(tile => tile.layer === topLayer).map(tile => tile.kind));
  assert(topKinds.has(0), 'top pad should include the singleton already in the tray');
  const counts = new Map<number, number>();
  pad!.tiles.forEach(tile => counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1));
  counts.forEach((count, kind) => {
    assert(count % 3 === 0, `kind ${kind} must stay a multiple of three after tray bias`);
  });
}

function testTopLayerHasNoTriple() {
  const director = new EndlessDirector(777, Date.now());
  director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
  const pad = director.nextWave({
    activeCount: ENDLESS_REFILL_REMAINING,
    minLayer: 0,
    maxLayer: 6,
    trayCounts: [1, 2],
  });
  assert(!!pad, 'pressure pad exists');
  const topLayer = Math.max(...pad!.tiles.map(tile => tile.layer));
  const topCounts = new Map<number, number>();
  pad!.tiles.filter(tile => tile.layer === topLayer).forEach(tile => {
    topCounts.set(tile.kind, (topCounts.get(tile.kind) || 0) + 1);
  });
  topCounts.forEach((count, kind) => {
    assert(count < 3, `top layer should not expose three ${kind} tiles`);
  });
}

// 上限回归：旧逻辑在剩余容量 3~11 时仍硬补 12 张，棋盘可越界到 ~131。
// 现在容量不足一波最小补牌（12）时直接暂停，任何时刻棋盘都不得超过 120。
function testRefillNeverExceedsBoardCap() {
  [11, 222, 3333].forEach(seed => {
    const director = new EndlessDirector(seed, Date.now());
    const opening = director.nextWave({ activeCount: 0, minLayer: null, maxLayer: null });
    assert(!!opening, `seed ${seed}: opening wave exists`);
    let board = opening!.tiles.length;
    let maxBoard = board;
    let rng = seed;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    for (let step = 0; step < 4000; step += 1) {
      // 交替普通补波与强制补波（复活/洗牌路径），覆盖高占用边界
      const force = step % 7 === 3;
      const wave = director.nextWave({
        activeCount: board,
        minLayer: 0,
        maxLayer: 4,
        trayCounts: [1],
        force,
      });
      if (wave) board += wave.tiles.length;
      assert(
        board <= ENDLESS_BOARD_CAP,
        `seed ${seed} step ${step}: board ${board} exceeds cap ${ENDLESS_BOARD_CAP}`,
      );
      if (board > maxBoard) maxBoard = board;
      const remove = Math.min(board, 3 + Math.floor(rand() * 33));
      board -= remove;
    }
    assert(maxBoard >= 100, `seed ${seed}: refills should keep the board busy (max ${maxBoard})`);
  });
}

testStagesFollowRefills();
testRefillByRemainingCount();
testBottomPadDoesNotCoverTop();
testPadMatchesTray();
testTopLayerHasNoTriple();
testRefillNeverExceedsBoardCap();
process.stdout.write('EndlessDirector validation passed: early pressure, tray-aware pad, no top-layer triples, board cap holds.\n');
