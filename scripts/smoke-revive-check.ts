import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelSolver, TileCoverGraph } from '../assets/scripts/level/LevelSolver';

const generator = new LevelGenerator();
const solver = new LevelSolver();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[smoke-revive-check] ${message}`);
}

const scenarios: Array<{ level: number; role?: 'normal' | 'breather' | 'spike'; rescue?: boolean }> = [
  { level: 1 },
  { level: 3 },
  { level: 8 },
  { level: 15 },
  { level: 25 },
  { level: 40 },
  { level: 60 },
  { level: 80 },
  { level: 100 },
  { level: 20, role: 'breather' },
  { level: 29, role: 'spike' },
  { level: 50, role: 'spike' },
  { level: 35, rescue: true },
];

for (const scenario of scenarios) {
  const started = Date.now();
  const definition = generator.generate({
    level: scenario.level,
    seed: 20260911 + scenario.level * 131,
    role: scenario.role,
    rescue: scenario.rescue,
    recentFingerprints: [],
    recentArchetypes: [],
  });
  const elapsed = Date.now() - started;
  const verification = solver.solve(definition, {
    maxStates: 250000,
    analyzeBranches: false,
    preferredSolution: definition.plan.solution,
    coverGraph: new TileCoverGraph(definition),
  });
  const s = definition.score;
  const role = scenario.role ?? 'normal';
  console.log([
    `L${scenario.level}`,
    `role=${scenario.role ?? (scenario.rescue ? 'rescue' : 'normal')}`,
    `arch=${definition.archetype}`,
    `tiles=${definition.tiles.length}`,
    `diff=${s.difficulty}`,
    `fail=${s.estimatedFailureRate}%`,
    `failProg=${s.failureProgressAvg}%`,
    `pair=${s.trappedPairRate}%`,
    `revive=${s.reviveRescueRate}%`,
    `verify=${verification.solvable ? 'OK' : 'FAIL'}`,
    `${elapsed}ms`,
  ].join(' '));
  assert(verification.solvable, `L${scenario.level} is not solvable`);
  const band = LevelGenerator.failureRateBand(scenario.level, scenario.rescue === true);
  if (LevelGenerator.needsFailFeelGates(s, role, band, scenario.rescue === true)) {
    assert(
      s.failureProgressAvg >= LevelGenerator.minFailureProgress,
      `L${scenario.level} failureProgressAvg ${s.failureProgressAvg} < ${LevelGenerator.minFailureProgress}`,
    );
    assert(
      s.trappedPairRate >= LevelGenerator.minTrappedPairRate,
      `L${scenario.level} trappedPairRate ${s.trappedPairRate} < ${LevelGenerator.minTrappedPairRate}`,
    );
    assert(
      s.reviveRescueRate >= LevelGenerator.minReviveRescueRate,
      `L${scenario.level} reviveRescueRate ${s.reviveRescueRate} < ${LevelGenerator.minReviveRescueRate}`,
    );
  }
}
console.log('smoke done');
