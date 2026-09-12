import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelRules, LevelSolver } from '../assets/scripts/level/LevelSolver';
import { DifficultyController } from '../assets/scripts/level/DifficultyController';
import { LevelDefinition, PlayerRun } from '../assets/scripts/level/LevelTypes';

const generator = new LevelGenerator();
const solver = new LevelSolver();
const levels: LevelDefinition[] = [];
const recentFingerprints: string[] = [];
const recentArchetypes: LevelDefinition['archetype'][] = [];
const metricTotals = {
  difficulty: 0,
  tiles: 0,
  layers: 0,
  decisions: 0,
  failureRisk: 0,
  combo: 0,
  comeback: 0,
};

assert(LevelGenerator.baseDifficulty(1) === 22, 'Level 1 difficulty changed unexpectedly');
assert(LevelGenerator.baseDifficulty(2) === 42.3, 'Level 2 difficulty must start at 42.3');
assert(LevelGenerator.baseDifficulty(2) < LevelGenerator.baseDifficulty(3), 'Difficulty must increase after level 2');
assert(!LevelRules.overlapsGeometry(
  { x: 0, y: 0, width: 104, height: 107 },
  { x: 99, y: 99, width: 104, height: 107 },
), 'Transparent rounded corners must not count as cover');
assert(!LevelRules.overlapsGeometry(
  { x: 0, y: 0, width: 104, height: 107 },
  { x: 52, y: 106, width: 104, height: 107 },
), 'Invisible one-pixel edge contact must not count as cover');
assert(LevelRules.overlapsGeometry(
  { x: 0, y: 0, width: 104, height: 107 },
  { x: 80, y: 0, width: 104, height: 107 },
), 'Visible card overlap must count as cover');

for (let index = 0; index < 1000; index += 1) {
  const levelNumber = (index % 120) + 1;
  const level = generator.generate({
    level: levelNumber,
    seed: 1000003 + index * 7919,
    recentFingerprints,
    recentArchetypes,
    maxAttempts: 40,
    solverAnalyzeBranches: false,
  });
  // 复验带上见证路径提示（与 rescue 段一致）：真正的可解性证明是下面的
  // isWinningPath（逐步重放见证路径）。无提示的无界 DFS 在后期巨型关上会
  // 被状态上限截断，与玩法正确性无关。
  const verification = solver.solve(level, { maxStates: 250000, analyzeBranches: false, preferredSolution: level.plan.solution });
  assert(verification.solvable, `Seed ${level.seed} is not solvable`);
  assert(!verification.truncated, `Seed ${level.seed} verification was truncated`);
  assert(verification.solution.length === level.tiles.length, `Seed ${level.seed} has an incomplete solution`);
  assert(isWinningPath(level, level.plan.solution), `Seed ${level.seed} has an invalid generation witness`);
  assert(level.tiles.length % 3 === 0, `Seed ${level.seed} has a non-triplet tile count`);
  assert(isSymmetricLayout(level), `Seed ${level.seed} is not horizontally symmetric`);
  assert(!hasSameLayerOverlap(level), `Seed ${level.seed} has overlapping cards on one layer`);
  assert(hasOnlyAllowedParentCoverage(level), `Seed ${level.seed} has an invalid parent cover ratio`);
  const expectedKindCount = expectedKinds(levelNumber);
  const expectedLayerCount = levelNumber <= 1 ? 2 : Math.min(9, 5 + Math.floor((levelNumber - 2) / 4));
  assert(level.kindCount === expectedKindCount, `Seed ${level.seed} has ${level.kindCount} kinds, expected ${expectedKindCount}`);
  assert(new Set(level.tiles.map(tile => tile.kind)).size === expectedKindCount, `Seed ${level.seed} does not use all configured kinds`);
  assert(Math.max(...level.tiles.map(tile => tile.layer)) + 1 === expectedLayerCount, `Seed ${level.seed} has an invalid layer count`);
  if (levelNumber > 1) {
    assert(level.tiles.length >= 45, `Seed ${level.seed} has too few cards for a normal level`);
    assert(level.tiles.length <= 90, `Seed ${level.seed} exceeds the 90-card limit`);
  }
  const counts = new Map<number, number>();
  level.tiles.forEach(tile => counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1));
  counts.forEach((count, kind) => assert(count % 3 === 0, `Seed ${level.seed} kind ${kind} is not a multiple of 3`));
  assert(new Set(level.tiles.map(tile => `${tile.layer}:${tile.x}:${tile.y}:${tile.kind}`)).size > 1, `Seed ${level.seed} is degenerate`);
  if (levelNumber > 1) {
    const band = LevelGenerator.failureRateBand(levelNumber);
    assert(
      level.score.estimatedFailureRate >= band.min
        && level.score.estimatedFailureRate <= band.max,
      `Seed ${level.seed} estimated failure rate ${level.score.estimatedFailureRate} is outside ${band.min}-${band.max}`,
    );
    if (LevelGenerator.needsFailFeelGates(level.score, 'normal', band)) {
      assert(
        level.score.failureProgressAvg >= LevelGenerator.minFailureProgress,
        `Seed ${level.seed} failureProgressAvg ${level.score.failureProgressAvg} below ${LevelGenerator.minFailureProgress}`,
      );
      assert(
        level.score.trappedPairRate >= LevelGenerator.minTrappedPairRate,
        `Seed ${level.seed} trappedPairRate ${level.score.trappedPairRate} below ${LevelGenerator.minTrappedPairRate}`,
      );
      assert(
        level.score.reviveRescueRate >= LevelGenerator.minReviveRescueRate,
        `Seed ${level.seed} reviveRescueRate ${level.score.reviveRescueRate} below ${LevelGenerator.minReviveRescueRate}`,
      );
    }
  }

  levels.push(level);
  recentFingerprints.push(level.fingerprint);
  recentArchetypes.push(level.archetype);
  while (recentFingerprints.length > 10) recentFingerprints.shift();
  while (recentArchetypes.length > 10) recentArchetypes.shift();
  metricTotals.difficulty += level.score.difficulty;
  metricTotals.tiles += level.tiles.length;
  metricTotals.layers += Math.max(...level.tiles.map(tile => tile.layer)) + 1;
  metricTotals.decisions += level.score.decisionCount;
  metricTotals.failureRisk += level.score.failureRisk;
  metricTotals.combo += level.score.comboOpportunities;
  metricTotals.comeback += level.score.comebackOpportunities;
}

const uniqueFingerprints = new Set(levels.map(level => level.fingerprint)).size;
assert(uniqueFingerprints === levels.length, `Expected 1000 unique levels, got ${uniqueFingerprints}`);

const impossible = {
  version: 1 as const,
  level: 1,
  seed: 0,
  archetype: 'normal' as const,
  slotCapacity: 6,
  kindCount: 4,
  tiles: [0, 1, 2, 3, 4, 5, 6].map(id => ({
    id,
    kind: Math.floor(id / 2),
    x: id * 150,
    y: 0,
    layer: 0,
    width: 104,
    height: 107,
  })),
  plan: { solution: [], plannedKinds: [], plannedComboCount: 0 },
  score: {} as LevelDefinition['score'],
  fingerprint: 'impossible',
};
const impossibleResult = solver.solve(impossible, { maxStates: 1000, analyzeBranches: true });
assert(!impossibleResult.solvable && impossibleResult.proven, 'Solver failed to prove a small impossible level');

let rescueWins = 0;
for (let index = 0; index < 30; index += 1) {
  const rescueLevel = generator.generate({
    level: 51,
    seed: 9000001 + index * 104729,
    targetDifficulty: 47,
    rescue: true,
    maxAttempts: 40,
    solverAnalyzeBranches: false,
  });
  const rescueVerification = solver.solve(rescueLevel, { analyzeBranches: false, preferredSolution: rescueLevel.plan.solution });
  assert(isSymmetricLayout(rescueLevel), `Rescue seed ${rescueLevel.seed} is not horizontally symmetric`);
  if (rescueVerification.solvable && isWinningPath(rescueLevel, rescueLevel.plan.solution)) rescueWins += 1;
}
assert(rescueWins === 30, `Only ${rescueWins}/30 rescue levels were solvable`);

const difficulty = new DifficultyController();
const failedRun: PlayerRun = {
  won: false, level: 30, remainingSlots: 0, mistakes: 4, elapsedMs: 50000, decisionCount: 3, nearFailureCount: 0,
  collectedElements: 0, matchCount: 0,
};
for (let index = 0; index < 4; index += 1) {
  difficulty.record(failedRun);
  difficulty.planNext(60);
}
const rescue = difficulty.planNext(60);
assert(rescue.rescue, 'Four consecutive failures did not trigger a rescue level');
difficulty.record({ ...failedRun, won: true, remainingSlots: 1 });
const recoveryOne = difficulty.planNext(60);
assert(recoveryOne.targetDifficulty < 60, 'Rescue success did not start gradual recovery');
difficulty.record({ ...failedRun, won: true, remainingSlots: 2 });
const recoveryTwo = difficulty.planNext(60);
assert(recoveryTwo.targetDifficulty < 60, 'Recovery jumped too quickly');
difficulty.record({ ...failedRun, won: true, remainingSlots: 3 });
assert(difficulty.planNext(60).targetDifficulty === 60, 'Recovery did not return to the baseline smoothly');

// —— 关卡角色节拍表：调度正确性 ——
// 空历史时 mastery 偏低会主动取消 spike（新手保护），先回填 3 局干净胜利再测节拍。
const scheduler = new DifficultyController();
for (let index = 0; index < 3; index += 1) {
  scheduler.record({
    won: true,
    level: index + 1,
    remainingSlots: 2,
    mistakes: 0,
    elapsedMs: 20000,
    decisionCount: 8,
    nearFailureCount: 0,
    collectedElements: 60,
    matchCount: 12,
  });
}
for (let level = 1; level <= 40; level += 1) {
  const position = ((level - 1) % 20) + 1;
  const role = scheduler.planNext(LevelGenerator.baseDifficulty(level), level).role;
  if (position % 5 === 0) {
    assert(role === 'breather', `Level position ${position} must schedule a breather, got ${role}`);
  } else if (position === 9 || position === 14 || position === 19) {
    assert(role === 'spike', `Level position ${position} must schedule a spike, got ${role}`);
  } else {
    assert(role === 'normal', `Level position ${position} must schedule a normal level, got ${role}`);
  }
}

const struggle = new DifficultyController();
struggle.record(failedRun);
struggle.record(failedRun);
assert(struggle.planNext(LevelGenerator.baseDifficulty(14), 14).role === 'normal',
  'Scheduled spike must downgrade to normal after consecutive failures');

// 连败 1 次不再取消难关（保留变现高峰），但必须附免费复活兜底；
// 无连败时难关照常触发且不送免费复活（广告复活不白送）。
const spikeFreeRevive = new DifficultyController();
for (let index = 0; index < 3; index += 1) {
  spikeFreeRevive.record({
    won: true,
    level: index + 1,
    remainingSlots: 2,
    mistakes: 0,
    elapsedMs: 20000,
    decisionCount: 8,
    nearFailureCount: 0,
    collectedElements: 60,
    matchCount: 12,
  });
}
spikeFreeRevive.record(failedRun);
const freeRevivePlan = spikeFreeRevive.planNext(LevelGenerator.baseDifficulty(9), 9);
assert(freeRevivePlan.role === 'spike', 'Single loss must not cancel a scheduled spike anymore');
assert(freeRevivePlan.freeRevive === true, 'Spike during a loss streak must grant a free revive');
const noStreakPlanner = new DifficultyController();
for (let index = 0; index < 3; index += 1) {
  noStreakPlanner.record({
    won: true,
    level: index + 1,
    remainingSlots: 2,
    mistakes: 0,
    elapsedMs: 20000,
    decisionCount: 8,
    nearFailureCount: 0,
    collectedElements: 60,
    matchCount: 12,
  });
}
const noStreakPlan = noStreakPlanner.planNext(LevelGenerator.baseDifficulty(19), 19);
assert(noStreakPlan.role === 'spike' && !noStreakPlan.freeRevive,
  'Spike without a loss streak must keep the ad revive');

const emptyHistory = new DifficultyController();
assert(emptyHistory.planNext(LevelGenerator.baseDifficulty(9), 9).role === 'normal',
  'Empty history must still cancel early spikes by mastery');
assert(emptyHistory.planNext(LevelGenerator.baseDifficulty(29), 29).role === 'spike',
  'Monetization-tier spikes must keep without a sample');

const revivedWinPlanner = new DifficultyController();
revivedWinPlanner.record({
  won: true,
  level: 24,
  remainingSlots: 1,
  mistakes: 0,
  elapsedMs: 20000,
  decisionCount: 8,
  nearFailureCount: 0,
  collectedElements: 60,
  matchCount: 12,
  revived: true,
});
assert(revivedWinPlanner.snapshot().winStreak === 0, 'Ad revive wins must not count as a win streak');

const rescueScheduler = new DifficultyController();
for (let index = 0; index < 4; index += 1) {
  rescueScheduler.record(failedRun);
  rescueScheduler.planNext(LevelGenerator.baseDifficulty(15), 15);
}
const forcedRescue = rescueScheduler.planNext(LevelGenerator.baseDifficulty(16), 16);
assert(forcedRescue.rescue && forcedRescue.role === 'normal', 'Rescue must override the role schedule');

// —— breather 爽关分布：更大更松、必有三消链、难度在容差带内 ——
const breatherPlanner = new DifficultyController();
const breatherPlan = breatherPlanner.planNext(LevelGenerator.baseDifficulty(10), 10);
assert(breatherPlan.role === 'breather', 'Level 10 must plan a breather');
let breatherComboTotal = 0;
let breatherTileTotal = 0;
for (let index = 0; index < 10; index += 1) {
  const breather = generator.generate({
    level: 10,
    seed: 31000001 + index * 7919,
    targetDifficulty: breatherPlan.targetDifficulty,
    role: 'breather',
    maxAttempts: 60,
    solverAnalyzeBranches: false,
  });
  assert(breather.score.maxCombo >= 2, `Breather seed ${breather.seed} has no combo chain (maxCombo ${breather.score.maxCombo})`);
  assert(breather.score.satisfaction >= 45, `Breather seed ${breather.seed} satisfaction ${breather.score.satisfaction} below the fun floor`);
  assert(breather.score.difficulty >= breatherPlan.targetDifficulty - 6, `Breather seed ${breather.seed} difficulty below tolerance band`);
  assert(
    breather.kindCount === expectedKinds(10) - 2,
    `Breather seed ${breather.seed} must use two fewer kinds, got ${breather.kindCount}`,
  );
  assert(isWinningPath(breather, breather.plan.solution), `Breather seed ${breather.seed} witness is invalid`);
  breatherComboTotal += breather.score.maxCombo;
  breatherTileTotal += breather.tiles.length;
}

// —— spike 难关分布：短棋盘、压力原型、难度在容差带内，且明显短于普通关 ——
// 与节拍表相同：空历史 mastery 会取消 spike，先回填 3 局干净胜利。
const spikePlanner = new DifficultyController();
for (let index = 0; index < 3; index += 1) {
  spikePlanner.record({
    won: true,
    level: index + 1,
    remainingSlots: 2,
    mistakes: 0,
    elapsedMs: 20000,
    decisionCount: 8,
    nearFailureCount: 0,
    collectedElements: 60,
    matchCount: 12,
  });
}
const spikePlan = spikePlanner.planNext(LevelGenerator.baseDifficulty(14), 14);
assert(spikePlan.role === 'spike', 'Level 14 must plan a spike');
let spikeTileTotal = 0;
let normalTileTotal = 0;
for (let index = 0; index < 10; index += 1) {
  const spike = generator.generate({
    level: 14,
    seed: 41000001 + index * 7919,
    targetDifficulty: spikePlan.targetDifficulty,
    role: 'spike',
    maxAttempts: 60,
    solverAnalyzeBranches: false,
  });
  assert(spike.tiles.length <= 60, `Spike seed ${spike.seed} exceeds the short-level cap`);
  assert(spike.tiles.length % 3 === 0 && spike.tiles.length >= 36, `Spike seed ${spike.seed} tile count out of range`);
  assert(['stacked', 'hidden', 'order'].indexOf(spike.archetype) >= 0, `Spike seed ${spike.seed} archetype ${spike.archetype} is not a pressure archetype`);
  // Spike 牌量只有普通关一半左右，共享结构分按规模加权；生成侧验收目标已密度校正（-12），
  // 容差带再放宽 ±6，因此下限是 target-18。
  assert(
    spike.score.difficulty >= spikePlan.targetDifficulty - 18,
    `Spike seed ${spike.seed} difficulty below density-adjusted band`,
  );
  assert(isWinningPath(spike, spike.plan.solution), `Spike seed ${spike.seed} witness is invalid`);
  if (LevelGenerator.needsFailFeelGates(spike.score, 'spike', LevelGenerator.failureRateBand(14))) {
    assert(
      spike.score.reviveRescueRate >= LevelGenerator.minReviveRescueRate,
      `Spike seed ${spike.seed} reviveRescueRate ${spike.score.reviveRescueRate} below ${LevelGenerator.minReviveRescueRate}`,
    );
  }
  spikeTileTotal += spike.tiles.length;

  const normal = generator.generate({
    level: 14,
    seed: 42000001 + index * 7919,
    maxAttempts: 40,
    solverAnalyzeBranches: false,
  });
  normalTileTotal += normal.tiles.length;
}
assert(spikeTileTotal / 10 < normalTileTotal / 10 * 0.75,
  `Spikes (${round(spikeTileTotal / 10)} tiles) must be clearly shorter than normal levels (${round(normalTileTotal / 10)} tiles)`);

const averages = {
  averageDifficulty: round(metricTotals.difficulty / levels.length),
  averageTileCount: round(metricTotals.tiles / levels.length),
  averageLayerCount: round(metricTotals.layers / levels.length),
  averageDecisionCount: round(metricTotals.decisions / levels.length),
  averageFailureRisk: round(metricTotals.failureRisk / levels.length),
  averageComboOpportunity: round(metricTotals.combo / levels.length),
  averageComebackOpportunity: round(metricTotals.comeback / levels.length),
  rescueSuccessRate: round(rescueWins / 30 * 100),
};
console.log(JSON.stringify({
  generated: levels.length,
  unique: uniqueFingerprints,
  solvable: true,
  symmetric: levels.every(isSymmetricLayout),
  rescueRecovery: true,
  roleSchedule: true,
  averages,
  breather: {
    averageTiles: round(breatherTileTotal / 10),
    averageMaxCombo: round(breatherComboTotal / 10),
    targetDifficulty: breatherPlan.targetDifficulty,
  },
  spike: {
    averageTiles: round(spikeTileTotal / 10),
    normalAverageTiles: round(normalTileTotal / 10),
    targetDifficulty: spikePlan.targetDifficulty,
  },
  archetypes: countBy(levels.map(level => level.archetype)),
}, null, 2));

function countBy(values: string[]) {
  const result: Record<string, number> = {};
  values.forEach(value => { result[value] = (result[value] || 0) + 1; });
  return result;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function expectedKinds(level: number) {
  if (level <= 1) return 4;
  if (level <= 10) {
    if (level === 2) return 8;
    if (level <= 4) return 9;
    if (level <= 6) return 10;
    return 11;
  }
  if (level <= 20) return Math.min(13, 11 + Math.floor((level - 10) / 5));
  return Math.min(15, 13 + Math.floor((level - 20) / 5));
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`[level-system-test] ${message}`);
}

function isWinningPath(level: LevelDefinition, path: number[]) {
  let active = level.tiles.map(() => true);
  let counts = Array.from({ length: level.kindCount }, () => 0);
  for (const tileId of path) {
    const move = LevelRules.move(level, active, counts, tileId);
    if (!move) return false;
    active = move.active;
    counts = move.counts;
  }
  return path.length === level.tiles.length && !active.some(Boolean);
}

function isSymmetricLayout(level: LevelDefinition) {
  const positions = new Map<string, LevelDefinition['tiles'][number]>();
  const centers = new Map<number, number>();
  level.tiles.forEach(tile => {
    positions.set(`${tile.layer}:${tile.x}:${tile.y}`, tile);
    if (tile.x === 0) centers.set(tile.layer, (centers.get(tile.layer) || 0) + 1);
  });
  if (Array.from(centers.values()).some(count => count > 1)) return false;
  return level.tiles.every(tile => {
    if (tile.x === 0) return true;
    const mirror = positions.get(`${tile.layer}:${-tile.x}:${tile.y}`);
    return !!mirror && mirror.width === tile.width && mirror.height === tile.height;
  });
}

function hasSameLayerOverlap(level: LevelDefinition) {
  for (let firstIndex = 0; firstIndex < level.tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < level.tiles.length; secondIndex += 1) {
      const first = level.tiles[firstIndex];
      const second = level.tiles[secondIndex];
      if (first.layer === second.layer && LevelRules.overlaps(first, second)) return true;
    }
  }
  return false;
}

function hasOnlyAllowedParentCoverage(level: LevelDefinition) {
  for (const tile of level.tiles) {
    if (tile.layer === 0) continue;
    const parents = level.tiles.filter(parent => parent.layer === tile.layer - 1);
    const coveringParents = parents.filter(parent => LevelRules.overlaps(tile, parent));
    if (coveringParents.length === 0) return false;
    if (coveringParents.some(parent => !LevelRules.hasAllowedCoverRatio(tile, parent))) return false;
  }
  return true;
}
