import { getAnalyticsPlatform } from './Analytics';
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

interface WechatApi {
  setUserCloudStorage?: (options: { KVDataList: Array<{ key: string; value: string }>; fail: (error: unknown) => void }) => void;
  shareAppMessage?: (options: {
    title: string;
    query?: string;
  }) => void;
}

export class LeaderboardService {

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

  /** 兼容旧调用方：身份留在本机，不请求后端。 */
  ensureProfile(userId: string, name: string) {
    return Promise.resolve({ userId: userId || `local-${Date.now().toString(36)}`, name: name || '猫咪的朋友' });
  }

  fetchBoard(tab: LeaderboardTab, userId: string): Promise<LeaderboardData> {
    return this.fetchPreviewBoard(0);
  }

  submitLevel(userId: string, levelCount: number, stars: number) { this.reportStars(stars); }
  submitEndless(userId: string, clearCount: number, durationMs: number) {}
  submitChallenge(userId: string, durationMs: number, date: string) {}

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
