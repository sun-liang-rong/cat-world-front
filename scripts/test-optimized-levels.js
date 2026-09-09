/**
 * 测试优化后的前 10 关效果
 */

const { LevelGenerator } = require('../.codex/level-test/LevelGenerator.js');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎮 优化后的关卡测试：解决"无脑点"问题');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const gen = new LevelGenerator();

console.log('关卡 | 种类 | 牌数 | 每种平均 | 层数 | 难度 | 决策点 | 评价');
console.log('-----|------|------|----------|------|------|--------|------');

const levels = [2, 3, 4, 5, 7, 10, 15, 20];

levels.forEach(levelNum => {
  const level = gen.generate({ level: levelNum, seed: levelNum });
  const avgPerKind = (level.tiles.length / level.kindCount).toFixed(1);
  const layers = Math.max(...level.tiles.map(t => t.layer)) + 1;

  // 评价策略性
  let rating = '';
  const avg = parseFloat(avgPerKind);
  if (avg < 6) rating = '⚠️ 偏难';
  else if (avg <= 8) rating = '✅ 完美';
  else if (avg <= 9.5) rating = '⚡ 适中';
  else rating = '😴 太简单';

  console.log(`L${levelNum.toString().padStart(2, ' ')}  |  ${level.kindCount.toString().padStart(2, ' ')}  |  ${level.tiles.length.toString().padStart(2, ' ')}  |   ${avgPerKind}    |  ${layers}   | ${level.score.difficulty.toFixed(1).padStart(4, ' ')} |   ${level.score.decisionPoints.toString().padStart(2, ' ')}   | ${rating}`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 详细对比 L3
console.log('🔍 第 3 关详细对比：\n');

const level3 = gen.generate({ level: 3, seed: 3 });

console.log('【优化后参数】');
console.log(`  元素种类：${level3.kindCount} 种`);
console.log(`  总牌数：${level3.tiles.length} 张`);
console.log(`  每种平均：${(level3.tiles.length / level3.kindCount).toFixed(1)} 张`);
console.log(`  槽位容量：${level3.slotCapacity} 格`);
console.log(`  层数：${Math.max(...level3.tiles.map(t => t.layer)) + 1} 层\n`);

console.log('【策略性指标】');
console.log(`  种类/槽位比：${(level3.kindCount / level3.slotCapacity).toFixed(2)} ${level3.kindCount / level3.slotCapacity >= 1.3 ? '✅' : '❌'}`);
console.log(`  每种平均：${(level3.tiles.length / level3.kindCount).toFixed(1)} 张 ${(level3.tiles.length / level3.kindCount) <= 8 ? '✅' : '❌'}`);
console.log(`  决策点：${level3.score.decisionPoints} 次`);
console.log(`  压力时刻：${level3.score.pressureMoments} 次`);
console.log(`  最大槽位占用：${level3.score.maxTrayOccupancy}/${level3.slotCapacity} 格\n`);

console.log('【元素分布】');
const kindCounts = {};
level3.tiles.forEach(tile => {
  kindCounts[tile.kind] = (kindCounts[tile.kind] || 0) + 1;
});
Object.keys(kindCounts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(kind => {
  const count = kindCounts[kind];
  const groups = count / 3;
  console.log(`  种类 ${kind}：${count} 张 (${groups.toFixed(0)} 组)`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n💡 优化效果总结：\n');

const avgPerKind = level3.tiles.length / level3.kindCount;
const ratio = level3.kindCount / level3.slotCapacity;

if (avgPerKind >= 6 && avgPerKind <= 8 && ratio >= 1.3) {
  console.log('✅ 优化成功！');
  console.log('   - 每种元素 6-8 张（策略性甜蜜点）');
  console.log('   - 种类/槽位比 ≥ 1.3（有真实选择）');
  console.log('   - 不再"无脑点"，需要思考策略\n');
} else {
  console.log('⚠️ 仍需调整：');
  if (avgPerKind > 8) {
    console.log(`   - 每种平均 ${avgPerKind.toFixed(1)} 张，仍偏多`);
  }
  if (ratio < 1.3) {
    console.log(`   - 种类/槽位比 ${ratio.toFixed(2)}，选择空间不足`);
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
