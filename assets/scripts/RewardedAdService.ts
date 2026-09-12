export interface RewardedAdResult {
  completed: boolean;
  simulated: boolean;
}

// 激励视频总开关：false 时 Main 不给任何页面注入看广告能力，
// 结算复活/双倍、首页金币广告、商店广告领道具的入口会全部自动隐藏。
// 流量主开通、要恢复广告时改回 true 即可（各页面逻辑无需再动）。
export const REWARDED_AD_ENABLED = false;

interface WechatRewardedVideoAd {
  show: () => Promise<void>;
  load: () => Promise<void>;
  onClose: (callback: (result?: { isEnded?: boolean }) => void) => void;
  onError: (callback: (error: unknown) => void) => void;
  offClose?: (callback: (result?: { isEnded?: boolean }) => void) => void;
  offError?: (callback: (error: unknown) => void) => void;
}

interface WechatApi {
  createRewardedVideoAd: (options: { adUnitId: string }) => WechatRewardedVideoAd;
}

export class RewardedAdService {
  private rewardedAd: WechatRewardedVideoAd | null = null;

  constructor(private readonly adUnitId: string) {}

  watch(): Promise<RewardedAdResult> {
    const wxApi = this.getWechatApi();
    if (!wxApi) {
      return Promise.resolve({ completed: true, simulated: true });
    }
    if (!this.adUnitId.trim()) {
      console.error('[CatWorld] Rewarded ad unit ID is not configured');
      return Promise.resolve({ completed: false, simulated: false });
    }

    const ad = this.getRewardedAd(wxApi);
    if (!ad) return Promise.resolve({ completed: false, simulated: false });

    return new Promise(resolve => {
      let settled = false;
      const cleanup = () => {
        ad.offClose?.(onClose);
        ad.offError?.(onError);
      };
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ completed, simulated: false });
      };
      const onClose = (result?: { isEnded?: boolean }) => {
        finish(!result || result.isEnded !== false);
      };
      const onError = (error: unknown) => {
        console.error('[CatWorld] Rewarded ad failed', error);
        finish(false);
      };
      const show = () => {
        ad.show().catch(() => {
          if (settled) return;
          ad.load().then(() => ad.show()).catch(onError);
        });
      };

      ad.onClose(onClose);
      ad.onError(onError);
      show();
    });
  }

  private getRewardedAd(wxApi: WechatApi) {
    if (this.rewardedAd) return this.rewardedAd;
    try {
      this.rewardedAd = wxApi.createRewardedVideoAd({ adUnitId: this.adUnitId });
      return this.rewardedAd;
    } catch (error) {
      console.error('[CatWorld] Failed to create rewarded ad', error);
      return null;
    }
  }

  private getWechatApi() {
    const runtime = typeof globalThis === 'undefined'
      ? null
      : globalThis as typeof globalThis & { wx?: WechatApi };
    return runtime?.wx || null;
  }
}
