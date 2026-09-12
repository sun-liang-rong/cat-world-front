import { LevelGenerator } from './LevelGenerator';
import { LevelArchetype, TileDefinition } from './LevelTypes';

export const ENDLESS_BOARD_CAP = 120;
export const ENDLESS_RESUME_THRESHOLD = 90;
export const ENDLESS_REFILL_REMAINING = 40;

export interface EndlessStageConfig {
  stage: number;
  kindCount: number;
  tileCount: number;
  keepLayers: number;
  refillTiles: number;
  refillLayers: number;
  archetype: LevelArchetype;
  fullTrayPressure: boolean;
}

export interface EndlessWave {
  tiles: TileDefinition[];
  stage: number;
}

export interface EndlessBoardSnapshot {
  activeCount: number;
  minLayer: number | null;
  maxLayer: number | null;
  force?: boolean;
  trayCounts?: number[];
}

const STAGES: EndlessStageConfig[] = [
  { stage: 0, kindCount: 4, tileCount: 90, keepLayers: 7, refillTiles: 40, refillLayers: 4, archetype: 'normal', fullTrayPressure: false },
  { stage: 1, kindCount: 8, tileCount: 90, keepLayers: 7, refillTiles: 40, refillLayers: 4, archetype: 'stacked', fullTrayPressure: false },
  { stage: 2, kindCount: 10, tileCount: 90, keepLayers: 7, refillTiles: 40, refillLayers: 4, archetype: 'hidden', fullTrayPressure: false },
  { stage: 3, kindCount: 12, tileCount: 90, keepLayers: 7, refillTiles: 40, refillLayers: 4, archetype: 'order', fullTrayPressure: false },
  { stage: 4, kindCount: 13, tileCount: 90, keepLayers: 7, refillTiles: 40, refillLayers: 4, archetype: 'stacked', fullTrayPressure: true },
  { stage: 5, kindCount: 14, tileCount: 90, keepLayers: 8, refillTiles: 40, refillLayers: 4, archetype: 'stacked', fullTrayPressure: true },
  { stage: 6, kindCount: 15, tileCount: 90, keepLayers: 8, refillTiles: 40, refillLayers: 4, archetype: 'stacked', fullTrayPressure: true },
  { stage: 7, kindCount: 15, tileCount: 90, keepLayers: 9, refillTiles: 40, refillLayers: 4, archetype: 'stacked', fullTrayPressure: true },
];

export class EndlessDirector {
  readonly generator = new LevelGenerator();
  private waveIndex = 0;
  private pausedByCap = false;

  constructor(
    private readonly seed: number,
    private startedAt = Date.now(),
  ) {}

  // 计时起点对齐到玩家真正开打（startPlay）：预创建/加载等待不计入坚持时长，
  // 否则 HUD 的「坚持时长」会比结算的 durationMs 多算加载等待时间。
  markStarted(now = Date.now()) {
    this.startedAt = now;
  }

  elapsedMs(now = Date.now()) {
    return Math.max(0, now - this.startedAt);
  }

  currentStage(): EndlessStageConfig {
    const index = Math.max(0, Math.min(STAGES.length - 1, this.waveIndex));
    return STAGES[index];
  }

  /**
   * 按场上剩余牌数补卡：开局约 90 张，降到 40 张（含）从底部垫约 40 张。
   * 点掉几张但还没掉到阈值时不补，避免点一张就塞牌。
   */
  shouldRefill(snapshot: EndlessBoardSnapshot) {
    const activeCount = Math.max(0, snapshot.activeCount);
    if (snapshot.force === true || activeCount <= 0) return true;
    if (activeCount >= ENDLESS_BOARD_CAP) {
      this.pausedByCap = true;
      return false;
    }
    if (this.pausedByCap) {
      if (activeCount > ENDLESS_RESUME_THRESHOLD) return false;
      this.pausedByCap = false;
    }
    return activeCount <= ENDLESS_REFILL_REMAINING;
  }

  nextWave(snapshot: EndlessBoardSnapshot): EndlessWave | null {
    if (!this.shouldRefill(snapshot)) return null;

    const opening = this.waveIndex === 0;
    const stage = this.currentStage();
    const layerCount = opening ? stage.keepLayers : stage.refillLayers;
    const remainingCapacity = ENDLESS_BOARD_CAP - Math.max(0, snapshot.activeCount);
    // 容量不足一波最小补牌（12 张）时直接暂停，等消除腾出空间；
    // 否则会突破 120 上限（旧逻辑在容量 3~11 时仍硬补 12 张）。
    if (!opening && remainingCapacity < 12) {
      this.pausedByCap = true;
      return null;
    }

    let tileCount = opening ? stage.tileCount : stage.refillTiles;
    tileCount = Math.max(12, Math.round(tileCount / 3) * 3);
    if (!opening) {
      // 补牌量不得超过剩余容量（保持 3 的倍数），上限 120 是硬约束
      const capped = Math.floor(remainingCapacity / 3) * 3;
      tileCount = Math.min(tileCount, capped);
    }

    const waveSeed = (this.seed ^ Math.imul(this.waveIndex + 1, 0x9e3779b9)) | 0;
    const tiles = this.generator.createWaveTiles({
      seed: waveSeed,
      tileCount,
      kindCount: stage.kindCount,
      layerCount,
      archetype: stage.archetype,
      slotCapacity: 6,
      fullTrayPressure: stage.fullTrayPressure,
      trayCounts: snapshot.trayCounts,
    });

    if (!opening && snapshot.minLayer !== null) {
      const generatedMax = tiles.reduce((max, tile) => Math.max(max, tile.layer), tiles[0]?.layer ?? 0);
      const offset = snapshot.minLayer - 1 - generatedMax;
      tiles.forEach(tile => {
        tile.layer += offset;
      });
    }

    this.waveIndex += 1;
    this.pausedByCap = snapshot.activeCount + tiles.length >= ENDLESS_BOARD_CAP;
    return { tiles, stage: stage.stage };
  }
}
