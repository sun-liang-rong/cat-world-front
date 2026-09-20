// Usage: node scripts/validate-level-optimization.js <compiled level module directory>
const assert = require('assert').strict;
const path = require('path');
const compiled = path.resolve(process.argv[2]);
const { DifficultyController } = require(path.join(compiled, 'DifficultyController.js'));
const { LevelGenerator } = require(path.join(compiled, 'LevelGenerator.js'));
const { LevelSystem } = require(path.join(compiled, 'LevelSystem.js'));
const { LevelRules, LevelSolver, TileCoverGraph } = require(path.join(compiled, 'LevelSolver.js'));
let checks = 0;

const run = won => ({
  won, level: 24, remainingSlots: won ? 3 : 0, mistakes: 0, elapsedMs: 25000,
  decisionCount: 20, nearFailureCount: 1, collectedElements: 60, matchCount: 20,
});

function recovery() {
  const controller = new DifficultyController();
  for (let i = 0; i < 4; i += 1) controller.record(run(false));
  assert(controller.planNext(50, 24).rescue);
  for (const adjustment of [-6, -3, 0]) {
    controller.record(run(true));
    assert.equal(controller.planNext(50, 24).targetDifficulty, 50 + adjustment);
  }
  const restored = new DifficultyController();
  restored.fromJSON(controller.toJSON());
  for (const item of [controller, restored]) {
    item.record(run(true));
    assert.equal(item.planNext(50, 29).role, 'spike', 'recovery must restore spikes');
    assert.equal(item.planNext(50, 30).role, 'breather', 'recovery must restore breathers');
  }
  checks += 1;
}

function board(kinds, goal, capacity = 6) {
  return {
    version: 1, level: 11, seed: 1, archetype: 'normal', role: 'normal', slotCapacity: capacity,
    kindCount: Math.max(...kinds) + 1,
    tiles: kinds.map((kind, id) => ({ id, kind, x: id * 150, y: 0, layer: 0, width: 100, height: 100 })),
    goal, plan: { solution: kinds.map((_, id) => id), plannedKinds: kinds, plannedComboCount: 0 },
    score: {}, fingerprint: 'fixture',
  };
}

// Independent tiny-state oracle: use geometry rules but implement victory and matching here.
function oracle(level, active = level.tiles.map(() => true), counts = Array(level.kindCount).fill(0), collected = 0) {
  const goal = level.goal?.type === 'collect_kind' ? level.goal : null;
  if (goal ? collected >= goal.count : !active.some(Boolean)) return true;
  if (counts.reduce((sum, value) => sum + value, 0) >= level.slotCapacity) return false;
  for (const tile of LevelRules.availableTiles(level, active)) {
    const nextActive = active.slice();
    nextActive[level.tiles.indexOf(tile)] = false;
    const nextCounts = counts.slice();
    nextCounts[tile.kind] += 1;
    const cleared = nextCounts[tile.kind] === 3;
    if (cleared) nextCounts[tile.kind] = 0;
    const nextCollected = collected + (cleared && tile.kind === goal?.kind ? 3 : 0);
    if (oracle(level, nextActive, nextCounts, nextCollected)) return true;
  }
  return false;
}

function goals() {
  const solver = new LevelSolver();
  const level = board([0, 0, 0, 1, 2, 3, 4, 5], { type: 'collect_kind', kind: 0, count: 3 }, 4);
  assert.equal(solver.solve(level, { preferredSolution: level.plan.solution }).solution.length, 3);
  assert.equal(solver.solve({ ...level, goal: undefined }).solvable, false);
  const impossible = { ...level, goal: { type: 'collect_kind', kind: 0, count: 6 } };
  assert.equal(solver.solve(impossible).solvable, false, 'clearing a board cannot satisfy missing target tiles');
  assert(solver.solve(impossible, { initialState: {
    active: level.tiles.map(() => true), counts: Array(level.kindCount).fill(0), collected: 3,
  } }).solvable, 'remaining goal must include previous match progress');
  assert.equal(LevelRules.progressPercent(impossible.goal, 7, 1, 3), 50);
  assert.equal(LevelGenerator.failureProgressFloor(impossible.goal), 50);
  assert.equal(LevelGenerator.failureRateBand(11, false, impossible.goal).min, 0);

  const risk = new LevelGenerator();
  assert.equal(risk.estimatePlayerRisk(level).estimatedFailureRate, 0, 'stop simulation at collected goal');
  assert.equal(risk.estimatePlayerRisk({ ...level, goal: undefined }).estimatedFailureRate, 100);

  // Revival deletes two target tiles and returns one: only 2 remain, so clearing
  // the board is possible but collecting a triple is not. Do not credit deleted tiles.
  const revive = board([0, 0, 0], { type: 'collect_kind', kind: 0, count: 3 });
  revive.tiles[2].x = revive.tiles[0].x;
  revive.tiles[2].layer = 0;
  revive.tiles[0].layer = 1;
  assert.equal(risk.canReviveRescue(revive, new TileCoverGraph(revive), [false, false, true], [0, 1], 0), false);

  // Exhaustively compare legal wins for varied small boards, including impossible
  // targets, blocked cards and partially completed goals after non-match removal.
  for (let seed = 0; seed < 72; seed += 1) {
    const kinds = Array.from({ length: 6 }, (_, i) => (seed * (i + 3) + i * i) % 3);
    const test = board(kinds, seed % 3 ? { type: 'collect_kind', kind: seed % 3, count: seed % 2 ? 3 : 6 } : undefined, 4);
    if (seed % 2) {
      test.tiles[5].x = test.tiles[0].x;
      test.tiles[5].layer = 1;
    }
    const active = test.tiles.map((_, i) => i !== seed % 7);
    const counts = Array(test.kindCount).fill(0);
    const collected = seed % 4 === 0 ? 3 : 0;
    const expected = oracle(test, active, counts, collected);
    const actual = solver.solve(test, { initialState: { active, counts, collected }, maxStates: 20000 });
    assert(actual.proven && !actual.truncated);
    assert.equal(actual.solvable, expected, `small-state goal oracle seed ${seed}`);
  }
  checks += 1;
}

function geometry(level) {
  return level.tiles.map(({ kind, ...tile }) => tile);
}
function quotas(level) {
  const counts = Array(level.kindCount).fill(0);
  level.tiles.forEach(tile => counts[tile.kind] += 1);
  return counts;
}
function verifyWitness(level) {
  const full = new LevelSolver().solve({ ...level, goal: undefined }, {
    preferredSolution: level.plan.solution, analyzeBranches: false,
  });
  assert(full.solvable && full.solution.length === level.tiles.length);
  const active = level.tiles.map(() => true);
  const counts = Array(level.kindCount).fill(0);
  for (const id of level.plan.solution) {
    const index = level.tiles.findIndex(tile => tile.id === id);
    assert(LevelRules.availableTiles(level, active).some(tile => tile.id === id));
    active[index] = false;
    const kind = level.tiles[index].kind;
    counts[kind] = (counts[kind] + 1) % 3;
    assert(!active.some(Boolean) || counts.reduce((a, b) => a + b, 0) < level.slotCapacity);
  }
}

async function retries() {
  for (const levelNumber of [1, 2, 10, 11, 29, 80, 158]) {
    const system = new LevelSystem();
    system.setLuckFactor(0);
    const original = await system.nextLevelAsync(levelNumber, 900001 + levelNumber * 10007);
    const unchanged = JSON.stringify(original);
    for (const rescue of [false, true]) {
      if (rescue) for (let i = 0; i < 4; i += 1) system.recordPerformance(run(false));
      const retried = await system.retryLevelAsync(original, 700001 + levelNumber * 10007 + (rescue ? 7919 : 0));
      assert.deepEqual(geometry(retried), geometry(original));
      assert.deepEqual(quotas(retried), quotas(original));
      assert.deepEqual(retried.goal, original.goal);
      assert.equal(retried.slotCapacity, original.slotCapacity);
      assert(retried.tiles.some((tile, i) => tile.kind !== original.tiles[i].kind));
      assert.equal(JSON.stringify(original), unchanged, 'retry must not mutate the original');
      verifyWitness(retried);
      if (rescue) assert.equal(retried.archetype, 'rescue');
    }
  }
  checks += 1;
}

async function caching() {
  for (const challenge of [false, true]) {
    const generator = new LevelGenerator();
    const calls = new Map();
    const original = generator.estimatePlayerRisk.bind(generator);
    generator.estimatePlayerRisk = (level, graph) => {
      calls.set(level, (calls.get(level) || 0) + 1);
      return original(level, graph);
    };
    const result = await generator.generateAsync(challenge
      ? { level: 100, seed: 1900701, role: 'spike', fullTrayPressure: true, slotCapacity: 5, targetDifficulty: 100 }
      : { level: 23, seed: 1130162 });
    assert([...calls.values()].every(count => count === 1), 'each immutable candidate gets one simulation');
    if (challenge) assert(calls.size <= 6, 'only challenge finalists need simulation');
    assert(calls.has(result), 'delivered candidate must have a measured score');
    verifyWitness(result);
  }
  checks += 1;
}

async function main() {
  recovery();
  goals();
  await retries();
  await caching();
  process.stdout.write(`[CatWorld] Passed ${checks} suites: recovery, goal solver/risk/revival, retry invariants, caching.\n`);
}
main().catch(error => { console.error('[CatWorld] Optimization validation failed', error); process.exitCode = 1; });
