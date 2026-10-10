import { getAnalyticsPlatform } from './Analytics';

export interface RewardedAdResult {
  completed: boolean;
  simulated: boolean;
}

export const TAP_REWARDED_AD_UNIT_ID = '1067058';

// 预览模拟完播；微信 / TapTap 分别使用各自广告 SDK 和广告位。
export const REWARDED_AD_ENABLED = true;

interface TapRewardedVideoAd {
  destroy?: () => void;
  show: () => Promise<void>;
  load: () => Promise<void>;
  onLoad: (callback: () => void) => void;
  onError: (callback: (error: unknown) => void) => void;
  onClose: (callback: (result?: { isEnded?: boolean }) => void) => void;
}

interface TapApi {
  createRewardedVideoAd: (options: { adUnitId: string }) => TapRewardedVideoAd;
}

function getTapApi(): TapApi | null {
  const runtime = typeof globalThis === 'undefined'
    ? null
    : globalThis as typeof globalThis & { tap?: TapApi; wx?: TapApi };
  const api = getAnalyticsPlatform() === 'wechat' ? runtime?.wx : runtime?.tap;
  return api?.createRewardedVideoAd ? api : null;
}

export class RewardedAdService {
  private rewardedAd: TapRewardedVideoAd | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private pending: ((result: RewardedAdResult) => void) | null = null;

  constructor(private readonly adUnitId = TAP_REWARDED_AD_UNIT_ID) {}

  isAvailable() {
    return getAnalyticsPlatform() === 'preview' || (!!this.adUnitId.trim() && !!getTapApi());
  }

  destroy() {
    this.finish(false);
    this.rewardedAd?.destroy?.();
    this.rewardedAd = null;
  }

  watch(): Promise<RewardedAdResult> {
    const platform = getAnalyticsPlatform();
    const tapApi = getTapApi();
    if (!tapApi) {
      if (platform === 'preview') {
        return Promise.resolve({ completed: true, simulated: true });
      }
      console.error('[CatWorld] 当前平台广告 SDK 不可用');
      return Promise.resolve({ completed: false, simulated: false });
    }
    if (!this.adUnitId.trim()) {
      console.error('[CatWorld] Rewarded ad unit ID is not configured');
      return Promise.resolve({ completed: false, simulated: false });
    }
    if (this.pending) {
      console.error('[CatWorld] Rewarded ad is already showing');
      return Promise.resolve({ completed: false, simulated: false });
    }

    const ad = this.getRewardedAd(tapApi);
    if (!ad) return Promise.resolve({ completed: false, simulated: false });

    return new Promise(resolve => {
      this.pending = resolve;
      this.timeout = setTimeout(() => this.finish(false), 90000);
      Promise.resolve().then(() => ad.show()).catch(() => {
        if (!this.pending || this.rewardedAd !== ad) return;
        Promise.resolve().then(() => ad.load()).then(() => {
          if (this.pending && this.rewardedAd === ad) return ad.show();
        }).catch(error => {
          if (this.rewardedAd !== ad) return;
          console.error('[CatWorld] Rewarded ad failed', error);
          this.finish(false);
        });
      });
    });
  }

  private getRewardedAd(tapApi: TapApi) {
    if (this.rewardedAd) return this.rewardedAd;
    try {
      this.rewardedAd = tapApi.createRewardedVideoAd({ adUnitId: this.adUnitId });
      this.bindListeners(this.rewardedAd);
      return this.rewardedAd;
    } catch (error) {
      console.error('[CatWorld] Failed to create rewarded ad', error);
      return null;
    }
  }

  private bindListeners(ad: TapRewardedVideoAd) {
    ad.onLoad(() => {});
    ad.onError(error => {
      if (this.rewardedAd !== ad) return;
      console.error('[CatWorld] Rewarded ad failed', error);
      this.finish(false);
    });
    ad.onClose(result => {
      if (this.rewardedAd !== ad) return;
      this.finish(!!result && result.isEnded === true);
    });
  }

  private finish(completed: boolean) {
    const resolve = this.pending;
    if (!resolve) return;
    this.pending = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    const ad = this.rewardedAd;
    this.rewardedAd = null;
    try { ad?.destroy?.(); } catch (error) { console.error('[CatWorld] Failed to dispose rewarded ad', error); }
    resolve({ completed, simulated: false });
  }
}
