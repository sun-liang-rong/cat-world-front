import { sys } from 'cc';
import { HTML5, MINIGAME, PREVIEW, WECHAT } from 'cc/env';
import { ApiClient } from './ApiClient';
import type { RewardedAdResult } from './RewardedAdService';

export const ANALYTICS_APP_VERSION = '1.0.0';

export type AnalyticsPageId =
  | 'home'
  | 'game'
  | 'settlement'
  | 'town'
  | 'shop'
  | 'cats'
  | 'cat_detail'
  | 'daily'
  | 'activity'
  | 'adventure'
  | 'rank'
  | 'moments';

export type AnalyticsPlatform = 'wechat' | 'h5' | 'preview';

export type GameMode = 'main' | 'challenge' | 'endless';

export type AdScene = 'revive' | 'double_coins' | 'home_coins' | 'shop_item';

export type TrackEventName =
  | 'app_launch'
  | 'loading_finish'
  | 'page_view'
  | 'level_enter_click'
  | 'level_start'
  | 'level_end'
  | 'level_next'
  | 'level_replay'
  | 'level_home'
  | 'level_go_build'
  | 'tutorial_done'
  | 'ad_entrance_show'
  | 'ad_click'
  | 'ad_result'
  | 'building_light'
  | 'shop_buy'
  | 'cat_trial_offer_show'
  | 'cat_trial_start'
  | 'cat_trial_game_start'
  | 'cat_trial_converted'
  | 'challenge_locked_click'
  | 'journey_start'
  | 'journey_open'
  | 'journey_claim'
  | 'journey_complete'
  | 'town_daily_show'
  | 'town_daily_complete'
  | 'town_daily_reward_claim';

export type TrackProps = Record<string, string | number | boolean | string[] | null>;

export interface AnalyticsContext {
  userId: string;
  level: number;
  coins: number;
  stars: number;
  expLevel: number;
  equippedCat: string | null;
}

interface QueuedEvent {
  event_id: string;
  name: TrackEventName;
  ts: number;
  props: TrackProps;
}

const QUEUE_KEY = 'cat-world-analytics-queue-v1';
const MAX_QUEUE = 200;
const MAX_BATCH = 50;
const FLUSH_DELAY_MS = 400;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cachedPlatform: AnalyticsPlatform | null = null;

export function getAnalyticsPlatform(): AnalyticsPlatform {
  if (cachedPlatform) return cachedPlatform;
  cachedPlatform = detectPlatform();
  return cachedPlatform;
}

function detectPlatform(): AnalyticsPlatform {
  // Cocos 会按构建目标把 cc/env 常量编译成字面量：
  // 微信小游戏包 WECHAT/MINIGAME=true，web-mobile 包 HTML5=true。
  // 不要只靠运行时有没有 wx，H5 里也可能被注入同类对象。
  let platform: AnalyticsPlatform = 'h5';
  if (PREVIEW) platform = 'preview';
  else if (WECHAT || MINIGAME || sys.platform === sys.Platform.WECHAT_GAME) platform = 'wechat';
  else if (HTML5 || sys.isBrowser) platform = 'h5';

  const runtime = typeof globalThis === 'undefined'
    ? null
    : globalThis as typeof globalThis & { wx?: unknown; tap?: unknown };
  console.log('[CatWorld] 渠道检测', {
    platform,
    PREVIEW,
    WECHAT,
    MINIGAME,
    HTML5,
    sysPlatform: sys.platform,
    isBrowser: sys.isBrowser,
    hasWx: !!runtime?.wx,
    hasTap: !!runtime?.tap,
  });
  return platform;
}

export class Analytics {
  private userId = '';
  private readonly sessionId = makeId();
  private readonly platform = getAnalyticsPlatform();
  private readonly api: ApiClient;
  private getContext: () => AnalyticsContext;
  private currentPage: AnalyticsPageId | '' = '';
  private queue: QueuedEvent[] = [];
  private allowFlush = false;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(api = new ApiClient(), getContext: () => AnalyticsContext = () => ({
    userId: '',
    level: 1,
    coins: 0,
    stars: 0,
    expLevel: 1,
    equippedCat: null,
  })) {
    this.api = api;
    this.getContext = getContext;
    this.queue = this.readQueue();
    this.allowFlush = true;
    if (this.queue.length > 0) this.scheduleFlush(800);
  }

  setContext(getContext: () => AnalyticsContext) {
    this.getContext = getContext;
  }

  setUserId(userId: string) {
    this.userId = userId.trim();
    this.allowFlush = true;
    this.flush();
  }

  pageView(pageId: AnalyticsPageId) {
    this.track('page_view', { page_id: pageId });
  }

  track(name: TrackEventName, props: TrackProps = {}) {
    if (name === 'page_view') {
      const pageId = typeof props.page_id === 'string' ? props.page_id : '';
      if (!pageId || this.currentPage === pageId) return;
      this.currentPage = pageId as AnalyticsPageId;
    }
    const context = this.getContext();
    const event: QueuedEvent = {
      event_id: makeId(),
      name,
      ts: Date.now(),
      props: this.compact({
        level: context.level,
        coins: context.coins,
        stars: context.stars,
        exp_level: context.expLevel,
        equipped_cat: context.equippedCat,
        ...props,
      }),
    };
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    }
    this.writeQueue();
    this.scheduleFlush();
  }

  async trackRewardedAd(scene: AdScene, watch: () => Promise<RewardedAdResult>) {
    this.track('ad_click', { scene });
    let result: RewardedAdResult;
    try {
      result = await watch();
    } catch (error) {
      this.track('ad_result', { scene, result: 'error' });
      throw error;
    }
    const status = result.completed
      ? (result.simulated ? 'simulated' : 'completed')
      : 'skipped';
    this.track('ad_result', {
      scene,
      result: status,
      simulated: result.simulated,
    });
    return result;
  }

  flush() {
    this.scheduleFlush(0);
  }

  private scheduleFlush(delay = FLUSH_DELAY_MS) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, delay);
  }

  private async flushNow() {
    if (!this.allowFlush || this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.slice(0, MAX_BATCH);
    const ids = new Set(batch.map(event => event.event_id));
    try {
      await this.api.track({
        user_id: this.userId || this.getContext().userId,
        session_id: this.sessionId,
        platform: this.platform,
        app_version: ANALYTICS_APP_VERSION,
        events: batch,
      });
      this.queue = this.queue.filter(event => !ids.has(event.event_id));
      this.writeQueue();
    } catch (error) {
      console.error('[CatWorld] Analytics flush failed', error);
    } finally {
      this.flushing = false;
      if (this.allowFlush && this.queue.length > 0) this.scheduleFlush(2000);
    }
  }

  private compact(props: TrackProps) {
    const next: TrackProps = {};
    Object.keys(props).forEach(key => {
      const value = props[key];
      if (value === undefined) return;
      next[key] = value;
    });
    return next;
  }

  private readQueue(): QueuedEvent[] {
    try {
      const raw = sys.localStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as QueuedEvent[] | null;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && typeof item.event_id === 'string' && typeof item.name === 'string');
    } catch (error) {
      console.error('[CatWorld] Failed to load analytics queue', error);
      return [];
    }
  }

  private writeQueue() {
    try {
      sys.localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('[CatWorld] Failed to save analytics queue', error);
    }
  }
}
