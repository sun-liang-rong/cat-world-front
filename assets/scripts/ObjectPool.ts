import { Node } from 'cc';

/**
 * 通用对象池：复用节点，减少创建和销毁开销
 */
export class ObjectPool<T extends Node> {
  private pool: T[] = [];
  private active: Set<T> = new Set();
  private createFn: () => T;
  private resetFn?: (node: T) => void;
  private readonly maxSize: number;

  constructor(createFn: () => T, resetFn?: (node: T) => void, maxSize = 50) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
  }

  /**
   * 从池中获取一个对象，如果池为空则创建新对象
   */
  get(): T {
    let node: T;
    if (this.pool.length > 0) {
      node = this.pool.pop()!;
    } else {
      node = this.createFn();
    }
    this.active.add(node);
    if (this.resetFn) this.resetFn(node);
    return node;
  }

  /**
   * 将对象放回池中复用
   */
  put(node: T): void {
    if (!this.active.has(node)) return;
    this.active.delete(node);
    node.active = false;
    if (this.pool.length < this.maxSize) {
      this.pool.push(node);
    } else {
      node.destroy();
    }
  }

  /**
   * 预创建指定数量的对象
   */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      const node = this.createFn();
      node.active = false;
      this.pool.push(node);
    }
  }

  /**
   * 清空池中所有对象
   */
  clear(): void {
    this.pool.forEach(node => node.destroy());
    this.pool.length = 0;
    this.active.forEach(node => node.destroy());
    this.active.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      pooled: this.pool.length,
      active: this.active.size,
      total: this.pool.length + this.active.size,
    };
  }
}
