import { sys } from 'cc';

/**
 * 设备性能等级
 */
export enum DeviceTier {
  LOW = 'low',      // 低端设备
  MEDIUM = 'medium', // 中端设备
  HIGH = 'high',     // 高端设备
}

/**
 * 性能配置
 */
export interface PerformanceConfig {
  tier: DeviceTier;
  animationDuration: number;     // 动画时长倍数（低端设备缩短）
  batchDelay: number;            // 批次延迟（ms）
}

/**
 * 性能管理器：启动时按机型定一次档，之后只提供动画时长/批次延迟的缩放。
 *
 * 说明：早期版本还带一套「按 FPS 自动降级」的逻辑（updateFPS / autoAdjustConfig /
 * getFPS / adjustDelay / shouldSkipAnimation），但工程里没有任何逐帧 update() 去驱动
 * 它（全工程只有 Main / SettlementPopup / LoadingOverlay 三个 Component，都没有
 * update），整条链路从未生效，只会造成「低端机已有降级保护」的错觉，已移除。
 * 配置里同样从未被读取的 maxConcurrentTweens / particleLimit / enableShadows /
 * targetFPS 一并删除。
 */
export class PerformanceManager {
  private static instance: PerformanceManager;
  private config: PerformanceConfig;

  private constructor() {
    this.config = this.detectDeviceConfig();
  }

  static getInstance(): PerformanceManager {
    if (!PerformanceManager.instance) {
      PerformanceManager.instance = new PerformanceManager();
    }
    return PerformanceManager.instance;
  }

  /**
   * 检测设备性能等级
   */
  private detectDeviceConfig(): PerformanceConfig {
    const platform = sys.platform;
    const os = sys.os;
    const browserType = sys.browserType;

    // 微信小游戏环境
    if (platform === sys.Platform.WECHAT_GAME) {
      const systemInfo = (sys as any).wx?.getSystemInfoSync?.();
      if (systemInfo) {
        const { model, platform: wechatPlatform } = systemInfo;
        // 根据机型判断
        if (this.isLowEndDevice(model, wechatPlatform)) {
          return this.getLowEndConfig();
        } else if (this.isHighEndDevice(model, wechatPlatform)) {
          return this.getHighEndConfig();
        }
      }
      // 默认中端
      return this.getMediumEndConfig();
    }

    // 移动端浏览器
    if (sys.isMobile) {
      // iOS 设备通常性能较好
      if (os === sys.OS.IOS) {
        return this.getHighEndConfig();
      }
      // Android 设备默认中端
      return this.getMediumEndConfig();
    }

    // 桌面浏览器（开发环境）
    return this.getHighEndConfig();
  }

  private isLowEndDevice(model: string, platform: string): boolean {
    const lowEndKeywords = [
      'redmi 4', 'redmi 5', 'redmi 6',
      'mi a1', 'mi a2',
      'iphone 6', 'iphone 7',
      'oppo a', 'vivo y',
      'android 6', 'android 7',
    ];
    const modelLower = model.toLowerCase();
    return lowEndKeywords.some(keyword => modelLower.includes(keyword));
  }

  private isHighEndDevice(model: string, platform: string): boolean {
    const highEndKeywords = [
      'iphone 13', 'iphone 14', 'iphone 15',
      'mi 12', 'mi 13', 'xiaomi 12', 'xiaomi 13',
      'oneplus', 'oppo find', 'vivo x',
      'samsung galaxy s2', 'samsung galaxy s3',
    ];
    const modelLower = model.toLowerCase();
    return highEndKeywords.some(keyword => modelLower.includes(keyword));
  }

  private getLowEndConfig(): PerformanceConfig {
    return {
      tier: DeviceTier.LOW,
      animationDuration: 0.7,  // 动画缩短30%
      batchDelay: 40,
    };
  }

  private getMediumEndConfig(): PerformanceConfig {
    return {
      tier: DeviceTier.MEDIUM,
      animationDuration: 0.85,  // 动画缩短15%
      batchDelay: 28,
    };
  }

  private getHighEndConfig(): PerformanceConfig {
    return {
      tier: DeviceTier.HIGH,
      animationDuration: 1.0,  // 正常速度
      batchDelay: 20,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * 根据性能调整动画时长
   */
  adjustDuration(duration: number): number {
    return duration * this.config.animationDuration;
  }
}
