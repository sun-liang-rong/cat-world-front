declare module 'cc' {
  export const sys: {
    platform: number;
    isBrowser: boolean;
    Platform: { WECHAT_GAME: number };
    localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
    };
  };

  export class ImageAsset {}
  export class Texture2D {
    image: ImageAsset | null;
    isValid: boolean;
    destroy(): void;
  }
  export class SpriteFrame {
    texture: Texture2D | null;
    isValid: boolean;
    addRef(): void;
    decRef(): void;
    destroy(): void;
  }

  export namespace AssetManager {
    class Bundle {
      load(
        path: string,
        type: typeof ImageAsset,
        callback: (error: Error | null, asset?: ImageAsset) => void,
      ): void;
    }
  }

  export const assetManager: {
    getBundle(name: string): AssetManager.Bundle | null;
    loadBundle(name: string, callback: (error: Error | null, bundle?: AssetManager.Bundle) => void): void;
    releaseAsset(asset: ImageAsset): void;
  };

  export const resources: {
    load(
      path: string,
      type: typeof ImageAsset,
      callback: (error: Error | null, asset?: ImageAsset) => void,
    ): void;
  };
}

declare const process: {
  stdout: { write(value: string): void };
};


declare module 'cc/env' {
  export const HTML5: boolean;
  export const MINIGAME: boolean;
  export const PREVIEW: boolean;
  export const WECHAT: boolean;
}
