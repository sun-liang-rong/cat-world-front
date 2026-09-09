export interface RewardedAdResult {
  completed: boolean;
  simulated: boolean;
}

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
