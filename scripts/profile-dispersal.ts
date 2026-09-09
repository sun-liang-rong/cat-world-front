import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { LevelSystem } from '../assets/scripts/level/LevelSystem';

// 量化"卡牌分散度"：
// 1. tripleRuns: 见证序列里"三连同 kind"的出现次数（保底序列 [0,0,0,1,1,1...] 的签名，
//    意味着三张同种牌在同一段收集窗口里，容易同时可见）
// 2. sameKindGap: 同种元素相邻两次出现之间的平均序列距离（越大越分散）
// 3. layerSpread: 同种三张牌的层跨度均值（0 = 三张埋在同一层，越大越分散）
const system = new LevelSystem();
let tripleRuns = 0;
const levelCount = 40;
let gapSum = 0;
let gapCount = 0;
let layerSpreadSum = 0;
let layerSpreadCount = 0;
for (let level = 1; level <= levelCount; level += 1) {
  system.difficulty.planNext(LevelGenerator.baseDifficulty(level), level);
  const levelDef = system.nextLevel(level, 5000003 + level * 7919);
  const sequence = levelDef.plan.plannedKinds;
  for (let index = 0; index + 2 < sequence.length; index += 1) {
    if (sequence[index] === sequence[index + 1] && sequence[index] === sequence[index + 2]) tripleRuns += 1;
  }
  const positionsByKind = new Map<number, number[]>();
  sequence.forEach((kind, index) => {
    const list = positionsByKind.get(kind) || [];
    list.push(index);
    positionsByKind.set(kind, list);
  });
  positionsByKind.forEach(list => {
    for (let index = 1; index < list.length; index += 1) {
      gapSum += list[index] - list[index - 1];
      gapCount += 1;
    }
  });
  const layersByKind = new Map<number, number[]>();
  levelDef.tiles.forEach(tile => {
    const list = layersByKind.get(tile.kind) || [];
    list.push(tile.layer);
    layersByKind.set(tile.kind, list);
  });
  layersByKind.forEach(list => {
    if (list.length >= 3) {
      layerSpreadSum += Math.max(...list) - Math.min(...list);
      layerSpreadCount += 1;
    }
  });
}
console.log(JSON.stringify({
  avgTripleRunsPerLevel: (tripleRuns / levelCount).toFixed(2),
  avgSameKindGap: (gapSum / gapCount).toFixed(1),
  avgLayerSpread: (layerSpreadSum / layerSpreadCount).toFixed(2),
}, null, 2));
