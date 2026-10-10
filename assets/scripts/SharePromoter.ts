import { Node } from 'cc';
import { Analytics, getAnalyticsPlatform } from './Analytics';
import { LeaderboardService, ShareCard, ShareResult } from './LeaderboardService';
import { ItemId, ShareCardType, ShareOffer } from './PlayerTypes';
import { Toast } from './Toast';

export interface SharePromoterOptions {
  analytics: Analytics;
  leaderboard: LeaderboardService;
  playerStore: PlayerStoreLike;
  /** 操作提示挂载的根节点（Toast 用）。 */
  getRoot: () => Node;
  /** 本地每日补给到账后刷新对局内道具 HUD（可选）。 */
  refreshGameInventory?: () => void;
}

/** 只依赖分享流程用到的存档能力，避免直接耦合 PlayerStore 全量接口。 */
export interface PlayerStoreLike {
  canClaimToolByShare(id: ItemId): boolean;
  claimToolByShare(id: ItemId): { message: string };
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
 * 分享适配层：成果分享的入口限流与卡片组装都在这里，Main 只透传。每次 App session 仅把
 * 分享入口当作一次自动留存提示，手动入口不受此限制。
 */
export class SharePromoter {
  private sharePromptShown = false;

  constructor(private readonly options: SharePromoterOptions) {}

  buildShareOffer(type: ShareCardType, label: string): ShareOffer | null {
    if (!this.options.leaderboard.canShare() || this.sharePromptShown) return null;
    this.sharePromptShown = true;
    this.options.analytics.track('share_entrance_show', { card_type: type });
    return { type, label: label.split(' · ')[0] };
  }

  shareCard(type: ShareCardType) {
    if (!this.options.leaderboard.canShare()) return;
    const card: ShareCard = {
      type,
      title: SHARE_CARD_TITLES[type],
      query: `share_card=${type}`,
    };
    this.options.analytics.track('share_click', { card_type: type });
    this.share(card).then(result => this.trackShareResult({ card_type: type, result }));
  }

  // 本地每日补给与分享无关，沿用旧存档限领字段，避免升级后重复领取。
  claimToolSupply(id: ItemId) {
    const root = this.options.getRoot();
    if (!this.options.playerStore.canClaimToolByShare(id)) {
      Toast.show(root, '今天的这个道具补给已领取，可以去商店看看');
      return;
    }
    const claim = this.options.playerStore.claimToolByShare(id);
    Toast.show(root, claim.message);
    this.options.refreshGameInventory?.();
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
