import { Button, Color, Graphics, Label, Node, Sprite, UITransform, view } from 'cc';
import { AssetStore, BACK_BUTTON_SIZE, COMMON_UI_ASSETS } from './AssetStore';
import { AudioEffect } from './AudioManager';
import { Toast } from './Toast';
import { ITEM_DEFINITIONS, ItemDefinition } from './GameContent';
import { RewardedAdResult } from './RewardedAdService';
import { ItemId, ShopItemStatus } from './PlayerTypes';

export interface ShopScreenOptions {
  onPlaySound: (effect: AudioEffect) => void;
  getCoins: () => number;
  getItemCount: (id: ItemId) => number;
  onBuyItem: (id: ItemId) => boolean;
  getShopItemStatus: (id: ItemId) => ShopItemStatus;
  onClaimItemByAd: (id: ItemId) => boolean;
  onWatchAd: () => Promise<RewardedAdResult>;
  onReturnHome: () => void;
}

type ShopItemView = {
  id: ItemId;
  countLabel: Label;
  button: Button;
  buttonLabel: Label;
  buttonSprite: Sprite | null;
};

export class ShopScreen {
  private shopUI: Node | null = null;
  private coinLabel: Label | null = null;
  private readonly itemViews: ShopItemView[] = [];
  private readonly iconSizes: Record<ItemId, [number, number]> = {
    hammer: [99, 106],
    glove: [87, 106],
    dice: [99, 105],
    extra_slot: [106, 92],
  };
  private readonly descriptions: Record<ItemId, string> = {
    hammer: '直接移除\n一个可收集元素。',
    dice: '重新排列棋盘上\n尚未收集的元素。',
    extra_slot: '本局临时增加\n1 个收集槽位。',
    glove: '交换两个槽位元素，\n或将一个元素放回棋盘。',
  };
  private pendingAdItemId: ItemId | null = null;
  private active = false;

  constructor(
    private readonly root: Node,
    private readonly assets: AssetStore,
    private readonly options: ShopScreenOptions,
  ) {}

  loadAndCreate(onReady?: () => void) {
    const paths = [
      'home/home_bg',
      'shop/sign_board',
      COMMON_UI_ASSETS.backButton,
      COMMON_UI_ASSETS.coinIcon,
      'shop/cat_shopkeeper',
      'shop/card_frame',
      'shop/badge_green',
      'shop/badge_blue',
      'shop/button_buy',
      'shop/button_ad',
      'shop/icon_hammer',
      'shop/icon_glove',
      'shop/icon_dice',
      'shop/icon_extra_slot',
      'shop/hint_ribbon',
    ];
    this.assets.loadImages(paths, () => {
      this.create();
      onReady?.();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.shopUI) return;
    this.shopUI.active = active;
    if (active) this.refresh();
  }

  destroy() {
    this.pendingAdItemId = null;
    this.itemViews.length = 0;
    this.shopUI?.destroy();
    this.shopUI = null;
  }

  private create() {
    if (this.shopUI) return;
    const visibleSize = view.getVisibleSize();
    const top = visibleSize.height / 2;
    const bottom = -visibleSize.height / 2;
    this.shopUI = new Node('ShopUI');
    this.root.addChild(this.shopUI);
    this.shopUI.active = this.active;
    this.image(this.shopUI, 'home/home_bg', 0, 0, visibleSize.width, visibleSize.height);
    this.addWarmVeil(visibleSize.width, visibleSize.height);

    this.buildHeader(top);
    const positions: Array<[number, number]> = [[-154, 110], [154, 110], [-154, -340], [154, -340]];
    ITEM_DEFINITIONS.forEach((definition, index) => {
      this.buildItemCard(definition, positions[index][0], positions[index][1]);
    });
    this.buildHintRibbon(bottom);
    this.refresh();
  }

  private buildHeader(top: number) {
    const y = top - 150;
    this.buildBackButton(-315, y);
    const chip = this.pill(
      this.shopUI!, 272, y, 170, 60, 30,
      new Color(255, 248, 226, 250), new Color(235, 205, 158),
    );
    this.image(chip, COMMON_UI_ASSETS.coinIcon, -55, 0, 42, 42);
    this.coinLabel = this.label(chip, '', 25, -1, 22, new Color(112, 69, 40));
    this.coinLabel.isBold = true;

    const sign = this.image(this.shopUI!, 'shop/sign_board', -15, top - 125, 368, 239);
    const title = this.label(sign, '道具商店', 0, -36, 36, new Color(111, 62, 28));
    title.isBold = true;
    // Added after the sign; sits low so only the ears tickle the ribbon's bottom edge.
    this.image(this.shopUI!, 'shop/cat_shopkeeper', -10, top - 262, 190, 165);
  }

  private buildBackButton(x: number, y: number) {
    const node = new Node('ShopBackButton');
    this.shopUI!.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(BACK_BUTTON_SIZE.hitWidth, BACK_BUTTON_SIZE.hitHeight);
    this.image(node, COMMON_UI_ASSETS.backButton, 0, 0, BACK_BUTTON_SIZE.visualWidth, BACK_BUTTON_SIZE.visualHeight);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.options.onReturnHome();
    });
  }

  private buildItemCard(definition: ItemDefinition, x: number, y: number) {
    const id = definition.id;
    const card = this.image(
      this.shopUI!,
      'shop/card_frame',
      x,
      y,
      288,
      430,
      { left: 44, right: 44, top: 44, bottom: 44 },
    );

    const badgeName = id === 'hammer' || id === 'dice' ? 'shop/badge_green' : 'shop/badge_blue';
    const badge = this.image(card, badgeName, 0, 98, 156, 156);
    const [iconWidth, iconHeight] = this.iconSizes[id];
    this.image(badge, 'shop/icon_' + id, 0, 0, iconWidth, iconHeight);

    // Chunky brown name bar with cream text, matching the reference card style.
    const bar = this.pill(card, 0, -16, 156, 42, 21, new Color(107, 74, 48));
    const title = this.label(bar, definition.name, 0, -1, 26, new Color(255, 248, 226));
    title.isBold = true;

    const description = this.label(card, this.descriptions[id], 0, -72, 20, new Color(136, 94, 63));
    description.lineHeight = 26;
    description.overflow = Label.Overflow.SHRINK;
    description.node.getComponent(UITransform)!.setContentSize(250, 52);

    const buttonNode = this.image(card, 'shop/button_buy', 0, -147, 236, 88);
    const buttonLabel = this.label(buttonNode, '', 30, 0, 24, new Color(150, 78, 20));
    buttonLabel.isBold = true;
    const button = buttonNode.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      void this.handleItemAction(id, definition.name);
    });

    const countTag = this.pill(
      card, 84, 158, 68, 30, 15,
      new Color(255, 248, 226, 235), new Color(235, 205, 158),
    );
    const countLabel = this.label(countTag, '', 0, -1, 15, new Color(136, 94, 63));
    countLabel.isBold = true;

    this.itemViews.push({
      id,
      countLabel,
      button,
      buttonLabel,
      buttonSprite: buttonNode.getComponent(Sprite),
    });
  }

  private pill(
    parent: Node,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: Color,
    stroke?: Color,
  ) {
    const node = new Node('Pill');
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    if (stroke) {
      graphics.lineWidth = 3;
      graphics.strokeColor = stroke;
    }
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    if (stroke) graphics.stroke();
    return node;
  }

  private buildHintRibbon(bottom: number) {
    const ribbon = this.image(this.shopUI!, 'shop/hint_ribbon', 0, bottom + 68, 380, 84);
    const hint = this.label(ribbon, '每种道具每天最多获取 5 次\n首次金币购买，之后观看广告', 0, 2, 16, new Color(136, 94, 63));
    hint.lineHeight = 22;
    hint.isBold = true;
  }

  private refresh() {
    if (!this.shopUI) return;
    if (this.coinLabel) this.coinLabel.string = `${this.options.getCoins()}`;
    this.itemViews.forEach(viewData => {
      const definition = ITEM_DEFINITIONS.find(item => item.id === viewData.id)!;
      const status = this.options.getShopItemStatus(viewData.id);
      const affordable = this.options.getCoins() >= definition.price;
      const atLimit = status.totalClaims >= status.maxClaims;
      const waitingOnThis = this.pendingAdItemId === viewData.id;
      const busy = this.pendingAdItemId !== null;
      const count = this.options.getItemCount(viewData.id);
      viewData.countLabel.string = `已有${count}`;
      viewData.button.interactable = definition.purchasable
        && !atLimit
        && !busy
        && (status.coinPurchased || affordable);
      viewData.buttonLabel.string = !definition.purchasable
        ? '未开放'
        : waitingOnThis
          ? '广告中...'
          : atLimit
            ? '明日再来'
            : status.coinPurchased
              ? '观看广告'
              : affordable ? `${definition.price}金币` : '金币不足';
      viewData.buttonLabel.color = !definition.purchasable || atLimit || waitingOnThis
        ? new Color(150, 137, 121)
        : !status.coinPurchased && !affordable
          ? new Color(190, 59, 51)
          : new Color(150, 78, 20);
      if (viewData.buttonSprite && status.coinPurchased && definition.purchasable) {
        const adFrame = this.assets.getFrame('shop/button_ad');
        if (adFrame) viewData.buttonSprite.spriteFrame = adFrame;
      }
    });
  }

  private async handleItemAction(id: ItemId, name: string) {
    if (this.pendingAdItemId !== null) return;
    const definition = ITEM_DEFINITIONS.find(item => item.id === id)!;
    const status = this.options.getShopItemStatus(id);
    if (!definition.purchasable || status.totalClaims >= status.maxClaims) {
      this.toast(!definition.purchasable ? '该道具还未开放' : '该道具今天已达到获取上限');
      return;
    }

    this.options.onPlaySound('click');
    if (!status.coinPurchased) {
      const success = this.options.onBuyItem(id);
      this.toast(success ? `${name}已放入背包` : '金币不足，暂时无法购买');
      this.refresh();
      return;
    }

    this.pendingAdItemId = id;
    this.toast('正在准备广告...');
    this.refresh();

    let result: RewardedAdResult;
    try {
      result = await this.options.onWatchAd();
    } catch (error) {
      console.error('[CatWorld] Rewarded ad callback failed', error);
      result = { completed: false, simulated: false };
    }
    if (this.pendingAdItemId !== id || !this.shopUI) return;

    this.pendingAdItemId = null;
    if (!result.completed) {
      this.toast('广告未完整观看，未获得道具');
      this.refresh();
      return;
    }

    const success = this.options.onClaimItemByAd(id);
    this.toast(success
      ? `${name}已放入背包${result.simulated ? '（预览模拟）' : ''}`
      : '该道具今天已达到获取上限');
    this.refresh();
  }

  private addWarmVeil(width: number, height: number) {
    const veil = new Node('WarmVeil');
    this.shopUI!.addChild(veil);
    veil.addComponent(UITransform).setContentSize(width, height);
    const graphics = veil.addComponent(Graphics);
    graphics.fillColor = new Color(255, 235, 188, 92);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }

  private image(
    parent: Node,
    path: string,
    x: number,
    y: number,
    width: number,
    height: number,
    insets?: { left: number; right: number; top: number; bottom: number },
  ) {
    const node = new Node(path.replace(/\//g, '_'));
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const frame = this.assets.getFrame(path);
    if (frame) {
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
      if (insets) {
        const slicedFrame = frame as any;
        slicedFrame.insetLeft = insets.left;
        slicedFrame.insetRight = insets.right;
        slicedFrame.insetTop = insets.top;
        slicedFrame.insetBottom = insets.bottom;
        sprite.type = Sprite.Type.SLICED;
      }
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
    if (!this.shopUI) return;
    const bottom = -view.getVisibleSize().height / 2;
    Toast.show(this.shopUI, text, { y: bottom + 235 });
  }
}
