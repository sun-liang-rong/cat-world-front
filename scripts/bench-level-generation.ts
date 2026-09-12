/**
 * Micro-benchmark + smoke test for LevelGenerator performance changes.
 * Compile: see README validate-level-system command pattern.
 */
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelSolver } from '../assets/scripts/level/LevelSolver';

function seedFor(level: number) {
  return (0x4d595841 + Math.imul(level, 7919)) | 0;
}

function timeGenerate(level: number, seed: number) {
  const generator = new LevelGenerator();
  const started = Date.now();
  const definition = generator.generate({
    level,
    seed,
    targetDifficulty: LevelGenerator.baseDifficulty(level),
    recentFingerprints: [],
    recentArchetypes: [],
  });
  const elapsed = Date.now() - started;
  const solver = new LevelSolver();
  const verifyStart = Date.now();
  const verified = solver.solve(definition, {
    maxStates: 250000,
    analyzeBranches: false,
    preferredSolution: definition.plan.solution,
  });
  const verifyElapsed = Date.now() - verifyStart;
  return {
    level,
    elapsed,
    verifyElapsed,
    tiles: definition.tiles.length,
    kinds: definition.kindCount,
    layers: Math.max(...definition.tiles.map(tile => tile.layer)) + 1,
    solvable: verified.solvable,
    explored: verified.exploredStates,
    difficulty: definition.score.difficulty,
    failureRate: definition.score.estimatedFailureRate,
    archetype: definition.archetype,
  };
}

const levels = [5, 15, 30, 50, 80, 100];
console.log('level,ms,verifyMs,tiles,kinds,layers,solvable,explored,difficulty,failRate,archetype');
for (const level of levels) {
  const samples: ReturnType<typeof timeGenerate>[] = [];
  for (let i = 0; i < 3; i += 1) {
    samples.push(timeGenerate(level, seedFor(level) + i * 17));
  }
  const avg = samples.reduce((sum, item) => sum + item.elapsed, 0) / samples.length;
  const last = samples[samples.length - 1];
  console.log([
    level,
    avg.toFixed(1),
    last.verifyElapsed,
    last.tiles,
    last.kinds,
    last.layers,
    last.solvable,
    last.explored,
    last.difficulty,
    last.failureRate,
    last.archetype,
  ].join(','));
  samples.forEach(sample => {
    if (!sample.solvable) {
      console.error('UNSOLVABLE', sample);
      process.exitCode = 1;
    }
  });
}
