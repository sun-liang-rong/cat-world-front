import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelDefinition } from '../assets/scripts/level/LevelTypes';

// 全叠（羊了个羊式 100% 覆盖）分布探针：统计全叠牌占比、叠柱深度分布，
// 以及平均难度/牌量，用于与改动前的基线对比。
// 运行方式与 validate-level-system.ts 相同（README「批量验收命令」）。

const generator = new LevelGenerator();
const totals = {
  levels: 0,
  tiles: 0,
  fullStackTiles: 0,
  columnsDepth2: 0,
  columnsDepth3: 0,
  columnsDepth4: 0,
  maxDepth: 0,
  levelsWithDepth3: 0,
  difficulty: 0,
};

for (let index = 0; index < 120; index += 1) {
  const levelNumber = (index % 120) + 1;
  const level = generator.generate({
    level: levelNumber,
    seed: 1000003 + index * 7919,
    maxAttempts: 40,
    solverAnalyzeBranches: false,
  });
  totals.levels += 1;
  totals.tiles += level.tiles.length;
  totals.difficulty += level.score.difficulty;

  // 叠柱：同一 (x,y) 上跨连续层的同位牌链，链长 ≥2 即存在全叠
  const columns = new Map<string, number[]>();
  level.tiles.forEach(tile => {
    const key = `${tile.x},${tile.y}`;
    const layers = columns.get(key) || [];
    layers.push(tile.layer);
    columns.set(key, layers);
  });
  let levelHasDepth3 = false;
  columns.forEach(layers => {
    layers.sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i <= layers.length; i += 1) {
      if (i < layers.length && layers[i] === layers[i - 1] + 1) {
        run += 1;
        continue;
      }
      if (run >= 2) {
        totals.columnsDepth2 += 1;
        if (run >= 3) {
          totals.columnsDepth3 += 1;
          levelHasDepth3 = true;
        }
        if (run >= 4) totals.columnsDepth4 += 1;
        totals.maxDepth = Math.max(totals.maxDepth, run);
        totals.fullStackTiles += run - 1;
      }
      run = 1;
    }
  });
  if (levelHasDepth3) totals.levelsWithDepth3 += 1;
}

const round = (value: number) => Math.round(value * 100) / 100;
console.log(JSON.stringify({
  levels: totals.levels,
  averageTiles: round(totals.tiles / totals.levels),
  averageDifficulty: round(totals.difficulty / totals.levels),
  fullStackTileShare: round(totals.fullStackTiles / totals.tiles * 100),
  columnsDepth2: totals.columnsDepth2,
  columnsDepth3: totals.columnsDepth3,
  columnsDepth4: totals.columnsDepth4,
  maxStackDepth: totals.maxDepth,
  levelsWithDepth3Share: round(totals.levelsWithDepth3 / totals.levels * 100),
}, null, 2));
