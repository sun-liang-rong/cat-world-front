import { Analytics } from './Analytics';
import { LeaderboardService } from './LeaderboardService';
import { PlayerStore } from './PlayerStore';

export interface ProfileCoordinatorOptions {
  playerStore: PlayerStore;
  leaderboard: LeaderboardService;
  analytics: Analytics;
  /** 宿主（Main）节点是否仍有效；无效时丢弃晚到的 profile 结果，不写状态。 */
  isAlive: () => boolean;
}

/**
 * 远程玩家身份（profile）协调器：
 * - 单飞控制：多个入口同时需要 profile 时共用同一条进行中的 Promise，成功只写入一次 PlayerStore；
 * - 失败只记 [CatWorld] 日志：不写假用户 ID、不把空值当已创建、不重置本地进度；
 * - 失败后清除进行中记录，仅在下一个显式入口（打开排行榜）时重试，不盲目自动重试
 *   POST /user/generate，避免网络超时后生成多个孤儿 profile；
 * - 身份创建成功后按现有排行榜字段补报可从本机存档精确恢复的最好成绩（仅主线榜）。
 */
export class ProfileCoordinator {
  private request: Promise<void> | null = null;
  /** 本次会话是否已因新建身份补报过最好成绩（避免重复上报）。 */
  private backfilled = false;

  constructor(private readonly options: ProfileCoordinatorOptions) {}

  hasProfile() {
    return this.options.playerStore.hasProfile();
  }

  /**
   * 获取可用身份；已有 profile 直接返回，进行中的请求共享同一条 Promise。
   * 失败时 Promise 以原错误 reject，由调用方决定是否向用户展示（后台调用应吞掉）。
   */
  ensure(): Promise<void> {
    if (this.options.playerStore.hasProfile()) return Promise.resolve();
    if (this.request) return this.request;

    let attempt: Promise<void>;
    attempt = this.options.leaderboard
      .ensureProfile(
        this.options.playerStore.getUserId(),
        this.options.playerStore.getUserName(),
      )
      .then(profile => {
        if (!this.options.isAlive()) return;
        // 写入后 hasProfile() 为真，后续 ensure() 直接短路，天然只写一次。
        this.options.playerStore.setProfile(profile.userId, profile.name);
        this.options.analytics.setUserId(profile.userId);
        this.backfillBestScores();
      })
      .catch(error => {
        console.error('[CatWorld] Failed to generate player profile', error);
        // 清除进行中记录：排行榜入口的下一次显式调用才会重试，后台不自动重放。
        if (this.request === attempt) this.request = null;
        throw error;
      });
    this.request = attempt;
    return attempt;
  }

  /** 主线榜补报/逐场上报：关卡进度与累计星星可从本机存档精确恢复。 */
  submitLevelBest() {
    const store = this.options.playerStore;
    if (!store.hasProfile()) return;
    this.options.leaderboard.submitLevel(
      store.getUserId(),
      Math.max(1, store.getLevel() - 1),
      store.getTotalStarsEarned(),
    );
  }

  submitEndless(clearCount: number, durationMs: number) {
    const store = this.options.playerStore;
    if (!store.hasProfile() || clearCount <= 0) return;
    this.options.leaderboard.submitEndless(store.getUserId(), clearCount, durationMs);
  }

  submitChallenge(durationMs: number) {
    const store = this.options.playerStore;
    if (!store.hasProfile() || durationMs <= 0) return;
    this.options.leaderboard.submitChallenge(store.getUserId(), durationMs, store.getDailyDateKey());
  }

  /**
   * 新身份创建后的最好成绩补报：只上传主线榜的关卡数与累计星星（现有排行榜字段、
   * 本机可精确恢复）。无尽/挑战榜缺少与最好成绩配对的用时字段，不做估算补报，
   * 不上传整个 PlayerState，也不重复发放任何奖励。
   */
  private backfillBestScores() {
    if (this.backfilled) return;
    this.backfilled = true;
    const store = this.options.playerStore;
    if (!store.hasProfile()) return;
    const levelCount = Math.max(1, store.getLevel() - 1);
    if (levelCount > 1 || store.getTotalStarsEarned() > 0) {
      this.options.leaderboard.submitLevel(store.getUserId(), levelCount, store.getTotalStarsEarned());
    }
  }
}
