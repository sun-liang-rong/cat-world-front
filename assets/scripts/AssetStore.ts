import { assetManager, AssetManager, ImageAsset, resources, SpriteFrame, Texture2D } from 'cc';

// Shared visual resources keep the same currency, star, and back affordances
// across every screen. The coin HUD is a complete chip and already includes
// its own add button artwork; the other entries are standalone icons.
export const COMMON_UI_ASSETS = {
  backButton: 'adventure/adventure_back',
  coinIcon: 'tasks/daily_coin',
  starIcon: 'tasks/daily_star',
  coinHud: 'home_top_crops/paw',
} as const;

export const BACK_BUTTON_SIZE = {
  visualWidth: 84,
  visualHeight: 85,
  hitWidth: 108,
  hitHeight: 108,
} as const;

// 微信小游戏右上角胶囊（「···」和关闭）在 750 宽设计稿上大约占顶部 155px。
// 首页设置按钮再下移 20px 后，热区顶边正好让开这块区域；右上角可点控件都按这条线避让。
export const WECHAT_CAPSULE_INSET = 155;

export function belowWeChatCapsule(top: number, height: number) {
  return top - WECHAT_CAPSULE_INSET - height / 2;
}

export class AssetStore {
  private readonly frames: Record<string, SpriteFrame> = {};
  private readonly pending = new Map<string, Array<() => void>>();
  private readonly bundlePending = new Map<string, Array<(bundle: AssetManager.Bundle | null) => void>>();
  // 资源归属：path -> 请求过它的 owner 集合。用于按页释放（releaseOwner）。
  // 没有 owner 的加载（首页/关卡的预加载）视为常驻，永不释放。
  private readonly owners = new Map<string, Set<object>>();
  // 被「无归属」加载过的路径 = 常驻资源，releaseOwner 绝不能销毁它们。
  // 这一点必须有：home/home_bg 这类图既被 Main 常驻预加载，又出现在多个页面的清单里，
  // 若只看 owner 集合，页面被淘汰时会把它一起销毁，导致首页/游戏页背景变空白。
  private readonly permanentPaths = new Set<string>();
  // 保留 ImageAsset 引用，释放时才能让 assetManager 真正回收 CPU 侧图像数据。
  private readonly imageAssets = new Map<string, ImageAsset>();

  loadImages(paths: string[], onComplete: () => void, onProgress?: (loaded: number, total: number) => void) {
    this.loadImagesWith(paths, onComplete, onProgress, (path, callback) => {
      resources.load(path, ImageAsset, callback);
    });
  }

  /** 带归属的加载：owner 释放时这些图片会被回收（没有其他 owner 引用的话）。 */
  loadImagesFor(owner: object, paths: string[], onComplete: () => void) {
    this.loadImagesWith(paths, onComplete, undefined, (path, callback) => {
      resources.load(path, ImageAsset, callback);
    }, owner);
  }

  /**
   * 释放某个 owner 加载的图片。仅当某张图不再被任何 owner 引用时才真正销毁；
   * 被多个页面共用（或被无 owner 的常驻加载占用）的图片会保留。
   */
  releaseOwner(owner: object) {
    this.owners.forEach((set, path) => {
      if (!set.delete(owner)) return;
      if (set.size > 0) return;
      this.owners.delete(path);
      if (this.permanentPaths.has(path)) return;
      this.destroyFrame(path);
    });
  }

  private destroyFrame(path: string) {
    const frame = this.frames[path];
    if (frame) {
      delete this.frames[path];
      const texture = frame.texture;
      frame.decRef();
      if (frame.isValid) frame.destroy();
      if (texture?.isValid) texture.destroy();
    }
    const image = this.imageAssets.get(path);
    if (image) {
      this.imageAssets.delete(path);
      assetManager.releaseAsset(image);
    }
  }

  private retain(paths: string[], owner: object) {
    paths.forEach(path => {
      let set = this.owners.get(path);
      if (!set) {
        set = new Set<object>();
        this.owners.set(path, set);
      }
      set.add(owner);
    });
  }

  loadImagesFromBundle(
    bundleName: string,
    paths: string[],
    onComplete: () => void,
    onProgress?: (loaded: number, total: number) => void,
  ) {
    const missing = Array.from(new Set(paths)).filter(path => !this.frames[path]);
    if (missing.length === 0) {
      onComplete();
      return;
    }

    this.ensureBundle(bundleName, bundle => {
      this.loadImagesWith(paths, onComplete, onProgress, (path, callback) => {
        if (!bundle) {
          callback(new Error(`Bundle not available: ${bundleName}`), null);
          return;
        }
        bundle.load(path, ImageAsset, callback);
      });
    });
  }

  getFrame(path: string) {
    return this.frames[path];
  }

  private loadImagesWith(
    paths: string[],
    onComplete: () => void,
    onProgress: ((loaded: number, total: number) => void) | undefined,
    load: (
      path: string,
      callback: (error: Error | null, asset: ImageAsset | null) => void,
    ) => void,
    owner?: object,
  ) {
    // 归属必须对「本次请求的全部路径」登记，而不只是本次真正发起下载的那些：
    // 若某张图已被别人缓存，这里也要记上本 owner，否则别人释放时会把它销毁。
    if (owner) {
      this.retain(paths, owner);
    } else {
      // 无归属加载 = 常驻，登记后 releaseOwner 不会回收它。
      paths.forEach(path => this.permanentPaths.add(path));
    }

    const missing = Array.from(new Set(paths)).filter(path => !this.frames[path]);
    if (missing.length === 0) {
      onComplete();
      return;
    }

    let loaded = 0;
    let completed = false;
    const settlePath = () => {
      loaded += 1;
      onProgress?.(loaded, missing.length);
      if (loaded === missing.length && !completed) {
        completed = true;
        onComplete();
      }
    };

    const pathsToLoad: string[] = [];
    missing.forEach(path => {
      const waiters = this.pending.get(path);
      if (waiters) {
        waiters.push(settlePath);
        return;
      }
      this.pending.set(path, [settlePath]);
      pathsToLoad.push(path);
    });

    pathsToLoad.forEach(path => {
      load(path, (error, asset) => {
        if (!error && asset) {
          this.frames[path] = this.createFrame(asset);
          this.imageAssets.set(path, asset);
        } else if (error) {
          console.error('[CatWorld] Failed to load image asset', path, error);
        }
        const waiters = this.pending.get(path) || [];
        this.pending.delete(path);
        waiters.forEach(waiter => waiter());
      });
    });
  }

  private ensureBundle(bundleName: string, onComplete: (bundle: AssetManager.Bundle | null) => void) {
    const existing = assetManager.getBundle(bundleName);
    if (existing) {
      onComplete(existing);
      return;
    }

    const waiters = this.bundlePending.get(bundleName);
    if (waiters) {
      waiters.push(onComplete);
      return;
    }

    this.bundlePending.set(bundleName, [onComplete]);
    assetManager.loadBundle(bundleName, (error, bundle) => {
      if (error || !bundle) {
        console.error('[CatWorld] Failed to load asset bundle', bundleName, error);
      }
      const callbacks = this.bundlePending.get(bundleName) || [];
      this.bundlePending.delete(bundleName);
      callbacks.forEach(callback => callback(error || !bundle ? null : bundle));
    });
  }

  private createFrame(asset: ImageAsset) {
    const texture = new Texture2D();
    texture.image = asset;
    const frame = new SpriteFrame();
    frame.texture = texture;
    // 缓存自己持有一份引用：微信小游戏在节点 active=false 时会拆掉 Sprite 的渲染数据，
    // 若缓存不占引用，GPU 贴图会被回收，返回首页时只剩黑色清空色。
    frame.addRef();
    return frame;
  }
}
