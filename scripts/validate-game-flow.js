// 实际 GameScreen 逻辑回归：模拟 Cocos 渲染层，不启动编辑器或修改玩家存档。
const assert = require('assert');
const Module = require('module');
const path = require('path');
const animations = [];
const deadlines = [];
class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
class Color {}
function tween(target) {
  const callbacks = [];
  const animation = {
    target, callbacks,
    to() { return this; }, by() { return this; }, delay() { return this; }, repeatForever() { return this; },
    call(fn) { callbacks.push(fn); return this; }, start() { animations.push(this); return this; },
  };
  return animation;
}
const stop = target => animations.forEach(animation => {
  if (animation.target === target) animation.callbacks.length = 0;
});
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'cc') return {
    Vec3, Vec2: Vec3, Color, tween, Tween: { stopAllByTarget: stop }, Component: class {},
    _decorator: { ccclass: () => value => value, property: () => () => {} },
    sys: { localStorage: { getItem: () => null }, Platform: {} },
  };
  if (request === 'cc/env') return { PREVIEW: true };
  return originalLoad.call(this, request, parent, isMain);
};
const compiledGamePath = path.resolve(process.argv[2] || '.codex/game-flow-tests/GameScreen.js');
const { GameScreen } = require(compiledGamePath);
const { SettlementPopup } = require(path.join(path.dirname(compiledGamePath), 'SettlementPopup.js'));
const { SettlementButton } = require(path.join(path.dirname(compiledGamePath), 'SettlementButton.js'));
const { EndlessDirector } = require(path.join(path.dirname(compiledGamePath), 'level/EndlessDirector.js'));
const originalTimeout = global.setTimeout;
global.setTimeout = callback => { deadlines.push(callback); return callback; };
function tile(kind, inTray = false) {
  return { kind, inTray, active: !inTray, width: 100, height: 100,
    layer: 0, geometry: { x: 0, y: 0, width: 100, height: 100 },
    blockedOverlay: { active: false }, targetOverlay: { active: false }, goalBadge: { active: false },
    matchReadyOverlay: { active: false, setScale() {} },
    node: { isValid: true, removeFromParent() {}, setPosition() {}, setWorldPosition() {}, setScale() {}, getComponent() { return null; } } };
}
function revive(goal) {
  const game = Object.create(GameScreen.prototype);
  const pair = [tile(0, true), tile(0, true)];
  const remaining = tile(0);
  Object.assign(game, {
    gameOver: true, pendingRevive: true, reviveUsed: false, trayTiles: pair.slice(), boardTiles: [...pair, remaining],
    options: { level: 4, levelDefinition: { goal }, onSaveRun() {}, onPlaySound() {}, onVibrate() {} },
    collectProgress: 0, eliminatedCount: 0,
    restoreTileToBoard(card) { card.active = true; card.inTray = false; },
    addEliminated(count) { this.eliminatedCount += count; },
    reflowTray() {}, refreshBoardTileStates() {}, toast() {},
    refreshToolButtons() { this.toolsEnabled = !this.gameOver; },
    isTopTile() { return true; },
  });
  game.reviveFromAd();
  assert(game.toolsEnabled, 'revive must reactivate tool buttons');
  assert.equal(game.trayTiles.length, 0);
  assert(game.reviveUsed && !game.gameOver);
  return game;
}
const protectedGame = revive({ type: 'collect_kind', kind: 0, count: 3 });
assert.equal(protectedGame.boardTiles.filter(card => card.active).length, 3, 'revive must retain every required target card');
assert.equal(protectedGame.eliminatedCount, 0, 'returned target cards must not count as eliminated');
assert.equal(revive({ type: 'clear_board' }).eliminatedCount, 2);
animations.length = 0; deadlines.length = 0;
const fastGame = Object.create(GameScreen.prototype);
const incoming = [tile(0, true), tile(1, true)];
Object.assign(fastGame, {
  pendingTrayAnimations: 2, destroyed: false, gameOver: false, boardIntroActive: false,
  trayTiles: incoming, boardTiles: [], trayCapacity: 6, traySlotWidth: 88, traySlotHeight: 88,
  trayFlightDuration: 0.1, tweenTargets: new Set(), timers: new Set(), options: {},
  trayLayer: { addChild() {} }, resizeTrayTile() {}, reflowTray() {}, refillEndlessBoard() {},
  finish(win) { this.finished = win; },
});
incoming.forEach(card => fastGame.animateTileToTray(card, new Vec3(0, 300), new Vec3(), 0));
const flights = animations.slice();
flights.forEach(animation => animation.callbacks.forEach(callback => callback()));
// 槽位重排/撤回会停止落地缩放，不能因此丢掉逻辑计数的归零。
incoming.forEach(card => stop(card.node));
assert.equal(fastGame.pendingTrayAnimations, 0, 'cancelled landing animation must not block settlement');
deadlines.forEach(callback => callback());
assert.equal(fastGame.finished, true, 'empty board must settle even with unmatched tray cards');

const originalOpen = SettlementPopup.open;
const originalAppearance = SettlementButton.setAppearance;
const originalNow = Date.now;
let now = 1000;
Date.now = () => now;
SettlementButton.setAppearance = () => {};
SettlementPopup.open = (parent, assets, options) => {
  const popup = { options, node: { isValid: true }, close() { this.node.isValid = false; } };
  parent.lastPopup = popup;
  return popup;
};

function gameplay(options = {}) {
  const game = Object.create(GameScreen.prototype);
  const cards = [0, 0, 1, 2, 3, 4].map(kind => tile(kind, true));
  const board = [tile(0), tile(1)];
  const storage = { coins: 100, checkpoint: undefined, records: [], events: [] };
  Object.assign(game, {
    gameOver: false, pendingRevive: false, destroyed: false, playStarted: true,
    checkpointReady: true, boardIntroActive: false, pausedAt: 0, startedAt: now,
    performanceReported: false, reviveUsed: false, endlessRecorded: false,
    trayTiles: cards, boardTiles: [...cards, ...board], trayCapacity: 6,
    coins: storage.coins, eliminatedCount: 30, matchCount: 10, endlessStage: 0,
    equippedCatId: null, catSkillUsed: false, catSkillPicksLeft: 0,
    extraTraySlot: false, trialConsumedForRun: false,
    collectedTotal: 6, collectProgress: 0, mistakes: 0, decisionCount: 0, nearFailureCount: 0,
    usedTools: new Set(), trialStartRemaining: null, gameUI: {}, assets: {},
    options: {
      level: 10, rewardMode: 'share', getCoins: () => storage.coins,
      onCoinsChanged: coins => { storage.coins = coins; },
      onPlaySound() {}, onVibrate() {}, onPerformance() {}, onCatSkillCharge() {},
      onSaveRun: () => { storage.checkpoint = game.createCheckpoint(); },
      onTrack: (name, props) => storage.events.push({ name, props }),
      onStarsGranted() {}, onReplay() {}, onReturnHome() {}, onNextLevel() {},
      ...options,
    },
    updateTrayDangerAlert() {}, clearToolMode() {}, closeLeaveConfirm() {},
    refreshToolButtons() {}, refreshCatSkillPanel() {}, reflowTray() {}, toast() {},
    restoreTileToBoard(card) { card.active = true; card.inTray = false; },
    isTopTile: () => true,
  });
  return { game, storage };
}

function endlessGame(rewardAvailable = true) {
  const fixture = gameplay({ onReviveAd: rewardAvailable ? async () => true : undefined });
  fixture.game.options.endless = {
    seed: 1, bestEliminated: 0,
    onFinish: result => {
      fixture.storage.records.push(result);
      fixture.storage.coins += 43;
      fixture.game.options.onSaveRun();
      return { coins: 43, isNewRecord: true, bestEliminated: result.eliminated };
    },
  };
  fixture.game.options.onDoubleRewardAd = async () => true;
  return fixture;
}

function testGiftBalance() {
  const { game, storage } = gameplay();
  Object.assign(game, {
    equippedCatId: 'ragdoll', catSkillConfig: { effect: 'grant_item' },
    catSkill: { level: 15, charge: 8 }, catGrantItem() {},
  });
  game.options.onCatSkillFired = () => {
    storage.coins += 20;
    return { readyAt: 0, giftCoins: 20 };
  };
  game.fireCatSkill();
  assert.equal(storage.coins, 120, 'Lv15 skill must grant the gift');
  game.addCoins(6);
  assert.equal(storage.coins, 126, 'next match must retain the skill gift');

  game.equippedCatId = 'orange';
  game.catSkillUsed = false;
  game.catSkillPicksLeft = 1;
  game.catClearBoardTile = () => {};
  game.itemNames = ['小鱼'];
  game.selectCatSkillTile(tile(0));
  game.addCoins(50);
  assert.equal(storage.coins, 196, 'selected-board skill gift must survive the win reward');
}

function testPairHighlight() {
  const { game } = gameplay();
  const exposed = tile(0);
  const blocked = tile(0);
  game.trayTiles = [tile(0, true), tile(0, true)];
  game.boardTiles = [exposed, blocked];
  game.isTopTile = card => card !== blocked;
  game.refreshBoardTileStates();
  assert(exposed.matchReadyOverlay.active, 'an exposed third card must highlight when the tray holds a pair');
  assert(!blocked.matchReadyOverlay.active, 'covered cards must stay unhighlighted');
  game.trayTiles.pop();
  game.refreshBoardTileStates();
  assert(!exposed.matchReadyOverlay.active, 'the highlight must disappear after the pair is removed');

  // 进入槽位时牌已经 active=false，收集第二张也必须立即重新计算提示。
  const incomingCard = tile(0);
  incomingCard.node.worldPosition = { clone: () => new Vec3() };
  incomingCard.node.position = { clone: () => new Vec3() };
  game.boardTiles = [incomingCard, exposed];
  game.trayTiles = [tile(0, true)];
  game.trayFlightLayer = { addChild() {} };
  game.pendingTrayAnimations = 0;
  game.traySlotSpacing = 88; game.trayFirstSlotX = -264;
  game.animateTileToTray = () => {};
  game.updateTargetLabel = () => {};
  game.registerCatProgress = () => {};
  game.collectTile(incomingCard);
  assert(exposed.matchReadyOverlay.active, 'collecting the second card must refresh the third-card hint');
}

function testReviveTiming() {
  now = 1000;
  let durationMs = 0;
  const { game, storage } = gameplay({
    challenge: { coinReward: 80 }, onReviveAd: async () => true,
    onChallengeWin: duration => { durationMs = duration; },
  });
  now += 10000;
  game.finish(false);
  game.options.onSaveRun();
  assert.equal(storage.checkpoint.elapsedMs, 10000, 'revive choice must retain the unfinished board and frozen time');
  now += 2000;
  game.pauseForBackground();
  now += 20000;
  game.reviveFromAd();
  assert(!game.gameOver && !game.pausedAt, 'revive must resume gameplay and the clock');
  now += 10000;
  game.finish(true);
  assert.equal(durationMs, 20000, 'challenge duration must exclude the failed dialog and sharing in background');
  now += 60000;
  assert.equal(game.createCheckpoint(), null, 'a final win must clear the checkpoint');
}

function testBackgroundTiming() {
  now = 1000;
  const { game } = endlessGame();
  game.endlessDirector = new EndlessDirector(1, now);
  game.endlessHudLabel = { string: '' };
  now += 2000;
  game.pauseForBackground();
  now += 50000;
  game.refreshEndlessHud();
  assert(game.endlessHudLabel.string.endsWith('0:02'), 'endless HUD must freeze through background and resume prompt');
  game.resumeRunClock();
  now += 3000;
  game.refreshEndlessHud();
  assert(game.endlessHudLabel.string.endsWith('0:05'), 'endless HUD must resume from active time');
  assert.equal(game.createCheckpoint().elapsedMs, 5000, 'background time must stay out of the persisted run');

  const preparing = gameplay({ challenge: { coinReward: 80 } });
  preparing.game.awaitingLevelDefinition = true;
  preparing.game.boardIntroActive = true;
  preparing.game.hidePreparingHint = () => {};
  preparing.game.beginBoardIntro = () => {};
  now += 2000;
  preparing.game.pauseForBackground();
  now += 10000;
  preparing.game.applyLevelDefinition({ level: 10 });
  now += 10000;
  preparing.game.resumeRunClock();
  assert.equal(Date.now() - preparing.game.startedAt, 0, 'a challenge prepared in background must start at zero active time');
}

function testEndlessFinalization() {
  now = 1000;
  const { game, storage } = endlessGame();
  now += 10000;
  game.finish(false);
  const choice = game.gameUI.lastPopup;
  assert(choice.options.endlessRevive && !choice.options.win);
  assert.equal(storage.records.length, 0, 'first endless failure must wait for the revive decision');
  assert.equal(storage.coins, 100, 'revive choice must not pay the base reward');
  assert.equal(storage.checkpoint.tray.length, 6, 'revive choice must preserve the full tray checkpoint');
  const restored = endlessGame();
  Object.assign(restored.game, {
    boardTiles: [], trayTiles: [], trayLayer: { addChild() {} },
    makeOpeningTile(card) {
      const created = tile(card.kind);
      created.geometry = card;
      this.boardTiles.push(created);
      return created;
    },
    resizeTrayTile() {}, sortBoardTileNodes() {}, updateTargetLabel() {},
  });
  restored.game.restoreCheckpoint(storage.checkpoint);
  assert(restored.game.gameUI.lastPopup.options.endlessRevive, 'restoring a failed run must reopen the unused revive choice');
  assert.equal(restored.storage.records.length, 0, 'restoring the choice must not pay or submit');
  assert.equal(restored.storage.checkpoint.elapsedMs, 10000, 'restoring the choice must retain the frozen effective time');
  now += 20000;
  choice.options.onRevive();
  assert.equal(game.trayTiles.length, 4, 'endless revive must free one pair');
  assert.equal(game.eliminatedCount, 32, 'revive removals must count toward the endless score');
  assert.equal(storage.records.length, 0, 'successful revive must not submit an interim result');
  now += 10000;
  game.trayTiles.push(tile(2, true), tile(3, true));
  game.finish(false);
  const final = game.gameUI.lastPopup;
  assert(final.options.endless && !final.options.endlessRevive && final.options.win);
  assert.equal(final.options.onRevive, undefined, 'second failure must not offer another revive');
  assert.equal(storage.records.length, 1, 'second failure must submit exactly one result');
  assert.equal(storage.records[0].durationMs, 20000, 'endless duration must exclude the revive wait');
  assert.equal(storage.records[0].eliminated, 32);
  assert.equal(storage.coins, 143);
  assert.equal(storage.checkpoint, null, 'final endless settlement must clear the saved run');
  final.options.onDoubleReward();
  final.options.onDoubleReward();
  game.openEndlessSettlement();
  assert.equal(storage.coins, 186, 'double reward can only add one matching base reward');
  assert.equal(storage.records.length, 1, 'repeated settlement must not submit or pay again');

  const declined = endlessGame();
  declined.game.finish(false);
  const declinedChoice = declined.game.gameUI.lastPopup;
  declinedChoice.options.onReplay();
  declinedChoice.options.onReplay();
  declinedChoice.options.onRevive();
  assert.equal(declined.storage.records.length, 1, 'declining revival must finalize once');
  assert(declined.game.gameOver, 'a late revive callback cannot reopen a finalized run');
  assert.equal(declined.storage.coins, 143);

  const unavailable = endlessGame(false);
  unavailable.game.finish(false);
  assert.equal(unavailable.storage.records.length, 1, 'without a reward service failure must settle normally');
  assert(!unavailable.game.gameUI.lastPopup.options.endlessRevive);

  const quit = endlessGame();
  quit.game.finish(false, false);
  assert.equal(quit.storage.records.length, 1, 'confirmed mid-run exit must settle without a revive prompt');
  assert(!quit.game.gameUI.lastPopup.options.endlessRevive);
}

async function testCancelledEndlessReward() {
  const { game, storage } = endlessGame();
  game.finish(false);
  const choice = game.gameUI.lastPopup;
  const popup = Object.create(SettlementPopup.prototype);
  Object.assign(popup, {
    node: choice.node, adBusy: false,
    adButton: { interactable: true, node: {} }, adButtonLabel: { string: '' },
    options: { ...choice.options, onReviveAd: async () => false },
  });
  await popup.watchRevive(choice.options.onRevive);
  assert(game.gameOver && game.pendingRevive && !game.reviveUsed, 'cancelled sharing must retain the revive decision');
  assert.equal(storage.records.length, 0, 'cancelled sharing must not finalize or pay');
  assert(!popup.adBusy && popup.adButton.interactable, 'cancelled reward must restore the retry button');
  popup.options.onReviveAd = async () => true;
  await popup.watchRevive(choice.options.onRevive);
  assert(!game.gameOver && game.reviveUsed, 'retrying and completing the reward must revive once');
  assert.equal(storage.records.length, 0);
}

async function main() {
  try {
    testGiftBalance();
    testPairHighlight();
    testReviveTiming();
    testBackgroundTiming();
    testEndlessFinalization();
    await testCancelledEndlessReward();
    console.log('Game flow validation passed: rapid collection, collect-goal protection, skill gifts, pair hints, effective timing, endless revive/cancel/decline and single settlement.');
  } finally {
    global.setTimeout = originalTimeout;
    Date.now = originalNow;
    SettlementPopup.open = originalOpen;
    SettlementButton.setAppearance = originalAppearance;
    Module._load = originalLoad;
  }
}
main().catch(error => {
  console.error('[CatWorld] Game flow validation failed', error);
  process.exitCode = 1;
});
