import { AudioClip, AudioSource, Node, resources, sys } from 'cc';

export type AudioEffect = 'click' | 'collect' | 'match' | 'win' | 'fail';

type AudioSettings = {
  musicEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
};

const SETTINGS_KEY = 'cat-world-audio-settings-v1';
const AUDIO_NAMES = ['bgm', 'click', 'collect', 'match', 'win', 'fail'] as const;

type WxVibrateApi = {
  vibrateShort?: (options?: { type?: string; fail?: () => void }) => void;
  vibrateLong?: () => void;
};

export class AudioManager {
  private readonly musicSource: AudioSource;
  private readonly effectSource: AudioSource;
  private readonly clips: Partial<Record<typeof AUDIO_NAMES[number], AudioClip>> = {};
  private musicEnabled = true;
  private soundEnabled = true;
  private vibrationEnabled = true;
  private musicPlaying = false;

  constructor(parent: Node) {
    this.loadSettings();

    const musicNode = new Node('BackgroundMusic');
    parent.addChild(musicNode);
    this.musicSource = musicNode.addComponent(AudioSource);
    this.musicSource.playOnAwake = false;
    this.musicSource.loop = true;
    this.musicSource.volume = 0.28;

    const effectNode = new Node('SoundEffects');
    parent.addChild(effectNode);
    this.effectSource = effectNode.addComponent(AudioSource);
    this.effectSource.playOnAwake = false;
    this.effectSource.volume = 0.85;
  }

  load() {
    const paths = AUDIO_NAMES.map(name => `audio/${name}`);
    resources.load(paths, AudioClip, (error, assets) => {
      if (error || !assets) {
        console.error('[CatWorld] Failed to load audio assets', error);
        return;
      }
      (assets as AudioClip[]).forEach((clip, index) => {
        if (clip) this.clips[AUDIO_NAMES[index]] = clip;
      });
      this.applyMusic();
    });
  }

  getMusicEnabled() {
    return this.musicEnabled;
  }

  getSoundEnabled() {
    return this.soundEnabled;
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    this.saveSettings();
    this.applyMusic();
  }

  setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    this.saveSettings();
  }

  getVibrationEnabled() {
    return this.vibrationEnabled;
  }

  setVibrationEnabled(enabled: boolean) {
    this.vibrationEnabled = enabled;
    this.saveSettings();
    // 开启时立刻给一次短震动，让玩家当场感知到开关生效。
    if (enabled) this.vibrate();
  }

  // 震动反馈入口：微信小游戏走 wx.vibrateShort，编辑器/网页预览没有 wx 时静默跳过。
  vibrate() {
    if (!this.vibrationEnabled) return;
    const wxApi = (globalThis as { wx?: WxVibrateApi }).wx;
    if (!wxApi?.vibrateShort) return;
    try {
      wxApi.vibrateShort({ type: 'light', fail: () => wxApi.vibrateLong?.() });
    } catch (error) {
      console.error('[CatWorld] Failed to vibrate', error);
    }
  }

  playEffect(effect: AudioEffect) {
    if (!this.soundEnabled) return;
    // 产品决定：按钮点击不发声，只保留玩法音效（收卡/三消/胜负）。
    // 各页面 onPlaySound('click') 调用点保留不动，在这里统一静音。
    if (effect === 'click') return;
    const clip = this.clips[effect];
    if (clip) this.effectSource.playOneShot(clip);
  }

  private applyMusic() {
    if (this.musicEnabled) {
      const clip = this.clips.bgm;
      if (clip && !this.musicPlaying) {
        this.musicSource.clip = clip;
        this.musicSource.play();
        this.musicPlaying = true;
      }
      return;
    }
    if (this.musicPlaying) {
      this.musicSource.stop();
      this.musicPlaying = false;
    }
  }

  private loadSettings() {
    try {
      const serialized = sys.localStorage.getItem(SETTINGS_KEY);
      if (!serialized) return;
      const settings = JSON.parse(serialized) as Partial<AudioSettings>;
      if (typeof settings.musicEnabled === 'boolean') this.musicEnabled = settings.musicEnabled;
      if (typeof settings.soundEnabled === 'boolean') this.soundEnabled = settings.soundEnabled;
      if (typeof settings.vibrationEnabled === 'boolean') this.vibrationEnabled = settings.vibrationEnabled;
    } catch (error) {
      console.error('[CatWorld] Failed to load audio settings', error);
    }
  }

  private saveSettings() {
    try {
    const settings: AudioSettings = {
      musicEnabled: this.musicEnabled,
      soundEnabled: this.soundEnabled,
      vibrationEnabled: this.vibrationEnabled,
    };
      sys.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('[CatWorld] Failed to save audio settings', error);
    }
  }
}
