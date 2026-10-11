import { getAnalyticsPlatform } from './Analytics';
import type { AdScene } from './Analytics';

export type RewardActionMode = 'share' | 'ad';
/** 当前先用分享；微信广告开通后改为 ad，并在 Main 配置正式广告位。 */
export const REWARD_ACTION_MODE: RewardActionMode = 'share';

export interface RewardedAdResult {
  completed: boolean;
  simulated: boolean;
}

export const TAP_REWARDED_AD_UNIT_ID = '1067058';

// 保留广告适配，分享模式下不会创建或调用广告 SDK。

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

interface RewardShareApi {
  shareAppMessage: (options: { title: string; query: string }) => void;
  onHide: (callback: () => void) => void;
  offHide: (callback: () => void) => void;
  onShow: (callback: () => void) => void;
  offShow: (callback: () => void) => void;
}

function getRewardShareApi(): RewardShareApi | null {
  if (getAnalyticsPlatform() !== 'wechat') return null;
  const runtime = globalThis as typeof globalThis & { wx?: Partial<RewardShareApi> };
  const api = runtime.wx;
  return api?.shareAppMessage && api.onHide && api.offHide && api.onShow && api.offShow
    ? api as RewardShareApi : null;
}

const REWARD_SHARE_TITLES: Record<AdScene, string> = {
  revive: '猫咪冒险就差一步啦，来和我一起挑战吧！',
  double_coins: '我在猫爪星球完成挑战啦，一起来收集猫咪吧！',
  home_coins: '来猫爪星球，和我一起建设猫咪小镇吧！',
  shop_item: '猫爪星球的猫咪道具铺开张啦，一起来玩吧！',
};

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
  private clearShareListeners: (() => void) | null = null;

  constructor(
    private readonly adUnitId = TAP_REWARDED_AD_UNIT_ID,
    readonly mode: RewardActionMode = REWARD_ACTION_MODE,
  ) {}

  isAvailable() {
    if (this.mode === 'share') return getAnalyticsPlatform() === 'preview' || !!getRewardShareApi();
    return getAnalyticsPlatform() === 'preview' || (!!this.adUnitId.trim() && !!getTapApi());
  }

  destroy() {
    this.finish(false);
    this.rewardedAd?.destroy?.();
    this.rewardedAd = null;
  }

  watch(scene: AdScene = 'home_coins'): Promise<RewardedAdResult> {
    if (this.mode === 'share') return this.shareForReward(scene);
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

  /** 微信不提供可信的送达结果；这里只奖励分享操作后返回，不声称分享成功。 */
  private shareForReward(scene: AdScene): Promise<RewardedAdResult> {
    if (this.pending) return Promise.resolve({ completed: false, simulated: false });
    if (getAnalyticsPlatform() === 'preview') {
      return Promise.resolve({ completed: true, simulated: true });
    }
    const api = getRewardShareApi();
    if (!api) return Promise.resolve({ completed: false, simulated: false });

    return new Promise(resolve => {
      this.pending = resolve;
      let leftGame = false;
      const onHide = () => {
        if (this.pending === resolve) leftGame = true;
      };
      const onShow = () => {
        if (this.pending === resolve && leftGame) this.finish(true);
      };
      this.clearShareListeners = () => {
        try { api.offHide(onHide); }
        finally { api.offShow(onShow); }
      };
      this.timeout = setTimeout(() => {
        if (this.pending === resolve) this.finish(false);
      }, 30000);
      try {
        api.onHide(onHide);
        api.onShow(onShow);
        api.shareAppMessage({ title: REWARD_SHARE_TITLES[scene], query: `reward_scene=${scene}` });
      } catch (error) {
        console.error('[CatWorld] Failed to open reward share', error);
        this.finish(false);
      }
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
    const clearShareListeners = this.clearShareListeners;
    this.clearShareListeners = null;
    try { clearShareListeners?.(); }
    catch (error) { console.error('[CatWorld] Failed to remove reward share listeners', error); }
    const ad = this.rewardedAd;
    this.rewardedAd = null;
    try { ad?.destroy?.(); } catch (error) { console.error('[CatWorld] Failed to dispose rewarded ad', error); }
    resolve({ completed, simulated: false });
  }
}
