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

export class AssetStore {
  private readonly frames: Record<string, SpriteFrame> = {};
  private readonly pending = new Map<string, Array<() => void>>();
  private readonly bundlePending = new Map<string, Array<(bundle: AssetManager.Bundle | null) => void>>();

  loadImages(paths: string[], onComplete: () => void, onProgress?: (loaded: number, total: number) => void) {
    this.loadImagesWith(paths, onComplete, onProgress, (path, callback) => {
      resources.load(path, ImageAsset, callback);
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
  ) {
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
    return frame;
  }
}
