import { BuildingId, CatId } from './PlayerTypes';

// 每个主题的关卡数：主题 N 的 20 关最多产出 60 颗星星，
// 正好覆盖对应建筑 清理/修复/装饰 三个阶段的总消耗
export const LEVELS_PER_THEME = 20;

// 小节点机制：每个大节点（清理/修复/装饰）拆成若干小格，点亮 1 格固定消耗 3 星，
// 与「每关固定 3 星」严格对齐——打 1 关 = 点亮 1 格，玩家从第 1 关起每关都能建设。
// 5 + 7 + 8 = 20 格 × 3 星 = 60 星，一个主题的满星产出正好亮满一栋建筑。
export const CELL_STAR_COST = 3;
export const BUILDING_STAGE_CELLS: number[] = [5, 7, 8];

// 小镇建筑配置：主题 ↔ 建筑 ↔ 猫咪一一对应。
// 建筑本身暂无功能（后期再加），作用是承载星星消耗并解锁对应猫咪。
export interface BuildingDefinition {
  id: BuildingId;
  name: string;
  flavor: string;
  stageNames: string[];
  stageCosts: number[];
  // 阶段外观图路径为 town/<artPrefix>_stage_<已完成的阶段数>，0 号是未开工的废墟
  artPrefix: string;
  // 装饰完成后解锁的猫咪，顺序与主题顺序一致
  catId: CatId;
  reward: string;
  unlockHint: string;
}

export const BUILDING_DEFINITIONS: BuildingDefinition[] = [
  {
    id: 'cat_house',
    name: '流浪猫小屋',
    flavor: '青青草原的家，给大橘一个落脚处',
    stageNames: ['清理', '修复', '装饰'],
    stageCosts: [15, 21, 24],
    artPrefix: 'house',
    catId: 'orange',
    reward: '解锁猫咪「大橘」',
    unlockHint: '小镇的第一栋建筑，通关攒星星即可建设',
  },
  {
    id: 'cafe',
    name: '猫咪咖啡馆',
    flavor: '溪谷小镇的聚会据点',
    stageNames: ['清理', '修复', '装饰'],
    stageCosts: [15, 21, 24],
    artPrefix: 'cafe',
    catId: 'white',
    reward: '解锁猫咪「白猫」',
    unlockHint: '闯到第 2 个主题（溪谷小镇）后解锁',
  },
  {
    id: 'yarn_workshop',
    name: '毛线工坊',
    flavor: '星光海湾边织毛线的作坊',
    stageNames: ['清理', '修复', '装饰'],
    stageCosts: [15, 21, 24],
    artPrefix: 'workshop',
    catId: 'black',
    reward: '解锁猫咪「黑猫」',
    unlockHint: '闯到第 3 个主题（星光海湾）后解锁',
  },
  {
    id: 'cat_society',
    name: '猫咪社',
    flavor: '云朵山径上猫咪们的俱乐部',
    stageNames: ['清理', '修复', '装饰'],
    stageCosts: [15, 21, 24],
    artPrefix: 'society',
    catId: 'ragdoll',
    reward: '解锁猫咪「布偶猫」',
    unlockHint: '闯到第 4 个主题（云朵山径）后解锁',
  },
  {
    id: 'star_fountain',
    name: '星星喷泉',
    flavor: '莓果森林深处的许愿喷泉',
    stageNames: ['清理', '修复', '装饰'],
    stageCosts: [15, 21, 24],
    artPrefix: 'fountain',
    catId: 'aurora',
    reward: '解锁猫咪「极光猫」',
    unlockHint: '闯到第 5 个主题（莓果森林）后解锁',
  },
];

export function getBuildingDefinition(id: BuildingId): BuildingDefinition {
  const definition = BUILDING_DEFINITIONS.find(item => item.id === id);
  return definition ?? BUILDING_DEFINITIONS[0];
}

// 建设页渲染用的建筑快照，由 PlayerStore 派生
export interface BuildingView {
  id: BuildingId;
  name: string;
  flavor: string;
  stageNames: string[];
  stageCosts: number[];
  artPrefix: string;
  catId: CatId;
  reward: string;
  unlockHint: string;
  stage: number;
  maxStage: number;
  /** 当前大节点内已点亮的小格数；completed 时等于 cellCount */
  subProgress: number;
  /** 当前大节点的格子总数 */
  cellCount: number;
  /** 点亮一格的星星单价（恒为 CELL_STAR_COST） */
  cellCost: number;
  unlocked: boolean;
  completed: boolean;
}

/** 点亮一格的结果：ok 之外带回里程碑信息，供页面区分普通点亮/大节点完成/建成 */
export interface BuildCellResult {
  ok: boolean;
  message: string;
  /** 本次点亮刚好亮满一个大节点（建筑外观随之变化） */
  stageJustCompleted?: boolean;
  /** 本次点亮建成整栋建筑（对应猫咪解锁） */
  buildingCompleted?: boolean;
}

/** 结算页/首页气泡用的「下一格建设目标」快照，无可建建筑时为 null */
export interface BuildTargetInfo {
  buildingId: BuildingId;
  buildingName: string;
  stageName: string;
  subProgress: number;
  cellCount: number;
  /** 距离点亮下一格还差的星星数；0 表示已够 */
  starsNeeded: number;
}
