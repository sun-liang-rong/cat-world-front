/**
 * 超萌挑战难度探针：按 Main.challengeGenerationOptions 的真实配置生成若干局，
 * 打印牌量/层数/最优路径槽位峰值/模拟失败率/困对率/复活可解率与耗时，
 * 用来手感校准"是否够难"。运行方式见 README 的 validate 编译命令模式。
 */
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';

async function main() {
  const generator = new LevelGenerator();
  const seeds = [101, 202, 303, 404, 505];
  for (const seed of seeds) {
    const startedAt = Date.now();
    const definition = await generator.generateAsync({
      level: 100,
      seed,
      targetDifficulty: 100,
      role: 'spike',
      slotCapacity: 5,
      fullTrayPressure: true,
    });
    const elapsed = Date.now() - startedAt;
    const maxLayer = Math.max(...definition.tiles.map(tile => tile.layer)) + 1;
    const score = definition.score;
    const kindCounts = new Map<number, number>();
    definition.tiles.forEach(tile => kindCounts.set(tile.kind, (kindCounts.get(tile.kind) ?? 0) + 1));
    const minPerKind = Math.min(...kindCounts.values());
    process.stdout.write(
      `seed=${seed} 牌=${definition.tiles.length} 层=${maxLayer} 种=${definition.kindCount}`
      + ` 最少/种=${minPerKind} 槽峰=${score.maxTrayOccupancy}/5`
      + ` 模拟失败率=${score.estimatedFailureRate}% 困对=${score.trappedPairRate}%`
      + ` 复活可解=${score.reviveRescueRate}% 尾段=${score.failureProgressAvg}%`
      + ` 耗时=${elapsed}ms\n`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
