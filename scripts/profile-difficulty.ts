import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelSystem } from '../assets/scripts/level/LevelSystem';

// 输出 1~40 关的真实难度参数曲线，用于诊断"难度偏简单"的来源
const system = new LevelSystem();
console.log('level,role,tiles,kinds,layers,tilesPerKind,difficulty,maxTray,failureRisk,estimatedFailureRate,wrongChoiceRisk,archetype');
for (let level = 1; level <= 40; level += 1) {
  const plan = system.difficulty.planNext(LevelGenerator.baseDifficulty(level), level);
  const generated = system.nextLevel(level, 5000003 + level * 7919);
  const tilesPerKind = (generated.tiles.length / generated.kindCount).toFixed(1);
  console.log([
    level,
    plan.role,
    generated.tiles.length,
    generated.kindCount,
    Math.max(...generated.tiles.map(tile => tile.layer)) + 1,
    tilesPerKind,
    generated.score.difficulty,
    generated.score.maxTrayOccupancy,
    generated.score.failureRisk,
    generated.score.estimatedFailureRate,
    generated.score.wrongChoiceRisk,
    generated.archetype,
  ].join(','));
}
