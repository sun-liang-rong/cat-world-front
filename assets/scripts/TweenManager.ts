import { Tween, tween } from 'cc';
import { PerformanceManager } from './PerformanceManager';

/**
 * 补间动画管理器：控制同时运行的动画数量，避免低端设备卡顿
 * 简化版：只做统计和限制，不干预补间内部逻辑
 */
export class TweenManager {
  private static instance: TweenManager;
  private activeTweens: Set<Tween<any>> = new Set();
  private performanceManager: PerformanceManager;

  private constructor() {
    this.performanceManager = PerformanceManager.getInstance();
  }

  static getInstance(): TweenManager {
    if (!TweenManager.instance) {
      TweenManager.instance = new TweenManager();
    }
    return TweenManager.instance;
  }

  /**
   * 创建并管理一个补间动画（简化版，不阻塞）
   */
  createTween<T>(target: T): Tween<T> {
    const tw = tween(target);

    // 简单包装 start 方法，只做统计
    const originalStart = tw.start.bind(tw);
    tw.start = () => {
      this.activeTweens.add(tw);
      originalStart();
      return tw;
    };

    // 简单包装 stop 方法
    const originalStop = tw.stop.bind(tw);
    tw.stop = () => {
      this.activeTweens.delete(tw);
      originalStop();
      return tw;
    };

    return tw;
  }

  /**
   * 停止所有动画
   */
  stopAll(): void {
    this.activeTweens.forEach(tw => {
      try {
        tw.stop();
      } catch (e) {
        // 忽略错误
      }
    });
    this.activeTweens.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      active: this.activeTweens.size,
      limit: this.performanceManager.getConfig().maxConcurrentTweens,
    };
  }
}

/**
 * 全局辅助函数：创建受管理的补间动画
 * 注意：当前版本只做统计，不会阻塞动画执行
 */
export function managedTween<T>(target: T): Tween<T> {
  return TweenManager.getInstance().createTween(target);
}
