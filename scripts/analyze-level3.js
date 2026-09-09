/**
 * 分析第3关为什么太简单
 */

const { LevelGenerator } = require('../.codex/level-analysis/LevelGenerator.js');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 第 3 关 vs 后期关卡对比分析');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const gen = new LevelGenerator();

// 分析多个关卡
const levels = [3, 5, 10, 15, 20];

console.log('关卡 | 种类 | 牌数 | 每种平均 | 层数 | 难度 | 决策点');
console.log('-----|------|------|----------|------|------|-------');

levels.forEach(levelNum => {
  const level = gen.generate({ level: levelNum, seed: levelNum });
  const avgPerKind = (level.tiles.length / level.kindCount).toFixed(1);
  const layers = Math.max(...level.tiles.map(t => t.layer)) + 1;

  console.log(`L${levelNum.toString().padStart(2, ' ')}  |  ${level.kindCount.toString().padStart(2, ' ')}  |  ${level.tiles.length.toString().padStart(2, ' ')}  |   ${avgPerKind}    |  ${layers}   | ${level.score.difficulty.toFixed(1).padStart(4, ' ')} | ${level.score.decisionPoints.toString().padStart(2, ' ')}`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 详细分析 L3
const level3 = gen.generate({ level: 3, seed: 3 });

console.log('🔍 第 3 关详细分析：\n');
console.log('【基础参数】');
console.log(`  元素种类：${level3.kindCount} 种`);
console.log(`  总牌数：${level3.tiles.length} 张`);
console.log(`  每种元素平均：${(level3.tiles.length / level3.kindCount).toFixed(1)} 张`);
console.log(`  槽位容量：${level3.slotCapacity} 格`);
console.log(`  层数：${Math.max(...level3.tiles.map(t => t.layer)) + 1} 层\n`);

console.log('【难度指标】');
console.log(`  目标难度：${level3.score.difficulty.toFixed(1)} 分`);
console.log(`  决策点：${level3.score.decisionPoints} 次`);
console.log(`  强制移动：${level3.score.forcedMoves} 次`);
console.log(`  错误选择：${level3.score.wrongChoiceCount} 次`);
console.log(`  最大槽位占用：${level3.score.maxTrayOccupancy}/${level3.slotCapacity} 格`);
console.log(`  失败风险：${level3.score.failureRisk.toFixed(1)}\n`);

console.log('【节奏分析】');
console.log(`  压力时刻：${level3.score.pressureMoments} 次`);
console.log(`  缓解时刻：${level3.score.reliefMoments} 次`);
console.log(`  最大连击：${level3.score.maxCombo} 次\n`);

// 分析元素分布
const kindCounts = {};
level3.tiles.forEach(tile => {
  kindCounts[tile.kind] = (kindCounts[tile.kind] || 0) + 1;
});

console.log('【元素分布】');
Object.keys(kindCounts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(kind => {
  const count = kindCounts[kind];
  const groups = count / 3;
  console.log(`  种类 ${kind}：${count} 张 (${groups.toFixed(0)} 组三消)`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n💡 问题诊断：\n');

// 诊断
const avgPerKind = level3.tiles.length / level3.kindCount;
const decisionRate = level3.score.decisionPoints / level3.tiles.length;

if (avgPerKind > 8) {
  console.log(`❌ 每种元素太多 (${avgPerKind.toFixed(1)} 张/种)`);
  console.log('   → 同类元素密集，太容易凑齐三消\n');
}

if (level3.kindCount <= 6) {
  console.log(`❌ 元素种类太少 (${level3.kindCount} 种)`);
  console.log('   → 选择空间小，几乎都是"正确选择"\n');
}

if (decisionRate < 0.3) {
  console.log(`❌ 决策点太少 (${(decisionRate * 100).toFixed(0)}%)`);
  console.log('   → 大部分是强制移动，无脑点击\n');
}

if (level3.score.maxTrayOccupancy < level3.slotCapacity - 2) {
  console.log(`❌ 槽位压力不足 (最多只用 ${level3.score.maxTrayOccupancy}/${level3.slotCapacity} 格)`);
  console.log('   → 从不接近满槽，没有危机感\n');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
