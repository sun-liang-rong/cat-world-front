import {
  _decorator,
  BlockInputEvents,
  Button,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  Sprite,
  SpriteFrame,
  Tween,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
  view,
} from 'cc';
import { AssetStore } from './AssetStore';
import { AudioEffect } from './AudioManager';

const { ccclass } = _decorator;

// 帧图与首页 preloadOverlays 的预载清单对应（home_settings/*），AssetStore 全局缓存共享；
// 未预载完成时弹窗会自行 loadImages 兜底，缺图路径均有纯 Graphics 回退。
// 开关不使用贴图：滑块动画和配色由 Graphics 实时绘制，跟随全局奶油色板。
const FRAME_PATHS = {
  popupPanel: 'home_settings/popup_panel',
  btnClose: 'home_settings/btn_close',
  rowCard: 'home_settings/row_card',
  iconTile: 'home_settings/icon_tile',
  iconMusic: 'home_settings/icon_music',
  iconSound: 'home_settings/icon_sound',
  iconVibrate: 'home_settings/icon_vibrate',
} as const;

export interface SettingsPopupOptions {
  getMusicEnabled: () => boolean;
  getSoundEnabled: () => boolean;
  getVibrationEnabled: () => boolean;
  onMusicChanged: (enabled: boolean) => void;
  onSoundChanged: (enabled: boolean) => void;
  onVibrationChanged: (enabled: boolean) => void;
  onPlaySound: (effect: AudioEffect) => void;
  onClose?: () => void;
}

type FrameKey = keyof typeof FRAME_PATHS;

// 可复用设置弹窗（音乐 / 音效 / 震动），模式对齐 SettlementPopup：
// static open 挂到任意父节点，开关回调由宿主注入；首页与关卡页共用同一实现。
@ccclass('SettingsPopup')
export class SettingsPopup extends Component {
  private options!: SettingsPopupOptions;
  private frames: Partial<Record<FrameKey, SpriteFrame>> = {};
  private musicToggle: Node | null = null;
  private soundToggle: Node | null = null;
  private vibrationToggle: Node | null = null;

  public static open(parent: Node, assets: AssetStore, options: SettingsPopupOptions) {
    const node = new Node('SettingsPopup');
    parent.addChild(node);
    const popup = node.addComponent(SettingsPopup);
    popup.setup(assets, options);
    return popup;
  }

  public close() {
    // 组件的 node 在销毁完成后会被引擎置空；宿主可能拿着残留引用再次 close，必须判空
    const node = this.node as Node | null;
    if (node && node.isValid) node.destroy();
    const onClose = this.options?.onClose;
    this.options = { ...this.options, onClose: undefined };
    onClose?.();
  }

  private setup(assets: AssetStore, options: SettingsPopupOptions) {
    this.options = options;
    this.buildBackdrop();
    assets.loadImages(Object.values(FRAME_PATHS), () => {
      if (!this.node.isValid) return;
      Object.keys(FRAME_PATHS).forEach(key => {
        const frame = assets.getFrame(FRAME_PATHS[key as FrameKey]);
        if (frame) this.frames[key as FrameKey] = frame;
      });
      this.buildContent();
    });
  }

  private buildBackdrop() {
    const size = view.getVisibleSize();
    const backdrop = new Node('SettingsBackdrop');
    this.node.addChild(backdrop);
    backdrop.addComponent(UITransform).setContentSize(size.width, size.height);
    const graphics = backdrop.addComponent(Graphics);
    graphics.fillColor = new Color(22, 18, 13, 150);
    graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    graphics.fill();
    backdrop.addComponent(BlockInputEvents);
    backdrop.on(Node.EventType.TOUCH_END, () => this.close());
    const opacity = backdrop.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(opacity).to(0.2, { opacity: 255 }).start();
  }

  private buildContent() {
    this.buildShadow();
    const panel = this.buildPanel();
    this.buildHeader(panel);
    this.buildSettingRow(panel, '音乐', '背景音乐', 'iconMusic', 43, 88, 'music');
    this.buildSettingRow(panel, '音效', '互动音效', 'iconSound', 44, -32, 'sound');
    this.buildSettingRow(panel, '震动', '震动反馈', 'iconVibrate', 44, -152, 'vibration');
    this.buildFooter(panel);
    this.refreshSettingRows();
  }

  private buildShadow() {
    const shadow = new Node('SettingsShadow');
    this.node.addChild(shadow);
    shadow.setPosition(0, 2);
    shadow.addComponent(UITransform).setContentSize(592, 532);
    const graphics = shadow.addComponent(Graphics);
    graphics.fillColor = new Color(69, 48, 29, 82);
    graphics.roundRect(-296, -266, 592, 532, 40);
    graphics.fill();
  }

  private buildPanel() {
    const panel = new Node('SettingsPanel');
    this.node.addChild(panel);
    panel.setPosition(0, 26);
    panel.addComponent(UITransform).setContentSize(580, 520);
    const panelFrame = this.frames.popupPanel;
    if (panelFrame) {
      this.applySliceInsets(panelFrame, 80, 80);
      const sprite = panel.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.type = Sprite.Type.SLICED;
      sprite.spriteFrame = panelFrame;
    } else {
      const graphics = panel.addComponent(Graphics);
      graphics.fillColor = new Color(255, 247, 224);
      graphics.strokeColor = new Color(205, 165, 102);
      graphics.lineWidth = 4;
      graphics.roundRect(-290, -260, 580, 520, 38);
      graphics.fill();
      graphics.stroke();
    }
    panel.addComponent(BlockInputEvents);
    const opacity = panel.addComponent(UIOpacity);
    opacity.opacity = 0;
    tween(opacity).to(0.22, { opacity: 255 }).start();
    panel.setScale(new Vec3(0.9, 0.9, 1));
    tween(panel)
      .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    return panel;
  }

  private buildHeader(panel: Node) {
    const title = this.label(panel, '设置', 0, 218, 30, new Color(100, 69, 43));
    title.isBold = true;
    // 副标题做成暖黄小徽章，替代原先游离的绿色文字，与全局奶油色板保持一致
    const badge = new Node('SettingsSubtitleBadge');
    panel.addChild(badge);
    badge.setPosition(0, 176);
    badge.addComponent(UITransform).setContentSize(104, 30);
    const badgeGraphics = badge.addComponent(Graphics);
    badgeGraphics.fillColor = new Color(255, 224, 108, 235);
    badgeGraphics.strokeColor = new Color(235, 205, 158, 255);
    badgeGraphics.lineWidth = 2;
    badgeGraphics.roundRect(-52, -15, 104, 30, 12);
    badgeGraphics.fill();
    badgeGraphics.stroke();
    const badgeLabel = this.label(badge, '小镇偏好', 0, 0, 16, new Color(112, 69, 40));
    badgeLabel.isBold = true;

    const close = this.spriteNode(panel, 'SettingsClose', this.frames.btnClose, 240, 216, 88, 88);
    if (!this.frames.btnClose) {
      const fallback = close.addComponent(Graphics);
      fallback.fillColor = new Color(91, 53, 34, 60);
      fallback.ellipse(2, -4, 38, 38);
      fallback.fill();
      fallback.lineWidth = 3;
      fallback.strokeColor = new Color(255, 250, 229);
      fallback.fillColor = new Color(244, 103, 92);
      fallback.ellipse(0, 2, 38, 38);
      fallback.fill();
      fallback.stroke();
      fallback.lineWidth = 6;
      fallback.strokeColor = new Color(255, 250, 236);
      fallback.moveTo(-15, 16);
      fallback.lineTo(15, -13);
      fallback.moveTo(15, 16);
      fallback.lineTo(-15, -13);
      fallback.stroke();
    }
    const closeButton = close.addComponent(Button);
    closeButton.transition = Button.Transition.SCALE;
    closeButton.zoomScale = 0.93;
    closeButton.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      this.close();
    });
  }

  private buildSettingRow(
    panel: Node,
    name: string,
    caption: string,
    iconKey: FrameKey,
    iconSize: number,
    y: number,
    kind: 'music' | 'sound' | 'vibration',
  ) {
    const row = this.spriteNode(panel, `${name}Row`, this.frames.rowCard, 0, y, 528, 104, 48, 44);
    if (!this.frames.rowCard) {
      const fallback = row.addComponent(Graphics);
      fallback.fillColor = new Color(255, 252, 241);
      fallback.strokeColor = new Color(239, 215, 175);
      fallback.lineWidth = 3;
      fallback.roundRect(-264, -52, 528, 104, 25);
      fallback.fill();
      fallback.stroke();
    }

    const tile = this.spriteNode(row, `${name}IconTile`, this.frames.iconTile, -208, 0, 72, 72);
    if (!this.frames.iconTile) {
      const fallback = tile.addComponent(Graphics);
      fallback.fillColor = new Color(255, 237, 204);
      fallback.strokeColor = new Color(241, 202, 145);
      fallback.lineWidth = 2;
      fallback.roundRect(-36, -36, 72, 72, 18);
      fallback.fill();
      fallback.stroke();
    }
    const iconFrame = this.frames[iconKey];
    if (iconFrame) {
      this.spriteNode(tile, `${name}Icon`, iconFrame, 0, 0, iconSize, iconSize);
    }

    const titleLabel = this.label(row, name, -104, 10, 24, new Color(100, 69, 43));
    titleLabel.isBold = true;
    const captionLabel = this.label(row, caption, -104, -20, 17, new Color(172, 143, 104));
    captionLabel.isBold = true;

    // 开关整体用代码绘制：暖黄=开 / 灰褐=关，旋钮可滑动，不依赖开关贴图
    const toggle = new Node(`${name}Toggle`);
    row.addChild(toggle);
    toggle.setPosition(174, 0);
    toggle.addComponent(UITransform).setContentSize(132, 72);
    const track = new Node('ToggleTrack');
    toggle.addChild(track);
    track.addComponent(UITransform).setContentSize(132, 72);
    track.addComponent(Graphics);
    const knob = new Node('ToggleKnob');
    toggle.addChild(knob);
    knob.addComponent(UITransform).setContentSize(56, 56);
    const knobGraphics = knob.addComponent(Graphics);
    knobGraphics.fillColor = new Color(96, 62, 36, 48);
    knobGraphics.ellipse(2, -4, 25, 25);
    knobGraphics.fill();
    knobGraphics.fillColor = new Color(255, 250, 234);
    knobGraphics.strokeColor = new Color(247, 225, 179);
    knobGraphics.lineWidth = 2;
    knobGraphics.ellipse(0, 2, 26, 26);
    knobGraphics.fill();
    knobGraphics.stroke();

    const button = toggle.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.93;
    button.node.on(Button.EventType.CLICK, () => {
      this.options.onPlaySound('click');
      if (kind === 'music') this.options.onMusicChanged(!this.options.getMusicEnabled());
      else if (kind === 'sound') this.options.onSoundChanged(!this.options.getSoundEnabled());
      else this.options.onVibrationChanged(!this.options.getVibrationEnabled());
      this.animateToggle(toggle, this.getSettingEnabled(kind));
    });
    if (kind === 'music') this.musicToggle = toggle;
    else if (kind === 'sound') this.soundToggle = toggle;
    else this.vibrationToggle = toggle;
  }

  private buildFooter(panel: Node) {
    const rule = new Node('SettingsFooterRule');
    panel.addChild(rule);
    rule.setPosition(0, -226);
    const graphics = rule.addComponent(Graphics);
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(235, 215, 180, 190);
    graphics.moveTo(-170, 0);
    graphics.lineTo(170, 0);
    graphics.stroke();
    const footer = this.label(panel, '猫爪星球奇遇记', 0, -240, 17, new Color(181, 147, 96));
    footer.isBold = true;
  }

  private refreshSettingRows() {
    this.refreshToggle(this.musicToggle, this.options.getMusicEnabled());
    this.refreshToggle(this.soundToggle, this.options.getSoundEnabled());
    this.refreshToggle(this.vibrationToggle, this.options.getVibrationEnabled());
  }

  private getSettingEnabled(kind: 'music' | 'sound' | 'vibration') {
    if (kind === 'music') return this.options.getMusicEnabled();
    if (kind === 'sound') return this.options.getSoundEnabled();
    return this.options.getVibrationEnabled();
  }

  private refreshToggle(toggle: Node | null, enabled: boolean) {
    if (!toggle) return;
    this.drawToggleTrack(toggle, enabled);
    const knob = toggle.getChildByName('ToggleKnob');
    knob?.setPosition(enabled ? 32 : -32, 0);
  }

  // 点击后只重绘当前开关的底色，旋钮从当前位置滑到目标侧，动画期间连点也顺滑
  private animateToggle(toggle: Node, enabled: boolean) {
    this.drawToggleTrack(toggle, enabled);
    const knob = toggle.getChildByName('ToggleKnob');
    if (!knob) return;
    Tween.stopAllByTarget(knob);
    tween(knob)
      .to(0.16, { position: new Vec3(enabled ? 32 : -32, 0, 0) }, { easing: 'backOut' })
      .start();
  }

  private drawToggleTrack(toggle: Node, enabled: boolean) {
    const track = toggle.getChildByName('ToggleTrack');
    const graphics = track?.getComponent(Graphics);
    if (!graphics) return;
    graphics.clear();
    graphics.lineWidth = 3;
    graphics.fillColor = enabled ? new Color(255, 224, 108) : new Color(216, 199, 170);
    graphics.strokeColor = enabled ? new Color(238, 186, 96) : new Color(184, 164, 133);
    graphics.roundRect(-66, -36, 132, 72, 36);
    graphics.fill();
    graphics.stroke();
  }

  private spriteNode(
    parent: Node,
    name: string,
    frame: SpriteFrame | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
    sliceHorizontal = 0,
    sliceVertical = sliceHorizontal,
  ) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    if (frame) {
      if (sliceHorizontal > 0) this.applySliceInsets(frame, sliceHorizontal, sliceVertical);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.type = sliceHorizontal > 0 ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
      sprite.spriteFrame = frame;
    }
    return node;
  }

  private applySliceInsets(frame: SpriteFrame, horizontal: number, vertical: number) {
    frame.insetLeft = horizontal;
    frame.insetRight = horizontal;
    frame.insetTop = vertical;
    frame.insetBottom = vertical;
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
    return label;
  }
}
