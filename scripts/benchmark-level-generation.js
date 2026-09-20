// Compile assets/scripts/level/LevelSystem.ts with the bundled Cocos TypeScript,
// then pass the emitted directory. Diagnostics stay outside the game runtime.
const path = require('path');
const { performance } = require('perf_hooks');
const compiled = path.resolve(process.argv[2]);
const { LevelGenerator } = require(path.join(compiled, 'LevelGenerator.js'));
const { LevelSolver } = require(path.join(compiled, 'LevelSolver.js'));

const cases = [
  { name: 'onboarding', level: 2 },
  { name: 'normal', level: 23 },
  { name: 'late', level: 80 },
  { name: 'breather', level: 10, role: 'breather' },
  { name: 'spike', level: 29, role: 'spike' },
  { name: 'collect', level: 11 },
  { name: 'rescue', level: 24, rescue: true },
  { name: 'challenge', level: 100, role: 'spike', fullTrayPressure: true, slotCapacity: 5 },
];

async function sample(test, index) {
  const generator = new LevelGenerator();
  const riskCounts = new Map();
  let riskCalls = 0;
  let attempts = 0;
  let maxAttemptMs = 0;
  const evaluate = generator.evaluateAttempt.bind(generator);
  generator.evaluateAttempt = (...args) => {
    const start = performance.now();
    const result = evaluate(...args);
    maxAttemptMs = Math.max(maxAttemptMs, performance.now() - start);
    attempts += 1;
    return result;
  };
  const estimate = generator.estimatePlayerRisk.bind(generator);
  generator.estimatePlayerRisk = (level, ...rest) => {
    riskCalls += 1;
    riskCounts.set(level, (riskCounts.get(level) || 0) + 1);
    return estimate(level, ...rest);
  };
  const base = LevelGenerator.baseDifficulty(test.level);
  const targetDifficulty = test.fullTrayPressure ? 100
    : test.rescue ? base - 14
      : test.role === 'breather' ? base - 14
        : test.role === 'spike' ? base + 9 : base;
  const seed = 900001 + test.level * 10007 + index * 7919;
  const start = performance.now();
  const level = await generator.generateAsync({ ...test, seed, targetDifficulty });
  const ms = performance.now() - start;
  // A generation witness must still clear the entire board, even for collect goals.
  const verification = new LevelSolver().solve({ ...level, goal: undefined }, {
    analyzeBranches: false,
    preferredSolution: level.plan.solution,
  });
  if (!verification.solvable || verification.solution.length !== level.tiles.length) {
    throw new Error(`[CatWorld] Invalid witness: ${test.name}/${seed}`);
  }
  return {
    name: test.name, seed, ms: round(ms), maxAttemptMs: round(maxAttemptMs),
    attempts, riskCalls, uniqueRiskBoards: riskCounts.size,
    repeatedRiskCalls: riskCalls - riskCounts.size,
    fingerprint: level.fingerprint, goal: level.goal || null,
    tiles: level.tiles.length, score: level.score,
  };
}

function round(value) { return Math.round(value * 100) / 100; }
function summarize(rows) {
  const times = rows.map(row => row.ms).sort((a, b) => a - b);
  return {
    samples: rows.length,
    averageMs: round(times.reduce((sum, value) => sum + value, 0) / times.length),
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    maxMs: times[times.length - 1],
    riskCalls: rows.reduce((sum, row) => sum + row.riskCalls, 0),
    repeatedRiskCalls: rows.reduce((sum, row) => sum + row.repeatedRiskCalls, 0),
    maxAttemptMs: Math.max(...rows.map(row => row.maxAttemptMs)),
  };
}

async function main() {
  new LevelGenerator().generate({ level: 1, seed: 1 });
  const rows = [];
  for (const test of cases) {
    for (let index = 0; index < 4; index += 1) rows.push(await sample(test, index));
  }
  process.stdout.write(`${JSON.stringify({
    runtime: process.version,
    summary: summarize(rows),
    byCase: cases.map(test => ({ name: test.name, ...summarize(rows.filter(row => row.name === test.name)) })),
    rows,
  }, null, 2)}\n`);
}

main().catch(error => { console.error('[CatWorld] Benchmark failed', error); process.exitCode = 1; });
