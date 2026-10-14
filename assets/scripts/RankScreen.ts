import { SettlementButton } from './SettlementButton';
import { ensureButtonControl } from './Theme';
import { Button, Color, Graphics, Label, Mask, Node, ScrollView, Sprite, tween, UITransform, Vec3, view } from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { LeaderboardData, LeaderboardEntry, LeaderboardTab } from './LeaderboardService';
import { Toast } from './Toast';

export interface RankScreenOptions {
  getStars: () => number;
  getName?: () => string;
  onPlaySound: (effect: AudioEffect) => void;
  fetchEntries: (tab: LeaderboardTab) => Promise<LeaderboardData>;
  onInvite: () => boolean;
  onReturnHome: () => void;
}

const ROW_WIDTH = 660;
const ROW_HEIGHT = 118;
const ROW_STEP = ROW_HEIGHT + 16;
const LIST_TOP_PAD = 8;
const RANK_MEDAL_X = -262;
const AVATAR_X = -160;
const NAME_BAR_X = 20;
const NAME_BAR_WIDTH = 230;
const NAME_BAR_HEIGHT = 52;
const STAR_X = 186;
const SCORE_BAR_X = 270;
const SCORE_BAR_WIDTH = 108;
const LIST_VIEW_TOP_INSET = 400;
const LIST_VIEW_BOTTOM_INSET = 252;
const TABS: Array<{ id: LeaderboardTab; label: string }> = [
  { id: 'level', label: '关卡模式' },
  { id: 'endless', label: '无尽模式' },
  { id: 'challenge', label: '超萌挑战' },
];

export class RankScreen {
  private rankUI: Node | null = null;
  private scrollView: ScrollView | null = null;
  private listContent: Node | null = null;
  private emptyState: Node | null = null;
  private emptyLabel: Label | null = null;
  private statusCaption: Label | null = null;
  private selfRankLabel: Label | null = null;
  private selfRankBadge: Node | null = null;
  private selfStarsLabel: Label | null = null;
  private selfCaptionLabel: Label | null = null;
  private selfNameLabel: Label | null = null;
  private retryButton: Node | null = null;
  private tabButtons: Array<{ id: LeaderboardTab; node: Node; label: Label }> = [];
  private currentTab: LeaderboardTab = 'level';
  private loadToken = 0;
  private listViewHeight = 0;
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: RankScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    this.assets.loadImagesFor(this, [
      'home/home_bg',
      'rank/title_banner',
      COMMON_UI_ASSETS.backButton,
      'rank/medal_gold',
      'rank/medal_silver',
      'rank/medal_bronze',
      'rank/badge_wood',
      COMMON_UI_ASSETS.starIcon,
      'rank/cat_orange',
      'rank/cat_white',
      'rank/cat_black',
      'rank/cat_ragdoll',
      'rank/cat_calico',
      'rank/cat_grey',
      'rank/cat_crown',
      'rank/btn_gold',
      'rank/bar_name',
    ], () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.rankUI) return;
    this.rankUI.active = active;
    if (active) this.reloadList();
    else this.loadToken += 1;
  }

  destroy() {
    this.active = false;
    this.loadToken += 1;
    this.rankUI?.destroy();
    this.rankUI = null;
    this.scrollView = null;
    this.listContent = null;
    this.emptyState = null;
    this.emptyLabel = null;
    this.statusCaption = null;
    this.selfRankLabel = null;
    this.selfRankBadge = null;
    this.selfStarsLabel = null;
    this.selfCaptionLabel = null;
    this.selfNameLabel = null;
    this.retryButton = null;
    this.tabButtons = [];
  }

  private create() {
    if (this.rankUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -visibleSize.height / 2;
    this.rankUI = new Node('RankUI');
    this.root.addChild(this.rankUI);
    this.rankUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.rankUI.active = this.active;

    this.image(this.rankUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);
    this.buildHeader(top);
    this.buildTabs(top);
    this.buildListView(top, bottom);
    this.buildSelfCard(bottom);
    this.buildEmptyState(top, bottom);
    this.buildRetryButton(top);
    if (this.active) this.reloadList();
  }

  private buildHeader(top: number) {
    const banner = this.image(this.rankUI!, 'rank/title_banner', 14, top - 146, 480, 194);
    // 标题对准铭牌面的几何中心（约在素材高度 70% 处），不是整张吊牌的中心。
    const title = this.label(banner, '排行榜', 0, -39, 33, new Color(111, 62, 28));
    title.isBold = true;
    title.outlineWidth = 2;
    title.outlineColor = new Color(255, 248, 226, 200);
    this.statusCaption = this.label(this.rankUI!, '', 0, top - 376, 20, new Color(150, 124, 95));
    this.statusCaption.enableWrapText = false;
    this.statusCaption.overflow = Label.Overflow.SHRINK;
    this.statusCaption.node.getComponent(UITransform)!.setContentSize(660, 28);

    const back = new Node('RankBackButton');
    this.rankUI!.addChild(back);
    back.setPosition(-300, top - 146);
    back.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(back, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    const button = back.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.options.onReturnHome();
    });
  }

  private buildListView(top: number, bottom: number) {
    const viewHeight = (top - LIST_VIEW_TOP_INSET) - (bottom + LIST_VIEW_BOTTOM_INSET);
    this.listViewHeight = viewHeight;
    const viewCenterY = (top - LIST_VIEW_TOP_INSET) - viewHeight / 2;
    const viewNode = new Node('RankListView');
    this.rankUI!.addChild(viewNode);
    viewNode.setPosition(0, viewCenterY);
    viewNode.addComponent(UITransform).setContentSize(680, viewHeight);
    const mask = viewNode.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;

    const content = new Node('RankContent');
    viewNode.addChild(content);
    content.addComponent(UITransform).setAnchorPoint(0.5, 1);
    content.getComponent(UITransform)!.setContentSize(680, viewHeight);
    content.setPosition(0, viewHeight / 2);
    this.listContent = content;

    const scrollView = viewNode.addComponent(ScrollView);
    scrollView.content = content;
    scrollView.horizontal = false;
    scrollView.vertical = true;
    scrollView.inertia = true;
    this.scrollView = scrollView;
  }

  private buildTabs(top: number) {
    const bar = new Node('RankTabs');
    this.rankUI!.addChild(bar);
    bar.setPosition(0, top - 304);
    bar.addComponent(UITransform).setContentSize(660, 88);
    TABS.forEach((tab, index) => {
      const node = new Node(`RankTab_${tab.id}`);
      bar.addChild(node);
      node.setPosition((index - 1) * 220, 0);
      node.addComponent(UITransform).setContentSize(200, 88);
      SettlementButton.apply(node, tab.id === this.currentTab ? 'primary' : 'secondary', 200, 88);
      const label = this.label(node, tab.label, 0, 0, 22, new Color(112, 69, 40));
      label.isBold = true;
      SettlementButton.styleLabel(label, 200, 88, 24);
      const button = node.addComponent(Button);
      ensureButtonControl(button);
      button.node.on(Button.EventType.CLICK, () => {
        if (this.currentTab === tab.id) return;
        this.options.onPlaySound('click');
        this.currentTab = tab.id;
        this.refreshTabs();
        this.reloadList();
      });
      this.tabButtons.push({ id: tab.id, node, label });
    });
    this.refreshTabs();
  }

  private refreshTabs() {
    this.tabButtons.forEach(tab => {
      SettlementButton.setAppearance(tab.node, tab.id === this.currentTab ? 'primary' : 'secondary');
    });
  }

  private reloadList() {
    if (!this.active || !this.listContent || !this.scrollView || !this.rankUI) return;
    const token = ++this.loadToken;
    const tab = this.currentTab;
    let rendering = false;
    // 重进页面或切换页签时先回到顶部，避免拉取期间停留在上次的滚动位置
    this.scrollView.scrollToTop(0, false);
    if (this.retryButton) this.retryButton.active = false;
    this.listContent.parent!.active = false;
    this.emptyState!.active = false;
    this.refreshSelfCard(tab, []);
    this.selfRankLabel!.string = '读取中';
    this.selfCaptionLabel!.string = '正在读取我的名次…';
    this.statusCaption!.string = '正在拉取排行榜...';
    this.statusCaption!.node.active = true;
    this.options.fetchEntries(tab).then(data => {
      if (token !== this.loadToken || !this.rankUI || !this.active || data.tab !== this.currentTab) return;
      rendering = true;
      this.renderList(data);
    }).catch(error => {
      console.error(rendering ? '[CatWorld] Failed to render rank list' : '[CatWorld] Failed to load rank list', error);
      if (token !== this.loadToken || !this.rankUI || !this.active) return;
      // 拉取失败只展示错误提示；不要走空列表渲染，否则「还没有人上榜」会和报错同屏矛盾
      this.listContent!.destroyAllChildren();
      this.emptyState!.active = false;
      this.listContent!.parent!.active = false;
      this.statusCaption!.string = rendering ? '排行榜显示失败，请点击重试' : '排行榜加载失败，请点击重试';
      this.statusCaption!.node.active = true;
      this.selfRankLabel!.string = '--';
      this.selfCaptionLabel!.string = '名次暂未读取成功';
      if (this.retryButton) this.retryButton.active = true;
    });
  }

  // 拉取失败（含排行榜入口生成身份失败）时提供显式重试入口（需求 A-3）
  private buildRetryButton(top: number) {
    const node = new Node('RankRetryButton');
    this.rankUI!.addChild(node);
    node.setPosition(0, top - LIST_VIEW_TOP_INSET - 76);
    node.addComponent(UITransform).setContentSize(200, 72);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(255, 224, 108);
    graphics.strokeColor = new Color(221, 158, 28);
    graphics.lineWidth = 3;
    graphics.roundRect(-100, -36, 200, 72, 36);
    graphics.fill();
    graphics.stroke();
    SettlementButton.apply(node, 'primary', 200, 96);
    const label = this.label(node, '点击重试', 0, 0, 24, new Color(112, 69, 40));
    SettlementButton.styleLabel(label, 200, 96, 24);
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    node.active = false;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.reloadList();
    });
    this.retryButton = node;
  }

  private renderList(data: LeaderboardData) {
    if (!this.listContent || !this.scrollView || !this.rankUI) return;
    const viewHeight = this.listViewHeight;
    this.statusCaption!.string = data.tab === 'level'
      ? '累计星星越多排名越高，同分比较通关数'
      : data.tab === 'endless' ? '消除数量越多排名越高，同分比较用时' : '今日最快通关榜，用时越短排名越高';
    if (data.pendingSubmission) this.statusCaption!.string = '成绩待同步，重进排行榜可重试';
    this.statusCaption!.node.active = true;

    this.listContent.destroyAllChildren();
    this.emptyState!.active = data.entries.length === 0;
    if (this.emptyLabel) this.emptyLabel.string = data.tab === 'challenge'
      ? '今天还没有通关记录\n去超萌挑战争夺榜首吧'
      : data.tab === 'endless' ? '还没有无尽模式记录\n去消除卡牌，创造纪录吧' : '还没有关卡模式记录\n去闯关，为猫咪收集星星吧';
    this.listContent.parent!.active = data.entries.length > 0;
    if (data.entries.length === 0) {
      this.refreshSelfCard(data.tab, data.entries);
      if (data.pendingSubmission) this.selfCaptionLabel!.string = '成绩待同步，重进榜单可重试';
      return;
    }

    const contentHeight = LIST_TOP_PAD * 2 + data.entries.length * ROW_STEP - 16;
    const contentTransform = this.listContent.getComponent(UITransform)!;
    contentTransform.setContentSize(680, contentHeight);
    this.listContent.setPosition(0, viewHeight / 2);

    // 每次渲染都从头显示：自己的名次已由底部常驻卡片展示，列表定位到自己的行会挡住榜首
    data.entries.forEach((entry, index) => {
      this.buildRow(data.tab, entry, index, -LIST_TOP_PAD - ROW_HEIGHT / 2 - index * ROW_STEP);
    });
    this.refreshSelfCard(data.tab, data.entries);
    if (data.pendingSubmission) this.selfCaptionLabel!.string = '成绩待同步，重进榜单可重试';
  }

  private buildRow(tab: LeaderboardTab, entry: LeaderboardEntry, index: number, y: number) {
    const row = new Node(`RankRow_${index}`);
    this.listContent!.addChild(row);
    row.setPosition(0, y);
    row.addComponent(UITransform).setContentSize(ROW_WIDTH, ROW_HEIGHT);
    const rank = entry.rank || index + 1;
    this.drawRowCard(row, entry.isSelf, rank);

    if (rank <= 3) {
      const medal = this.image(row, this.medalPathForRank(rank), RANK_MEDAL_X, 2, 96, 95);
      if (rank === 1) {
        tween(medal)
          .repeatForever(
            tween()
              .to(1.1, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
              .to(1.1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
          )
          .start();
      }
    } else {
      this.image(row, 'rank/badge_wood', RANK_MEDAL_X, 2, 78, 79);
      const rankText = this.label(row, `${rank}`, RANK_MEDAL_X, 2, 24, new Color(255, 248, 226));
      rankText.isBold = true;
    }

    this.image(row, entry.avatarPath, AVATAR_X, 2, 94, 92);

    const nameBar = this.image(row, 'rank/bar_name', NAME_BAR_X, 2, NAME_BAR_WIDTH, NAME_BAR_HEIGHT);
    const name = this.label(nameBar, this.shortName(entry.name, 9), 0, 0, 22, new Color(112, 69, 40));
    name.isBold = true;
    name.enableWrapText = false;
    name.overflow = Label.Overflow.SHRINK;
    name.node.getComponent(UITransform)!.setContentSize(NAME_BAR_WIDTH - 24, 36);

    if (tab === 'level') this.image(row, COMMON_UI_ASSETS.starIcon, STAR_X, 2, 44, 43);
    this.drawScoreBar(row, SCORE_BAR_X);
    const score = this.label(row, entry.scoreLabel, SCORE_BAR_X, 2, tab === 'challenge' ? 20 : 21, new Color(112, 69, 40));
    score.isBold = true;
    score.enableWrapText = false;
    score.overflow = Label.Overflow.SHRINK;
    score.node.getComponent(UITransform)!.setContentSize(SCORE_BAR_WIDTH - 16, 34);
  }

  private drawRowCard(parent: Node, isSelf: boolean, rank: number) {
    const card = new Node('RowCard');
    parent.addChild(card);
    card.addComponent(UITransform).setContentSize(ROW_WIDTH, ROW_HEIGHT);
    const graphics = card.addComponent(Graphics);
    if (isSelf) {
      graphics.lineWidth = 4;
      graphics.strokeColor = new Color(243, 177, 53);
      graphics.fillColor = new Color(255, 233, 148);
    } else if (rank === 1) {
      graphics.lineWidth = 4;
      graphics.strokeColor = new Color(245, 175, 40);
      graphics.fillColor = new Color(255, 245, 212);
    } else if (rank === 2) {
      graphics.lineWidth = 3;
      graphics.strokeColor = new Color(190, 202, 216);
      graphics.fillColor = new Color(252, 250, 246);
    } else if (rank === 3) {
      graphics.lineWidth = 3;
      graphics.strokeColor = new Color(220, 168, 126);
      graphics.fillColor = new Color(255, 247, 236);
    } else {
      graphics.lineWidth = 3;
      graphics.strokeColor = new Color(235, 205, 158);
      graphics.fillColor = new Color(255, 248, 226);
    }
    graphics.roundRect(-ROW_WIDTH / 2, -ROW_HEIGHT / 2, ROW_WIDTH, ROW_HEIGHT, 26);
    graphics.fill();
    graphics.stroke();

    // 前三名与玩家自身：增加内圈微高光细线，营造精致金属浮雕感
    if (rank <= 3 || isSelf) {
      graphics.lineWidth = 1.2;
      graphics.strokeColor = rank === 1
        ? new Color(255, 255, 255, 160)
        : rank === 2
          ? new Color(255, 255, 255, 200)
          : rank === 3
            ? new Color(255, 255, 255, 140)
            : new Color(255, 255, 255, 150);
      graphics.roundRect(-ROW_WIDTH / 2 + 2.5, -ROW_HEIGHT / 2 + 2.5, ROW_WIDTH - 5, ROW_HEIGHT - 5, 23.5);
      graphics.stroke();
    }
  }

  private drawScoreBar(parent: Node, x: number) {
    const bar = new Node('ScoreBar');
    parent.addChild(bar);
    bar.setPosition(x, 2);
    bar.addComponent(UITransform).setContentSize(SCORE_BAR_WIDTH, 50);
    const graphics = bar.addComponent(Graphics);
    graphics.fillColor = new Color(238, 219, 183);
    graphics.roundRect(-SCORE_BAR_WIDTH / 2, -25, SCORE_BAR_WIDTH, 50, 25);
    graphics.fill();
  }

  private buildSelfCard(bottom: number) {
    const card = new Node('SelfCard');
    this.rankUI!.addChild(card);
    // 底边离屏幕 68px，避开 Home 条。
    card.setPosition(0, bottom + 152);
    card.addComponent(UITransform).setContentSize(690, 168);

    const shadow = new Node('SelfCardShadow');
    card.addChild(shadow);
    shadow.setPosition(0, -92);
    shadow.addComponent(UITransform).setContentSize(340, 26);
    const shadowGraphics = shadow.addComponent(Graphics);
    shadowGraphics.fillColor = new Color(92, 54, 22, 60);
    shadowGraphics.ellipse(0, 0, 170, 12);
    shadowGraphics.fill();

    const panel = new Node('SelfCardPanel');
    card.addChild(panel);
    panel.addComponent(UITransform).setContentSize(690, 168);
    const graphics = panel.addComponent(Graphics);
    graphics.lineWidth = 3;
    graphics.strokeColor = new Color(235, 205, 158);
    graphics.fillColor = new Color(255, 248, 226);
    graphics.roundRect(-345, -84, 690, 168, 30);
    graphics.fill();
    graphics.stroke();

    this.image(panel, 'rank/cat_crown', -278, 0, 118, 117);

    const nameBar = this.image(panel, 'rank/bar_name', -105, 50, 190, 46);
    this.selfNameLabel = this.label(nameBar, '我', 0, 0, 22, new Color(112, 69, 40));
    this.selfNameLabel.isBold = true;
    this.selfNameLabel.enableWrapText = false;
    this.selfNameLabel.overflow = Label.Overflow.SHRINK;
    this.selfNameLabel.node.getComponent(UITransform)!.setContentSize(166, 34);
    this.image(panel, COMMON_UI_ASSETS.starIcon, 22, 50, 36, 35).name = 'SelfScoreIcon';
    this.selfStarsLabel = this.label(panel, String(this.options.getStars()), 96, 50, 22, new Color(112, 69, 40));
    this.selfStarsLabel.isBold = true;
    this.selfStarsLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.selfStarsLabel.enableWrapText = false;
    this.selfStarsLabel.overflow = Label.Overflow.SHRINK;
    this.selfStarsLabel.node.getComponent(UITransform)!.setContentSize(96, 34);

    this.selfCaptionLabel = this.label(panel, '', -35, 4, 18, new Color(136, 94, 63));
    this.selfCaptionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.selfCaptionLabel.overflow = Label.Overflow.CLAMP;
    this.selfCaptionLabel.node.getComponent(UITransform)!.setContentSize(330, 24);

    this.selfRankBadge = new Node('SelfRankBadge');
    panel.addChild(this.selfRankBadge);
    this.selfRankBadge.setPosition(-180, -46);
    this.selfRankBadge.addComponent(UITransform).setContentSize(56, 56);
    this.selfRankLabel = this.label(panel, '', -96, -46, 20, new Color(112, 69, 40));
    this.selfRankLabel.isBold = true;
    this.selfRankLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.selfRankLabel.overflow = Label.Overflow.CLAMP;
    this.selfRankLabel.node.getComponent(UITransform)!.setContentSize(100, 26);

    this.buildInviteButton(panel);
  }

  private buildInviteButton(panel: Node) {
    const node = new Node('InviteButton');
    panel.addChild(node);
    node.setPosition(240, 0);
    node.addComponent(UITransform).setContentSize(192, 88);
    SettlementButton.apply(node, 'secondary', 192, 88);
    const label = this.label(node, '邀请好友', 0, 0, 26, new Color(255, 251, 238));
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = new Color(184, 74, 10);
    SettlementButton.styleLabel(label, 192, 88, 24);
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const sent = this.options.onInvite();
      this.toast(sent ? '已发起邀请，等好友加入吧' : '当前环境不支持微信分享');
    });
  }

  private drawPillFallback(parent: Node, width: number, height: number) {
    const graphics = parent.addComponent(Graphics);
    graphics.fillColor = new Color(255, 214, 74);
    graphics.strokeColor = new Color(221, 158, 28);
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
  }

  private refreshSelfCard(tab: LeaderboardTab, entries: LeaderboardEntry[]) {
    if (!this.selfRankLabel || !this.selfStarsLabel || !this.selfCaptionLabel) return;
    const icon = this.selfStarsLabel.node.parent?.getChildByName('SelfScoreIcon');
    if (icon) icon.active = tab === 'level';
    const self = entries.find(entry => entry.isSelf);
    if (this.selfNameLabel) {
      this.selfNameLabel.string = this.shortName(self ? self.name.replace('（我）', '') : this.options.getName?.() || '我', 7);
    }
    if (!self) {
      this.selfRankLabel.string = '未上榜';
      this.setSelfRankBadge(0);
      this.selfStarsLabel.string = tab === 'level' ? String(this.options.getStars()) : '--';
      this.selfCaptionLabel.string = this.emptyCaption(tab);
      return;
    }
    const rank = self.rank || entries.indexOf(self) + 1;
    this.selfRankLabel.string = `第${rank}名`;
    this.setSelfRankBadge(rank);
    this.selfStarsLabel.string = self.scoreLabel;
    if (rank === 1) {
      this.selfCaptionLabel.string = '已是榜首，继续保持！';
      return;
    }
    const ahead = entries[Math.max(0, entries.indexOf(self) - 1)];
    this.selfCaptionLabel.string = this.gapCaption(tab, ahead, self);
  }

  private medalPathForRank(rank: number) {
    if (rank === 1) return 'rank/medal_gold';
    if (rank === 2) return 'rank/medal_silver';
    if (rank === 3) return 'rank/medal_bronze';
    return 'rank/badge_wood';
  }

  private setSelfRankBadge(rank: number) {
    if (!this.selfRankBadge?.isValid) return;
    this.selfRankBadge.removeAllChildren();
    const path = this.medalPathForRank(rank);
    const size = rank >= 1 && rank <= 3 ? 56 : 52;
    this.image(this.selfRankBadge, path, 0, 0, size, size);
    // 前三名奖牌自带名次样式，第 4 名起才需要在木圈上标数字（同列表行 buildRow）
    if (rank > 3) {
      const rankText = this.label(this.selfRankBadge, `${rank}`, 0, 0, 20, new Color(255, 248, 226));
      rankText.isBold = true;
    }
  }

  private emptyCaption(tab: LeaderboardTab) {
    if (tab === 'endless') return '去无尽模式消卡，抢下榜首吧';
    if (tab === 'challenge') return '通关超萌挑战，用时越短排名越高';
    return '完成关卡，抢下榜首吧';
  }

  private gapCaption(tab: LeaderboardTab, ahead: LeaderboardEntry, self: LeaderboardEntry) {
    const name = ahead.name.replace('（我）', '');
    if (tab === 'endless') {
      const gap = ahead.score - self.score + 1;
      return `还差 ${gap} 张卡超越${name}`;
    }
    if (tab === 'challenge') {
      return `比${name}慢 ${this.formatDurationGap(self.durationMs - ahead.durationMs)}`;
    }
    const gap = ahead.score - self.score + 1;
    return `还差 ${gap} 颗星星超越${name}`;
  }

  private formatDurationGap(durationMs: number) {
    const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}秒`;
    return `${minutes}分${seconds < 10 ? `0${seconds}` : seconds}秒`;
  }

  private buildEmptyState(top: number, bottom: number) {
    const state = new Node('RankEmptyState');
    this.rankUI!.addChild(state);
    state.setPosition(0, (top - LIST_VIEW_TOP_INSET + bottom + LIST_VIEW_BOTTOM_INSET) / 2);
    state.active = false;
    this.emptyState = state;

    const text = this.label(state, '', 0, -20, 24, new Color(112, 69, 40));
    this.emptyLabel = text;
    text.lineHeight = 44;
    text.isBold = true;

    const button = new Node('EmptyInviteButton');
    state.addChild(button);
    button.setPosition(0, -128);
    button.addComponent(UITransform).setContentSize(232, 100);
    SettlementButton.apply(button, 'secondary', 288, 96);
    const label = this.label(button, '邀请好友一起玩', 0, 0, 26, new Color(255, 251, 238));
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = new Color(184, 74, 10);
    SettlementButton.styleLabel(label, 288, 96, 24);
    const buttonComponent = button.addComponent(Button);
    ensureButtonControl(buttonComponent);
    buttonComponent.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const sent = this.options.onInvite();
      this.toast(sent ? '已发起邀请，等好友加入吧' : '当前环境不支持微信分享');
    });
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.rankUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 38);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private image(parent: Node, path: string, x: number, y: number, width: number, height: number) {
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = this.assets.getFrame(path);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
    }
    return node;
  }

  // 超长昵称保留可读字号，避免整串文字被压成难辨认的小字。
  private shortName(name: string, maxChars: number) {
    const chars = Array.from(name);
    return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('')}…` : name;
  }

  private label(parent: Node, text: string, x: number, y: number, size: number, color: Color) {
    const node = new Node('Label');
    parent.addChild(node);
    node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 8;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
  }

  private toast(text: string) {
    if (!this.rankUI) return;
    Toast.show(this.rankUI, text);
  }
}
