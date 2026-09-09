import {
  ActivityRewardId,
  ActivityStatus,
  ActivityTaskId,
  ActivityState,
  RewardBundle,
} from './PlayerTypes';
import { COMMON_UI_ASSETS } from './AssetStore';

export type ActivityRewardKind = 'coin' | 'hammer' | 'star' | 'dice' | 'gift';

export interface ActivityTaskDefinition {
  id: ActivityTaskId;
  iconPath: string;
  title: string;
  description: string;
  target: number;
  pointReward: number;
}

export interface ActivityRewardDefinition {
  id: ActivityRewardId;
  threshold: number;
  name: string;
  kind: ActivityRewardKind;
  amount: number;
  reward: RewardBundle;
  iconPath: string;
}

export interface ActivityVisualConfig {
  backgroundPath: string;
  heroTitlePath: string;
  backButtonPath: string;
}

export interface ActivityDefinition {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  claimEndAt: string;
  minLevel: number;
  totalPoints: number;
  dailyDirectPointLimit: number;
  heroTitle: string;
  visuals: ActivityVisualConfig;
  tasks: ActivityTaskDefinition[];
  rewards: ActivityRewardDefinition[];
}

export interface ActivityTaskSnapshot extends ActivityTaskDefinition {
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface ActivityRewardSnapshot extends ActivityRewardDefinition {
  unlocked: boolean;
  claimed: boolean;
}

export interface ActivitySnapshot {
  definition: ActivityDefinition;
  status: ActivityStatus;
  points: number;
  todayDirectPoints: number;
  remainingMs: number;
  nextRewardThreshold: number | null;
  claimableRewardCount: number;
  tasks: ActivityTaskSnapshot[];
  rewards: ActivityRewardSnapshot[];
}

const CAT_PICNIC_ACTIVITY: ActivityDefinition = {
  id: 'cat_picnic_001',
  title: '猫咪春游会',
  description: '一起出发吧',
  // Keep the first local event live for the current prototype window.
  startAt: '2026-09-01T00:00:00+08:00',
  endAt: '2026-09-08T00:00:00+08:00',
  claimEndAt: '2026-09-09T00:00:00+08:00',
  minLevel: 1,
  totalPoints: 1000,
  dailyDirectPointLimit: 300,
  heroTitle: '完成关卡，收集积分',
  visuals: {
    backgroundPath: 'activity/redesign/activity_redesign_bg',
    heroTitlePath: 'activity/redesign/activity_redesign_title_sign',
    backButtonPath: COMMON_UI_ASSETS.backButton,
  },
  tasks: [
    {
      id: 'complete_levels',
      iconPath: COMMON_UI_ASSETS.coinIcon,
      title: '完成 10 个关卡',
      description: '帮助猫咪们准备春游行李',
      target: 10,
      pointReward: 100,
    },
    {
      id: 'make_matches',
      iconPath: 'activity/redesign/activity_redesign_hammer',
      title: '完成 30 次三消',
      description: '收集更多春游小物件',
      target: 30,
      pointReward: 100,
    },
    {
      id: 'interact_cats',
      iconPath: COMMON_UI_ASSETS.starIcon,
      title: '与猫咪互动 7 次',
      description: '和猫咪一起享受春日时光',
      target: 7,
      pointReward: 80,
    },
  ],
  rewards: [
    {
      id: 'activity_reward_100',
      threshold: 100,
      name: '金币 ×50',
      kind: 'coin',
      amount: 50,
      reward: { coins: 50 },
      iconPath: COMMON_UI_ASSETS.coinIcon,
    },
    {
      id: 'activity_reward_300',
      threshold: 300,
      name: '锤子 ×1',
      kind: 'hammer',
      amount: 1,
      reward: { items: { hammer: 1 } },
      iconPath: 'activity/redesign/activity_redesign_hammer',
    },
    {
      id: 'activity_reward_500',
      threshold: 500,
      name: '星星 ×1',
      kind: 'star',
      amount: 1,
      reward: { stars: 1 },
      iconPath: COMMON_UI_ASSETS.starIcon,
    },
    {
      id: 'activity_reward_800',
      threshold: 800,
      name: '骰子 ×2',
      kind: 'dice',
      amount: 2,
      reward: { items: { dice: 2 } },
      iconPath: 'activity/redesign/activity_redesign_dice',
    },
    {
      id: 'activity_reward_1000',
      threshold: 1000,
      name: '春游礼包',
      kind: 'gift',
      amount: 1,
      reward: { coins: 300, items: { hammer: 2, dice: 2 } },
      iconPath: 'activity/redesign/activity_redesign_gift',
    },
  ],
};

export const ACTIVITY_DEFINITIONS: ActivityDefinition[] = [CAT_PICNIC_ACTIVITY];

export function getCurrentActivity() {
  return ACTIVITY_DEFINITIONS[0];
}

export function createActivityState(definition: ActivityDefinition, dateKey: string): ActivityState {
  const tasks = {} as ActivityState['tasks'];
  definition.tasks.forEach(task => {
    tasks[task.id] = { progress: 0, claimed: false };
  });
  return {
    eventId: definition.id,
    points: 0,
    dailyPointDateKey: dateKey,
    dailyDirectPoints: 0,
    completedLevelIds: [],
    tasks,
    claimedRewardIds: [],
  };
}
