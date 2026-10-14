import { ensureButtonControl, createVerticalContent } from './Theme';
import {
  Button,
  Color,
  Graphics,
  Label,
  Node,
  Sprite,
  UITransform,
  UIOpacity,
  Tween,
  Vec3,
  tween,
  view,
} from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS, belowWeChatCapsule } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { SettlementButton } from './SettlementButton';
import { Toast } from './Toast';
import {
  CAT_DEFINITIONS,
  CAT_MILESTONES,
  getCatSkillConfig,
  getCatSkillChargeRequired,
  getCatDefinition,
  getCatUpgradeCost,
  MAX_CAT_LEVEL,
} from './GameContent';
import { CatId, CatInteraction, CatProgress, CatTrialStatus, CatUpgradeResult } from './PlayerTypes';

export interface CatDetailScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getCoins: () => number;
  getCat: (id: CatId) => CatProgress;
  getEquippedCat: () => CatId | null;
  /** 试住快照：试住期的猫咪详情按只读「试住中」模式展示 */
  getCatTrialStatus?: () => CatTrialStatus | null;
  onInteract: (id: CatId, interaction: CatInteraction) => { ok: boolean; message: string };
  onUpgrade: (id: CatId) => CatUpgradeResult;
  onEquip: (id: CatId) => { ok: boolean; message: string };
  onReturnCollection: () => void;
}

type InteractionView = {
  id: CatInteraction;
  node: Node;
  button: Button;
  opacity: UIOpacity;
  status: Label;
};

type StatCardView = {
  titleLabel: Label;
  bar: Graphics;
  barLabel: Label;
};

type MilestoneChipView = {
  level: number;
  graphics: Graphics;
  label: Label;
  check: Graphics;
};

// 统一暖色奶油风色板（与工程其它页面一致）
const COLOR_TITLE = new Color(111, 62, 28);
const COLOR_BODY = new Color(112, 69, 40);
const COLOR_STROKE = new Color(235, 205, 158);
const COLOR_ACCENT_STROKE = new Color(224, 154, 51);
const COLOR_MUTED = new Color(150, 137, 121);
const COLOR_BAR_FILL = new Color(255, 176, 59);
const COLOR_BAR_TRACK = new Color(246, 232, 204);

const EXPERIENCE_MAX = 20;
const AFFECTION_MAX = 100;
const INTERACTION_COST = 10;

export class CatDetailScreen {
  private detailUI: Node | null = null;
  private catId: CatId = 'orange';
  private portrait: Node | null = null;
  private nameLabel: Label | null = null;
  private rarityPill: Graphics | null = null;
  private rarityLabel: Label | null = null;
  private equippedBadge: Node | null = null;
  private statCards: Record<'level' | 'affection', StatCardView> | null = null;
  private coinLabel: Label | null = null;
  private skillIcon: Node | null = null;
  private skillDescLabel: Label | null = null;
  private skillCooldownLabel: Label | null = null;
  private unlockLabel: Label | null = null;
  private upgradeButton: Button | null = null;
  private upgradeLabel: Label | null = null;
  private upgradeOpacity: UIOpacity | null = null;
  private equipButton: Button | null = null;
  private equipLabel: Label | null = null;
  private equipOpacity: UIOpacity | null = null;
  private interactionViews: InteractionView[] = [];
  private trialBadge: Node | null = null;
  private readonly milestoneChips: MilestoneChipView[] = [];
  private idleAnimationStarted = false;
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: CatDetailScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    const paths = [
      'home/home_bg',
      COMMON_UI_ASSETS.backButton,
      COMMON_UI_ASSETS.coinIcon,
      'shop/hint_ribbon',
      COMMON_UI_ASSETS.starIcon,
      'popup/btn_orange',
      'popup/btn_green',
      'cat_detail/icon_heart',
      'cat_detail/icon_pet',
      'cat_detail/icon_feed',
      'cat_detail/icon_play',
      'cat_detail/icon_skill',
      ...CAT_DEFINITIONS.map(cat => cat.portraitPath),
    ];
    this.assets.loadImagesFor(this, paths, () => {
      this.create();
      onReady?.();
    });
  }

  setCat(id: CatId) {
    this.catId = id;
    this.refresh();
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.detailUI) return;
    this.detailUI.active = active;
    if (active) this.refresh();
  }

  destroy() {
    this.interactionViews.length = 0;
    this.milestoneChips.length = 0;
    if (this.portrait) Tween.stopAllByTarget(this.portrait);
    this.statCards = null;
    this.detailUI?.destroy();
    this.detailUI = null;
  }

  private create() {
    if (this.detailUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    this.detailUI = new Node('CatDetailUI');
    this.root.addChild(this.detailUI);
    this.detailUI.addComponent(UITransform).setContentSize(visibleSize.width, visibleSize.height);
    this.detailUI.active = this.active;
    this.image(this.detailUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);

    // 顶栏：返回 + 标题 + 金币胶囊
    const headerY = top - 150;
    this.buildBackButton(this.detailUI, -315, headerY, this.options.onReturnCollection);
    const title = this.label(this.detailUI, '猫咪详情', 0, headerY, 40, COLOR_TITLE);
    title.isBold = true;
    const coinChip = this.capsule(this.detailUI, 250, belowWeChatCapsule(top, 56), 208, 56, new Color(255, 248, 226, 235), COLOR_STROKE);
    this.image(coinChip, COMMON_UI_ASSETS.coinIcon, -70, 0, 42, 42);
    this.coinLabel = this.label(coinChip, '', 18, 0, 23, COLOR_BODY);
    this.coinLabel.isBold = true;

    // 保留详情字号和按钮热区；短屏只滚动内容，不让头像顶进 HUD 或操作压住 Home 条。
    const panelHeight = 1064;
    const contentTop = Math.min(445, top - 244);
    const contentBottom = -top + 68;
    const content = createVerticalContent(this.detailUI, contentTop, contentBottom, 696, panelHeight + 8);
    const panel = this.creamPanel(content, 0, -panelHeight / 2, 680, panelHeight, 30, new Color(255, 248, 226, 245), COLOR_STROKE);

    // 头像区：光晕徽章 + 立绘 + 出战中角标
    this.buildPortraitBadge(panel, 0, 300);
    this.portrait = this.image(panel, 'cats/cat_orange', 0, 300, 220, 220);
    if (!this.assets.getFrame('cats/cat_orange')) this.drawCatFallback(this.portrait, 'orange', 1.4);
    this.equippedBadge = this.buildEquippedBadge(panel, 0, 430);
    this.trialBadge = this.buildTrialBadge(panel, 0, 430);

    // 名字铭带 + 稀有度胶囊
    const ribbon = this.image(panel, 'shop/hint_ribbon', 0, 158, 340, 76);
    if (!this.assets.getFrame('shop/hint_ribbon')) {
      const fallback = ribbon.addComponent(Graphics);
      this.drawCapsule(fallback, 320, 68, new Color(255, 248, 226), COLOR_ACCENT_STROKE, 3);
    }
    this.nameLabel = this.label(panel, '', 0, 160, 34, COLOR_TITLE);
    this.nameLabel.isBold = true;

    const rarityNode = new Node('RarityPill');
    panel.addChild(rarityNode);
    rarityNode.setPosition(0, 86);
    rarityNode.addComponent(UITransform).setContentSize(180, 44);
    this.rarityPill = rarityNode.addComponent(Graphics);
    this.rarityLabel = this.label(rarityNode, '', 0, 0, 21, COLOR_TITLE);
    this.rarityLabel.isBold = true;

    // 属性卡：等级经验 / 好感度，各带进度条
    this.statCards = {
      level: this.buildStatCard(panel, -166, COMMON_UI_ASSETS.starIcon),
      affection: this.buildStatCard(panel, 166, 'cat_detail/icon_heart'),
    };

    // 专属技能卡
    const skillPanel = this.creamPanel(panel, 0, -128, 620, 132, 22, new Color(255, 235, 188, 130), COLOR_STROKE);
    this.skillIcon = this.image(skillPanel, 'cat_detail/icon_skill', -262, 0, 64, 64);
    const skillTitle = this.label(skillPanel, '专属技能', -172, 40, 23, COLOR_TITLE);
    skillTitle.isBold = true;
    this.skillCooldownLabel = this.label(skillPanel, '', 200, 40, 20, new Color(177, 106, 43));
    this.skillDescLabel = this.label(skillPanel, '', 15, -18, 20, COLOR_BODY);
    this.skillDescLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.skillDescLabel.node.getComponent(UITransform)!.setContentSize(470, 56);
    this.skillDescLabel.lineHeight = 28;
    this.skillDescLabel.overflow = Label.Overflow.CLAMP;

    // 每日互动
    const interactionTitle = this.label(panel, '每日互动', -220, -226, 24, COLOR_TITLE);
    interactionTitle.isBold = true;
    this.buildInteractionButton(panel, 'pet', '抚摸', 'cat_detail/icon_pet', -184, -308);
    this.buildInteractionButton(panel, 'feed', '喂食', 'cat_detail/icon_feed', 0, -308);
    this.buildInteractionButton(panel, 'play', '玩耍', 'cat_detail/icon_play', 184, -308);

    // 底部操作：复用结算弹窗的木纹按钮，保证全局按钮质感一致
    const upgradeNode = SettlementButton.create(panel, this.assets, {
      text: '',
      tone: 'orange',
      appearance: 'secondary',
      width: 280,
      height: 108,
      fontSize: 28,
      scale: 1,
      onClick: () => {
        this.options.onPlaySound('click');
        const result = this.options.onUpgrade(this.catId);
        this.toast(result.message);
        this.refresh();
        if (result.ok) this.playUpgradeAnimation();
      },
    });
    upgradeNode.setPosition(-152, -464);
    this.upgradeButton = upgradeNode.getComponent(Button);
    this.upgradeLabel = upgradeNode.getChildByName('Label')?.getComponent(Label) ?? null;
    this.upgradeOpacity = upgradeNode.addComponent(UIOpacity);

    const equipNode = SettlementButton.create(panel, this.assets, {
      text: '',
      tone: 'green',
      width: 280,
      height: 108,
      fontSize: 28,
      scale: 1,
      onClick: () => {
        this.options.onPlaySound('click');
        const result = this.options.onEquip(this.catId);
        this.toast(result.message);
        this.refresh();
      },
    });
    equipNode.setPosition(152, -464);
    this.equipButton = equipNode.getComponent(Button);
    this.equipLabel = equipNode.getChildByName('Label')?.getComponent(Label) ?? null;
    this.equipOpacity = equipNode.addComponent(UIOpacity);

    this.unlockLabel = this.label(panel, '', 0, -394, 21, COLOR_BODY);
    this.unlockLabel.node.getComponent(UITransform)!.setContentSize(600, 36);
    this.unlockLabel.isBold = true;

    this.refresh();
  }

  private buildPortraitBadge(parent: Node, x: number, y: number) {
    const node = new Node('PortraitBadge');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(300, 300);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(255, 224, 108, 95);
    graphics.circle(0, 0, 148);
    graphics.fill();
    graphics.fillColor = new Color(255, 236, 178, 165);
    graphics.circle(0, 0, 134);
    graphics.fill();
    graphics.strokeColor = COLOR_STROKE;
    graphics.lineWidth = 3;
    graphics.circle(0, 0, 134);
    graphics.stroke();
    graphics.fillColor = new Color(242, 196, 112, 170);
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16;
      graphics.circle(Math.cos(angle) * 112, Math.sin(angle) * 112, 4);
      graphics.fill();
    }
    return node;
  }

  private buildEquippedBadge(parent: Node, x: number, y: number) {
    const node = new Node('EquippedBadge');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(136, 44);
    const graphics = node.addComponent(Graphics);
    this.drawCapsule(graphics, 136, 44, new Color(112, 166, 76), new Color(71, 111, 38), 3);
    const label = this.label(node, '出战中', 0, 0, 20, Color.WHITE);
    label.isBold = true;
    label.outlineWidth = 3;
    label.outlineColor = new Color(47, 84, 17);
    node.active = false;
    return node;
  }

  // 试住徽章：与出战中徽章同位互斥，黄色强调「临时体验」
  private buildTrialBadge(parent: Node, x: number, y: number) {
    const node = new Node('TrialBadge');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(168, 44);
    const graphics = node.addComponent(Graphics);
    this.drawCapsule(graphics, 168, 44, new Color(255, 224, 108), new Color(201, 148, 47), 3);
    const label = this.label(node, '试住体验中', 0, 0, 20, new Color(111, 62, 28));
    label.isBold = true;
    node.active = false;
    return node;
  }

  private buildStatCard(parent: Node, x: number, iconPath: string): StatCardView {
    const card = new Node('StatCard');
    parent.addChild(card);
    card.setPosition(x, 0);
    card.addComponent(UITransform).setContentSize(300, 104);
    const graphics = card.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 110);
    graphics.strokeColor = COLOR_STROKE;
    graphics.lineWidth = 2;
    graphics.roundRect(-150, -52, 300, 104, 20);
    graphics.fill();
    graphics.stroke();

    this.image(card, iconPath, -112, 26, 38, 38);
    const titleLabel = this.label(card, '', 23, 26, 22, COLOR_BODY);
    titleLabel.isBold = true;
    titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    titleLabel.node.getComponent(UITransform)!.setContentSize(214, 30);
    titleLabel.overflow = Label.Overflow.CLAMP;

    const barNode = new Node('Bar');
    card.addChild(barNode);
    barNode.setPosition(0, -20);
    barNode.addComponent(UITransform).setContentSize(240, 24);
    const bar = barNode.addComponent(Graphics);
    const barLabel = this.label(barNode, '', 0, 0, 20, Color.WHITE);
    barLabel.isBold = true;
    barLabel.outlineWidth = 2;
    barLabel.outlineColor = new Color(190, 120, 40);
    return { titleLabel, bar, barLabel };
  }

  private buildInteractionButton(parent: Node, id: CatInteraction, text: string, iconPath: string, x: number, y: number) {
    const node = new Node(`Interaction_${id}`);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(168, 112);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(255, 251, 238);
    graphics.strokeColor = new Color(240, 180, 72);
    graphics.lineWidth = 3;
    graphics.roundRect(-84, -56, 168, 112, 20);
    graphics.fill();
    graphics.stroke();
    SettlementButton.apply(node, 'secondary', 168, 112);
    this.image(node, iconPath, 0, 22, 46, 46);
    const name = this.label(node, text, 0, -14, 21, COLOR_TITLE);
    name.isBold = true;
    const status = this.label(node, '', 0, -42, 17, COLOR_BODY);
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      const result = this.options.onInteract(this.catId, id);
      if (result.ok) {
        this.spawnHeartBurst();
        if (this.portrait?.isValid) {
          Tween.stopAllByTarget(this.portrait);
          tween(this.portrait)
            .to(0.08, { scale: new Vec3(1.08, 0.92, 1) })
            .to(0.12, { scale: new Vec3(0.95, 1.06, 1) })
            .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'bounceOut' })
            .start();
        }
      }
      this.toast(result.message);
      this.refresh();
    });
    const opacity = node.addComponent(UIOpacity);
    this.interactionViews.push({ id, node, button, opacity, status });
  }

  private spawnHeartBurst() {
    if (!this.portrait?.isValid || !this.detailUI?.isValid) return;
    const parent = this.portrait.parent || this.detailUI;
    const basePos = this.portrait.position;
    for (let i = 0; i < 3; i++) {
      const heartNode = new Node(`HeartSpark_${i}`);
      parent.addChild(heartNode);
      const offsetX = (i - 1) * 36 + (Math.random() - 0.5) * 16;
      heartNode.setPosition(basePos.x + offsetX, basePos.y + 20);
      heartNode.addComponent(UITransform).setContentSize(24, 24);
      const gfx = heartNode.addComponent(Graphics);
      gfx.fillColor = new Color(255, 105, 140, 240);
      const r = 6;
      gfx.circle(-r * 0.7, r * 0.3, r);
      gfx.circle(r * 0.7, r * 0.3, r);
      gfx.moveTo(-r * 1.35, 0);
      gfx.lineTo(0, -r * 1.5);
      gfx.lineTo(r * 1.35, 0);
      gfx.close();
      gfx.fill();

      const opacity = heartNode.addComponent(UIOpacity);
      opacity.opacity = 240;
      heartNode.setScale(new Vec3(0.6, 0.6, 1));
      const targetY = basePos.y + 70 + i * 22;
      tween(heartNode)
        .to(0.2, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
        .to(0.4, { position: new Vec3(basePos.x + offsetX * 1.4, targetY, 0) }, { easing: 'quadOut' })
        .start();
      tween(opacity)
        .delay(0.25)
        .to(0.35, { opacity: 0 })
        .call(() => {
          if (heartNode.isValid) heartNode.destroy();
        })
        .start();
    }
  }

  private refresh() {
    if (!this.detailUI) return;
    const definition = getCatDefinition(this.catId);
    const progress = this.options.getCat(this.catId);
    const unlocked = !!progress?.unlocked;
    const trialStatus = this.options.getCatTrialStatus?.() ?? null;
    // 试住模式：猫咪尚未正式解锁、但正处于试住期 → 只读展示，不允许升级/互动/换装
    const trialMode = !unlocked && trialStatus?.catId === this.catId;
    const showAsUnlocked = unlocked || trialMode;
    const equipped = this.options.getEquippedCat() === this.catId;
    const interactionCounts = progress?.interactionCounts || { pet: 0, feed: 0, play: 0 };
    const coins = this.options.getCoins();

    if (this.portrait) {
      this.portrait.name = definition.portraitPath.replace(/\//g, '_');
      const frame = this.assets.getFrame(definition.portraitPath);
      const sprite = this.portrait.getComponent(Sprite);
      if (frame && sprite) sprite.spriteFrame = frame;
      const opacity = this.portrait.getComponent(UIOpacity) || this.portrait.addComponent(UIOpacity);
      opacity.opacity = showAsUnlocked ? 255 : 110;
      this.refreshIdleAnimation(showAsUnlocked, progress?.level ?? 1);
    }
    if (this.nameLabel) this.nameLabel.string = definition.name;
    if (this.rarityPill && this.rarityLabel) {
      this.rarityLabel.string = trialMode ? '试住中' : unlocked ? definition.rarity : '尚未解锁';
      this.rarityLabel.color = trialMode ? new Color(166, 110, 34) : unlocked ? COLOR_TITLE : COLOR_MUTED;
      this.drawCapsule(
        this.rarityPill,
        180,
        44,
        trialMode ? new Color(255, 239, 188) : unlocked ? new Color(255, 224, 108) : new Color(228, 216, 198),
        trialMode ? new Color(224, 154, 51) : unlocked ? COLOR_ACCENT_STROKE : new Color(204, 190, 168),
        2.5,
      );
    }
    if (this.equippedBadge) this.equippedBadge.active = unlocked && equipped;
    if (this.trialBadge) this.trialBadge.active = trialMode;
    if (this.coinLabel) this.coinLabel.string = `${coins}`;

    const cards = this.statCards;
    if (cards) {
      cards.level.titleLabel.string = showAsUnlocked ? `等级 Lv.${progress.level}` : '等级 --';
      const experience = showAsUnlocked ? progress.experience : 0;
      cards.level.barLabel.string = showAsUnlocked ? `互动 ${experience}/${EXPERIENCE_MAX}` : '--';
      this.drawBar(cards.level.bar, showAsUnlocked ? experience / EXPERIENCE_MAX : 0);
      cards.affection.titleLabel.string = '好感度';
      const affection = showAsUnlocked ? progress.affection : 0;
      cards.affection.barLabel.string = showAsUnlocked ? `${affection}/${AFFECTION_MAX}` : '--';
      this.drawBar(cards.affection.bar, showAsUnlocked ? affection / AFFECTION_MAX : 0);
    }

    if (this.skillDescLabel) {
      const effects: Record<CatId, string> = {
        orange: '自选清除1张棋盘牌', white: '自选清除1张棋盘牌',
        black: '清除槽位中1张牌', ragdoll: '获得1个随机道具', aurora: '自选清除2张棋盘牌',
      };
      const required = getCatSkillChargeRequired(this.catId, progress.level);
      const config = getCatSkillConfig(this.catId);
      const charge = config.chargeType === 'collect' ? `收集${required}张牌` : `完成${required}次三消`;
      this.skillDescLabel.string = !showAsUnlocked ? definition.unlockHint
        : `${effects[this.catId]}\n${trialMode ? '试住每局满充能' : charge + '充能'} · 每局1次`;
    }
    if (this.skillCooldownLabel) this.skillCooldownLabel.string = showAsUnlocked ? '无需等待' : '';
    if (this.skillIcon) {
      const opacity = this.skillIcon.getComponent(UIOpacity) || this.skillIcon.addComponent(UIOpacity);
      opacity.opacity = showAsUnlocked ? 255 : 120;
    }
    if (this.unlockLabel) {
      if (trialMode) {
        this.unlockLabel.string = `剩余试住 ${trialStatus!.remainingGames} 局 · 清理小屋后正式加入`;
      } else if (!unlocked) {
        this.unlockLabel.string = definition.unlockHint;
      } else {
        const next = CAT_MILESTONES.find(milestone => milestone.level > progress.level);
        this.unlockLabel.string = next
          ? `成长里程碑 · Lv.${next.level} ${next.title}`
          : '成长里程碑全部完成 · 专属头像框与称号已收藏';
      }
    }
    this.milestoneChips.forEach(chip => {
      this.drawMilestoneChip(chip, showAsUnlocked && (progress?.level ?? 1) >= chip.level);
    });

    this.interactionViews.forEach(viewData => {
      const used = interactionCounts[viewData.id] >= 1;
      const costsCoins = viewData.id !== 'pet';
      const affordable = !costsCoins || coins >= INTERACTION_COST;
      viewData.status.string = !showAsUnlocked
        ? '解锁后开放'
        : trialMode
          ? '试住后开放'
          : used
            ? '今日已用'
            : costsCoins && !affordable ? '金币不足' : viewData.id === 'pet' ? '免费' : `${INTERACTION_COST} 金币`;
      viewData.status.color = used || !showAsUnlocked || trialMode
        ? COLOR_MUTED
        : costsCoins && !affordable ? new Color(190, 59, 51) : COLOR_BODY;
      viewData.button.interactable = showAsUnlocked && !trialMode && !used && affordable;
      SettlementButton.apply(viewData.button.node, viewData.button.interactable ? 'secondary' : 'disabled', 168, 112);
      viewData.opacity.opacity = 255;
    });

    if (this.upgradeButton && this.upgradeLabel && this.upgradeOpacity) {
      const upgradeCost = unlocked ? getCatUpgradeCost(progress.level) : 0;
      const affordable = unlocked && coins >= upgradeCost;
      this.upgradeButton.interactable = unlocked && !trialMode && progress.level < MAX_CAT_LEVEL && affordable;
      this.upgradeLabel.string = trialMode
        ? '试住结束后可升级'
        : !unlocked
          ? '解锁后可升级'
          : progress.level >= MAX_CAT_LEVEL
            ? '已是最高等级'
            : !affordable
              ? `还差 ${upgradeCost - coins} 金币`
              : `升级 · ${upgradeCost} 金币`;
      SettlementButton.setAppearance(this.upgradeButton.node, this.upgradeButton.interactable ? 'secondary' : 'disabled');
      this.upgradeOpacity.opacity = 255;
    }
    if (this.equipButton && this.equipLabel && this.equipOpacity) {
      this.equipButton.interactable = unlocked && !trialMode && !equipped;
      this.equipLabel.string = trialMode
        ? '试住中自动出战'
        : !unlocked ? '解锁后可装备' : equipped ? '当前装备' : '装备出战';
      SettlementButton.setAppearance(this.equipButton.node, this.equipButton.interactable ? 'primary' : 'disabled');
      this.equipOpacity.opacity = 255;
    }
  }

  // 成长路线小签：达成金色 + 绿勾，未达成灰剪影
  private drawMilestoneChip(view: MilestoneChipView, reached: boolean) {
    view.graphics.clear();
    view.graphics.fillColor = reached ? new Color(255, 224, 108) : new Color(241, 235, 224);
    view.graphics.strokeColor = reached ? new Color(201, 148, 47) : new Color(206, 192, 172);
    view.graphics.lineWidth = 2.5;
    view.graphics.roundRect(-31, -22, 62, 44, 14);
    view.graphics.fill();
    view.graphics.stroke();
    view.label.string = `Lv.${view.level}`;
    view.label.color = reached ? COLOR_TITLE : COLOR_MUTED;
    view.check.clear();
    if (reached) {
      view.check.strokeColor = new Color(78, 139, 50);
      view.check.lineWidth = 3;
      view.check.moveTo(-5, 0);
      view.check.lineTo(-1, -4);
      view.check.lineTo(5, 4);
      view.check.stroke();
    }
  }

  private refreshIdleAnimation(unlocked: boolean, level: number) {
    if (!this.portrait) return;
    if (!unlocked || level < 3) {
      Tween.stopAllByTarget(this.portrait);
      this.portrait.setScale(new Vec3(1, 1, 1));
      this.idleAnimationStarted = false;
      return;
    }
    if (this.idleAnimationStarted) return;
    this.idleAnimationStarted = true;
    tween(this.portrait)
      .repeatForever(
        tween()
          .to(1.15, { scale: new Vec3(1.035, 0.965, 1) }, { easing: 'sineInOut' })
          .to(1.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  private playUpgradeAnimation() {
    if (!this.portrait) return;
    Tween.stopAllByTarget(this.portrait);
    this.idleAnimationStarted = false;
    this.portrait.setScale(new Vec3(0.86, 0.86, 1));
    tween(this.portrait)
      .to(0.28, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'backOut' })
      .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
      .call(() => {
        const progress = this.options.getCat(this.catId);
        this.refreshIdleAnimation(progress.unlocked, progress.level);
      })
      .start();
  }

  private buildBackButton(parent: Node, x: number, y: number, callback: () => void) {
    const node = new Node('CatDetailBackButton');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(node, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    const button = node.addComponent(Button);
    ensureButtonControl(button);
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      callback();
    });
  }

  private drawBar(graphics: Graphics, ratio: number) {
    graphics.clear();
    const width = 240;
    const height = 24;
    graphics.fillColor = COLOR_BAR_TRACK;
    graphics.strokeColor = COLOR_ACCENT_STROKE;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped > 0) {
      const fillWidth = Math.max(height, (width - 6) * clamped);
      graphics.fillColor = COLOR_BAR_FILL;
      graphics.roundRect(-width / 2 + 3, -height / 2 + 3, fillWidth, height - 6, (height - 6) / 2);
      graphics.fill();
    }
  }

  private drawCapsule(graphics: Graphics, width: number, height: number, fill: Color, stroke: Color, lineWidth: number) {
    graphics.clear();
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = lineWidth;
    graphics.roundRect(-width / 2, -height / 2, width, height, height / 2);
    graphics.fill();
    graphics.stroke();
  }

  private capsule(parent: Node, x: number, y: number, width: number, height: number, fill: Color, stroke: Color) {
    const node = new Node('Capsule');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    this.drawCapsule(graphics, width, height, fill, stroke, 3);
    return node;
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.detailUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 92);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private creamPanel(parent: Node, x: number, y: number, width: number, height: number, radius: number, fill: Color, stroke: Color) {
    const node = new Node('Panel');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = fill;
    graphics.strokeColor = stroke;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
    return node;
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

  private drawCatFallback(parent: Node, id: CatId, scale: number) {
    const graphics = parent.addComponent(Graphics);
    const colors: Record<CatId, Color> = {
      orange: new Color(238, 145, 65),
      white: new Color(245, 241, 225),
      black: new Color(75, 68, 70),
      ragdoll: new Color(183, 145, 111),
      aurora: new Color(109, 178, 178),
    };
    graphics.fillColor = colors[id];
    graphics.circle(0, -16 * scale, 42 * scale);
    graphics.fill();
    graphics.moveTo(-33 * scale, 14 * scale);
    graphics.lineTo(-42 * scale, 52 * scale);
    graphics.lineTo(-10 * scale, 37 * scale);
    graphics.close();
    graphics.fill();
    graphics.moveTo(33 * scale, 14 * scale);
    graphics.lineTo(42 * scale, 52 * scale);
    graphics.lineTo(10 * scale, 37 * scale);
    graphics.close();
    graphics.fill();
    graphics.fillColor = new Color(91, 53, 34);
    graphics.circle(-15 * scale, -12 * scale, 4 * scale);
    graphics.circle(15 * scale, -12 * scale, 4 * scale);
    graphics.fill();
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
    if (!this.detailUI) return;
    Toast.show(this.detailUI, text);
  }
}
