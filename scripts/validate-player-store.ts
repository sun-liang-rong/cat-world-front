import { sys } from 'cc';
import { PlayerStore } from '../assets/scripts/PlayerStore';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[PlayerStore] ${message}`);
}

function testDefaultsAndRewards() {
  const store = new PlayerStore('player-store-defaults');
  store.load();
  const initial = store.getState();
  assert(initial.coins === 100, 'new players should start with 100 coins');
  assert(initial.stars === 25, 'new players should start with 25 stars');
  assert(initial.level === 1, 'new players should start at level 1');
  assert(initial.buildings.cat_house.unlocked, 'cat house should be unlocked');
  assert(!initial.cats.orange.unlocked, 'orange cat should start locked');
  store.addReward({ coins: 40, stars: 3, items: { hammer: 2 } });
  assert(store.getCoins() === 140, 'reward coins should be added');
  assert(store.getStars() === 28, 'reward stars should be added');
  assert(store.getItemCount('hammer') === 2, 'reward items should be added');
  assert(store.spendCoins(40), 'spending available coins should succeed');
  assert(store.getCoins() === 100, 'spent coins should be deducted');
  assert(!store.spendCoins(101), 'overspending should fail');
  assert(store.getCoins() === 100, 'failed spending should not mutate coins');
}

function testBuildingAndCatUnlock() {
  const store = new PlayerStore('player-store-building');
  store.load();
  assert(store.buildBuildingStage('cat_house').ok, 'first building stage should succeed with starter stars');
  assert(!store.buildBuildingStage('cat_house').ok, 'building should fail when stars are insufficient');
  store.addReward({ stars: 35 });
  assert(store.buildBuildingStage('cat_house').ok, 'second building stage should succeed');
  assert(store.buildBuildingStage('cat_house').ok, 'third building stage should succeed');
  assert(store.isBuildingCompleted('cat_house'), 'cat house should be completed');
  assert(store.getCat('orange').unlocked, 'completing cat house should unlock orange cat');
  assert(store.getStars() === 0, 'building should consume exact stage costs');
  assert(!store.buildBuildingStage('cat_house').ok, 'completed building should reject further upgrades');
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
  store.addReward({ stars: 35 });
  store.buildBuildingStage('cat_house');
  store.buildBuildingStage('cat_house');
  store.buildBuildingStage('cat_house');
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

testDefaultsAndRewards();
testBuildingAndCatUnlock();
testShopLimits();
testDailyTasksAndChest();
testCatInteractionsAndChallengeReward();
testEndlessProgress();
testSaveNormalization();
process.stdout.write('PlayerStore validation passed: defaults, rewards, buildings, shop, daily tasks, cats, challenge marker, endless, normalization.\n');
