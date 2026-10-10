import { getAnalyticsPlatform } from './Analytics';

export interface RewardedAdResult {
  completed: boolean;
  simulated: boolean;
}

export const TAP_REWARDED_AD_UNIT_ID = '1067058';

// preview / H5 走 TapTap 激励视频；微信渠道暂不开放广告入口。
export const REWARDED_AD_ENABLED = getAnalyticsPlatform() !== 'wechat';

interface TapRewardedVideoAd {
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
    : globalThis as typeof globalThis & { tap?: TapApi };
  return runtime?.tap?.createRewardedVideoAd ? runtime.tap : null;
}

export class RewardedAdService {
  private rewardedAd: TapRewardedVideoAd | null = null;
  private listenersBound = false;
  private pending: ((result: RewardedAdResult) => void) | null = null;

  constructor(private readonly adUnitId = TAP_REWARDED_AD_UNIT_ID) {}

  watch(): Promise<RewardedAdResult> {
    const platform = getAnalyticsPlatform();
    const tapApi = getTapApi();
    if (!tapApi) {
      if (platform === 'preview') {
        return Promise.resolve({ completed: true, simulated: true });
      }
      console.error('[CatWorld] TapTap 广告 SDK 不可用');
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
      ad.show().catch(() => {
        if (!this.pending) return;
        ad.load().then(() => ad.show()).catch(error => {
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
    if (this.listenersBound) return;
    this.listenersBound = true;
    ad.onLoad(() => {});
    ad.onError(error => {
      console.error('[CatWorld] Rewarded ad failed', error);
      this.finish(false);
    });
    ad.onClose(result => {
      this.finish(!!result && result.isEnded === true);
    });
  }

  private finish(completed: boolean) {
    const resolve = this.pending;
    if (!resolve) return;
    this.pending = null;
    resolve({ completed, simulated: false });
  }
}
