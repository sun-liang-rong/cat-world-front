import { sys } from 'cc';
import {
  ActivitySnapshot,
  ActivityDefinition,
  createActivityState,
  getCurrentActivity,
} from './ActivityContent';
import { buildMomentSnapshots, MomentSnapshot } from './MomentContent';
import {
  DAILY_CHEST_REWARD,
  DAILY_TASK_DEFINITIONS,
  getCatDefinition,
  getCatSkillCooldownMs,
  getCatUpgradeCost,
  getItemDefinition,
  MAX_CAT_LEVEL,
} from './GameContent';
import {
  ActivityRewardId,
  ActivityStatus,
  ActivityTaskId,
  BuildingId,
  BuildingProgress,
  CatId,
  CatInteraction,
  DailyState,
  DailyTaskId,
  EndlessProgress,
  GamePetPosition,
  PlayerExperienceInfo,
  PlayerState,
  RewardBundle,
  ShopDailyState,
  ShopItemStatus,
  TaskSnapshot,
  ItemId,
} from './PlayerTypes';
import { AdFunnelBand, AdFunnelBandStats, AdFunnelState, PlayerRun } from './level/LevelTypes';
import {
  BuildCellResult,
  BuildTargetInfo,
  BuildingView,
  BUILDING_DEFINITIONS,
  BUILDING_STAGE_CELLS,
  CELL_STAR_COST,
  getBuildingDefinition,
  LEVELS_PER_THEME,
} from './TownContent';

// 全部玩法进度只写本机；排行榜累计星星由 LeaderboardService 单独上报微信，不经过这里。
const STORAGE_KEY = 'cat-world-player-state-v1';
const MAX_AFFECTION = 100;
const MAX_CAT_EXPERIENCE = 20;
const DAILY_SHOP_ITEM_LIMIT = 5;
const DAILY_SHOP_AD_LIMIT = DAILY_SHOP_ITEM_LIMIT - 1;
const DAILY_SHOP_ITEM_IDS: ItemId[] = ['hammer', 'glove', 'dice', 'extra_slot'];
const MAX_RECENT_RUNS = 10;
// 主题 ↔ 建筑 ↔ 猫咪按顺序一一对应：第 N 栋建筑装饰完成解锁第 N 只猫咪
const BUILDING_CATS: CatId[] = ['orange', 'white', 'black', 'ragdoll', 'aurora'];

// 玩家经验/等级：与主线关卡进度（state.level）解耦，只由累计经验推导。
// 通关任意关卡获胜得经验 = 30 + min(关卡号 - 1, 60)，越往后单关收益越高；
// 升到下一级所需经验 100 起步、每级 +40（Lv1→2 需 100，Lv2→3 需 140……）。
const WIN_EXP_BASE = 30;
const WIN_EXP_STAGE_BONUS_MAX = 60;
const EXP_PER_LEVEL_BASE = 100;
const EXP_PER_LEVEL_STEP = 40;

// 达到 level 级所需的累计经验（Lv1 为 0）
function totalExpForLevel(level: number) {
  if (level <= 1) return 0;
  return (level - 1) * EXP_PER_LEVEL_BASE + (EXP_PER_LEVEL_STEP * (level - 1) * (level - 2)) / 2;
}

function levelFromTotalExp(total: number) {
  let level = 1;
  while (total >= totalExpForLevel(level + 1)) level += 1;
  return level;
}

// 存档反序列化用的宽松形状：version 允许 1/2（v1 读入后迁移补新字段）
type SavedPlayerState = Omit<Partial<PlayerState>, 'version'> & { version?: number };

export class PlayerStore {
  private state: PlayerState = this.createDefaultState();

  constructor(private readonly storageKey = STORAGE_KEY) {}

  load() {
    this.state = this.createDefaultState();
    try {
      const serialized = sys.localStorage.getItem(this.storageKey);
      if (serialized) {
        const parsed = JSON.parse(serialized) as SavedPlayerState | null;
        if (!parsed || typeof parsed !== 'object' || (parsed.version !== 1 && parsed.version !== 2)) {
          console.error('[CatWorld] Invalid player save, reset to defaults');
        } else {
          // v1 旧档走同一套逐字段校验，新增字段保持默认值，写回时升级为 v2
          this.state = this.normalize(parsed);
        }
      }
    } catch (error) {
      console.error('[CatWorld] Failed to load player save', error);
    }
    this.resetDailyState(false);
    this.syncUnlocks(false);
    this.applyBuildingUnlocks();
    this.save();
  }

  save() {
    try {
      sys.localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch (error) {
      console.error('[CatWorld] Failed to save player state', error);
    }
  }

  getState() {
    this.resetDailyState();
    return this.clone(this.state);
  }

  getMoments(): MomentSnapshot[] {
    const state = this.getState();
    return buildMomentSnapshots({
      level: state.level,
      buildStage: state.buildStage,
      cats: state.cats,
      activityPoints: state.activity.points,
    });
  }

  getCoins() {
    return this.state.coins;
  }

  getStars() {
    return this.state.stars;
  }

  getTotalStarsEarned() {
    return this.state.totalStarsEarned;
  }

  getLevel() {
    return this.state.level;
  }

  getUserName() {
    return this.state.userName;
  }

  getUserId() {
    return this.state.userId;
  }

  hasProfile() {
    return this.state.userId.length > 0 && this.state.userName.length > 0;
  }

  setProfile(userId: string, userName: string) {
    const nextId = userId.trim();
    const nextName = userName.trim();
    if (!nextId || !nextName) return;
    if (this.state.userId === nextId && this.state.userName === nextName) return;
    this.state.userId = nextId;
    this.state.userName = nextName;
    this.save();
  }

  getExperienceInfo(): PlayerExperienceInfo {
    const level = levelFromTotalExp(this.state.exp);
    return {
      level,
      exp: this.state.exp - totalExpForLevel(level),
      expToNext: EXP_PER_LEVEL_BASE + (level - 1) * EXP_PER_LEVEL_STEP,
    };
  }

  getBuildStage() {
    return this.state.buildStage;
  }

  // 主线至少通过一关：进度已越过第 1 关，或任意关卡留下过星星记录
  hasClearedAnyLevel() {
    if (this.state.level > 1) return true;
    return Object.keys(this.state.levelStars).some(key => (this.state.levelStars[Number(key)] ?? 0) > 0);
  }

  // 任意一栋建筑推进过至少一个阶段（或点亮过任意一格），即视为建设过小镇
  hasBuiltTown() {
    if (this.state.buildStage > 0) return true;
    return BUILDING_DEFINITIONS.some(definition => {
      const building = this.state.buildings[definition.id];
      return this.getBuildingStage(definition.id) > 0 || (building?.subProgress ?? 0) > 0;
    });
  }

  shouldShowTownBuildHint() {
    return this.hasClearedAnyLevel() && !this.hasBuiltTown();
  }

  // 任意一栋建筑走完清理/修复/装饰，即视为小镇装饰完成
  hasDecoratedTown() {
    return BUILDING_DEFINITIONS.some(definition => this.isBuildingCompleted(definition.id));
  }

  hasEquippedPet() {
    return this.state.equippedCat !== null;
  }

  shouldShowCatEquipHint() {
    return this.hasDecoratedTown() && !this.hasEquippedPet();
  }

  getLevelStar(level: number) {
    const value = this.state.levelStars[Math.floor(level)];
    return typeof value === 'number' ? value : 0;
  }

  // 结算时记录历史最高星（每关最多 3 星，只升不降）
  recordLevelStars(level: number, stars: number) {
    const key = Math.floor(level);
    const earned = Math.min(3, Math.max(0, Math.floor(Number.isFinite(stars) ? stars : 0)));
    if (!(key >= 1) || earned <= 0) return;
    const best = this.state.levelStars[key] ?? 0;
    if (earned > best) {
      this.state.levelStars[key] = earned;
      this.save();
    }
  }

  getBuilding(id: BuildingId): BuildingProgress {
    this.resetDailyState();
    return this.clone(this.state.buildings[id]);
  }

  getBuildingStageCount(id: BuildingId) {
    return getBuildingDefinition(id).stageNames.length;
  }

  // 流浪猫小屋的阶段沿用全局 buildStage（老存档与回忆页都依赖它），其余建筑存放在 buildings[id].stage
  getBuildingStage(id: BuildingId) {
    const maxStage = this.getBuildingStageCount(id);
    if (id === 'cat_house') return Math.max(0, Math.min(maxStage, this.state.buildStage));
    const building = this.state.buildings[id];
    return Math.max(0, Math.min(maxStage, building ? building.stage : 0));
  }

  isBuildingUnlocked(id: BuildingId) {
    this.resetDailyState();
    if (id === 'cat_house') return true;
    return !!this.state.buildings[id]?.unlocked;
  }

  isBuildingCompleted(id: BuildingId) {
    return this.getBuildingStage(id) >= this.getBuildingStageCount(id);
  }

  // 建设页一次取全部建筑快照，界面不直接读存档结构
  getBuildingViews(): BuildingView[] {
    this.resetDailyState();
    return BUILDING_DEFINITIONS.map(definition => {
      const stage = this.getBuildingStage(definition.id);
      const maxStage = definition.stageNames.length;
      const building = this.state.buildings[definition.id];
      const completed = stage >= maxStage;
      // 已建成建筑展示最后一个大节点的满格；进行中建筑展示当前大节点的格子
      const cellCount = BUILDING_STAGE_CELLS[Math.min(stage, maxStage - 1)] ?? 0;
      const subProgress = completed
        ? cellCount
        : Math.max(0, Math.min(cellCount, building?.subProgress ?? 0));
      return {
        ...definition,
        stage,
        maxStage,
        subProgress,
        cellCount,
        cellCost: CELL_STAR_COST,
        unlocked: definition.id === 'cat_house' ? true : !!building?.unlocked,
        completed,
      };
    });
  }

  // 当前大节点内已点亮的格数（按 stage 语义与格子数收敛，坏值不外溢）
  private getBuildingSubProgress(id: BuildingId) {
    const stage = this.getBuildingStage(id);
    const cellCount = BUILDING_STAGE_CELLS[Math.min(stage, BUILDING_STAGE_CELLS.length - 1)] ?? 0;
    const saved = this.state.buildings[id]?.subProgress ?? 0;
    return Math.max(0, Math.min(cellCount, Math.floor(saved)));
  }

  // 下一格建设目标：第一个已解锁、未建成的建筑（按主题顺序）。
  // 结算弹窗文案与首页气泡共用，starsNeeded 为 0 表示星已够点亮。
  getNextBuildableInfo(): BuildTargetInfo | null {
    this.resetDailyState();
    for (const definition of BUILDING_DEFINITIONS) {
      const stage = this.getBuildingStage(definition.id);
      if (stage >= definition.stageNames.length) continue;
      if (!this.isBuildingUnlocked(definition.id)) continue;
      const cellCount = BUILDING_STAGE_CELLS[Math.min(stage, BUILDING_STAGE_CELLS.length - 1)] ?? 0;
      return {
        buildingId: definition.id,
        buildingName: definition.name,
        stageName: definition.stageNames[stage] ?? '',
        subProgress: this.getBuildingSubProgress(definition.id),
        cellCount,
        starsNeeded: this.state.stars >= CELL_STAR_COST ? 0 : CELL_STAR_COST - this.state.stars,
      };
    }
    return null;
  }

  canLightNextBuildingCell() {
    const target = this.getNextBuildableInfo();
    return !!target && target.starsNeeded === 0;
  }

  // 点亮一格（小节点机制）：每格固定 3 星，亮满当前大节点自动进入下一阶段；
  // 三个大节点全亮即建成并联动猫咪解锁（syncUnlocks）。
  lightBuildingCell(id: BuildingId): BuildCellResult {
    const definition = getBuildingDefinition(id);
    if (!this.isBuildingUnlocked(id)) {
      return { ok: false, message: definition.unlockHint };
    }
    const stage = this.getBuildingStage(id);
    if (stage >= definition.stageNames.length) {
      return { ok: false, message: `${definition.name}已经建设完成` };
    }
    if (this.state.stars < CELL_STAR_COST) {
      return { ok: false, message: `还差 ${CELL_STAR_COST - this.state.stars} 颗星星，去闯关赢星星吧` };
    }
    const cellCount = BUILDING_STAGE_CELLS[Math.min(stage, BUILDING_STAGE_CELLS.length - 1)] ?? 0;
    if (cellCount <= 0) {
      return { ok: false, message: '建设配置异常' };
    }
    this.state.stars -= CELL_STAR_COST;
    const nextSub = this.getBuildingSubProgress(id) + 1;
    const stageJustCompleted = nextSub >= cellCount;
    const buildingCompleted = stageJustCompleted && stage + 1 >= definition.stageNames.length;
    this.state.buildings[id].subProgress = stageJustCompleted ? 0 : nextSub;
    if (id === 'cat_house') {
      // 流浪猫小屋的阶段沿用全局 buildStage 镜像（老存档与回忆页依赖它）
      if (stageJustCompleted) this.state.buildStage = stage + 1;
    } else if (stageJustCompleted) {
      this.state.buildings[id].stage = stage + 1;
    }
    this.syncUnlocks(false);
    this.save();
    const stageName = definition.stageNames[stage] ?? '';
    return {
      ok: true,
      message: stageJustCompleted
        ? buildingCompleted ? `${definition.name}建设完成！` : `${stageName}完成！`
        : `${stageName}进度 ${nextSub}/${cellCount}`,
      stageJustCompleted,
      buildingCompleted,
    };
  }

  // —— 第 1 关一次性建设引导 ——
  // 过关且从未点亮过任何格子时弹引导；跳过不置标记，点亮过则永不再弹。
  shouldShowFirstTownGuide() {
    return this.hasClearedAnyLevel() && !this.state.firstTownGuideDone && !this.hasBuiltTown();
  }

  markFirstTownGuideDone() {
    if (this.state.firstTownGuideDone) return;
    this.state.firstTownGuideDone = true;
    this.save();
  }

  // —— 第 1 关对局内新手教学 ——
  // 第一次三消时写入；失败重试不重放（教学三步演示完即算学会）。
  isBoardTutorialDone() {
    return this.state.boardTutorialDone;
  }

  markBoardTutorialDone() {
    if (this.state.boardTutorialDone) return;
    this.state.boardTutorialDone = true;
    this.save();
  }

  isCollectGoalHintDone() {
    return this.state.collectGoalHintDone;
  }

  markCollectGoalHintDone() {
    if (this.state.collectGoalHintDone) return;
    this.state.collectGoalHintDone = true;
    this.save();
  }

  getRecentRuns(): PlayerRun[] {
    return this.clone(this.state.recentRuns);
  }

  getEquippedCat() {
    this.resetDailyState();
    return this.state.equippedCat;
  }

  // 是否至少解锁了一只猫咪：宠物浮窗用它区分「去装备」和「先解锁建筑」两种提示
  hasAnyUnlockedCat() {
    return (Object.keys(this.state.cats) as CatId[]).some(id => this.state.cats[id].unlocked);
  }

  getGamePetPosition(): GamePetPosition {
    return { ...this.state.gamePetPosition };
  }

  setGamePetPosition(position: GamePetPosition) {
    const side = position.side === 'left' ? 'left' : 'right';
    const y = Math.max(
      -600,
      Math.min(600, Math.floor(Number.isFinite(position.y) ? position.y : 220)),
    );
    if (this.state.gamePetPosition.side === side && this.state.gamePetPosition.y === y) return;
    this.state.gamePetPosition = { side, y };
    this.save();
  }

  // —— 猫咪技能：充能 + 冷却 ——
  // 充能（收集元素/完成三消）在关卡内累计并持久化；充能完成后由玩家手动触发。
  // 升级猫咪缩短冷却时间（getCatSkillCooldownMs：40 分钟 → 30 分钟）。
  getCatSkillState(id: CatId): { readyAt: number; charge: number; level: number } {
    const cat = this.state.cats[id];
    return {
      readyAt: cat?.skillReadyAt ?? 0,
      charge: cat?.skillCharge ?? 0,
      level: cat?.level ?? 1,
    };
  }

  fireCatSkill(id: CatId): number {
    const cat = this.state.cats[id];
    if (!cat) return Date.now();
    cat.skillReadyAt = Date.now() + getCatSkillCooldownMs(cat.level);
    cat.skillCharge = 0;
    this.save();
    return cat.skillReadyAt;
  }

  setCatSkillCharge(id: CatId, charge: number) {
    const cat = this.state.cats[id];
    if (!cat) return;
    cat.skillCharge = Math.max(0, Math.floor(Number.isFinite(charge) ? charge : 0));
    this.save();
  }

  getDailyDateKey() {
    this.resetDailyState();
    return this.state.daily.dateKey;
  }

  getCat(id: CatId) {
    this.resetDailyState();
    return this.clone(this.state.cats[id]);
  }

  equipCat(id: CatId) {
    const cat = this.state.cats[id];
    if (!cat || !cat.unlocked) return { ok: false, message: '这只猫咪还没有解锁' };
    if (this.state.equippedCat === id) return { ok: true, message: `${getCatDefinition(id).name}已经装备啦` };
    this.state.equippedCat = id;
    this.save();
    return { ok: true, message: `${getCatDefinition(id).name}已装备` };
  }

  getItemCount(id: ItemId) {
    return this.state.inventory[id] ?? 0;
  }

  getShopItemStatus(id: ItemId): ShopItemStatus {
    this.resetDailyState();
    const progress = this.state.shop.items[id];
    const totalClaims = (progress.coinPurchased ? 1 : 0) + progress.adClaims;
    return {
      coinPurchased: progress.coinPurchased,
      adClaims: progress.adClaims,
      totalClaims,
      maxClaims: DAILY_SHOP_ITEM_LIMIT,
    };
  }

  getTasks(): TaskSnapshot[] {
    this.resetDailyState();
    return DAILY_TASK_DEFINITIONS.map(definition => {
      const task = this.state.daily.tasks[definition.id];
      return {
        id: definition.id,
        progress: task.progress,
        target: definition.target,
        claimed: task.claimed,
        completed: task.progress >= definition.target,
      };
    });
  }

  isDailyChestReady() {
    return this.getTasks().every(task => task.completed);
  }

  isDailyChestClaimed() {
    this.resetDailyState();
    return this.state.daily.chestClaimed;
  }

  // —— 超萌挑战大奖：每日首次通关发放，同日重复通关只发普通过关金币 ——
  isChallengeRewardClaimed() {
    this.resetDailyState();
    return this.state.daily.challengeRewardClaimed;
  }

  markChallengeRewardClaimed() {
    this.resetDailyState(false);
    if (this.state.daily.challengeRewardClaimed) return;
    this.state.daily.challengeRewardClaimed = true;
    this.save();
  }

  isEndlessUnlocked() {
    return this.state.level >= 2;
  }

  getEndlessProgress(): EndlessProgress {
    return this.clone(this.state.endless);
  }

  // 无尽结算：更新本地纪录、计入消除/三消类每日任务和活动，不推进主线、不写难度历史。
  recordEndlessRun(result: {
    eliminated: number;
    durationMs: number;
    stage: number;
    matchCount: number;
  }) {
    this.resetDailyState(false);
    const eliminated = this.nonNegativeInteger(result.eliminated, 0);
    const durationMs = this.nonNegativeInteger(result.durationMs, 0);
    const stage = Math.max(0, Math.min(7, Math.floor(this.safeNumber(result.stage, 0))));
    const matchCount = this.positiveInteger(result.matchCount);
    const endless = this.state.endless;
    endless.lastEliminated = eliminated;
    endless.lastDurationMs = durationMs;
    endless.lastStage = stage;
    endless.totalRuns += 1;
    endless.totalEliminated += eliminated;
    const isNewRecord = eliminated > endless.bestEliminated;
    if (isNewRecord) endless.bestEliminated = eliminated;

    this.state.daily.tasks.collect_100_elements.progress = Math.min(
      100,
      this.state.daily.tasks.collect_100_elements.progress + eliminated,
    );
    this.state.daily.tasks.make_5_matches.progress = Math.min(
      5,
      Math.max(this.state.daily.tasks.make_5_matches.progress, matchCount),
    );
    this.recordActivityMatches(matchCount);

    const today = this.todayKey();
    const firstOfDay = endless.dailyRewardDateKey !== today;
    let coins = Math.min(120, Math.floor(eliminated / 15));
    if (firstOfDay) {
      coins += 40;
      endless.dailyRewardDateKey = today;
    }
    if (coins > 0) this.applyReward({ coins });
    this.save();
    return {
      coins,
      isNewRecord,
      bestEliminated: endless.bestEliminated,
      firstOfDay,
    };
  }

  getActivitySnapshot(): ActivitySnapshot {
    this.syncActivityState(true);
    const definition = getCurrentActivity();
    const now = Date.now();
    const windowStatus = this.activityWindowStatus(definition, now);
    const status: ActivityStatus = this.state.level < definition.minLevel && windowStatus !== 'ended'
      ? 'locked'
      : windowStatus;
    const activity = this.state.activity;
    const tasks = definition.tasks.map(task => {
      const progress = activity.tasks[task.id]?.progress || 0;
      return {
        ...task,
        progress,
        completed: progress >= task.target,
        claimed: activity.tasks[task.id]?.claimed === true,
      };
    });
    const rewards = definition.rewards.map(reward => ({
      ...reward,
      unlocked: activity.points >= reward.threshold,
      claimed: activity.claimedRewardIds.indexOf(reward.id) >= 0,
    }));
    const nextReward = definition.rewards.find(reward => activity.points < reward.threshold);
    const claimableRewardCount = status === 'active' || status === 'claiming'
      ? rewards.filter(reward => reward.unlocked && !reward.claimed).length
      : 0;
    return {
      definition: this.clone(definition),
      status,
      points: activity.points,
      todayDirectPoints: activity.dailyDirectPoints,
      remainingMs: this.activityRemainingMs(definition, windowStatus, now),
      nextRewardThreshold: nextReward ? nextReward.threshold : null,
      claimableRewardCount,
      tasks,
      rewards,
    };
  }

  claimActivityTask(id: ActivityTaskId) {
    this.syncActivityState(false);
    const definition = getCurrentActivity();
    const status = this.activityWindowStatus(definition, Date.now());
    const taskDefinition = definition.tasks.find(task => task.id === id);
    const task = this.state.activity.tasks[id];
    if (
      this.state.level < definition.minLevel
      || (status !== 'active' && status !== 'claiming')
      || !taskDefinition
      || !task
      || task.claimed
      || task.progress < taskDefinition.target
    ) {
      return false;
    }
    task.claimed = true;
    this.state.activity.points = Math.min(
      definition.totalPoints,
      this.state.activity.points + taskDefinition.pointReward,
    );
    this.save();
    return true;
  }

  claimActivityReward(id: ActivityRewardId) {
    this.syncActivityState(false);
    const definition = getCurrentActivity();
    const status = this.activityWindowStatus(definition, Date.now());
    const reward = definition.rewards.find(item => item.id === id);
    if (
      this.state.level < definition.minLevel
      || (status !== 'active' && status !== 'claiming')
      || !reward
      || this.state.activity.points < reward.threshold
      || this.state.activity.claimedRewardIds.indexOf(reward.id) >= 0
    ) {
      return false;
    }
    this.state.activity.claimedRewardIds.push(reward.id);
    this.applyReward(reward.reward);
    this.save();
    return true;
  }

  addReward(reward: RewardBundle) {
    this.applyReward(reward);
    this.save();
  }

  setCoins(coins: number) {
    this.state.coins = this.nonNegativeInteger(coins, this.state.coins);
    this.save();
  }

  spendCoins(amount: number) {
    const cost = this.positiveInteger(amount);
    if (!Number.isInteger(amount) || amount < 0 || this.state.coins < cost) return false;
    this.state.coins -= cost;
    this.save();
    return true;
  }

  buyItem(id: ItemId) {
    this.resetDailyState(false);
    const definition = getItemDefinition(id);
    const progress = this.state.shop.items[id];
    if (
      !definition
      || !progress
      || !definition.purchasable
      || progress.coinPurchased
      || this.shopClaimCount(progress) >= DAILY_SHOP_ITEM_LIMIT
      || this.state.coins < definition.price
    ) {
      return false;
    }
    this.state.coins -= definition.price;
    progress.coinPurchased = true;
    this.state.inventory[id] += 1;
    this.save();
    return true;
  }

  claimItemByAd(id: ItemId) {
    this.resetDailyState(false);
    const definition = getItemDefinition(id);
    const progress = this.state.shop.items[id];
    if (
      !definition
      || !progress
      || !definition.purchasable
      || !progress.coinPurchased
      || progress.adClaims >= DAILY_SHOP_AD_LIMIT
      || this.shopClaimCount(progress) >= DAILY_SHOP_ITEM_LIMIT
    ) {
      return false;
    }
    progress.adClaims += 1;
    this.state.inventory[id] += 1;
    this.save();
    return true;
  }

  consumeItem(id: ItemId) {
    if (this.state.inventory[id] === undefined || this.state.inventory[id] <= 0) return false;
    this.state.inventory[id] -= 1;
    this.save();
    return true;
  }

  claimTask(id: DailyTaskId) {
    this.resetDailyState(false);
    const definition = DAILY_TASK_DEFINITIONS.find(item => item.id === id);
    const task = definition ? this.state.daily.tasks[id] : undefined;
    if (!definition || !task || task.claimed || task.progress < definition.target) return false;
    task.claimed = true;
    this.addReward(definition.reward);
    this.save();
    return true;
  }

  claimDailyChest() {
    this.resetDailyState(false);
    if (this.state.daily.chestClaimed || !this.isDailyChestReady()) return false;
    this.state.daily.chestClaimed = true;
    this.addReward(DAILY_CHEST_REWARD);
    this.save();
    return true;
  }

  recordRun(run: PlayerRun) {
    this.resetDailyState(false);
    const completedLevels = this.state.daily.tasks.clear_3_levels;
    const collectedElements = this.state.daily.tasks.collect_100_elements;
    completedLevels.progress = Math.min(3, completedLevels.progress + (run.won ? 1 : 0));
    collectedElements.progress = Math.min(100, collectedElements.progress + this.positiveInteger(run.collectedElements));
    this.state.daily.tasks.make_5_matches.progress = Math.min(
      5,
      Math.max(this.state.daily.tasks.make_5_matches.progress, this.positiveInteger(run.matchCount)),
    );
    const sanitized = this.sanitizeRun(run);
    if (sanitized) {
      this.state.recentRuns.push(sanitized);
      while (this.state.recentRuns.length > MAX_RECENT_RUNS) this.state.recentRuns.shift();
    }
    if (run.won) this.grantWinExperience(run.level);
    this.recordActivityRun(run);
    this.save();
  }

  private grantWinExperience(stage: number) {
    const level = Math.max(1, Math.floor(this.safeNumber(stage, 1)));
    this.state.exp += WIN_EXP_BASE + Math.min(level - 1, WIN_EXP_STAGE_BONUS_MAX);
  }

  setLevel(level: number) {
    this.state.level = Math.max(1, Math.floor(Number.isFinite(level) ? level : this.state.level));
    // 闯到主题 1–5 会解锁对应建筑；主题 6+ 不再对应新建筑
    this.applyBuildingUnlocks();
    this.save();
  }

  interactWithCat(id: CatId, interaction: CatInteraction) {
    if (interaction !== 'pet' && interaction !== 'feed' && interaction !== 'play') {
      return { ok: false, message: '暂不支持这种互动' };
    }
    this.resetDailyState(false);
    const cat = this.state.cats[id];
    if (!cat || !cat.unlocked) return { ok: false, message: '这只猫咪还没有解锁' };
    const today = this.todayKey();
    if (cat.interactionDate !== today) {
      cat.interactionDate = today;
      cat.interactionCounts = this.emptyInteractionCounts();
    }
    if (cat.interactionCounts[interaction] >= 1) {
      return { ok: false, message: '今天已经互动过啦，明天再来吧' };
    }
    if ((interaction === 'feed' || interaction === 'play') && !this.spendCoins(10)) {
      return { ok: false, message: '金币不足，完成关卡可以获得金币' };
    }
    cat.interactionCounts[interaction] += 1;
    cat.affection = Math.min(MAX_AFFECTION, cat.affection + (interaction === 'pet' ? 1 : 2));
    cat.experience = Math.min(MAX_CAT_EXPERIENCE, cat.experience + 1);
    this.recordActivityInteraction();
    this.save();
    const catName = getCatDefinition(id).name;
    return { ok: true, message: interaction === 'pet' ? `${catName}开心地蹭了蹭你` : '互动成功，好感度提升啦' };
  }

  upgradeCat(id: CatId) {
    const cat = this.state.cats[id];
    if (!cat || !cat.unlocked) return { ok: false, message: '这只猫咪还没有解锁' };
    if (cat.level >= MAX_CAT_LEVEL) return { ok: false, message: '猫咪已经达到最高等级' };
    const cost = getCatUpgradeCost(cat.level);
    if (!this.spendCoins(cost)) return { ok: false, message: `升级需要 ${cost} 金币` };
    cat.level += 1;
    cat.experience = 0;
    this.save();
    return { ok: true, message: `恭喜，${getCatDefinition(id).name}升到 Lv.${cat.level}` };
  }

  resetDailyState(shouldSave = true) {
    const today = this.todayKey();
    let changed = false;
    if (this.state.daily.dateKey !== today) {
      this.state.daily = this.createDailyState(today);
      changed = true;
    }
    if (!this.state.shop || this.state.shop.dateKey !== today) {
      this.state.shop = this.createShopDailyState(today);
      changed = true;
    }
    changed = this.resetCatInteractionState(today) || changed;
    if (changed && shouldSave) this.save();
    return changed;
  }

  private resetCatInteractionState(today: string) {
    let changed = false;
    (Object.keys(this.state.cats) as CatId[]).forEach(id => {
      const cat = this.state.cats[id];
      if (!cat.interactionDate || cat.interactionDate === today) return;
      cat.interactionDate = today;
      cat.interactionCounts = this.emptyInteractionCounts();
      changed = true;
    });
    return changed;
  }

  private syncUnlocks(shouldSave: boolean) {
    // 第 N 栋建筑装饰完成 → 解锁第 N 只猫咪
    BUILDING_DEFINITIONS.forEach((definition, index) => {
      if (this.isBuildingCompleted(definition.id)) {
        const catId = BUILDING_CATS[index];
        if (catId) this.state.cats[catId].unlocked = true;
      }
    });
    if (shouldSave) this.save();
  }

  private createDefaultState(): PlayerState {
    const cats = {} as PlayerState['cats'];
    (['orange', 'white', 'black', 'ragdoll', 'aurora'] as CatId[]).forEach(id => {
      cats[id] = {
        unlocked: false,
        level: 1,
        experience: 0,
        affection: 0,
        interactionDate: '',
        interactionCounts: this.emptyInteractionCounts(),
        skillReadyAt: 0,
        skillCharge: 0,
      };
    });
    return {
      version: 2,
      userName: '',
      userId: '',
      coins: 100,
      stars: 0,
      totalStarsEarned: 0,
      level: 1,
      exp: 0,
      levelStars: {},
      buildStage: 0,
      cats,
      equippedCat: null,
      gamePetPosition: { side: 'right', y: 220 },
      inventory: { hammer: 0, glove: 0, dice: 0, extra_slot: 0 },
      buildings: this.createBuildingStates(),
      daily: this.createDailyState(this.todayKey()),
      shop: this.createShopDailyState(this.todayKey()),
      activity: createActivityState(getCurrentActivity(), this.todayKey()),
      recentRuns: [],
      adFunnel: this.createAdFunnel(),
      endless: this.createEndlessProgress(),
      firstTownGuideDone: false,
      boardTutorialDone: false,
      collectGoalHintDone: false,
    };
  }

  private createAdFunnelBand(): AdFunnelBandStats {
    return {
      fails: 0,
      pairFails: 0,
      failProgressSum: 0,
      adRevives: 0,
      freeRevives: 0,
      reviveWins: 0,
      doubleCoins: 0,
    };
  }

  private createAdFunnel(): AdFunnelState {
    return {
      l1_5: this.createAdFunnelBand(),
      l6_10: this.createAdFunnelBand(),
      l11_22: this.createAdFunnelBand(),
      l23: this.createAdFunnelBand(),
    };
  }

  static funnelBandForLevel(level: number): AdFunnelBand {
    if (level <= 5) return 'l1_5';
    if (level <= 10) return 'l6_10';
    if (level <= 22) return 'l11_22';
    return 'l23';
  }

  getAdFunnel(): AdFunnelState {
    return this.clone(this.state.adFunnel);
  }

  getAdFunnelSummary(): string {
    const funnel = this.state.adFunnel;
    const format = (label: string, band: AdFunnelBandStats) => {
      const revives = band.adRevives + band.freeRevives;
      return `${label} ${band.reviveWins}/${revives}`;
    };
    return `复活后通关  ${format('1-5', funnel.l1_5)}  ${format('6-10', funnel.l6_10)}  ${format('11-22', funnel.l11_22)}  ${format('23+', funnel.l23)}`;
  }

  recordAdFunnel(event: {
    level: number;
    fail?: boolean;
    failHadPair?: boolean;
    failProgress?: number;
    adRevive?: boolean;
    freeRevive?: boolean;
    reviveWin?: boolean;
    doubleCoins?: boolean;
  }) {
    const band = this.state.adFunnel[PlayerStore.funnelBandForLevel(event.level)];
    if (event.fail) {
      band.fails += 1;
      if (event.failHadPair) band.pairFails += 1;
      if (Number.isFinite(event.failProgress)) {
        band.failProgressSum += Math.max(0, Math.min(100, Math.floor(event.failProgress!)));
      }
    }
    if (event.adRevive) band.adRevives += 1;
    if (event.freeRevive) band.freeRevives += 1;
    if (event.reviveWin) band.reviveWins += 1;
    if (event.doubleCoins) band.doubleCoins += 1;
    this.save();
  }

  private createEndlessProgress(): EndlessProgress {
    return {
      bestEliminated: 0,
      lastEliminated: 0,
      lastDurationMs: 0,
      lastStage: 0,
      totalRuns: 0,
      totalEliminated: 0,
      dailyRewardDateKey: '',
    };
  }

  private createBuildingStates(): Record<BuildingId, BuildingProgress> {
    const buildings = {} as Record<BuildingId, BuildingProgress>;
    BUILDING_DEFINITIONS.forEach(definition => {
      buildings[definition.id] = { unlocked: definition.id === 'cat_house', stage: 0, subProgress: 0 };
    });
    return buildings;
  }

  // 建筑随主题解锁：第 N 栋建筑在玩家闯到第 N 个主题（level >= 20*(N-1)+1）后开放。
  // 只遍历现有 5 栋，主题 6+ 不会越界解锁不存在的建筑。
  private applyBuildingUnlocks() {
    BUILDING_DEFINITIONS.forEach((definition, index) => {
      if (definition.id === 'cat_house') return;
      const themeReached = this.state.level >= index * LEVELS_PER_THEME + 1;
      this.state.buildings[definition.id].unlocked = themeReached;
    });
  }

  private createDailyState(dateKey: string): DailyState {
    const tasks = {} as DailyState['tasks'];
    DAILY_TASK_DEFINITIONS.forEach(definition => {
      tasks[definition.id] = { progress: 0, claimed: false };
    });
    return { dateKey, tasks, chestClaimed: false, challengeRewardClaimed: false };
  }

  private createShopDailyState(dateKey: string): ShopDailyState {
    const items = {} as ShopDailyState['items'];
    DAILY_SHOP_ITEM_IDS.forEach(id => {
      items[id] = { coinPurchased: false, adClaims: 0 };
    });
    return { dateKey, items };
  }

  private normalize(value: SavedPlayerState): PlayerState {
    const state = this.createDefaultState();
    if (!value || (value.version !== 1 && value.version !== 2)) return state;
    state.userName = typeof value.userName === 'string' ? value.userName.trim() : '';
    state.userId = typeof value.userId === 'string' ? value.userId.trim() : '';
    state.coins = this.nonNegativeInteger(value.coins, state.coins);
    state.stars = this.nonNegativeInteger(value.stars, state.stars);
    state.totalStarsEarned = this.nonNegativeInteger(value.totalStarsEarned, 0);
    state.level = Math.max(1, Math.floor(this.safeNumber(value.level, state.level)));
    // 老存档没有 exp 字段：按当前关卡进度预置经验，让经验等级从原显示值无缝衔接
    if (value.exp === undefined || value.exp === null) {
      state.exp = totalExpForLevel(state.level);
    } else {
      state.exp = Math.max(0, Math.floor(this.safeNumber(value.exp, 0)));
    }
    state.buildStage = Math.max(0, Math.floor(this.safeNumber(value.buildStage, state.buildStage)));
    if (value.levelStars && typeof value.levelStars === 'object') {
      const savedLevelStars = value.levelStars as Record<string, number>;
      Object.keys(savedLevelStars).slice(0, 2000).forEach(key => {
        const level = Number(key);
        if (!Number.isInteger(level) || level < 1) return;
        const stars = Math.min(3, Math.max(0, Math.floor(this.safeNumber(savedLevelStars[key], 0))));
        if (stars > 0) state.levelStars[level] = stars;
      });
    }
    BUILDING_DEFINITIONS.forEach(definition => {
      const saved = value.buildings?.[definition.id];
      if (!saved || typeof saved !== 'object') return;
      state.buildings[definition.id] = {
        unlocked: saved.unlocked === true || state.buildings[definition.id].unlocked,
        stage: Math.max(0, Math.floor(this.safeNumber(saved.stage, 0))),
        // 旧档没有 subProgress：stage 语义是「已完成大节点数」，当前阶段从 0 格开始
        subProgress: Math.max(0, Math.floor(this.safeNumber(saved.subProgress, 0))),
      };
    });
    if (Array.isArray(value.recentRuns)) {
      value.recentRuns.slice(-MAX_RECENT_RUNS).forEach(run => {
        const sanitized = this.sanitizeRun(run as PlayerRun);
        if (sanitized) state.recentRuns.push(sanitized);
      });
    }
    state.adFunnel = this.sanitizeAdFunnel(value.adFunnel);
    (Object.keys(state.cats) as CatId[]).forEach(id => {
      const saved = value.cats?.[id];
      if (!saved) return;
      state.cats[id] = {
        unlocked: saved.unlocked === true,
        level: Math.min(MAX_CAT_LEVEL, Math.max(1, Math.floor(this.safeNumber(saved.level, 1)))),
        experience: Math.min(MAX_CAT_EXPERIENCE, this.nonNegativeInteger(saved.experience, 0)),
        affection: Math.min(MAX_AFFECTION, this.nonNegativeInteger(saved.affection, 0)),
        interactionDate: typeof saved.interactionDate === 'string' ? saved.interactionDate : '',
        interactionCounts: {
          pet: Math.min(1, Math.max(0, Math.floor(this.safeNumber(saved.interactionCounts?.pet, 0)))),
          feed: Math.min(1, Math.max(0, Math.floor(this.safeNumber(saved.interactionCounts?.feed, 0)))),
          play: Math.min(1, Math.max(0, Math.floor(this.safeNumber(saved.interactionCounts?.play, 0)))),
        },
        skillReadyAt: Math.max(0, Math.floor(this.safeNumber(saved.skillReadyAt, 0))),
        skillCharge: this.nonNegativeInteger(saved.skillCharge, 0),
      };
    });
    if (
      typeof value.equippedCat === 'string'
      && value.equippedCat in state.cats
      && state.cats[value.equippedCat as CatId].unlocked
    ) {
      state.equippedCat = value.equippedCat as CatId;
    }
    const savedPetPosition = value.gamePetPosition;
    if (savedPetPosition && typeof savedPetPosition === 'object') {
      state.gamePetPosition = {
        side: savedPetPosition.side === 'left' ? 'left' : 'right',
        y: Math.max(
          -600,
          Math.min(600, Math.floor(this.safeNumber(savedPetPosition.y, state.gamePetPosition.y))),
        ),
      };
    }
    (Object.keys(state.inventory) as ItemId[]).forEach(id => {
      state.inventory[id] = Math.max(0, Math.floor(this.safeNumber(value.inventory?.[id], 0)));
    });
    if (value.shop?.dateKey && value.shop.dateKey === this.todayKey()) {
      state.shop.dateKey = value.shop.dateKey;
      DAILY_SHOP_ITEM_IDS.forEach(id => {
        const savedItem = value.shop?.items?.[id];
        if (!savedItem) return;
        const coinPurchased = savedItem.coinPurchased === true;
        state.shop.items[id] = {
          coinPurchased,
          adClaims: coinPurchased
            ? Math.min(DAILY_SHOP_AD_LIMIT, this.nonNegativeInteger(savedItem.adClaims, 0))
            : 0,
        };
      });
    }
    if (value.daily?.dateKey && value.daily.dateKey === this.todayKey()) {
      (Object.keys(state.daily.tasks) as DailyTaskId[]).forEach(id => {
        const savedTask = value.daily?.tasks?.[id];
        if (!savedTask) return;
        state.daily.tasks[id] = {
          progress: Math.min(
            DAILY_TASK_DEFINITIONS.find(definition => definition.id === id)!.target,
            Math.max(0, Math.floor(this.safeNumber(savedTask.progress, 0))),
          ),
          claimed: savedTask.claimed === true,
        };
      });
      state.daily.chestClaimed = value.daily.chestClaimed === true;
      state.daily.challengeRewardClaimed = value.daily.challengeRewardClaimed === true;
      state.daily.dateKey = value.daily.dateKey;
    }
    const activityDefinition = getCurrentActivity();
    const savedActivity = value.activity;
    if (savedActivity?.eventId === activityDefinition.id) {
      const activity = createActivityState(activityDefinition, this.todayKey());
      activity.points = Math.min(
        activityDefinition.totalPoints,
        this.nonNegativeInteger(savedActivity.points, 0),
      );
      activity.dailyPointDateKey = typeof savedActivity.dailyPointDateKey === 'string'
        ? savedActivity.dailyPointDateKey
        : this.todayKey();
      activity.dailyDirectPoints = Math.min(
        activityDefinition.dailyDirectPointLimit,
        this.nonNegativeInteger(savedActivity.dailyDirectPoints, 0),
      );
      activity.completedLevelIds = Array.isArray(savedActivity.completedLevelIds)
        ? savedActivity.completedLevelIds
          .filter(level => Number.isInteger(level) && level > 0)
          .slice(0, 1000)
        : [];
      activityDefinition.tasks.forEach(taskDefinition => {
        const savedTask = savedActivity.tasks?.[taskDefinition.id];
        if (!savedTask) return;
        activity.tasks[taskDefinition.id] = {
          progress: Math.min(
            taskDefinition.target,
            this.nonNegativeInteger(savedTask.progress, 0),
          ),
          claimed: savedTask.claimed === true,
        };
      });
      activity.claimedRewardIds = Array.isArray(savedActivity.claimedRewardIds)
        ? savedActivity.claimedRewardIds.filter(id => activityDefinition.rewards.some(reward => reward.id === id))
        : [];
      state.activity = activity;
    }
    const savedEndless = value.endless;
    if (savedEndless && typeof savedEndless === 'object') {
      state.endless = {
        bestEliminated: this.nonNegativeInteger(savedEndless.bestEliminated, 0),
        lastEliminated: this.nonNegativeInteger(savedEndless.lastEliminated, 0),
        lastDurationMs: this.nonNegativeInteger(savedEndless.lastDurationMs, 0),
        lastStage: Math.max(0, Math.min(7, Math.floor(this.safeNumber(savedEndless.lastStage, 0)))),
        totalRuns: this.nonNegativeInteger(savedEndless.totalRuns, 0),
        totalEliminated: this.nonNegativeInteger(savedEndless.totalEliminated, 0),
        dailyRewardDateKey: typeof savedEndless.dailyRewardDateKey === 'string'
          ? savedEndless.dailyRewardDateKey
          : '',
      };
    }
    state.firstTownGuideDone = value.firstTownGuideDone === true;
    state.boardTutorialDone = value.boardTutorialDone === true;
    state.collectGoalHintDone = value.collectGoalHintDone === true;
    return state;
  }

  private recordActivityRun(run: PlayerRun) {
    this.syncActivityState(false);
    const definition = getCurrentActivity();
    if (!this.canEarnActivity(definition)) return;

    const activity = this.state.activity;
    if (run.won && run.level > 0 && activity.completedLevelIds.indexOf(run.level) < 0) {
      activity.completedLevelIds.push(run.level);
      this.incrementActivityTask('complete_levels', 1, definition);
      this.addDirectActivityPoints(30, definition);
    }

    this.recordActivityMatches(this.positiveInteger(run.matchCount));
  }

  private recordActivityMatches(matchCount: number) {
    this.syncActivityState(false);
    const definition = getCurrentActivity();
    if (!this.canEarnActivity(definition) || matchCount <= 0) return;
    this.incrementActivityTask('make_matches', matchCount, definition);
    this.addDirectActivityPoints(Math.min(10, matchCount) * 5, definition);
  }

  private recordActivityInteraction() {
    this.syncActivityState(false);
    const definition = getCurrentActivity();
    if (!this.canEarnActivity(definition)) return;
    this.incrementActivityTask('interact_cats', 1, definition);
    this.addDirectActivityPoints(10, definition);
  }

  private incrementActivityTask(id: ActivityTaskId, amount: number, definition: ActivityDefinition) {
    const taskDefinition = definition.tasks.find(task => task.id === id);
    const task = this.state.activity.tasks[id];
    if (!taskDefinition || !task) return;
    task.progress = Math.min(taskDefinition.target, task.progress + this.positiveInteger(amount));
  }

  private addDirectActivityPoints(amount: number, definition: ActivityDefinition) {
    const remainingDaily = Math.max(0, definition.dailyDirectPointLimit - this.state.activity.dailyDirectPoints);
    const remainingEvent = Math.max(0, definition.totalPoints - this.state.activity.points);
    const granted = Math.min(this.positiveInteger(amount), remainingDaily, remainingEvent);
    this.state.activity.dailyDirectPoints += granted;
    this.state.activity.points += granted;
  }

  private canEarnActivity(definition: ActivityDefinition) {
    return this.state.level >= definition.minLevel
      && this.activityWindowStatus(definition, Date.now()) === 'active';
  }

  private syncActivityState(shouldSave: boolean) {
    const definition = getCurrentActivity();
    const today = this.todayKey();
    let changed = false;
    if (!this.state.activity || this.state.activity.eventId !== definition.id) {
      this.state.activity = createActivityState(definition, today);
      changed = true;
    }
    if (this.state.activity.dailyPointDateKey !== today) {
      this.state.activity.dailyPointDateKey = today;
      this.state.activity.dailyDirectPoints = 0;
      changed = true;
    }
    if (this.activityWindowStatus(definition, Date.now()) === 'ended') {
      changed = this.settleExpiredActivity(definition) || changed;
    }
    if (changed && shouldSave) this.save();
    return changed;
  }

  private settleExpiredActivity(definition: ActivityDefinition) {
    let changed = false;
    definition.rewards.forEach(reward => {
      if (
        this.state.activity.points < reward.threshold
        || this.state.activity.claimedRewardIds.indexOf(reward.id) >= 0
      ) {
        return;
      }
      this.state.activity.claimedRewardIds.push(reward.id);
      this.applyReward(reward.reward);
      changed = true;
    });
    return changed;
  }

  private activityWindowStatus(definition: ActivityDefinition, now: number): ActivityStatus {
    if (now < Date.parse(definition.startAt)) return 'scheduled';
    if (now < Date.parse(definition.endAt)) return 'active';
    if (now < Date.parse(definition.claimEndAt)) return 'claiming';
    return 'ended';
  }

  private activityRemainingMs(
    definition: ActivityDefinition,
    status: ActivityStatus,
    now: number,
  ) {
    if (status === 'scheduled') return Math.max(0, Date.parse(definition.startAt) - now);
    if (status === 'active') return Math.max(0, Date.parse(definition.endAt) - now);
    if (status === 'claiming') return Math.max(0, Date.parse(definition.claimEndAt) - now);
    return 0;
  }

  private applyReward(reward: RewardBundle) {
    this.state.coins += this.positiveInteger(reward.coins);
    this.state.stars += this.positiveInteger(reward.stars);
    this.state.totalStarsEarned += this.positiveInteger(reward.stars);
    Object.keys(reward.items || {}).forEach(id => {
      const amount = reward.items![id as ItemId];
      if (!amount || this.state.inventory[id as ItemId] === undefined) return;
      this.state.inventory[id as ItemId] += this.positiveInteger(amount);
    });
  }

  private shopClaimCount(progress: { coinPurchased: boolean; adClaims: number }) {
    return (progress.coinPurchased ? 1 : 0) + progress.adClaims;
  }

  private sanitizeRun(run: PlayerRun): PlayerRun | null {
    if (!run || typeof run !== 'object') return null;
    if (typeof run.won !== 'boolean' || !Number.isFinite(run.level) || run.level <= 0) return null;
    const sanitized: PlayerRun = {
      won: run.won,
      level: Math.max(1, Math.floor(run.level)),
      remainingSlots: Math.max(0, Math.floor(this.safeNumber(run.remainingSlots, 0))),
      mistakes: Math.max(0, Math.floor(this.safeNumber(run.mistakes, 0))),
      elapsedMs: Math.max(0, Math.floor(this.safeNumber(run.elapsedMs, 0))),
      decisionCount: Math.max(0, Math.floor(this.safeNumber(run.decisionCount, 0))),
      nearFailureCount: Math.max(0, Math.floor(this.safeNumber(run.nearFailureCount, 0))),
      collectedElements: Math.max(0, Math.floor(this.safeNumber(run.collectedElements, 0))),
      matchCount: Math.max(0, Math.floor(this.safeNumber(run.matchCount, 0))),
    };
    if (run.role === 'normal' || run.role === 'breather' || run.role === 'spike') sanitized.role = run.role;
    if (Number.isFinite(run.failProgress)) {
      sanitized.failProgress = Math.max(0, Math.min(100, Math.floor(run.failProgress!)));
    }
    if (typeof run.failHadPair === 'boolean') sanitized.failHadPair = run.failHadPair;
    if (run.revived === true) sanitized.revived = true;
    if (run.reviveFree === true) sanitized.reviveFree = true;
    return sanitized;
  }

  private sanitizeAdFunnel(value: AdFunnelState | undefined): AdFunnelState {
    const funnel = this.createAdFunnel();
    if (!value || typeof value !== 'object') return funnel;
    (Object.keys(funnel) as AdFunnelBand[]).forEach(band => {
      const saved = value[band];
      if (!saved || typeof saved !== 'object') return;
      funnel[band] = {
        fails: this.nonNegativeInteger(saved.fails, 0),
        pairFails: this.nonNegativeInteger(saved.pairFails, 0),
        failProgressSum: this.nonNegativeInteger(saved.failProgressSum, 0),
        adRevives: this.nonNegativeInteger(saved.adRevives, 0),
        freeRevives: this.nonNegativeInteger(saved.freeRevives, 0),
        reviveWins: this.nonNegativeInteger(saved.reviveWins, 0),
        doubleCoins: this.nonNegativeInteger(saved.doubleCoins, 0),
      };
    });
    return funnel;
  }

  private safeNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private positiveInteger(value: number | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private nonNegativeInteger(value: number | undefined, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : fallback;
  }

  private todayKey() {
    const now = new Date();
    const month = `0${now.getMonth() + 1}`.slice(-2);
    const day = `0${now.getDate()}`.slice(-2);
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private emptyInteractionCounts() {
    return { pet: 0, feed: 0, play: 0 };
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
}
