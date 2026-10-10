import { sys } from 'cc';
import { HTML5, MINIGAME, PREVIEW, WECHAT } from 'cc/env';
import { ApiClient, ApiError } from './ApiClient';
import { TrackEventName, TrackProps } from './TrackEvents';
import type { RewardedAdResult } from './RewardedAdService';

// 事件名与属性类型由 analytics/track-events.json 生成（scripts/generate_track_contract.js），
// 这里统一再导出，历史调用方保持从 Analytics 导入的习惯。
export type { TrackEventName, TrackProps } from './TrackEvents';

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

/**
 * 埋点全局上下文只保留匿名身份；金币、星星、关卡、猫咪等本机存档状态
 * 不再自动附加到每条事件（数据最小化，玩法进度不上传远端）。
 * 看板需要的关卡/模式等字段由各事件在调用点显式携带（见 analytics/track-events.json）。
 */
export interface AnalyticsContext {
  userId: string;
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
  if (PREVIEW) return 'preview';
  if (WECHAT || MINIGAME || sys.platform === sys.Platform.WECHAT_GAME) return 'wechat';
  if (HTML5 || sys.isBrowser) return 'h5';
  return 'h5';
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

  constructor(api = new ApiClient(), getContext: () => AnalyticsContext = () => ({ userId: '' })) {
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
    const event: QueuedEvent = {
      event_id: makeId(),
      name,
      ts: Date.now(),
      props: this.compact(props),
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
    const dropBatch = () => {
      this.queue = this.queue.filter(event => !ids.has(event.event_id));
      this.writeQueue();
    };
    try {
      const result = await this.api.track({
        user_id: this.userId || this.getContext().userId,
        session_id: this.sessionId,
        platform: this.platform,
        app_version: ANALYTICS_APP_VERSION,
        events: batch,
      });
      // 服务端已确认处理（含拒收），这批事件从队列移除；dropped 由服务端聚合告警，
      // 开发环境额外提示一次，避免被拒收事件在本地无限重试。
      dropBatch();
      if (PREVIEW && result.dropped > 0) {
        console.error(`[CatWorld] 本批埋点有 ${result.dropped} 条被服务端拒收（未知事件或非法属性），请核对事件目录`);
      }
    } catch (error) {
      // 服务端明确拒收（4xx）= 永久失败：丢弃本批，不再重试；
      // 网络失败 / 5xx（含数据库错误）= 临时失败：保留队列等待下次 flush。
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        dropBatch();
        if (PREVIEW) {
          console.error('[CatWorld] 埋点批次被服务端拒收（4xx），已丢弃本批事件', error);
        }
      } else {
        console.error('[CatWorld] Analytics flush failed', error);
      }
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
