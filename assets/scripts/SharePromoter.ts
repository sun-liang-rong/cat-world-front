import { Node } from 'cc';
import { Analytics, getAnalyticsPlatform } from './Analytics';
import { LeaderboardService, ShareCard, ShareResult } from './LeaderboardService';
import { ItemId, ShareCardType, ShareOffer } from './PlayerTypes';
import { Toast } from './Toast';

export interface SharePromoterOptions {
  analytics: Analytics;
  leaderboard: LeaderboardService;
  playerStore: PlayerStoreLike;
  /** 分享成功提示挂载的根节点（Toast 用）。 */
  getRoot: () => Node;
  /** 分享补领道具到账后刷新对局内道具 HUD（可选）。 */
  refreshGameInventory?: () => void;
}

/** 只依赖分享流程用到的存档能力，避免直接耦合 PlayerStore 全量接口。 */
export interface PlayerStoreLike {
  canClaimToolByShare(id: ItemId): boolean;
  canClaimCoinByShare(): boolean;
  claimToolByShare(id: ItemId): { message: string };
  claimShareReward(type: ShareCardType): { message: string };
  markCoinShareClaimed(): void;
  getShareDailyState(): { rewardClaimed: boolean };
}

const SHARE_CARD_TITLES: Record<ShareCardType, string> = {
  level_win: '我刚通关了新的关卡，来和我一起收集猫咪吧！',
  town_stage: '我把小镇的新建筑点亮啦，来看看我的猫咪小镇！',
  cat_unlock: '我解锁了新的猫咪，来看看它的专属技能！',
  challenge_record: '我完成了超萌挑战，敢来试试看吗？',
  endless_record: '我在无尽模式刷新了自己的纪录，来挑战我吧！',
  journey_complete: '我完成了猫咪 7 日旅程，大橘纪念徽章到手！',
  campaign_complete: '我完成了猫爪星球的全部冒险！',
  tool_request: '我的道具用完啦，来猫爪星球帮我补个货！',
};

/**
 * 分享适配层：所有分享入口（结算/小镇/道具/金币/复活/翻倍）的入口限流、
 * 卡片组装与回调发放都在这里，Main 只透传。每次 App session 仅把
 * 分享入口当作一次自动留存提示，手动入口不受此限制。
 */
export class SharePromoter {
  private sharePromptShown = false;

  constructor(private readonly options: SharePromoterOptions) {}

  buildShareOffer(type: ShareCardType, label: string): ShareOffer | null {
    if (!this.options.leaderboard.canShare()) return null;
    if (this.options.playerStore.getShareDailyState().rewardClaimed) return null;
    if (!this.sharePromptShown) {
      this.sharePromptShown = true;
      this.options.analytics.track('share_entrance_show', {
        card_type: type,
        prompt: 'session_first',
      });
    }
    return { type, label };
  }

  shareCard(type: ShareCardType) {
    if (!this.options.leaderboard.canShare()) return;
    const card: ShareCard = {
      type,
      title: SHARE_CARD_TITLES[type],
      // 只携带非隐私的分享场景，不带用户 ID、金币、星星或完整存档。
      query: `share_card=${type}`,
    };
    this.options.analytics.track('share_click', { card_type: type });
    this.options.analytics.track('share_card_open', { card_type: type });
    this.share(card).then(result => {
      this.trackShareResult({ card_type: type, result });
      if (result !== 'success') return;
      const reward = this.options.playerStore.claimShareReward(type);
      Toast.show(this.options.getRoot(), reward.message);
    }).catch(error => {
      console.error('[CatWorld] Share result handling failed', error);
      this.trackShareResult({ card_type: type, result: 'failed' });
    });
  }

  // 空道具点击 → 分享好友补领：微信环境拉起分享，回调成功才发放；
  // 每种道具每天限领 1 个（微信分享回调较宽松，防止刷道具）。
  shareForTool(id: ItemId) {
    const root = this.options.getRoot();
    if (!this.options.leaderboard.canShare()) {
      Toast.show(root, '分享功能暂未开放');
      return;
    }
    if (!this.options.playerStore.canClaimToolByShare(id)) {
      Toast.show(root, '今天已经分享领取过这个道具啦，明天再来');
      return;
    }
    const card: ShareCard = {
      type: 'tool_request',
      title: SHARE_CARD_TITLES.tool_request,
      query: `share_card=tool_request&item=${id}`,
    };
    this.options.analytics.track('share_click', { card_type: 'tool_request', item_id: id });
    this.share(card).then(result => {
      this.options.analytics.track('share_result', { card_type: 'tool_request', result, item_id: id });
      if (result !== 'success') return;
      const claim = this.options.playerStore.claimToolByShare(id);
      Toast.show(root, claim.message);
      this.options.refreshGameInventory?.();
    }).catch(error => {
      console.error('[CatWorld] Tool share failed', error);
    });
  }

  // 首页金币弹窗：分享好友换金币，成功后由 HomeScreen 发放；每天 1 次。
  shareForCoins(): Promise<boolean> {
    const root = this.options.getRoot();
    if (!this.options.leaderboard.canShare()) {
      Toast.show(root, '分享功能暂未开放');
      return Promise.resolve(false);
    }
    if (!this.options.playerStore.canClaimCoinByShare()) {
      Toast.show(root, '今天已经分享领取过金币啦，明天再来');
      return Promise.resolve(false);
    }
    const card: ShareCard = {
      type: 'level_win',
      title: SHARE_CARD_TITLES.level_win,
      query: 'share_card=level_win&scene=home_coins',
    };
    this.options.analytics.track('share_click', { card_type: 'level_win', scene: 'home_coins' });
    return this.share(card).then(result => {
      this.options.analytics.track('share_result', { card_type: 'level_win', result, scene: 'home_coins' });
      if (result !== 'success') return false;
      this.options.playerStore.markCoinShareClaimed();
      return true;
    }).catch(error => {
      console.error('[CatWorld] Home coin share failed', error);
      return false;
    });
  }

  // 失败结算「分享好友清出一对」：拉起微信分享，成功 resolve true；
  // 每局仍只复活一次（reviveUsed 限制），无需每日限领。
  shareForRevive(): Promise<boolean> {
    if (!this.options.leaderboard.canShare()) {
      Toast.show(this.options.getRoot(), '分享功能暂未开放');
      return Promise.resolve(false);
    }
    const card: ShareCard = {
      type: 'level_win',
      title: SHARE_CARD_TITLES.level_win,
      query: 'share_card=level_win&scene=revive',
    };
    this.options.analytics.track('share_click', { card_type: 'level_win', scene: 'revive' });
    return this.share(card).then(result => {
      this.options.analytics.track('share_result', { card_type: 'level_win', result, scene: 'revive' });
      return result === 'success';
    }).catch(error => {
      console.error('[CatWorld] Revive share failed', error);
      return false;
    });
  }

  // 结算「分享好友×2金币」：拉起微信分享，成功 resolve true，由 GameScreen 补发金币；
  // doubleRewardUsed 保证每局只翻倍一次。
  shareForDouble(): Promise<boolean> {
    if (!this.options.leaderboard.canShare()) {
      Toast.show(this.options.getRoot(), '分享功能暂未开放');
      return Promise.resolve(false);
    }
    const card: ShareCard = {
      type: 'level_win',
      title: SHARE_CARD_TITLES.level_win,
      query: 'share_card=level_win&scene=double_coins',
    };
    this.options.analytics.track('share_click', { card_type: 'level_win', scene: 'double_coins' });
    return this.share(card).then(result => {
      this.options.analytics.track('share_result', { card_type: 'level_win', result, scene: 'double_coins' });
      return result === 'success';
    }).catch(error => {
      console.error('[CatWorld] Double coin share failed', error);
      return false;
    });
  }

  private trackShareResult(props: { card_type: ShareCardType; result: ShareResult }) {
    this.options.analytics.track('share_result', {
      ...props,
      platform: getAnalyticsPlatform(),
    });
  }

  private share(card: ShareCard): Promise<ShareResult> {
    return this.options.leaderboard.share(card).catch(error => {
      console.error('[CatWorld] Failed to share card', error);
      return 'failed' as const;
    });
  }
}
