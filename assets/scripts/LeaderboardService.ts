import { ApiClient, RankBoardType, RankEntry, SubmitRankPayload } from './ApiClient';

export type LeaderboardSource = 'server' | 'empty';
export type LeaderboardTab = 'level' | 'endless' | 'challenge';

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
  shareAppMessage?: (options: { title: string }) => void;
}

export class LeaderboardService {
  constructor(private readonly api = new ApiClient()) {}

  ensureProfile(userId: string, name: string) {
    if (userId && name) return Promise.resolve({ userId, name });
    return this.api.generateProfile().then(profile => ({
      userId: profile.user_id,
      name: profile.name,
    }));
  }

  fetchBoard(tab: LeaderboardTab, userId: string, date?: string): Promise<LeaderboardData> {
    if (!userId) {
      return Promise.resolve({ source: 'empty', tab, entries: [] });
    }
    return this.api.listRank(this.tabType(tab), userId, date).then(entries => ({
      source: 'server' as const,
      tab,
      entries: this.mapEntries(tab, entries, userId),
    }));
  }

  submitLevel(userId: string, levelCount: number, starCount: number) {
    return this.submit({
      user_id: userId,
      type: 1,
      level_count: Math.max(0, Math.floor(levelCount)),
      star_count: Math.max(0, Math.floor(starCount)),
    });
  }

  submitEndless(userId: string, clearCount: number, durationMs: number) {
    return this.submit({
      user_id: userId,
      type: 2,
      clear_count: Math.max(0, Math.floor(clearCount)),
      duration_ms: Math.max(1, Math.floor(durationMs)),
    });
  }

  submitChallenge(userId: string, durationMs: number, date: string) {
    return this.submit({
      user_id: userId,
      type: 3,
      date,
      duration_ms: Math.max(1, Math.floor(durationMs)),
    });
  }

  invite(): boolean {
    const wxApi = this.getWechatApi();
    if (!wxApi?.shareAppMessage) return false;
    wxApi.shareAppMessage({ title: INVITE_TITLE });
    return true;
  }

  private submit(payload: SubmitRankPayload) {
    return this.api.submitRank(payload).catch(error => {
      console.error('[CatWorld] Failed to submit rank', error);
    });
  }

  private mapEntries(tab: LeaderboardTab, entries: RankEntry[], selfId: string): LeaderboardEntry[] {
    return entries.map((entry, index) => {
      const isSelf = entry.user_id === selfId;
      return {
        id: entry.user_id,
        name: isSelf ? `${entry.name}（我）` : entry.name,
        avatarPath: isSelf ? 'rank/cat_crown' : AVATAR_PATHS[index % AVATAR_PATHS.length],
        rank: entry.rank || index + 1,
        score: this.scoreValue(tab, entry),
        scoreLabel: this.scoreLabel(tab, entry),
        level: entry.level_count,
        durationMs: entry.duration_ms,
        isSelf,
      };
    });
  }

  private scoreValue(tab: LeaderboardTab, entry: RankEntry) {
    if (tab === 'level') return entry.star_count;
    if (tab === 'endless') return entry.clear_count;
    return entry.duration_ms;
  }

  private scoreLabel(tab: LeaderboardTab, entry: RankEntry) {
    if (tab === 'level') return `${entry.star_count}`;
    if (tab === 'endless') return `${entry.clear_count}`;
    return this.formatDuration(entry.duration_ms);
  }

  private formatDuration(durationMs: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
  }

  private tabType(tab: LeaderboardTab): RankBoardType {
    if (tab === 'level') return 1;
    if (tab === 'endless') return 2;
    return 3;
  }

  private getWechatApi() {
    const runtime = typeof globalThis === 'undefined'
      ? null
      : globalThis as typeof globalThis & { wx?: WechatApi };
    return runtime?.wx || null;
  }
}
