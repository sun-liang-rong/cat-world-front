import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelSolver } from '../assets/scripts/level/LevelSolver';

const generator = new LevelGenerator();
const solver = new LevelSolver();
const level = 10;
const base = LevelGenerator.baseDifficulty(level);
// breather target from schedule
const target = Math.max(12, Math.round((base - 14) * 10) / 10);

let accepted = 0;
let fallback = 0;
let comboIssues = 0;
for (let index = 0; index < 10; index += 1) {
  const seed = 31000001 + index * 7919;
  const started = Date.now();
  const breather = generator.generate({
    level,
    seed,
    targetDifficulty: target,
    role: 'breather',
    maxAttempts: 60,
    solverAnalyzeBranches: false,
  });
  const elapsed = Date.now() - started;
  const verify = solver.solve(breather, {
    analyzeBranches: false,
    preferredSolution: breather.plan.solution,
  });
  const okCombo = breather.score.maxCombo >= 2;
  if (!okCombo) comboIssues += 1;
  if (breather.score.difficulty >= target - 6 && breather.score.satisfaction >= 45 && okCombo) accepted += 1;
  else fallback += 1;
  console.log({
    index,
    elapsed,
    seed: breather.seed,
    archetype: breather.archetype,
    kindCount: breather.kindCount,
    tiles: breather.tiles.length,
    maxCombo: breather.score.maxCombo,
    satisfaction: breather.score.satisfaction,
    difficulty: breather.score.difficulty,
    target,
    failRate: breather.score.estimatedFailureRate,
    forgiveness: breather.score.forgiveness,
    solvable: verify.solvable,
    witness: breather.plan.solution.length,
  });
}
console.log({ accepted, fallback, comboIssues, target });
