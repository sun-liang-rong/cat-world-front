import { Button, Color, Graphics, Label, Mask, Node, ScrollView, Sprite, UITransform, view } from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { LeaderboardData, LeaderboardEntry, LeaderboardTab } from './LeaderboardService';
import { Toast } from './Toast';

export interface RankScreenOptions {
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
const LIST_VIEW_TOP_INSET = 360;
const LIST_VIEW_BOTTOM_INSET = 224;
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
  private mockCaption: Label | null = null;
  private selfRankLabel: Label | null = null;
  private selfRankBadge: Node | null = null;
  private selfStarsLabel: Label | null = null;
  private selfCaptionLabel: Label | null = null;
  private selfNameLabel: Label | null = null;
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
  }

  destroy() {
    this.rankUI?.destroy();
    this.rankUI = null;
    this.scrollView = null;
    this.listContent = null;
    this.emptyState = null;
    this.mockCaption = null;
    this.selfRankLabel = null;
    this.selfRankBadge = null;
    this.selfStarsLabel = null;
    this.selfCaptionLabel = null;
    this.selfNameLabel = null;
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
    this.reloadList();
  }

  private buildHeader(top: number) {
    const banner = this.image(this.rankUI!, 'rank/title_banner', 14, top - 146, 480, 194);
    // 标题对准铭牌面的几何中心（约在素材高度 70% 处），不是整张吊牌的中心。
    const title = this.label(banner, '排行榜', 0, -39, 33, new Color(111, 62, 28));
    title.isBold = true;
    title.outlineWidth = 2;
    title.outlineColor = new Color(255, 248, 226, 200);
    this.mockCaption = this.label(this.rankUI!, '', 10, top - 338, 16, new Color(150, 124, 95));

    const back = new Node('RankBackButton');
    this.rankUI!.addChild(back);
    back.setPosition(-300, top - 146);
    back.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(back, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    const button = back.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
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
    bar.setPosition(0, top - 286);
    bar.addComponent(UITransform).setContentSize(660, 64);
    TABS.forEach((tab, index) => {
      const node = new Node(`RankTab_${tab.id}`);
      bar.addChild(node);
      node.setPosition(-220 + index * 220, 0);
      node.addComponent(UITransform).setContentSize(200, 64);
      const graphics = node.addComponent(Graphics);
      graphics.fillColor = new Color(255, 248, 226);
      graphics.strokeColor = new Color(235, 205, 158);
      graphics.lineWidth = 3;
      graphics.roundRect(-100, -32, 200, 64, 22);
      graphics.fill();
      graphics.stroke();
      const label = this.label(node, tab.label, 0, 0, 22, new Color(112, 69, 40));
      label.isBold = true;
      const button = node.addComponent(Button);
      button.transition = Button.Transition.SCALE;
      button.zoomScale = 0.93;
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
      const graphics = tab.node.getComponent(Graphics);
      if (!graphics) return;
      const selected = tab.id === this.currentTab;
      graphics.clear();
      graphics.fillColor = selected ? new Color(255, 224, 108) : new Color(255, 248, 226);
      graphics.strokeColor = selected ? new Color(221, 158, 28) : new Color(235, 205, 158);
      graphics.lineWidth = selected ? 4 : 3;
      graphics.roundRect(-100, -32, 200, 64, 22);
      graphics.fill();
      graphics.stroke();
      tab.label.color = selected ? new Color(111, 62, 28) : new Color(136, 94, 63);
    });
  }

  private reloadList() {
    if (!this.listContent || !this.scrollView || !this.rankUI) return;
    const token = ++this.loadToken;
    // 重进页面或切换页签时先回到顶部，避免拉取期间停留在上次的滚动位置
    this.scrollView.scrollToTop(0, false);
    this.mockCaption!.string = '正在拉取排行榜...';
    this.mockCaption!.node.active = true;
    this.options.fetchEntries(this.currentTab).then(data => {
      if (token !== this.loadToken || !this.rankUI) return;
      this.renderList(data);
    }).catch(error => {
      console.error('[CatWorld] Failed to load rank list', error);
      if (token !== this.loadToken || !this.rankUI) return;
      // 拉取失败只展示错误提示；不要走空列表渲染，否则「还没有人上榜」会和报错同屏矛盾
      this.listContent!.destroyAllChildren();
      this.emptyState!.active = false;
      this.listContent!.parent!.active = false;
      this.mockCaption!.string = '排行榜暂时连不上，请稍后重试';
      this.mockCaption!.node.active = true;
    });
  }

  private renderList(data: LeaderboardData) {
    if (!this.listContent || !this.scrollView || !this.rankUI) return;
    const viewHeight = this.listViewHeight;
    this.mockCaption!.node.active = false;

    this.listContent.destroyAllChildren();
    this.emptyState!.active = data.entries.length === 0;
    this.listContent.parent!.active = data.entries.length > 0;
    if (data.entries.length === 0) {
      this.refreshSelfCard(data.tab, data.entries);
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
  }

  private buildRow(tab: LeaderboardTab, entry: LeaderboardEntry, index: number, y: number) {
    const row = new Node(`RankRow_${index}`);
    this.listContent!.addChild(row);
    row.setPosition(0, y);
    row.addComponent(UITransform).setContentSize(ROW_WIDTH, ROW_HEIGHT);
    this.drawRowCard(row, entry.isSelf);

    const rank = entry.rank || index + 1;
    if (rank <= 3) {
      this.image(row, this.medalPathForRank(rank), RANK_MEDAL_X, 2, 96, 95);
    } else {
      this.image(row, 'rank/badge_wood', RANK_MEDAL_X, 2, 78, 79);
      const rankText = this.label(row, `${rank}`, RANK_MEDAL_X, 2, 24, new Color(255, 248, 226));
      rankText.isBold = true;
    }

    this.image(row, entry.avatarPath, AVATAR_X, 2, 94, 92);

    const nameBar = this.image(row, 'rank/bar_name', NAME_BAR_X, 2, NAME_BAR_WIDTH, NAME_BAR_HEIGHT);
    const name = this.label(nameBar, entry.name, 0, 0, 22, new Color(112, 69, 40));
    name.isBold = true;
    name.node.getComponent(UITransform)!.setContentSize(NAME_BAR_WIDTH - 24, 36);

    if (tab === 'level') this.image(row, COMMON_UI_ASSETS.starIcon, STAR_X, 2, 44, 43);
    this.drawScoreBar(row, SCORE_BAR_X);
    const score = this.label(row, entry.scoreLabel, SCORE_BAR_X, 2, tab === 'challenge' ? 18 : 21, new Color(112, 69, 40));
    score.isBold = true;
  }

  private drawRowCard(parent: Node, isSelf: boolean) {
    const card = new Node('RowCard');
    parent.addChild(card);
    card.addComponent(UITransform).setContentSize(ROW_WIDTH, ROW_HEIGHT);
    const graphics = card.addComponent(Graphics);
    graphics.lineWidth = isSelf ? 4 : 3;
    graphics.strokeColor = isSelf ? new Color(243, 177, 53) : new Color(235, 205, 158);
    graphics.fillColor = isSelf ? new Color(255, 233, 148) : new Color(255, 248, 226);
    graphics.roundRect(-ROW_WIDTH / 2, -ROW_HEIGHT / 2, ROW_WIDTH, ROW_HEIGHT, 26);
    graphics.fill();
    graphics.stroke();
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
    // 底边距屏幕底 44px（Home 条安全区），给滚动列表让出最大高度。
    card.setPosition(0, bottom + 128);
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
    this.image(panel, COMMON_UI_ASSETS.starIcon, 22, 50, 36, 35).name = 'SelfScoreIcon';
    this.selfStarsLabel = this.label(panel, '', 90, 50, 22, new Color(112, 69, 40));
    this.selfStarsLabel.isBold = true;
    this.selfStarsLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.selfStarsLabel.overflow = Label.Overflow.CLAMP;
    this.selfStarsLabel.node.getComponent(UITransform)!.setContentSize(84, 28);

    this.selfCaptionLabel = this.label(panel, '', -35, 4, 17, new Color(136, 94, 63));
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
    const visual = this.image(node, 'rank/btn_gold', 0, 0, 190, 86);
    if (!this.assets.getFrame('rank/btn_gold')) this.drawPillFallback(visual, 190, 86);
    const label = this.label(node, '邀请好友', 0, 0, 26, new Color(255, 251, 238));
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = new Color(184, 74, 10);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const sent = this.options.onInvite();
      this.toast(sent ? '已发起邀请，等好友加入吧' : '预览环境：已模拟邀请好友');
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
      this.selfNameLabel.string = self ? self.name.replace('（我）', '') : '我';
    }
    if (!self) {
      this.selfRankLabel.string = '未上榜';
      this.setSelfRankBadge(0);
      this.selfStarsLabel.string = tab === 'challenge' ? '--' : '0';
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

    const text = this.label(state, '还没有人上榜\n先去闯关、无尽或超萌挑战吧', 0, -20, 24, new Color(112, 69, 40));
    text.lineHeight = 44;
    text.isBold = true;

    const button = new Node('EmptyInviteButton');
    state.addChild(button);
    button.setPosition(0, -128);
    button.addComponent(UITransform).setContentSize(232, 100);
    const visual = this.image(button, 'rank/btn_gold', 0, 0, 230, 98);
    if (!this.assets.getFrame('rank/btn_gold')) this.drawPillFallback(visual, 230, 98);
    const label = this.label(button, '邀请好友一起玩', 0, 0, 26, new Color(255, 251, 238));
    label.isBold = true;
    label.outlineWidth = 2;
    label.outlineColor = new Color(184, 74, 10);
    const buttonComponent = button.addComponent(Button);
    buttonComponent.transition = Button.Transition.SCALE;
    buttonComponent.zoomScale = 0.93;
    buttonComponent.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const sent = this.options.onInvite();
      this.toast(sent ? '已发起邀请，等好友加入吧' : '预览环境：已模拟邀请好友');
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
