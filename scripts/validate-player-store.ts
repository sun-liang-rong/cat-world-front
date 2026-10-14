import { sys } from 'cc';
import { PlayerStore } from '../assets/scripts/PlayerStore';
import { BUILDING_DEFINITIONS, isCampaignComplete, MAX_MAIN_LEVEL, themeIndexForLevel } from '../assets/scripts/TownContent';
import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';
import { getCatSkillChargeRequired, getCatUpgradeCost } from '../assets/scripts/GameContent';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[PlayerStore] ${message}`);
}

function withTime<T>(iso: string, run: () => T): T {
  const OriginalDate = Date;
  const now = OriginalDate.parse(iso);
  class FixedDate extends OriginalDate {
    constructor(value?: string | number) {
      super(value === undefined ? now : typeof value === 'string' ? OriginalDate.parse(value) : value);
    }
    static now() { return now; }
    // 模拟 UTC 设备，确保上海日期不依赖测试机的本地时区。
    getFullYear() { return this.getUTCFullYear(); }
    getMonth() { return this.getUTCMonth(); }
    getDate() { return this.getUTCDate(); }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = OriginalDate;
  }
}

function testTrialReloadAndUpgradeCosts() {
  const key = 'player-store-trial-reload';
  const store = new PlayerStore(key);
  store.load();
  store.setLevel(2);
  assert(store.startCatTrial().ok, 'trial should start after the first clear');
  const reloaded = new PlayerStore(key);
  reloaded.load();
  assert(reloaded.getCatTrial().remainingGames === 5, 'reload must preserve all five trial games');
  reloaded.consumeCatTrialGame();
  const consumed = new PlayerStore(key);
  consumed.load();
  assert(consumed.getCatTrial().remainingGames === 4, 'reload must preserve four unconsumed trial games');
  const saved = consumed.getState();
  saved.catTrial.remainingGames = 3;
  sys.localStorage.setItem(key, JSON.stringify(saved));
  consumed.load();
  assert(consumed.getCatTrial().remainingGames === 3, 'legacy remaining trial count should not be extended');

  const expected = [10, 15, 28, 51, 84, 125, 176, 235, 304, 383, 470, 566, 672, 787, 911, 1045, 1187, 1339, 1500];
  expected.forEach((cost, index) => assert(getCatUpgradeCost(index + 1) === cost, `Lv.${index + 1} upgrade should cost ${cost}`));
  assert(expected.reduce((total, cost) => total + cost, 0) === 9888, 'full cat growth should cost 9888 coins');
  assert(getCatUpgradeCost(20) === 0, 'max level should have no further upgrade fee');
}

function testShanghaiDailyDate() {
  withTime('2026-10-13T15:59:59Z', () => {
    const store = new PlayerStore('player-store-shanghai-day');
    store.load();
    assert(store.getDailyDateKey() === '2026-10-13', 'Shanghai date should remain Oct 13 before midnight');
    assert(store.buyItem('hammer'), 'first shop purchase should succeed before midnight');
  });
  withTime('2026-10-13T16:00:00Z', () => {
    const store = new PlayerStore('player-store-shanghai-day');
    store.load();
    assert(store.getDailyDateKey() === '2026-10-14', 'Shanghai date should advance at UTC 16:00 on a UTC device');
    assert(store.buyItem('hammer'), 'shop quota should reset at Shanghai midnight');
  });
}

function testActivityExpirationAndInteractionCap() {
  withTime('2026-09-05T04:00:00Z', () => {
    const store = new PlayerStore('player-store-activity-expiration');
    store.load();
    for (let level = 1; level <= 3; level += 1) {
      store.recordRun({ won: true, level, remainingSlots: 3, mistakes: 0, elapsedMs: 10000,
        decisionCount: 30, nearFailureCount: 0, collectedElements: 30, matchCount: 10 });
    }
    assert(store.getActivitySnapshot().points === 240, 'three ten-match wins should grant 240 direct activity points');
  });
  withTime('2026-09-10T04:00:00Z', () => {
    const store = new PlayerStore('player-store-activity-expiration');
    store.load();
    const snapshot = store.getActivitySnapshot();
    assert(snapshot.status === 'ended' && snapshot.points === 340, 'expired completed task should automatically grant its points');
    assert(snapshot.tasks.find(task => task.id === 'make_matches')?.claimed, 'auto-settled task must be marked claimed');
    assert(store.getItemCount('hammer') === 1, 'task points should unlock and automatically award the 300-point hammer');
    const coins = store.getCoins();
    store.getActivitySnapshot();
    const reloaded = new PlayerStore('player-store-activity-expiration');
    reloaded.load();
    reloaded.getActivitySnapshot();
    assert(reloaded.getCoins() === coins && reloaded.getItemCount('hammer') === 1, 'automatic activity rewards must remain one-time across reload');
  });
  withTime('2026-09-05T04:00:00Z', () => {
    const key = 'player-store-activity-interactions';
    const store = new PlayerStore(key);
    store.load();
    store.setLevel(21);
    store.addReward({ stars: 120 });
    for (const id of ['cat_house', 'cafe'] as const) {
      for (let index = 0; index < 20; index += 1) assert(store.lightBuildingCell(id).ok, 'two cats should unlock for interaction coverage');
    }
    assert(store.interactWithCat('orange', 'pet').ok, 'first activity interaction should succeed');
    assert(store.interactWithCat('orange', 'feed').ok, 'second activity interaction should succeed');
    assert(store.interactWithCat('orange', 'play').ok, 'third activity interaction should succeed');
    assert(store.interactWithCat('white', 'pet').ok, 'fourth interaction should remain usable for affection');
    assert(store.getActivitySnapshot().points === 30, 'only first three daily cat interactions should grant points');
    assert(store.getActivitySnapshot().tasks.find(task => task.id === 'interact_cats')?.progress === 4, 'interaction task should track actual interactions independently');
    const reloaded = new PlayerStore(key);
    reloaded.load();
    assert(reloaded.interactWithCat('white', 'feed').ok, 'additional cat interaction should still succeed');
    assert(reloaded.getActivitySnapshot().points === 30, 'interaction point cap should survive reload');
    const legacy = reloaded.getState();
    delete (legacy.activity as Partial<typeof legacy.activity>).dailyInteractionClaims;
    sys.localStorage.setItem(key, JSON.stringify(legacy));
    reloaded.load();
    assert(reloaded.interactWithCat('white', 'play').ok, 'legacy save should remain usable');
    assert(reloaded.getActivitySnapshot().points === 30, 'old saves should infer already-used interaction claims');
  });
  withTime('2026-09-06T04:00:00Z', () => {
    const store = new PlayerStore('player-store-activity-interactions');
    store.load();
    assert(store.interactWithCat('orange', 'pet').ok, 'new Shanghai day should reset cat interaction');
    assert(store.getActivitySnapshot().points === 40, 'new day should reset the activity interaction point quota');
  });
}

function testCampaignDailyTasksAndGrowthPhotos() {
  const store = new PlayerStore('player-store-campaign-daily');
  store.load();
  store.recordRun({ won: true, level: 160, remainingSlots: 3, mistakes: 0, elapsedMs: 10000,
    decisionCount: 10, nearFailureCount: 0, collectedElements: 30, matchCount: 5 });
  store.setLevel(161);
  let task = store.getTasks().find(item => item.id === 'clear_3_levels');
  assert(task?.target === 150 && task.progress === 50 && task.action === 'endless', 'campaign completion should preserve one prior win as 50 endless progress');
  assert(task.title === '无尽消除 150 个元素', 'daily task title should describe the active endless objective');
  store.recordEndlessRun({ eliminated: 100, durationMs: 10000, stage: 2, matchCount: 5 });
  assert(store.getTasks().every(item => item.completed), 'endless should make every post-campaign daily task achievable');
  assert(store.isDailyChestReady() && store.claimDailyChest(), 'post-campaign daily chest should remain achievable');
  assert(store.claimTask('clear_3_levels'), 'post-campaign endless objective should grant its original coin reward');
  const reloaded = new PlayerStore('player-store-campaign-daily');
  reloaded.load();
  task = reloaded.getTasks().find(item => item.id === 'clear_3_levels');
  assert(task?.progress === 150 && task.claimed, 'endless progress and claimed state should survive reload');

  const main = new PlayerStore('player-store-main-endless-task');
  main.load();
  main.setLevel(2);
  main.recordEndlessRun({ eliminated: 150, durationMs: 10000, stage: 2, matchCount: 5 });
  assert(main.getTasks().find(item => item.id === 'clear_3_levels')?.progress === 0, 'endless must not advance the mainline daily objective');
  for (let level = 1; level <= 3; level += 1) main.recordRun({ won: true, level, remainingSlots: 3, mistakes: 0,
    elapsedMs: 10000, decisionCount: 10, nearFailureCount: 0, collectedElements: 30, matchCount: 5 });
  assert(main.claimTask('clear_3_levels'), 'main objective should be claimable before campaign completion');
  main.setLevel(161);
  assert(main.getTasks().find(item => item.id === 'clear_3_levels')?.claimed, 'same-day campaign migration must preserve claimed rewards');
  assert(!main.claimTask('clear_3_levels'), 'campaign migration must not grant the task reward twice');

  withTime('2026-10-14T04:00:00Z', () => {
    const key = 'player-store-campaign-legacy-daily';
    sys.localStorage.setItem(key, JSON.stringify({
      version: 6,
      level: 161,
      daily: { dateKey: '2026-10-14', tasks: { clear_3_levels: { progress: 3, claimed: false } } },
    }));
    const legacy = new PlayerStore(key);
    legacy.load();
    assert(legacy.getTasks().find(item => item.id === 'clear_3_levels')?.completed, 'completed unclaimed legacy task must remain claimable after migration');
    assert(legacy.claimTask('clear_3_levels'), 'legacy completed task should still grant its reward');
  });
  withTime('2026-10-15T04:00:00Z', () => {
    const legacy = new PlayerStore('player-store-campaign-legacy-daily');
    legacy.load();
    const freshTask = legacy.getTasks().find(item => item.id === 'clear_3_levels');
    assert(freshTask?.target === 150 && freshTask.progress === 0 && !freshTask.claimed, 'next post-campaign day should start a fresh achievable endless task');
  });

  const cats = new PlayerStore('player-store-growth-photo');
  cats.load();
  cats.setCoins(20000);
  cats.addReward({ stars: 15 });
  for (let index = 0; index < 5; index += 1) cats.lightBuildingCell('cat_house');
  while (cats.getCat('orange').level < 17) assert(cats.upgradeCat('orange').ok, 'orange should reach level 17');
  assert(!cats.getMoments().find(moment => moment.id === 'cat_growth_orange')?.unlocked, 'growth photo must stay locked before level 18');
  assert(cats.upgradeCat('orange').ok, 'orange should reach level 18');
  assert(cats.getMoments().find(moment => moment.id === 'cat_growth_orange')?.unlocked, 'level 18 should unlock the promised orange growth photo');
  assert(!cats.getMoments().find(moment => moment.id === 'cat_growth_white')?.unlocked, 'one cat milestone must not unlock another cat photo');
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
    if (index === 4) {
      assert(store.getCat('orange').unlocked, 'five cells should permanently unlock orange');
      assert(store.getEquippedCat() === 'orange', 'first cat should equip automatically');
    }
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

function testTownDailyLife() {
  const store = new PlayerStore('player-store-town-daily');
  store.load();
  assert(!store.getTownDailySnapshot().unlocked, 'town daily should stay locked before the first cat-house cell');

  store.addReward({ stars: 3 });
  assert(store.lightBuildingCell('cat_house').ok, 'first cat-house cell should unlock town daily life');
  const snapshot = store.getTownDailySnapshot();
  assert(snapshot.unlocked && snapshot.taskId !== null, 'town daily should expose a deterministic task after the first cell');
  assert(!snapshot.claimed && !snapshot.canClaim, 'town daily should require completing the task before claiming');

  switch (snapshot.taskId) {
    case 'complete_level':
      store.recordRun({
        won: true,
        level: 1,
        remainingSlots: 2,
        mistakes: 0,
        elapsedMs: 1000,
        decisionCount: 3,
        nearFailureCount: 0,
        collectedElements: 20,
        matchCount: 3,
      });
      break;
    case 'light_cell':
      store.addReward({ stars: 3 });
      assert(store.lightBuildingCell('cat_house').ok, 'town daily light-cell task should complete when another cell is lit');
      break;
    case 'enter_building':
      assert(store.markTownBuildingEntered('cat_house'), 'enter-building task should complete from an unlocked building');
      break;
    case 'view_dialogue':
      assert(store.markTownDialogueViewed('cat_house'), 'view-dialogue task should complete from an unlocked building');
      break;
    case 'pet_cat':
      throw new Error('[PlayerStore] pet task should not be selected before a cat is unlocked');
  }

  const completed = store.getTownDailySnapshot();
  assert(completed.completed && completed.canClaim, 'town daily should become claimable after its action');
  const beforeClaim = store.getCoins();
  const claimed = store.claimTownDaily();
  assert(claimed.ok && store.getCoins() > beforeClaim, 'town daily claim should grant a small reward');
  assert(!store.claimTownDaily().ok, 'town daily reward should be one-time per day');
  const reloaded = new PlayerStore('player-store-town-daily');
  reloaded.load();
  assert(reloaded.getTownDailySnapshot().claimed, 'town daily claim should survive reload');

  const catKey = 'player-store-town-daily-cat';
  const catStore = new PlayerStore(catKey);
  catStore.load();
  catStore.addReward({ stars: 60 });
  for (let index = 0; index < 20; index += 1) assert(catStore.lightBuildingCell('cat_house').ok, 'cat house should complete for pet-task coverage');
  const catDaily = catStore.getTownDailySnapshot();
  if (catDaily.taskId === 'pet_cat') {
    assert(catStore.interactWithCat('orange', 'pet').ok, 'pet task should complete after orange is unlocked');
    assert(catStore.getTownDailySnapshot().canClaim, 'pet task should become claimable');
  }
}

function testShareDailyReward() {
  const key = 'player-store-share-daily';
  const store = new PlayerStore(key);
  store.load();
  assert(store.getState().version === 6, 'new saves should use player state version 6');
  assert(!store.getShareDailyState().rewardClaimed, 'share reward should be available on a new day');

  const beforeCoins = store.getCoins();
  const first = store.claimShareReward('level_win');
  assert(first.ok && store.getCoins() === beforeCoins + 30, 'first successful share should grant 30 coins');
  assert(store.getShareDailyState().rewardClaimed, 'share reward should be marked claimed after success');
  assert(store.getShareDailyState().lastCardType === 'level_win', 'last share card type should be persisted');

  const duplicate = store.claimShareReward('town_stage');
  assert(!duplicate.ok && store.getCoins() === beforeCoins + 30, 'second share reward on the same day should be rejected');

  const reloaded = new PlayerStore(key);
  reloaded.load();
  assert(reloaded.getShareDailyState().rewardClaimed, 'share reward claim should survive reload');
  assert(reloaded.getShareDailyState().lastCardType === 'level_win', 'share card type should survive reload');

  const legacyKey = 'player-store-share-daily-legacy';
  sys.localStorage.setItem(legacyKey, JSON.stringify({ version: 5, coins: 123, level: 4 }));
  const legacy = new PlayerStore(legacyKey);
  legacy.load();
  assert(legacy.getState().version === 6, 'legacy saves should be upgraded to version 6');
  assert(!legacy.getShareDailyState().rewardClaimed, 'legacy saves without share state should get a fresh share day');

  const invalidCardKey = 'player-store-share-daily-invalid-card';
  sys.localStorage.setItem(invalidCardKey, JSON.stringify({
    version: 6,
    shareDaily: {
      dateKey: legacy.getShareDailyState().dateKey,
      rewardClaimed: true,
      lastCardType: 'not-a-card',
    },
  }));
  const invalidCard = new PlayerStore(invalidCardKey);
  invalidCard.load();
  assert(invalidCard.getShareDailyState().rewardClaimed, 'valid share claim flag should be normalized');
  assert(invalidCard.getShareDailyState().lastCardType === '', 'invalid share card type should be cleared');

  const invalidVersionKey = 'player-store-share-daily-invalid-version';
  sys.localStorage.setItem(invalidVersionKey, JSON.stringify({ version: 999, coins: 999 }));
  const invalidVersion = new PlayerStore(invalidVersionKey);
  invalidVersion.load();
  assert(invalidVersion.getState().version === 6, 'invalid save versions should reset to current defaults');
  assert(invalidVersion.getCoins() === 100, 'invalid save versions should reset economy defaults');
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

function testCatTrialAndChallengeGate() {
  const store = new PlayerStore('player-store-retention-phase1');
  store.load();
  assert(!store.isChallengeUnlocked(), 'challenge should stay locked before clearing level 5');
  store.setLevel(6);
  assert(store.isChallengeUnlocked(), 'challenge should unlock at level 6 after clearing level 5');

  const fresh = new PlayerStore('player-store-cat-trial');
  fresh.load();
  assert(!fresh.shouldShowCatTrialOffer(), 'cat trial should wait until the first level is cleared');
  fresh.recordLevelStars(1, 3);
  assert(fresh.shouldShowCatTrialOffer(), 'cat trial should show after the first level is cleared');
  fresh.markCatTrialOfferShown();
  assert(fresh.startCatTrial().ok, 'cat trial should start after the offer is shown');
  assert(fresh.getEquippedCat() === 'orange', 'active trial should temporarily equip orange cat');
  assert(fresh.getEquippedCat(false) === null, 'trial cat should not count as a formal equipped cat');
  assert(fresh.getCatSkillState('orange').charge === 20, 'trial game should start with a full orange skill charge');
  for (let remaining = 4; remaining >= 0; remaining -= 1) {
    assert(fresh.consumeCatTrialGame()?.remainingGames === remaining, 'trial should last five effective games');
  }
  assert(!fresh.isCatTrialActive(), 'trial should deactivate after five mainline games');
  assert(!fresh.shouldShowCatTrialOffer(), 'completed or dismissed trial should not reappear');

  const journey = new PlayerStore('player-store-cat-journey');
  journey.load();
  assert(!journey.getCatJourneySnapshot().started, 'journey should stay locked before the first clear');
  journey.recordLevelStars(1, 3);
  const startedJourney = journey.getCatJourneySnapshot();
  assert(startedJourney.started && startedJourney.currentDay === 1, 'journey should start at day one after the first clear');
  assert(startedJourney.canClaim, 'day one journey reward should be claimable');
  const beforeJourneyCoins = journey.getCoins();
  const firstClaim = journey.claimCatJourney();
  assert(firstClaim.ok && firstClaim.rewardText === '金币 ×50', 'day one journey claim should grant the configured reward');
  assert(journey.getCoins() === beforeJourneyCoins + 50, 'day one journey reward should add fifty coins');
  assert(!journey.claimCatJourney().ok, 'journey should not be claimable twice on the same day');
  assert(journey.getCatJourneySnapshot().currentDay === 2, 'journey should advance to day two after claiming');
}

function testCatMilestonesAndSkillGifts() {
  const store = new PlayerStore('player-store-cat-milestones');
  store.load();
  store.addReward({ stars: 60, coins: 20000 });
  for (let index = 0; index < 20; index += 1) assert(store.lightBuildingCell('cat_house').ok, 'cat house should complete for milestone coverage');
  assert(store.getCat('orange').unlocked, 'orange cat should be unlocked for milestone coverage');

  const levelTwo = store.upgradeCat('orange');
  assert(levelTwo.ok && levelTwo.newLevel === 2, 'cat upgrade should advance to level two');
  assert(levelTwo.milestoneLevels?.indexOf(2) >= 0, 'level two should claim the upgrade animation milestone');
  for (let index = 0; index < 3; index += 1) assert(store.upgradeCat('orange').ok, 'cat should upgrade through level five');
  assert(getCatSkillChargeRequired('orange', 4) === 20, 'level four should keep the original orange charge requirement');
  assert(getCatSkillChargeRequired('orange', 5) === 19, 'level five should reduce orange charge requirement by one');
  assert(store.getCatMilestones('orange').find(milestone => milestone.level === 5)?.claimed, 'level five milestone should be claimed');

  while (store.getCat('orange').level < 15) assert(store.upgradeCat('orange').ok, 'cat should upgrade through the daily gift milestone');
  const beforeGift = store.getCoins();
  const firstFire = store.fireCatSkill('orange');
  assert(firstFire.giftCoins === 20 && store.getCoins() === beforeGift + 20, 'level fifteen first skill use should grant the daily cat gift');
  const secondFire = store.fireCatSkill('orange');
  assert(secondFire.giftCoins === 0, 'cat gift should not repeat on the same day');
  const reloaded = new PlayerStore('player-store-cat-milestones');
  reloaded.load();
  assert(reloaded.getCat('orange').skillGiftDate.length > 0, 'cat gift date should persist');
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
  assert(store.getCoins() === 0, 'invalid primary version should recover the last valid backup');
  sys.localStorage.removeItem(key + '-backup');
  sys.localStorage.setItem(key, JSON.stringify({ version: 999 }));
  store.load();
  assert(store.getCoins() === 100, 'two invalid/missing saves should use defaults');
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

function testCheckpointAndBackup() {
  const key = 'player-store-checkpoint';
  const store = new PlayerStore(key);
  store.load();
  const definition = new LevelGenerator().generate({ level: 1, seed: 42, maxAttempts: 8, solverAnalyzeBranches: false });
  const run = {
    version: 1 as const, mode: 'main' as const, level: 1, definition,
    board: definition.tiles.slice(1), tray: definition.tiles.slice(0, 1), elapsedMs: 1234,
    extraSlot: true, usedTools: ['extra_slot' as const], collectedTotal: 1, collectProgress: 0,
    eliminatedCount: 0, matchCount: 0, mistakes: 1, decisionCount: 1, nearFailureCount: 0,
    reviveUsed: false, equippedCat: null, catCharge: 0, catSkillUsed: false, catSkillPicksLeft: 0,
    trialConsumed: true, trialStartRemaining: 5, performanceReported: true,
  };
  store.bindCheckpointProvider(() => run);
  store.addReward({ coins: 6 });
  const restored = new PlayerStore(key); restored.load();
  assert(restored.getCoins() === 106, 'coins and checkpoint should persist together');
  assert(restored.getRunCheckpoint()?.tray.length === 1 && restored.getRunCheckpoint()?.extraSlot, 'tray and used slot should recover');
  assert(restored.getRunCheckpoint()?.performanceReported, 'revive performance must not report twice');
  assert(restored.getRunCheckpoint()?.trialConsumed, 'resume must not consume trial again');
  const copied = restored.getRunCheckpoint()!; copied.tray.length = 0;
  assert(restored.getRunCheckpoint()?.tray.length === 1, 'checkpoint reads must be defensive copies');
  sys.localStorage.setItem(key, '{broken');
  const backup = new PlayerStore(key); backup.load();
  assert(backup.getCoins() === 106 && backup.getRunCheckpoint()?.elapsedMs === 1234, 'corrupt primary must recover local backup');
  restored.clearRunCheckpoint();
  const cleared = new PlayerStore(key); cleared.load();
  assert(cleared.getRunCheckpoint() === null, 'settled/cancelled runs must stay cleared after restart');
  const state = cleared.getState();
  sys.localStorage.setItem(key, JSON.stringify({ ...state, currentRun: { ...run, definition: { level: 1 }, tray: [] } }));
  const invalid = new PlayerStore(key); invalid.load();
  assert(invalid.getRunCheckpoint() === null && invalid.getCoins() === 106, 'invalid checkpoint must not reset player progress');
  store.bindCheckpointProvider(() => ({ ...run, board: [], tray: [] })); store.save();
  const terminal = new PlayerStore(key); terminal.load();
  assert(terminal.getRunCheckpoint()?.board.length === 0, 'a clear awaiting settlement must recover, with match rewards already saved');
}

testCheckpointAndBackup();
testTrialReloadAndUpgradeCosts();
testShanghaiDailyDate();
testActivityExpirationAndInteractionCap();
testCampaignDailyTasksAndGrowthPhotos();
testDefaultsAndRewards();
testBuildingAndCatUnlock();
testBuildTargetsAndGuideFlag();
testTownDailyLife();
testShareDailyReward();
testBoardTutorialFlag();
testCollectGoalHintFlag();
testLateThemesDoNotAddBuildings();
testCollectGoalSchedule();
testShopLimits();
testDailyTasksAndChest();
testCatInteractionsAndChallengeReward();
testCatTrialAndChallengeGate();
testCatMilestonesAndSkillGifts();
testEndlessProgress();
testAdFunnelAndRunFields();
testSaveNormalization();
testLegacyBuildingSave();
process.stdout.write('PlayerStore validation passed: defaults, rewards, building progress, tutorials, themes, shop, daily tasks, trial reload, square upgrade costs, Shanghai midnight, activity expiration and interaction quotas, post-campaign daily tasks, growth photos, cat milestones, endless, ad funnel, town daily, share daily, normalization, local backup and checkpoints.\n');
