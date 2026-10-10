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
    to() { return this; }, by() { return this; }, delay() { return this; },
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
const { GameScreen } = require(path.resolve(process.argv[2] || '.codex/game-flow-tests/GameScreen.js'));
const originalTimeout = global.setTimeout;
global.setTimeout = callback => { deadlines.push(callback); return callback; };
function tile(kind, inTray = false) {
  return { kind, inTray, active: !inTray, width: 100, height: 100,
    node: { isValid: true, removeFromParent() {}, setPosition() {}, setScale() {}, getComponent() { return null; } } };
}
function revive(goal) {
  const game = Object.create(GameScreen.prototype);
  const pair = [tile(0, true), tile(0, true)];
  const remaining = tile(0);
  Object.assign(game, {
    gameOver: true, reviveUsed: false, trayTiles: pair.slice(), boardTiles: [...pair, remaining],
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
global.setTimeout = originalTimeout;
Module._load = originalLoad;
console.log('Game flow validation passed: cancelled landing, rapid collection, settlement, revive tools, collect-goal protection.');
