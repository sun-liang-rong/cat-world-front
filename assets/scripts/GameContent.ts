import { CatId, DailyTaskId, ItemId, RewardBundle } from './PlayerTypes';

export const MAX_CAT_LEVEL = 20;
const FIRST_CAT_UPGRADE_COST = 10;
const LAST_CAT_UPGRADE_COST = 1500;
const INITIAL_CAT_SKILL_COOLDOWN_MS = 40 * 60 * 1000;
const MIN_CAT_SKILL_COOLDOWN_MS = 30 * 60 * 1000;

export function getCatUpgradeCost(level: number) {
  if (level >= MAX_CAT_LEVEL) return 0;
  const currentLevel = Math.min(MAX_CAT_LEVEL - 1, Math.max(1, Math.floor(level)));
  const progress = (currentLevel - 1) / (MAX_CAT_LEVEL - 2);
  return Math.round(
    FIRST_CAT_UPGRADE_COST + (LAST_CAT_UPGRADE_COST - FIRST_CAT_UPGRADE_COST) * progress,
  );
}

export function getCatSkillCooldownMs(level: number) {
  const currentLevel = Math.min(MAX_CAT_LEVEL, Math.max(1, Math.floor(level)));
  const progress = (currentLevel - 1) / (MAX_CAT_LEVEL - 1);
  return Math.round(
    INITIAL_CAT_SKILL_COOLDOWN_MS
      - (INITIAL_CAT_SKILL_COOLDOWN_MS - MIN_CAT_SKILL_COOLDOWN_MS) * progress,
  );
}

export function formatCatSkillCooldown(level: number) {
  const totalSeconds = Math.round(getCatSkillCooldownMs(level) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// 猫咪技能机制：充能满且冷却结束后由玩家手动触发，升级猫咪缩短冷却时间。
// chargeType = 充能方式（收集元素 / 完成三消），chargeRequired = 触发一次需要的次数
export type CatSkillEffect = 'clear_board' | 'clear_board_double' | 'clear_tray' | 'grant_item';

export interface CatSkillConfig {
  chargeType: 'collect' | 'match';
  chargeRequired: number;
  effect: CatSkillEffect;
}

export const CAT_SKILL_CONFIGS: Record<CatId, CatSkillConfig> = {
  orange: { chargeType: 'collect', chargeRequired: 20, effect: 'clear_board' },
  white: { chargeType: 'match', chargeRequired: 3, effect: 'clear_board' },
  black: { chargeType: 'match', chargeRequired: 6, effect: 'clear_tray' },
  ragdoll: { chargeType: 'match', chargeRequired: 8, effect: 'grant_item' },
  aurora: { chargeType: 'match', chargeRequired: 10, effect: 'clear_board_double' },
};

export function getCatSkillConfig(id: CatId): CatSkillConfig {
  return CAT_SKILL_CONFIGS[id] ?? CAT_SKILL_CONFIGS.orange;
}

export interface CatDefinition {
  id: CatId;
  name: string;
  rarity: string;
  skill: string;
  unlockHint: string;
  /** 图鉴名牌用的短解锁条件（unlockHint 太长，放不下卡片）。 */
  unlockShort: string;
  portraitPath: string;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  price: number;
  iconPath: string;
  purchasable: boolean;
}

export interface DailyTaskDefinition {
  id: DailyTaskId;
  title: string;
  description: string;
  target: number;
  rewardText: string;
  reward: RewardBundle;
}

export const CAT_DEFINITIONS: CatDefinition[] = [
  {
    id: 'orange',
    name: '大橘',
    rarity: '新手猫咪',
    skill: '收集 20 个元素后手动发动，额外清除 1 个棋盘元素。',
    unlockHint: '完成流浪猫小屋装饰后解锁',
    unlockShort: '完成流浪猫小屋装饰解锁',
    portraitPath: 'cats/cat_orange',
  },
  {
    id: 'white',
    name: '白猫',
    rarity: '普通',
    skill: '完成 3 次三同消除后手动发动，额外清除 1 个棋盘元素。',
    unlockHint: '完成猫咪咖啡馆装饰后解锁',
    unlockShort: '完成猫咪咖啡馆装饰解锁',
    portraitPath: 'cats/cat_white',
  },
  {
    id: 'black',
    name: '黑猫',
    rarity: '普通',
    skill: '完成 6 次三同消除后手动发动，从收集槽移走 1 个元素。',
    unlockHint: '完成毛线工坊装饰后解锁',
    unlockShort: '完成毛线工坊装饰解锁',
    portraitPath: 'cats/cat_black',
  },
  {
    id: 'ragdoll',
    name: '布偶猫',
    rarity: '稀有',
    skill: '完成 8 次三同消除后手动发动，随机赠送 1 个道具。',
    unlockHint: '完成猫咪社装饰后解锁',
    unlockShort: '完成猫咪社装饰解锁',
    portraitPath: 'cats/cat_ragdoll',
  },
  {
    id: 'aurora',
    name: '极光猫',
    rarity: '传说',
    skill: '完成 10 次三同消除后手动发动，额外清除 2 个棋盘元素。',
    unlockHint: '完成星星喷泉装饰后解锁',
    unlockShort: '完成星星喷泉装饰解锁',
    portraitPath: 'cats/cat_aurora',
  },
];

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'hammer',
    name: '锤子',
    description: '直接移除一个可收集元素。',
    price: 30,
    iconPath: 'shop/item_hammer',
    purchasable: true,
  },
  {
    id: 'dice',
    name: '骰子',
    description: '重新排列棋盘上尚未收集的元素。',
    price: 35,
    iconPath: 'shop/item_dice',
    purchasable: true,
  },
  {
    id: 'extra_slot',
    name: '增加槽位',
    description: '本局临时增加 1 个收集槽位。',
    price: 60,
    iconPath: 'shop/item_extra_slot',
    purchasable: true,
  },
  {
    id: 'glove',
    name: '手套',
    description: '交换两个槽位元素，或将一个元素放回棋盘。',
    price: 40,
    iconPath: 'shop/item_glove',
    purchasable: true,
  },
];

export const DAILY_TASK_DEFINITIONS: DailyTaskDefinition[] = [
  {
    id: 'clear_3_levels',
    title: '完成 3 个关卡',
    description: '挑战关卡，赢取奖励！',
    target: 3,
    rewardText: '金币 ×100',
    reward: { coins: 100 },
  },
  {
    id: 'collect_100_elements',
    title: '消除 100 个元素',
    description: '消除更多元素，收集奖励！',
    target: 100,
    rewardText: '锤子 ×1',
    reward: { items: { hammer: 1 } },
  },
  {
    id: 'make_5_matches',
    title: '单局完成 5 次三消',
    description: '完成三消，展现你的实力！',
    target: 5,
    rewardText: '星星 ×1',
    reward: { stars: 1 },
  },
];

export const DAILY_CHEST_REWARD = {
  coins: 50,
  items: { hammer: 1, dice: 1 },
};

export function getCatDefinition(id: CatId) {
  return CAT_DEFINITIONS.find(item => item.id === id)!;
}

export function getItemDefinition(id: ItemId) {
  return ITEM_DEFINITIONS.find(item => item.id === id)!;
}
