import { getAnalyticsPlatform } from './Analytics';
import { ApiClient, RankBoardType, RankEntry, SubmitRankPayload } from './ApiClient';
import { ShareCardType } from './PlayerTypes';

export type LeaderboardSource = 'server' | 'empty' | 'mock';
export type LeaderboardTab = 'level' | 'endless' | 'challenge';

export interface ShareCard {
  type: ShareCardType;
  title: string;
  query?: string;
}

export type ShareResult = 'opened' | 'failed' | 'unsupported';

export interface LeaderboardEntry {
  id: string;
  name: string;
  avatarPath: string;
  rank: number;
  score: number;
  scoreLabel: string;
  level: number;
  durationMs: number;
  isSelf: boolean;
}

export interface LeaderboardData {
  source: LeaderboardSource;
  tab: LeaderboardTab;
  entries: LeaderboardEntry[];
  pendingSubmission?: boolean;
}

const INVITE_TITLE = '猫爪星球奇遇记：来和我一起闯关收集猫咪吧！';
const AVATAR_PATHS = [
  'rank/cat_orange',
  'rank/cat_white',
  'rank/cat_black',
  'rank/cat_ragdoll',
  'rank/cat_calico',
  'rank/cat_grey',
];
const BOARD_TYPES: Record<LeaderboardTab, RankBoardType> = { level: 1, endless: 2, challenge: 3 };

interface WechatApi {
  setUserCloudStorage?: (options: { KVDataList: Array<{ key: string; value: string }>; fail: (error: unknown) => void }) => void;
  shareAppMessage?: (options: {
    title: string;
    query?: string;
  }) => void;
}

export class LeaderboardService {
  constructor(private readonly api = new ApiClient()) {}

  isRemoteProfile(userId: string): boolean {
    return /^[A-HJ-NP-Z2-9]{8}$/.test(userId);
  }

  /** 与服务端一致，超萌挑战按上海自然日分榜。 */
  getChallengeDate(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  reportStars(stars: number) {
    if (getAnalyticsPlatform() !== 'wechat') return;
    try {
      this.getWechatApi()?.setUserCloudStorage?.({
        KVDataList: [{ key: 'cat_world_stars', value: String(Math.max(0, Math.floor(stars))) }],
        fail: error => console.error('[CatWorld] Failed to report friend stars', error),
      });
    } catch (error) { console.error('[CatWorld] Failed to report friend stars', error); }
  }

  fetchPreviewBoard(stars: number): Promise<LeaderboardData> {
    const entries: LeaderboardEntry[] = [
      ...[36, 24, 12].map((score, index) => ({
        id: `mock-${index}`, name: ['猫友小桃', '猫友阿圆', '猫友布丁'][index],
        avatarPath: AVATAR_PATHS[index], rank: 0, score, scoreLabel: String(score),
        level: 0, durationMs: 0, isSelf: false,
      })),
      { id: 'local', name: '我', avatarPath: 'rank/cat_crown', rank: 0, score: stars, scoreLabel: String(stars), level: 0, durationMs: 0, isSelf: true },
    ].sort((left, right) => right.score - left.score);
    entries.forEach((entry, index) => entry.rank = index + 1);
    return Promise.resolve({ source: 'mock', tab: 'level', entries });
  }

  async ensureProfile(userId: string, name: string) {
    if (this.isRemoteProfile(userId) && name.trim()) return { userId, name };
    const profile = await this.api.generateProfile();
    if (!this.isRemoteProfile(profile?.user_id) || !profile.name?.trim()) {
      throw new Error('排行榜昵称生成失败，请重试');
    }
    return { userId: profile.user_id, name: profile.name };
  }

  async fetchBoard(tab: LeaderboardTab, userId: string): Promise<LeaderboardData> {
    const rows = await this.api.listRank(BOARD_TYPES[tab], userId, tab === 'challenge' ? this.getChallengeDate() : undefined);
    if (!Array.isArray(rows)) throw new Error('排行榜返回数据异常，请重试');
    return {
      source: 'server',
      tab,
      entries: rows.map(row => this.toEntry(row, tab, userId)),
    };
  }

  submitScore(userId: string, score: Omit<SubmitRankPayload, 'user_id'>) {
    return this.api.submitRank({ ...score, user_id: userId });
  }

  submitLevel(userId: string, levelCount: number, stars: number) {
    this.reportStars(stars);
    return this.submitScore(userId, { type: 1, level_count: Math.max(0, Math.floor(levelCount)), star_count: Math.max(0, Math.floor(stars)) });
  }

  submitEndless(userId: string, clearCount: number, durationMs: number) {
    return this.submitScore(userId, { type: 2, clear_count: Math.max(0, Math.floor(clearCount)), duration_ms: Math.max(1, Math.floor(durationMs)) });
  }

  submitChallenge(userId: string, durationMs: number, date = this.getChallengeDate()) {
    return this.submitScore(userId, { type: 3, date, duration_ms: Math.max(1, Math.floor(durationMs)) });
  }

  private toEntry(row: RankEntry, tab: LeaderboardTab, userId: string): LeaderboardEntry {
    const isSelf = row.user_id === userId;
    const avatarIndex = Array.from(row.user_id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_PATHS.length;
    const score = tab === 'level' ? row.star_count : tab === 'endless' ? row.clear_count : row.duration_ms;
    const seconds = Math.floor(row.duration_ms / 1000);
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(Math.floor(row.duration_ms % 1000 / 10)).padStart(2, '0')}`;
    return {
      id: row.user_id,
      name: isSelf ? `${row.name}（我）` : row.name,
      avatarPath: isSelf ? 'rank/cat_crown' : AVATAR_PATHS[avatarIndex],
      rank: row.rank,
      score,
      scoreLabel: tab === 'challenge' ? duration : String(score),
      level: row.level_count,
      durationMs: row.duration_ms,
      isSelf,
    };
  }

  invite(): boolean {
    const wxApi = this.getWechatApi();
    if (!wxApi?.shareAppMessage || getAnalyticsPlatform() !== 'wechat') return false;
    try { wxApi.shareAppMessage({ title: INVITE_TITLE }); return true; }
    catch (error) { console.error('[CatWorld] Failed to invite friends', error); return false; }
  }

  canShare() {
    return getAnalyticsPlatform() === 'wechat' && !!this.getWechatApi()?.shareAppMessage;
  }

  share(card: ShareCard): Promise<ShareResult> {
    const wxApi = this.getWechatApi();
    const shareAppMessage = wxApi?.shareAppMessage;
    if (getAnalyticsPlatform() !== 'wechat' || !shareAppMessage) {
      return Promise.resolve('unsupported');
    }
    try {
      // 微信不提供分享成功/取消结果；发起分享即结束本地等待，不据此领奖。
      wxApi.shareAppMessage({ title: card.title, query: card.query });
      return Promise.resolve('opened');
    } catch (error) {
      console.error('[CatWorld] Failed to share card', error);
      return Promise.resolve('failed');
    }
  }

  private getWechatApi() {
    const runtime = typeof globalThis === 'undefined'
      ? null
      : globalThis as typeof globalThis & { wx?: WechatApi };
    return runtime?.wx || null;
  }
}
