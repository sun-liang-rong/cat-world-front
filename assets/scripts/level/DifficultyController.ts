import {
  DifficultyPlan,
  LevelRole,
  PlayerPerformanceSnapshot,
  PlayerRun,
} from './LevelTypes';

export class DifficultyController {
  private readonly history: PlayerRun[] = [];
  private recoveryStep = 0;
  private currentRescue = false;

  constructor(private readonly historyLimit = 10) {}

  record(run: PlayerRun) {
    this.history.push({ ...run });
    while (this.history.length > this.historyLimit) this.history.shift();
    if ((this.currentRescue || this.recoveryStep > 0) && run.won) {
      this.recoveryStep = this.recoveryStep >= 3 ? 0 : this.recoveryStep + 1;
    } else if (!run.won) {
      this.recoveryStep = 0;
    }
    this.currentRescue = false;
  }

  // 用持久化的对局历史回填（字段逐个校验，坏数据直接丢弃）
  seedHistory(runs: PlayerRun[]) {
    this.history.length = 0;
    this.recoveryStep = 0;
    this.currentRescue = false;
    (Array.isArray(runs) ? runs : []).slice(-this.historyLimit).forEach(run => {
      if (!run || typeof run !== 'object') return;
      if (typeof run.won !== 'boolean' || !Number.isFinite(run.level) || run.level <= 0) return;
      this.history.push(DifficultyController.copyRun(run));
    });
  }

  planNext(baseDifficulty: number, level?: number): DifficultyPlan {
    const snapshot = this.snapshot();
    const base = this.clamp(baseDifficulty, 0, 100);
    if (this.recoveryStep > 0 && this.recoveryStep < 4) {
      const recoveryAdjustment = this.recoveryStep === 1 ? -6 : this.recoveryStep === 2 ? -3 : 0;
      this.currentRescue = false;
      return {
        targetDifficulty: this.clamp(base + recoveryAdjustment, 0, 100),
        rescue: false,
        role: 'normal',
        reason: 'recovery',
        recoveryStep: this.recoveryStep,
      };
    }

    // 优先级3：平滑难度阶梯 - 渐进式降低难度
    if (snapshot.failureStreak >= 5) {
      this.currentRescue = true;
      this.recoveryStep = 0;
      return {
        targetDifficulty: this.clamp(base - 18, 0, 100),
        rescue: true,
        role: 'normal',
        reason: 'deep_rescue',
        recoveryStep: 0,
      };
    }
    if (snapshot.failureStreak >= 4) {
      this.currentRescue = true;
      this.recoveryStep = 0;
      return {
        targetDifficulty: this.clamp(base - 14, 0, 100),
        rescue: true,
        role: 'normal',
        reason: 'player_struggling',
        recoveryStep: 0,
      };
    }

    // 关卡角色节拍表：爽关/难关按主题内位置固定出现，救援与恢复优先于节拍表。
    const scheduled = DifficultyController.scheduledRole(level);
    if (scheduled === 'breather') {
      this.currentRescue = false;
      this.recoveryStep = 0;
      return {
        targetDifficulty: this.clamp(base - 14, 12, 100),
        rescue: false,
        role: 'breather',
        reason: 'scheduled_breather',
        recoveryStep: 0,
      };
    }

    // 优先级1：智能取消难关 - 避免"雪上加霜"
    if (scheduled === 'spike') {
      const mastery = this.masteryScore(snapshot);
      // 连败 ≥2 次才取消难关：难关失败本身是复活广告转化最高的场景，
      // 连败 1 次就取消会把变现高峰一起扔掉；难关失败会送一次免费复活
      // （GameScreen 注入 freeRevive）兜底留存，所以单败不再熔断。
      if (snapshot.failureStreak >= 2) {
        this.currentRescue = false;
        this.recoveryStep = 0;
        return {
          targetDifficulty: base,
          rescue: false,
          role: 'normal',
          reason: 'spike_cancelled_failure',
          recoveryStep: 0,
        };
      }
      // 精通度 <0.5 只在变现档之前取消难关。L23+ 难关是复活广告高峰，
      // 不能因为「看起来不太熟」把变现口误杀掉；连败 ≥2 仍会取消。
      if ((level ?? 0) < 23 && mastery < 0.5) {
        this.currentRescue = false;
        this.recoveryStep = 0;
        return {
          targetDifficulty: base,
          rescue: false,
          role: 'normal',
          reason: 'spike_cancelled_mastery',
          recoveryStep: 0,
        };
      }
      // 通过检查，可以触发难关。连败中（仅 1 次）的玩家打难关附赠免费复活：
      // 难关失败是复活广告转化最高的场景，所以无连败时不白送；
      // 但连败中的人已经站在流失边缘，再被难关打死就会卸载，给一次不看广告的复活。
      this.currentRescue = false;
      this.recoveryStep = 0;
      return {
        targetDifficulty: this.clamp(base + 9, 0, 100),
        rescue: false,
        role: 'spike',
        freeRevive: snapshot.failureStreak >= 1,
        reason: 'scheduled_spike',
        recoveryStep: 0,
      };
    }

    // 优先级3：平滑难度阶梯 - 渐进式降低难度
    if (snapshot.failureStreak === 3) {
      this.currentRescue = false;
      return {
        targetDifficulty: this.clamp(base - 9, 0, 100),
        rescue: false,
        role: 'normal',
        reason: 'player_struggling',
        recoveryStep: 0,
      };
    }
    if (snapshot.failureStreak === 2) {
      this.currentRescue = false;
      return {
        targetDifficulty: this.clamp(base - 5, 0, 100),
        rescue: false,
        role: 'normal',
        reason: 'player_struggling',
        recoveryStep: 0,
      };
    }
    if (snapshot.failureStreak === 1) {
      this.currentRescue = false;
      return {
        targetDifficulty: this.clamp(base - 2, 0, 100),
        rescue: false,
        role: 'normal',
        reason: 'slight_help',
        recoveryStep: 0,
      };
    }

    if (snapshot.sampleSize < 3) {
      this.currentRescue = false;
      return { targetDifficulty: base, rescue: false, role: 'normal', reason: 'onboarding', recoveryStep: 0 };
    }

    const mastery = this.masteryScore(snapshot);
    const adjustment = mastery >= 0.72
      ? 2 + Math.round((mastery - 0.72) * 8)
      : mastery <= 0.38
        ? -2 - Math.round((0.38 - mastery) * 8)
        : 0;
    this.currentRescue = false;
    return {
      targetDifficulty: this.clamp(base + adjustment, 0, 100),
      rescue: false,
      role: 'normal',
      reason: adjustment > 0 ? 'player_mastering' : 'steady',
      recoveryStep: 0,
    };
  }

  // 主题内 20 关一个循环：第 5/10/15/20 关是爽关，第 9/14/19 关是难关。
  // 节拍由关卡号决定（内容设计），与玩家表现驱动的难度自适应解耦。
  private static scheduledRole(level?: number): LevelRole {
    if (level === undefined || !Number.isFinite(level) || level < 1) return 'normal';
    const position = ((Math.floor(level) - 1) % 20) + 1;
    if (position % 5 === 0) return 'breather';
    if (position === 9 || position === 14 || position === 19) return 'spike';
    return 'normal';
  }

  snapshot(): PlayerPerformanceSnapshot {
    const sampleSize = this.history.length;
    if (sampleSize === 0) {
      return {
        sampleSize: 0,
        winRate: 0,
        averageRemainingSlots: 0,
        averageMistakes: 0,
        averageElapsedMs: 0,
        averageDecisionCount: 0,
        averageNearFailureCount: 0,
        winStreak: 0,
        failureStreak: 0,
      };
    }
    const sum = (selector: (run: PlayerRun) => number) => this.history.reduce((total, run) => total + selector(run), 0);
    return {
      sampleSize,
      winRate: sum(run => run.won ? 1 : 0) / sampleSize,
      averageRemainingSlots: sum(run => run.remainingSlots) / sampleSize,
      averageMistakes: sum(run => run.mistakes) / sampleSize,
      averageElapsedMs: sum(run => run.elapsedMs) / sampleSize,
      averageDecisionCount: sum(run => run.decisionCount) / sampleSize,
      averageNearFailureCount: sum(run => run.nearFailureCount) / sampleSize,
      winStreak: this.streak(true),
      failureStreak: this.streak(false),
    };
  }

  toJSON() {
    return JSON.stringify({ history: this.history, recoveryStep: this.recoveryStep });
  }

  fromJSON(serialized: string) {
    try {
      const value = JSON.parse(serialized) as { history?: PlayerRun[]; recoveryStep?: number };
      this.history.length = 0;
      (value.history || []).slice(-this.historyLimit).forEach(run => this.history.push(run));
      this.recoveryStep = this.clamp(value.recoveryStep || 0, 0, 3);
      this.currentRescue = false;
    } catch (_error) {
      this.history.length = 0;
      this.recoveryStep = 0;
      this.currentRescue = false;
    }
  }

  private masteryScore(snapshot: PlayerPerformanceSnapshot) {
    const speed = snapshot.averageElapsedMs <= 0
      ? 0.5
      : this.clamp(1 - (snapshot.averageElapsedMs - 18000) / 90000, 0, 1);
    const cleanPlay = this.clamp(1 - snapshot.averageMistakes / 8, 0, 1);
    const pressureUse = this.clamp(1 - snapshot.averageRemainingSlots / 4, 0, 1);
    const streak = this.clamp(snapshot.winStreak / 5, 0, 1);
    // Winning cleanly and quickly matters more than any single result.
    return this.clamp(
      snapshot.winRate * 0.45 + cleanPlay * 0.2 + speed * 0.15 + streak * 0.1 + pressureUse * 0.1,
      0,
      1,
    );
  }

  private static copyRun(run: PlayerRun): PlayerRun {
    const copied: PlayerRun = {
      won: run.won,
      level: Math.max(1, Math.floor(run.level)),
      remainingSlots: Math.max(0, Number.isFinite(run.remainingSlots) ? run.remainingSlots : 0),
      mistakes: Math.max(0, Number.isFinite(run.mistakes) ? run.mistakes : 0),
      elapsedMs: Math.max(0, Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0),
      decisionCount: Math.max(0, Number.isFinite(run.decisionCount) ? run.decisionCount : 0),
      nearFailureCount: Math.max(0, Number.isFinite(run.nearFailureCount) ? run.nearFailureCount : 0),
      collectedElements: Math.max(0, Number.isFinite(run.collectedElements) ? run.collectedElements : 0),
      matchCount: Math.max(0, Number.isFinite(run.matchCount) ? run.matchCount : 0),
    };
    if (run.role === 'normal' || run.role === 'breather' || run.role === 'spike') copied.role = run.role;
    if (Number.isFinite(run.failProgress)) copied.failProgress = Math.max(0, Math.min(100, Math.floor(run.failProgress!)));
    if (typeof run.failHadPair === 'boolean') copied.failHadPair = run.failHadPair;
    if (run.revived === true) copied.revived = true;
    if (run.reviveFree === true) copied.reviveFree = true;
    return copied;
  }

  private streak(wins: boolean) {
    let count = 0;
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      const run = this.history[index];
      if (wins && run.revived === true) break;
      if (run.won !== wins) break;
      count += 1;
    }
    return count;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }
}
