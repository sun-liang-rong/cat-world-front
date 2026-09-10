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
  maxConcurrentTweens: number;  // 最大同时运行的动画数
  animationDuration: number;     // 动画时长倍数（低端设备缩短）
  particleLimit: number;         // 粒子数量限制
  enableShadows: boolean;        // 是否启用阴影
  targetFPS: number;             // 目标帧率
  batchDelay: number;            // 批次延迟（ms）
}

/**
 * 性能管理器
 */
export class PerformanceManager {
  private static instance: PerformanceManager;
  private config: PerformanceConfig;
  private frameCount = 0;
  private lastTime = 0;
  private fps = 60;
  private fpsHistory: number[] = [];

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
      maxConcurrentTweens: 20,
      animationDuration: 0.7,  // 动画缩短30%
      particleLimit: 10,
      enableShadows: false,
      targetFPS: 30,
      batchDelay: 40,
    };
  }

  private getMediumEndConfig(): PerformanceConfig {
    return {
      tier: DeviceTier.MEDIUM,
      maxConcurrentTweens: 40,
      animationDuration: 0.85,  // 动画缩短15%
      particleLimit: 20,
      enableShadows: true,
      targetFPS: 45,
      batchDelay: 28,
    };
  }

  private getHighEndConfig(): PerformanceConfig {
    return {
      tier: DeviceTier.HIGH,
      maxConcurrentTweens: 80,
      animationDuration: 1.0,  // 正常速度
      particleLimit: 40,
      enableShadows: true,
      targetFPS: 60,
      batchDelay: 20,
    };
  }

  /**
   * 更新 FPS 统计
   */
  updateFPS(deltaTime: number): void {
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = now;

      // 记录 FPS 历史
      this.fpsHistory.push(this.fps);
      if (this.fpsHistory.length > 10) {
        this.fpsHistory.shift();
      }

      // 如果 FPS 持续低于目标，降级配置
      this.autoAdjustConfig();
    }
  }

  /**
   * 自动调整配置
   */
  private autoAdjustConfig(): void {
    if (this.fpsHistory.length < 5) return;

    const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    // 如果平均 FPS 低于目标的 80%，降级
    if (avgFPS < this.config.targetFPS * 0.8) {
      if (this.config.tier === DeviceTier.HIGH) {
        console.warn('[Performance] 降级到中端配置');
        this.config = this.getMediumEndConfig();
      } else if (this.config.tier === DeviceTier.MEDIUM) {
        console.warn('[Performance] 降级到低端配置');
        this.config = this.getLowEndConfig();
      }
      this.fpsHistory.length = 0;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * 获取当前 FPS
   */
  getFPS(): number {
    return this.fps;
  }

  /**
   * 根据性能调整动画时长
   */
  adjustDuration(duration: number): number {
    return duration * this.config.animationDuration;
  }

  /**
   * 根据性能调整延迟
   */
  adjustDelay(delay: number): number {
    return delay * this.config.animationDuration;
  }

  /**
   * 是否应该跳过某个动画
   */
  shouldSkipAnimation(priority: 'low' | 'medium' | 'high' = 'medium'): boolean {
    if (this.config.tier === DeviceTier.LOW) {
      return priority === 'low';
    }
    return false;
  }
}
