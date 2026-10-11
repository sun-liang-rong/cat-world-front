import { sys } from 'cc';
import { Analytics } from './Analytics';
import { SubmitRankPayload } from './ApiClient';
import { LeaderboardService } from './LeaderboardService';
import { PlayerStore } from './PlayerStore';

export interface ProfileCoordinatorOptions {
  playerStore: PlayerStore;
  leaderboard: LeaderboardService;
  /** 保留旧调用兼容；排行榜身份不替换匿名统计 ID。 */
  analytics?: Analytics;
  isAlive: () => boolean;
}

type PendingScore = Omit<SubmitRankPayload, 'user_id'>;
const PENDING_KEY = 'cat-world-rank-pending-v1';

/** 排行榜匿名身份和成绩队列；玩法存档仍由 PlayerStore 在本机维护。 */
export class ProfileCoordinator {
  private request: Promise<void> | null = null;
  private syncing: Promise<void> | null = null;
  private pending: PendingScore[] = [];
  private readonly acknowledged = new Map<string, PendingScore>();

  constructor(private readonly options: ProfileCoordinatorOptions) {
    try {
      const saved: unknown = JSON.parse(sys.localStorage.getItem(PENDING_KEY) || '[]');
      if (Array.isArray(saved)) {
        for (const score of saved) {
          if (!score || typeof score !== 'object') continue;
          if (score.type === 1 && this.validNumber(score.level_count) && this.validNumber(score.star_count)) {
            this.pending.push({ type: 1, level_count: score.level_count, star_count: score.star_count });
          } else if (score.type === 2 && this.validNumber(score.clear_count) && this.validNumber(score.duration_ms, 1)) {
            this.pending.push({ type: 2, clear_count: score.clear_count, duration_ms: score.duration_ms });
          } else if (score.type === 3 && this.validNumber(score.duration_ms, 1) && typeof score.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(score.date)) {
            this.pending.push({ type: 3, date: score.date, duration_ms: score.duration_ms });
          }
        }
      }
    } catch (error) {
      console.error('[CatWorld] Failed to restore pending rank scores', error);
    }
  }

  hasProfile(): boolean {
    return this.options.playerStore.hasProfile()
      && this.options.leaderboard.isRemoteProfile(this.options.playerStore.getUserId());
  }

  ensure(): Promise<void> {
    if (this.hasProfile()) return Promise.resolve();
    if (this.request) return this.request;
    const store = this.options.playerStore;
    this.request = this.options.leaderboard.ensureProfile(store.getUserId(), store.getUserName())
      .then(profile => {
        if (this.options.isAlive()) store.setProfile(profile.userId, profile.name);
      })
      .finally(() => { this.request = null; });
    return this.request;
  }

  submitLevelBest(): Promise<void> {
    const store = this.options.playerStore;
    return this.queue({ type: 1, level_count: Math.max(0, store.getLevel() - 1), star_count: store.getTotalStarsEarned() });
  }

  /** 历史无尽记录只补报确实配对的最近一局，不给最好消除数虚构用时。 */
  syncForBoard(): Promise<void> {
    const endless = this.options.playerStore.getEndlessProgress();
    return Promise.all([
      this.submitLevelBest(),
      this.submitEndless(endless.lastEliminated, endless.lastDurationMs),
    ]).then(() => {});
  }

  submitEndless(clearCount: number, durationMs: number): Promise<void> {
    if (clearCount <= 0 || durationMs <= 0) return Promise.resolve();
    return this.queue({ type: 2, clear_count: Math.floor(clearCount), duration_ms: Math.max(1, Math.floor(durationMs)) });
  }

  submitChallenge(durationMs: number): Promise<void> {
    if (durationMs <= 0) return Promise.resolve();
    return this.queue({ type: 3, date: this.options.leaderboard.getChallengeDate(), duration_ms: Math.max(1, Math.floor(durationMs)) });
  }

  /** 失败的成绩留在本机，下一次结算或打开榜单时重试。 */
  flush(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.ensure().then(async () => {
      if (!this.hasProfile()) return;
      while (this.pending.length > 0 && this.options.isAlive()) {
        const score = this.pending[0];
        await this.options.leaderboard.submitScore(this.options.playerStore.getUserId(), score);
        this.acknowledged.set(this.scoreKey(score), score);
        // 请求期间可能已被更好的成绩替换，新的记录仍需继续发送。
        const index = this.pending.indexOf(score);
        if (index >= 0) this.pending.splice(index, 1);
        this.saveQueue();
      }
    }).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private queue(score: PendingScore): Promise<void> {
    const index = this.pending.findIndex(item => item.type === score.type && item.date === score.date);
    if (index < 0) {
      const known = this.acknowledged.get(this.scoreKey(score));
      if (known && !this.isBetter(score, known)) return this.flush();
      this.pending.push(score);
    }
    else if (this.isBetter(score, this.pending[index])) this.pending[index] = score;
    this.saveQueue();
    return this.flush();
  }

  private isBetter(next: PendingScore, current: PendingScore): boolean {
    if (next.type === 1) {
      return next.star_count! > current.star_count!
        || (next.star_count === current.star_count && next.level_count! > current.level_count!);
    }
    if (next.type === 2) {
      return next.clear_count! > current.clear_count!
        || (next.clear_count === current.clear_count && next.duration_ms! < current.duration_ms!);
    }
    return next.duration_ms! < current.duration_ms!;
  }

  private scoreKey(score: PendingScore): string {
    return `${score.type}:${score.date || ''}`;
  }

  private validNumber(value: unknown, minimum = 0): boolean {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
  }

  private saveQueue(): void {
    try { sys.localStorage.setItem(PENDING_KEY, JSON.stringify(this.pending)); }
    catch (error) { console.error('[CatWorld] Failed to persist pending rank scores', error); }
  }
}
