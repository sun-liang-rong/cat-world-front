import { LevelGenerator, SeededRandom } from '../assets/scripts/level/LevelGenerator';
import { LevelSolver } from '../assets/scripts/level/LevelSolver';

declare const process: { argv: string[] };

const generator: any = new LevelGenerator();
const solver = new LevelSolver();
const level = Number(process.argv[2] || 3);
const archetype = process.argv[3] || 'stacked';
const target = Number(process.argv[4] || 42.3);

for (let attempt = 0; attempt < 8; attempt += 1) {
  const attemptSeed = (LevelGenerator as any).mixSeed(1000003, attempt);
  const random = new SeededRandom(attemptSeed);
  let candidate;
  try {
    candidate = generator.createCandidate(level, attemptSeed, archetype, random, 'normal');
  } catch (error) {
    console.log(`attempt ${attempt}: layout fail: ${(error as Error).message}`);
    continue;
  }
  const result = solver.solve(candidate, {
    maxStates: 250000,
    analyzeBranches: false,
    preferredSolution: candidate.plan.solution,
  });
  if (!result.solvable) {
    console.log(`attempt ${attempt}: unsolvable (truncated=${result.truncated})`);
    continue;
  }
  const score = generator.scoreCandidate(candidate, result, target, [], []);
  const rhythmRequirement = candidate.tiles.length <= 24 ? 1 : 2;
  console.log(JSON.stringify({
    attempt,
    tiles: candidate.tiles.length,
    kinds: candidate.kindCount,
    difficulty: score.difficulty,
    rhythm: score.rhythm,
    pressureMoments: score.pressureMoments,
    reliefMoments: score.reliefMoments,
    transitions: score.rhythmTransitions,
    rhythmRequirement,
    forgiveness: score.forgiveness,
    satisfaction: score.satisfaction,
    failureRisk: score.failureRisk,
  }));
}
