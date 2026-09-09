import { DifficultyController } from './DifficultyController';
import { LevelGenerator, LevelGenerationOptions } from './LevelGenerator';
import { LevelArchetype, LevelDefinition, PlayerRun } from './LevelTypes';

export interface LevelSystemSnapshot {
  performance: ReturnType<DifficultyController['snapshot']>;
  recentLevels: Array<{ level: number; fingerprint: string; archetype: LevelArchetype }>;
}

/** Facade used later by Main/GameScreen. It has no dependency on Cocos UI. */
export class LevelSystem {
  readonly generator = new LevelGenerator();
  readonly difficulty = new DifficultyController(10);
  private readonly recentLevels: LevelDefinition[] = [];

  /**
   * 运气系数（0-1）：控制关卡生成的随机性
   * - 0.0 = 完全确定性（同一关永远相同）
   * - 0.15 = 推荐值，微扰动，既公平又有新鲜感
   * - 0.5+ = 较大随机性，拼运气
   */
  private luckFactor = 0.15;

  /**
   * 设置运气系数（外部可调）
   * @param factor 0-1 之间的数值
   */
  setLuckFactor(factor: number) {
    this.luckFactor = Math.max(0, Math.min(1, factor));
  }

  /**
   * 获取当前运气系数
   */
  getLuckFactor(): number {
    return this.luckFactor;
  }

  /**
   * 应用运气扰动到种子
   * @private
   */
  private applyLuck(baseSeed: number): number {
    if (this.luckFactor === 0) return baseSeed;
    // 使用时间戳 * 运气系数作为扰动，模 1000 保证变化范围可控
    const perturbation = Math.floor(Date.now() * this.luckFactor) % 1000;
    return baseSeed + perturbation;
  }

  nextLevel(level: number, seed: number): LevelDefinition {
    const plan = this.difficulty.planNext(LevelGenerator.baseDifficulty(level), level);

    // 应用运气扰动到种子
    const luckSeed = this.applyLuck(seed);

    const options: LevelGenerationOptions = {
      level,
      seed: luckSeed,
      targetDifficulty: plan.targetDifficulty,
      rescue: plan.rescue,
      role: plan.role,
      recentFingerprints: this.recentLevels.map(item => item.fingerprint),
      recentArchetypes: this.recentLevels.map(item => item.archetype),
    };
    const generated = this.generator.generate(options);
    this.rememberLevel(generated);
    return generated;
  }

  nextLevelAsync(level: number, seed: number): Promise<LevelDefinition> {
    const plan = this.difficulty.planNext(LevelGenerator.baseDifficulty(level), level);

    // 应用运气扰动到种子
    const luckSeed = this.applyLuck(seed);

    return this.generator.generateAsync({
      level,
      seed: luckSeed,
      targetDifficulty: plan.targetDifficulty,
      rescue: plan.rescue,
      role: plan.role,
      recentFingerprints: this.recentLevels.map(item => item.fingerprint),
      recentArchetypes: this.recentLevels.map(item => item.archetype),
    }).then(generated => {
      this.rememberLevel(generated);
      return generated;
    });
  }

  recordPerformance(run: PlayerRun) {
    this.difficulty.record(run);
  }

  // 启动时用存档里的最近对局回填难度自适应上下文
  seedRuns(runs: PlayerRun[]) {
    this.difficulty.seedHistory(runs);
  }

  retryLevel(level: LevelDefinition, seed: number) {
    const plan = this.difficulty.planNext(LevelGenerator.baseDifficulty(level.level), level.level);

    // 应用运气扰动到种子
    const luckSeed = this.applyLuck(seed);

    return this.generator.generate({
      level: level.level,
      seed: luckSeed,
      targetDifficulty: plan.targetDifficulty,
      rescue: plan.rescue,
      role: plan.role,
      recentFingerprints: this.recentLevels.map(item => item.fingerprint),
      recentArchetypes: this.recentLevels.map(item => item.archetype),
    });
  }

  retryLevelAsync(level: LevelDefinition, seed: number): Promise<LevelDefinition> {
    const plan = this.difficulty.planNext(LevelGenerator.baseDifficulty(level.level), level.level);
    const luckSeed = this.applyLuck(seed);
    return this.generator.generateAsync({
      level: level.level,
      seed: luckSeed,
      targetDifficulty: plan.targetDifficulty,
      rescue: plan.rescue,
      role: plan.role,
      recentFingerprints: this.recentLevels.map(item => item.fingerprint),
      recentArchetypes: this.recentLevels.map(item => item.archetype),
    });
  }

  snapshot(): LevelSystemSnapshot {
    return {
      performance: this.difficulty.snapshot(),
      recentLevels: this.recentLevels.map(level => ({
        level: level.level,
        fingerprint: level.fingerprint,
        archetype: level.archetype,
      })),
    };
  }

  toJSON() {
    return JSON.stringify({ difficulty: this.difficulty.toJSON(), recentLevels: this.recentLevels });
  }

  fromJSON(serialized: string) {
    try {
      const value = JSON.parse(serialized) as { difficulty?: string; recentLevels?: LevelDefinition[] };
      if (value.difficulty) this.difficulty.fromJSON(value.difficulty);
      this.recentLevels.length = 0;
      (value.recentLevels || []).slice(-10).forEach(level => this.recentLevels.push(level));
    } catch (_error) {
      this.recentLevels.length = 0;
    }
  }

  private rememberLevel(level: LevelDefinition) {
    this.recentLevels.push(level);
    while (this.recentLevels.length > 10) this.recentLevels.shift();
  }
}
