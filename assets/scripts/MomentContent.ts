import { CatId, CatProgress } from './PlayerTypes';

export type MomentCategory = 'all' | 'town' | 'cats' | 'levels';

export interface MomentSource {
  level: number;
  buildStage: number;
  cats: Record<CatId, CatProgress>;
  activityPoints: number;
}

export interface MomentDefinition {
  id: string;
  category: Exclude<MomentCategory, 'all'>;
  dateLabel: string;
  title: string;
  description: string;
  unlockHint: string;
  imagePath: string;
  isUnlocked: (source: MomentSource) => boolean;
}

export interface MomentSnapshot {
  id: string;
  category: Exclude<MomentCategory, 'all'>;
  dateLabel: string;
  title: string;
  description: string;
  unlockHint: string;
  imagePath: string;
  unlocked: boolean;
}

export const MOMENT_DEFINITIONS: MomentDefinition[] = [
  {
    id: 'arrival',
    category: 'town',
    dateLabel: '第 1 天',
    title: '初到猫爪星球',
    description: '一条安静的小路，正在等你把这里变成家。',
    unlockHint: '进入小镇后记录',
    imagePath: 'home/home_bg',
    isUnlocked: () => true,
  },
  {
    id: 'first_win',
    category: 'levels',
    dateLabel: '第 2 天',
    title: '第一次通关',
    description: '你完成了第一场收集挑战，猫咪们为你准备了掌声。',
    unlockHint: '完成任意一个三消关卡后记录',
    imagePath: 'game/tiles/tile_8',
    isUnlocked: source => source.level >= 2,
  },
  {
    id: 'first_build',
    category: 'town',
    dateLabel: '第 3 天',
    title: '小屋有了第一盏灯',
    description: '完成第一阶段建设，小镇终于有了可以落脚的地方。',
    unlockHint: '完成流浪猫小屋的清理阶段',
    imagePath: 'town/house_stage_1',
    isUnlocked: source => source.buildStage >= 1,
  },
  {
    id: 'orange_unlocked',
    category: 'cats',
    dateLabel: '第 4 天',
    title: '大橘来到小镇',
    description: '流浪猫小屋修好啦，大橘决定留下来。',
    unlockHint: '完成流浪猫小屋建设后记录',
    imagePath: 'cats/cat_orange',
    isUnlocked: source => !!source.cats.orange?.unlocked,
  },
  {
    id: 'first_interaction',
    category: 'cats',
    dateLabel: '第 4 天',
    title: '第一次互动',
    description: '和猫咪打个招呼，今天的好心情也被记录下来。',
    unlockHint: '和一只已解锁的猫咪互动',
    imagePath: 'moment/moment_photo_bench',
    isUnlocked: source => (Object.keys(source.cats) as CatId[])
      .some(id => source.cats[id]?.affection > 0),
  },
  {
    id: 'town_finished',
    category: 'town',
    dateLabel: '第 6 天',
    title: '小屋焕然一新',
    description: '最后一块木板装好，小屋变成了温暖的小家。',
    unlockHint: '完成流浪猫小屋的全部建设阶段',
    imagePath: 'town/house_stage_3',
    isUnlocked: source => source.buildStage >= 3,
  },
  {
    id: 'activity_start',
    category: 'town',
    dateLabel: '第 7 天',
    title: '小镇的春游准备',
    description: '猫咪们开始为下一场小镇活动准备行李。',
    unlockHint: '参加一次限时活动',
    imagePath: 'activity/activity-sprite_element_6',
    isUnlocked: source => source.activityPoints > 0,
  },
  {
    id: 'second_win',
    category: 'levels',
    dateLabel: '第 8 天',
    title: '连胜的下午',
    description: '第二颗星星落进手心，今天的阳光也变得更亮了。',
    unlockHint: '再完成一场三消关卡后记录',
    imagePath: 'game/tiles/tile_14',
    isUnlocked: source => source.level >= 3,
  },
  {
    id: 'cat_family',
    category: 'cats',
    dateLabel: '第 10 天',
    title: '猫咪集合啦',
    description: '小镇不再只有一个脚印，新的朋友正在门口排队。',
    unlockHint: '解锁两只猫咪后记录',
    imagePath: 'moment/moment_photo_cats',
    isUnlocked: source => (Object.keys(source.cats) as CatId[])
      .filter(id => source.cats[id]?.unlocked).length >= 2,
  },
  {
    id: 'garden_bloom',
    category: 'town',
    dateLabel: '第 12 天',
    title: '花园开满了',
    description: '最后一朵小花被种下，猫咪们有了午后散步的新路线。',
    unlockHint: '完成流浪猫小屋的全部建设后记录',
    imagePath: 'town/house_stage_3',
    isUnlocked: source => source.buildStage >= 3,
  },
  ...[
    { level: 120, title: '星光野餐', description: '大橘带来面包，小白铺好餐布。冒险之后，我们一起看星星。', imagePath: 'moment/moment_photo_cats' },
    { level: 140, title: '写给小镇的信', description: '小黑把第一天的脚印收进信封：谢谢你，让我们拥有了家。', imagePath: 'moment/moment_photo_bench' },
    { level: 160, title: '我们一直在这里', description: '五只猫围在灯下。旅程走到终点，小镇的生活才刚刚开始。', imagePath: 'town/house_stage_3' },
  ].map(story => ({
    id: `story_${story.level}`, category: 'levels' as const, dateLabel: `第 ${story.level} 关纪念`,
    title: story.title, description: story.description, imagePath: story.imagePath,
    unlockHint: `完成第 ${story.level} 关后收录`, isUnlocked: (source: MomentSource) => source.level > story.level,
  })),
  {
    id: 'cat_affection', category: 'cats', dateLabel: '相伴的日子', title: '最安心的位置',
    description: '猫咪把小爪放在你手心：今天也要一起玩呀。', unlockHint: '任意猫咪好感达到 20',
    imagePath: 'moment/moment_photo_bench', isUnlocked: source => Object.values(source.cats).some(cat => cat.affection >= 20),
  },
  ...([
    { id: 'orange', name: '大橘' },
    { id: 'white', name: '白猫' },
    { id: 'black', name: '黑猫' },
    { id: 'ragdoll', name: '布偶猫' },
    { id: 'aurora', name: '极光猫' },
  ] as Array<{ id: CatId; name: string }>).map(cat => ({
    id: `cat_growth_${cat.id}`,
    category: 'cats' as const,
    dateLabel: '成长纪念',
    title: `${cat.name}的专属照片`,
    description: `${cat.name}已经长大啦，这张照片记录了你们一起成长的日子。`,
    unlockHint: `${cat.name}达到 Lv.18 后收录`,
    imagePath: `cats/cat_${cat.id}`,
    isUnlocked: (source: MomentSource) => !!source.cats[cat.id]?.unlocked && source.cats[cat.id].level >= 18,
  })),

];

export function buildMomentSnapshots(source: MomentSource): MomentSnapshot[] {
  return MOMENT_DEFINITIONS.map(definition => ({
    id: definition.id,
    category: definition.category,
    dateLabel: definition.dateLabel,
    title: definition.title,
    description: definition.description,
    unlockHint: definition.unlockHint,
    imagePath: definition.imagePath,
    unlocked: definition.isUnlocked(source),
  }));
}
