/**
 * One-off timing probe for LevelGenerator hot paths.
 * Run: tsc + node as in README validate-level-system.
 */
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelDefinition } from '../assets/scripts/level/LevelTypes';

const generator = new LevelGenerator();

function timeLevels(levels: number[], seedsPerLevel: number) {
  let totalMs = 0;
  let maxMs = 0;
  let acceptish = 0;
  const samples: Array<{ level: number; ms: number; tiles: number; attemptsNote: string }> = [];

  for (const levelNumber of levels) {
    for (let s = 0; s < seedsPerLevel; s += 1) {
      const seed = 900001 + levelNumber * 10007 + s * 7919;
      const t0 = Date.now();
      const level: LevelDefinition = generator.generate({
        level: levelNumber,
        seed,
        maxAttempts: 24,
        solverAnalyzeBranches: false,
      });
      const ms = Date.now() - t0;
      totalMs += ms;
      maxMs = Math.max(maxMs, ms);
      acceptish += 1;
      samples.push({
        level: levelNumber,
        ms,
        tiles: level.tiles.length,
        attemptsNote: `diff=${level.score.difficulty} risk=${level.score.estimatedFailureRate}`,
      });
    }
  }

  samples.sort((a, b) => b.ms - a.ms);
  console.log(JSON.stringify({
    count: acceptish,
    totalMs,
    avgMs: Math.round(totalMs / Math.max(acceptish, 1)),
    maxMs,
    slowest: samples.slice(0, 12),
    byLevel: levels.map(levelNumber => {
      const rows = samples.filter(row => row.level === levelNumber);
      const avg = Math.round(rows.reduce((sum, row) => sum + row.ms, 0) / Math.max(rows.length, 1));
      return { level: levelNumber, avgMs: avg, maxMs: Math.max(...rows.map(row => row.ms)) };
    }),
  }, null, 2));
}

// Warm up module paths
generator.generate({ level: 1, seed: 1, maxAttempts: 4 });
timeLevels([5, 20, 40, 60, 80, 100], 8);
