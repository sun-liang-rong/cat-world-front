/**
 * 难度优化测试脚本
 * 验证三个核心优化是否正确工作
 */

import { DifficultyController } from '../assets/scripts/level/DifficultyController';
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';

console.log('🧪 开始测试难度优化...\n');

// ========== 测试 1：平滑难度阶梯 ==========
console.log('📊 测试 1：平滑难度阶梯');
console.log('验证连败时的难度调整是否渐进式降低\n');

const controller = new DifficultyController();
const baseDifficulty = 50;

// 模拟连败 1-5 次
for (let streak = 1; streak <= 5; streak++) {
  // 重置控制器
  const testController = new DifficultyController();

  // 模拟连败
  for (let i = 0; i < streak; i++) {
    testController.record({
      won: false,
      level: 10 + i,
      remainingSlots: 0,
      mistakes: 3,
      elapsedMs: 120000,
      decisionCount: 20,
      nearFailureCount: 5,
      collectedElements: 50,
      matchCount: 10,
    });
  }

  const plan = testController.planNext(baseDifficulty, 11 + streak);
  const adjustment = plan.targetDifficulty - baseDifficulty;

  console.log(`连败 ${streak} 次：`);
  console.log(`  难度调整：${adjustment > 0 ? '+' : ''}${adjustment} 分`);
  console.log(`  目标难度：${plan.targetDifficulty}`);
  console.log(`  原因：${plan.reason}`);
  console.log(`  是否救援：${plan.rescue ? '是' : '否'}\n`);
}

// 预期结果
console.log('✅ 预期结果：');
console.log('  连败 1 次：-2 分 (slight_help)');
console.log('  连败 2 次：-5 分');
console.log('  连败 3 次：-9 分');
console.log('  连败 4 次：-14 分 (救援)');
console.log('  连败 5 次：-18 分 (深度救援)\n');
console.log('─'.repeat(60) + '\n');

// ========== 测试 2：智能取消难关 ==========
console.log('📊 测试 2：智能取消难关');
console.log('验证难关是否在合适的时机被取消\n');

// 测试场景 1：连败 1 次遇到难关
const scenario1 = new DifficultyController();
scenario1.record({
  won: false,
  level: 8,
  remainingSlots: 0,
  mistakes: 2,
  elapsedMs: 90000,
  decisionCount: 15,
  nearFailureCount: 3,
  collectedElements: 40,
  matchCount: 8,
});

const plan1 = scenario1.planNext(50, 9); // L9 是难关位
console.log('场景 1：连败 1 次，遇到 L9（难关位）');
console.log(`  关卡角色：${plan1.role}`);
console.log(`  原因：${plan1.reason}`);
console.log(`  ${plan1.role === 'normal' ? '✅ 难关已取消' : '❌ 难关仍触发'}\n`);

// 测试场景 2：精通度低遇到难关
const scenario2 = new DifficultyController();
// 模拟精通度低（多次失败，即使通过也用时长、失误多）
for (let i = 0; i < 5; i++) {
  scenario2.record({
    won: i % 2 === 0, // 胜率 60%，但表现差
    level: 5 + i,
    remainingSlots: i % 2 === 0 ? 1 : 0,
    mistakes: 5, // 失误多
    elapsedMs: 180000, // 用时长
    decisionCount: 30,
    nearFailureCount: 8,
    collectedElements: 60,
    matchCount: 12,
  });
}

const plan2 = scenario2.planNext(50, 9); // L9 是难关位
const snapshot2 = scenario2.snapshot();
console.log('场景 2：精通度低（胜率 60% 但操作差），遇到 L9（难关位）');
console.log(`  胜率：${(snapshot2.winRate * 100).toFixed(0)}%`);
console.log(`  平均失误：${snapshot2.averageMistakes.toFixed(1)}`);
console.log(`  平均用时：${(snapshot2.averageElapsedMs / 60000).toFixed(1)} 分钟`);
console.log(`  关卡角色：${plan2.role}`);
console.log(`  原因：${plan2.reason}`);
console.log(`  ${plan2.role === 'normal' ? '✅ 难关已取消' : '❌ 难关仍触发'}\n`);

// 测试场景 3：表现良好遇到难关
const scenario3 = new DifficultyController();
for (let i = 0; i < 5; i++) {
  scenario3.record({
    won: true,
    level: 5 + i,
    remainingSlots: 4, // 剩余槽位多
    mistakes: 1, // 失误少
    elapsedMs: 60000, // 用时短
    decisionCount: 15,
    nearFailureCount: 1,
    collectedElements: 50,
    matchCount: 10,
  });
}

const plan3 = scenario3.planNext(50, 9); // L9 是难关位
console.log('场景 3：表现良好（连胜 5 次，快速通关），遇到 L9（难关位）');
console.log(`  关卡角色：${plan3.role}`);
console.log(`  目标难度：${plan3.targetDifficulty}`);
console.log(`  ${plan3.role === 'spike' ? '✅ 难关正常触发' : '❌ 难关被误取消'}\n`);

console.log('─'.repeat(60) + '\n');

// ========== 测试 3：延缓种类数增长 ==========
console.log('📊 测试 3：延缓种类数增长');
console.log('验证元素种类数的新增长曲线\n');

const testLevels = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40];
console.log('关卡 | 原种类数 | 新种类数 | 差异');
console.log('-----|----------|----------|-----');

// 原逻辑：level <= 1 ? 4 : Math.min(15, 12 + Math.floor((level - 2) / 3))
const oldKindCount = (level: number) => {
  return level <= 1 ? 4 : Math.min(15, 12 + Math.floor((level - 2) / 3));
};

testLevels.forEach(level => {
  const oldCount = oldKindCount(level);
  // 通过反射私有方法（测试环境）
  const newCount = (LevelGenerator as any).kindCount(level, 'normal');
  const diff = newCount - oldCount;
  const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
  console.log(`L${level.toString().padStart(2, ' ')}  |    ${oldCount.toString().padStart(2, ' ')}    |    ${newCount.toString().padStart(2, ' ')}    | ${diffStr.padStart(4, ' ')}`);
});

console.log('\n✅ 预期变化：');
console.log('  前期（L2-L10）：种类数显著减少，降低新手难度');
console.log('  中期（L11-L20）：种类数稳定增长，保持学习空间');
console.log('  后期（L35+）：达到 15 种上限，保持挑战性\n');

console.log('─'.repeat(60) + '\n');

// ========== 测试 4：爽关种类数 ==========
console.log('📊 测试 4：爽关元素种类');
console.log('验证爽关（breather）是否正确减少 2 种元素\n');

const breatherLevels = [5, 10, 15, 20, 25, 30];
console.log('关卡 | 普通关 | 爽关 | 差异');
console.log('-----|--------|------|-----');

breatherLevels.forEach(level => {
  const normalCount = (LevelGenerator as any).kindCount(level, 'normal');
  const breatherCount = (LevelGenerator as any).kindCount(level, 'breather');
  const diff = breatherCount - normalCount;
  console.log(`L${level.toString().padStart(2, ' ')}  |   ${normalCount.toString().padStart(2, ' ')}   |  ${breatherCount.toString().padStart(2, ' ')}  | ${diff}`);
});

console.log('\n✅ 预期：爽关应该比普通关少 2 种元素（更容易连消）\n');

console.log('─'.repeat(60) + '\n');

// ========== 总结 ==========
console.log('🎉 测试完成！\n');
console.log('请检查以上输出，确认：');
console.log('1. ✅ 连败时难度调整是渐进式的（-2, -5, -9, -14, -18）');
console.log('2. ✅ 连败或精通度低时难关被取消');
console.log('3. ✅ 表现良好时难关正常触发');
console.log('4. ✅ 前期种类数显著降低（L2-L10）');
console.log('5. ✅ 后期仍保持 15 种上限（L35+）');
console.log('6. ✅ 爽关比普通关少 2 种元素');
