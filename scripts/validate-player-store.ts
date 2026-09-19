import { sys } from 'cc';
import { PlayerStore } from '../assets/scripts/PlayerStore';
import { BUILDING_DEFINITIONS, isCampaignComplete, MAX_MAIN_LEVEL, themeIndexForLevel } from '../assets/scripts/TownContent';
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[PlayerStore] ${message}`);
}

function testDefaultsAndRewards() {
  const store = new PlayerStore('player-store-defaults');
  store.load();
  const initial = store.getState();
  assert(initial.coins === 100, 'new players should start with 100 coins');
  assert(initial.stars === 0, 'new players should start with 0 stars');
  assert(initial.level === 1, 'new players should start at level 1');
  assert(initial.buildings.cat_house.unlocked, 'cat house should be unlocked');
  assert(!initial.cats.orange.unlocked, 'orange cat should start locked');
  store.addReward({ coins: 40, stars: 3, items: { hammer: 2 } });
  assert(store.getCoins() === 140, 'reward coins should be added');
  assert(store.getStars() === 3, 'reward stars should be added');
  assert(store.getItemCount('hammer') === 2, 'reward items should be added');
  assert(store.spendCoins(40), 'spending available coins should succeed');
  assert(store.getCoins() === 100, 'spent coins should be deducted');
  assert(!store.spendCoins(101), 'overspending should fail');
  assert(store.getCoins() === 100, 'failed spending should not mutate coins');
}

function testBuildingAndCatUnlock() {
  const store = new PlayerStore('player-store-building');
  store.load();
  // 小节点机制：20 格 × 3 星 = 60 星建满小屋（5 清理 + 7 修复 + 8 装饰）
  store.addReward({ stars: 3 });
  const first = store.lightBuildingCell('cat_house');
  assert(first.ok, 'lighting the first cell should succeed with 3 stars');
  assert(!first.stageJustCompleted && !first.buildingCompleted, 'first cell should not complete anything');
  assert(!store.lightBuildingCell('cat_house').ok, 'lighting should fail when stars are insufficient');
  assert(store.hasBuiltTown(), 'lighting one cell should count as having built the town');
  store.addReward({ stars: 57 });
  for (let index = 0; index < 19; index += 1) {
    assert(store.lightBuildingCell('cat_house').ok, `cell ${index + 2} should light`);
  }
  assert(store.isBuildingCompleted('cat_house'), '20 cells should complete the cat house');
  assert(store.getCat('orange').unlocked, 'completing cat house should unlock orange cat');
  assert(store.getStars() === 0, 'building should consume exactly 60 stars');
  assert(!store.lightBuildingCell('cat_house').ok, 'completed building should reject further lighting');
}

function testBuildTargetsAndGuideFlag() {
  const store = new PlayerStore('player-store-build-target');
  store.load();
  const target = store.getNextBuildableInfo();
  assert(!!target && target.buildingId === 'cat_house', 'first build target should be the cat house');
  assert(target!.cellCount === 5 && target!.subProgress === 0, 'clean stage should expose five cells');
  assert(target!.starsNeeded === 3, 'new player should need three stars for the next cell');
  assert(!store.canLightNextBuildingCell(), 'zero stars should not be enough to light a cell');
  // 引导条件要求「至少通过一关」：记录第 1 关星星来模拟 L1 已通
  store.recordLevelStars(1, 3);
  assert(store.shouldShowFirstTownGuide(), 'cleared level + unbuilt town should show the first town guide');
  store.markFirstTownGuideDone();
  store.markFirstTownGuideDone();
  assert(!store.shouldShowFirstTownGuide(), 'guide flag should suppress the first town guide');

  store.addReward({ stars: 3 });
  assert(store.canLightNextBuildingCell(), 'three stars should be enough to light a cell');
  assert(store.lightBuildingCell('cat_house').ok, 'lighting should succeed');
  assert(store.getNextBuildableInfo()!.subProgress === 1, 'sub progress should advance after lighting');
  assert(!store.canLightNextBuildingCell(), 'spending stars should re-lock the next cell');

  // 无尽解锁与星星无关：第 1 关通关即开放（回归旧语义）
  assert(!store.isEndlessUnlocked(), 'endless stays locked before clearing level 1');
  store.setLevel(2);
  assert(store.isEndlessUnlocked(), 'clearing level 1 should unlock endless');
}

function testShopLimits() {
  const store = new PlayerStore('player-store-shop');
  store.load();
  assert(store.buyItem('hammer'), 'first coin shop purchase should succeed');
  assert(!store.buyItem('hammer'), 'duplicate coin purchase should fail');
  for (let index = 0; index < 4; index += 1) assert(store.claimItemByAd('hammer'), `ad claim ${index + 1} should succeed`);
  assert(!store.claimItemByAd('hammer'), 'ad claim limit should be enforced');
  assert(store.getItemCount('hammer') === 5, 'shop total claims should equal five');
  const status = store.getShopItemStatus('hammer');
  assert(status.totalClaims === 5 && status.maxClaims === 5, 'shop status should expose claim totals');
}

function testDailyTasksAndChest() {
  const store = new PlayerStore('player-store-daily');
  store.load();
  for (let index = 0; index < 3; index += 1) {
    store.recordRun({ won: true, level: index + 1, remainingSlots: 2, mistakes: 0, elapsedMs: 1000,
      decisionCount: 3, nearFailureCount: 0, collectedElements: 34, matchCount: 5 });
  }
  assert(store.getTasks().every(task => task.completed), 'three winning runs should complete daily tasks');
  assert(store.isDailyChestReady(), 'daily chest should unlock when all tasks are complete');
  assert(store.claimTask('clear_3_levels'), 'completed level task should be claimable');
  assert(store.claimTask('collect_100_elements'), 'collection task should be claimable');
  assert(store.claimTask('make_5_matches'), 'match task should be claimable');
  assert(!store.claimTask('make_5_matches'), 'claimed task should not be claimable twice');
  assert(store.claimDailyChest(), 'daily chest should be claimable once');
  assert(!store.claimDailyChest(), 'daily chest should not be claimable twice');
  assert(store.getItemCount('hammer') === 2, 'daily reward and chest should grant two hammers');
  assert(store.getItemCount('dice') === 1, 'daily chest should grant one dice');
}

function testCatInteractionsAndChallengeReward() {
  const store = new PlayerStore('player-store-cats');
  store.load();
  store.addReward({ stars: 60 });
  for (let index = 0; index < 20; index += 1) {
    assert(store.lightBuildingCell('cat_house').ok, `house cell ${index + 1} should light`);
  }
  assert(store.getCat('orange').unlocked, 'orange cat should be unlocked for interaction tests');
  const beforeCoins = store.getCoins();
  assert(store.interactWithCat('orange', 'pet').ok, 'pet interaction should succeed once per day');
  assert(!store.interactWithCat('orange', 'pet').ok, 'duplicate pet interaction should fail');
  assert(store.interactWithCat('orange', 'feed').ok, 'feed interaction should spend coins and succeed');
  assert(store.getCoins() === beforeCoins - 10, 'feeding should cost ten coins');
  assert(!store.isChallengeRewardClaimed(), 'challenge reward should start unclaimed');
  store.markChallengeRewardClaimed();
  store.markChallengeRewardClaimed();
  assert(store.isChallengeRewardClaimed(), 'challenge reward marker should be idempotent');
}

function testEndlessProgress() {
  const store = new PlayerStore('player-store-endless');
  store.load();
  assert(!store.isEndlessUnlocked(), 'endless should stay locked before clearing level 1');
  const first = store.recordEndlessRun({ eliminated: 45, durationMs: 180000, stage: 4, matchCount: 8 });
  assert(first.coins === 43, 'first endless run should grant floor(45/15)+40 coins');
  assert(first.isNewRecord, 'first endless run should set a record');
  assert(store.getEndlessProgress().bestEliminated === 45, 'best eliminated should persist');
  const second = store.recordEndlessRun({ eliminated: 12, durationMs: 40000, stage: 1, matchCount: 2 });
  assert(second.coins === 0, 'same-day repeat below 15 cards should grant no coins');
  assert(!second.isNewRecord, 'lower score should not replace the record');
  store.setLevel(2);
  assert(store.isEndlessUnlocked(), 'clearing level 1 should unlock endless');
}

function testAdFunnelAndRunFields() {
  const store = new PlayerStore('player-store-ad-funnel');
  store.load();
  const empty = store.getAdFunnel();
  assert(empty.l23.fails === 0 && empty.l1_5.reviveWins === 0, 'new saves should start with an empty ad funnel');
  store.recordRun({
    won: false,
    level: 24,
    remainingSlots: 0,
    mistakes: 2,
    elapsedMs: 40000,
    decisionCount: 6,
    nearFailureCount: 1,
    collectedElements: 70,
    matchCount: 18,
    role: 'spike',
    failProgress: 88,
    failHadPair: true,
  });
  const recent = store.getRecentRuns()[0];
  assert(recent.role === 'spike', 'optional run role should persist');
  assert(recent.failProgress === 88, 'fail progress should persist');
  assert(recent.failHadPair === true, 'fail pair flag should persist');
  store.recordAdFunnel({ level: 24, fail: true, failHadPair: true, failProgress: 88 });
  store.recordAdFunnel({ level: 24, adRevive: true });
  store.recordAdFunnel({ level: 24, reviveWin: true });
  const funnel = store.getAdFunnel();
  assert(funnel.l23.fails === 1 && funnel.l23.pairFails === 1, 'monetization-tier fails should land in L23+');
  assert(funnel.l23.adRevives === 1 && funnel.l23.reviveWins === 1, 'revive funnel should count separately from recentRuns');
  assert(store.getAdFunnelSummary().indexOf('23+ 1/1') >= 0, 'settings summary should show revive conversion');

  const reloaded = new PlayerStore('player-store-ad-funnel');
  reloaded.load();
  assert(reloaded.getAdFunnel().l23.reviveWins === 1, 'ad funnel should survive reload');
  assert(reloaded.getRecentRuns()[0].failHadPair === true, 'optional run fields should survive reload');
}

function testSaveNormalization() {
  const key = 'player-store-normalization';
  sys.localStorage.setItem(key, JSON.stringify({ version: 1, coins: -50, level: 4, inventory: { hammer: 3 } }));
  const store = new PlayerStore(key);
  store.load();
  const state = store.getState();
  assert(state.coins === 0, 'invalid negative coins should be clamped to zero');
  assert(state.level === 4, 'valid legacy level should be preserved');
  assert(state.inventory.hammer === 3, 'valid legacy inventory should be preserved');
  assert(state.endless.bestEliminated === 0, 'legacy saves should receive empty endless progress');
  sys.localStorage.setItem(key, JSON.stringify({ version: 999, coins: 999999 }));
  store.load();
  assert(store.getCoins() === 100, 'invalid save version should reset to defaults');
}

function testLegacyBuildingSave() {
  // 旧档 stage=1（清理已完成）且没有 subProgress：读档后当前阶段从 0 格开始，进度无损
  const key = 'player-store-building-legacy';
  sys.localStorage.setItem(key, JSON.stringify({
    version: 2,
    buildStage: 1,
    buildings: { cat_house: { unlocked: true, stage: 1 } },
  }));
  const store = new PlayerStore(key);
  store.load();
  const house = store.getBuildingViews()[0];
  assert(house.stage === 1, 'legacy stage should be preserved');
  assert(house.subProgress === 0 && house.cellCount === 7, 'legacy current stage should start at zero cells');
  store.addReward({ stars: 3 });
  const result = store.lightBuildingCell('cat_house');
  assert(result.ok && !result.stageJustCompleted, 'legacy save should continue lighting the repair stage');
  assert(store.getBuildingViews()[0].subProgress === 1, 'legacy lighting should advance sub progress');
}

function testBoardTutorialFlag() {
  const store = new PlayerStore('player-store-tutorial');
  store.load();
  assert(!store.isBoardTutorialDone(), 'board tutorial should be pending for new saves');
  store.markBoardTutorialDone();
  store.markBoardTutorialDone();
  assert(store.isBoardTutorialDone(), 'board tutorial marker should be idempotent');
  const reloaded = new PlayerStore('player-store-tutorial');
  reloaded.load();
  assert(reloaded.isBoardTutorialDone(), 'board tutorial flag should survive reload');
  // 旧档没有该字段：normalize 补 false（level>1 永不触发，无副作用）
  const legacyKey = 'player-store-tutorial-legacy';
  sys.localStorage.setItem(legacyKey, JSON.stringify({ version: 2, level: 4 }));
  const legacy = new PlayerStore(legacyKey);
  legacy.load();
  assert(!legacy.isBoardTutorialDone(), 'legacy saves should default the flag to false');
}

function testLateThemesDoNotAddBuildings() {
  const store = new PlayerStore('player-store-late-theme');
  store.load();
  store.setLevel(101);
  const views = store.getBuildingViews();
  assert(views.length === 5, 'late themes must not add town buildings');
  assert(views.every(building => building.unlocked), 'reaching theme 6 should still unlock all five existing buildings');
  assert(store.getNextBuildableInfo()?.buildingId === 'cat_house', 'unbuilt house remains the next target after theme 6');
  store.setLevel(MAX_MAIN_LEVEL + 1);
  assert(isCampaignComplete(store.getLevel()), 'level 161 should mark the campaign complete');
  assert(themeIndexForLevel(101) === 5, 'level 101 belongs to theme 6');
  assert(themeIndexForLevel(MAX_MAIN_LEVEL + 1) === 7, 'finished campaign stays on the last theme');
  assert(BUILDING_DEFINITIONS.length === 5, 'building table stays at five entries');
}

function testCollectGoalSchedule() {
  const scheduled = LevelGenerator.COLLECT_GOAL_LEVELS;
  [11, 51, 111, 158].forEach(level => {
    assert(scheduled.indexOf(level) >= 0, `level ${level} should be on the collect schedule`);
    assert(LevelGenerator.wantsCollectGoal(level, 'normal', false, false), `level ${level} should request a collect goal`);
  });
  assert(!LevelGenerator.wantsCollectGoal(110, 'breather', false, false), 'breather levels must not request collect goals');
  assert(!LevelGenerator.wantsCollectGoal(111, 'normal', true, false), 'challenge boards must not request collect goals');
  assert(!LevelGenerator.wantsCollectGoal(23, 'normal', false, false), 'theme 2 keeps the original 21/24/28 schedule');
}

function testCollectGoalHintFlag() {
  const store = new PlayerStore('player-store-collect-hint');
  store.load();
  assert(!store.isCollectGoalHintDone(), 'collect goal hint should be pending for new saves');
  store.markCollectGoalHintDone();
  store.markCollectGoalHintDone();
  assert(store.isCollectGoalHintDone(), 'collect goal hint marker should be idempotent');
  const reloaded = new PlayerStore('player-store-collect-hint');
  reloaded.load();
  assert(reloaded.isCollectGoalHintDone(), 'collect goal hint flag should survive reload');
  const legacyKey = 'player-store-collect-hint-legacy';
  sys.localStorage.setItem(legacyKey, JSON.stringify({ version: 2, level: 11 }));
  const legacy = new PlayerStore(legacyKey);
  legacy.load();
  assert(!legacy.isCollectGoalHintDone(), 'legacy saves should default the collect hint flag to false');
}

testDefaultsAndRewards();
testBuildingAndCatUnlock();
testBuildTargetsAndGuideFlag();
testBoardTutorialFlag();
testCollectGoalHintFlag();
testLateThemesDoNotAddBuildings();
testCollectGoalSchedule();
testShopLimits();
testDailyTasksAndChest();
testCatInteractionsAndChallengeReward();
testEndlessProgress();
testAdFunnelAndRunFields();
testSaveNormalization();
testLegacyBuildingSave();
  process.stdout.write('PlayerStore validation passed: defaults, rewards, cells/targets/guide, board tutorial, collect hint, late themes, collect schedule, shop, daily tasks, cats, challenge marker, endless, ad funnel, normalization, legacy building save.\n');
