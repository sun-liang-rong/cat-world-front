const assert = require('assert');
const Module = require('module');
const path = require('path');
const build = path.resolve(process.argv[2] || '.codex/game-flow-tests');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'cc') return {
    Component: class {}, Color: class {},
    _decorator: { ccclass: () => value => value, property: () => () => {} },
    sys: { localStorage: { getItem: () => null }, Platform: {} },
  };
  if (request === 'cc/env') return { PREVIEW: true };
  return originalLoad.call(this, request, parent, isMain);
};
const { Main } = require(path.join(build, 'Main.js'));
const gameScreenModule = require(path.join(build, 'GameScreen.js'));
const originalGameScreen = gameScreenModule.GameScreen;
const { LevelGenerator } = require(path.join(build, 'level/LevelGenerator.js'));
const { Toast } = require(path.join(build, 'Toast.js'));
const originalToast = Toast.show;
const toasts = [];
Toast.show = (root, message) => toasts.push(message);
const tick = () => new Promise(resolve => setImmediate(resolve));

function controlledMain() {
  const generator = new LevelGenerator();
  const jobs = [];
  generator.runGenerateAsync = (options, abort) => new Promise((resolve, reject) => {
    jobs.push({ options, abort, resolve, reject });
  });
  const main = Object.create(Main.prototype);
  Object.assign(main, {
    node: { isValid: true }, root: {}, gameScreen: null,
    startingGame: false, nextLevelPreparing: false, nextLevelPrepareToken: 0,
    nextLevelReadyWaiters: [], nextLevelCancellation: null,
    challengePreparing: false, challengeSparePreparing: false,
    challengePrepareToken: 0, challengeSpareToken: 0,
    challengeCancellation: null, challengeSpareCancellation: null,
    playerStore: { getLevel: () => 6, isChallengeUnlocked: () => true },
    levelSystem: {
      nextLevelAsync: (level, seed, cancellation) => generator.generateAsync({ level, seed }, cancellation),
      generator,
    },
    opened: 0,
    openGame(onReady) { this.opened += 1; onReady?.(); },
  });
  return { main, jobs };
}

function testBackgroundReadiness() {
  // 仅替换 Cocos 页面及异步资源加载，调用真实 Main 的三个创建入口和前后台事件。
  class DeferredGameScreen {
    constructor(root, assets, options) {
      this.options = options;
      this.started = false;
      this.events = [];
      this.resumePrompts = 0;
    }
    loadAndCreate(onReady) { this.onReady = onReady; }
    completeLoad() {
      if (!this.options.deferStart) this.startPlay();
      this.onReady?.();
    }
    startPlay() { this.started = true; this.events.push('start'); }
    pauseForBackground() { if (this.started) this.events.push('pause'); }
    showResumePrompt() { this.resumePrompts += 1; }
    matchesPreparedLevel(level) { return !this.started && this.options.level === level; }
    destroy() { this.destroyed = true; }
  }
  gameScreenModule.GameScreen = DeferredGameScreen;
  function backgroundMain() {
    const main = Object.create(Main.prototype);
    Object.assign(main, {
      node: { isValid: true }, root: {}, gameScreen: null,
      appBackgrounded: false, startingGame: false,
      currentLevelDefinition: { level: 6 },
      assets: { releaseOwner() {} },
      audio: { setBackground() {} },
      analytics: { track() {} },
      rewardedAd: { mode: 'share', isAvailable: () => true },
      homeScreen: { setActive(active) { this.active = active; } },
      playerStore: {
        getLevel: () => 6, getRunCheckpoint: () => null, save() {},
        isChallengeRewardClaimed: () => false,
        getEndlessProgress: () => ({ bestEliminated: 0 }),
      },
      hideExtraPages() {},
    });
    return main;
  }
  try {
    for (const entry of ['openGame', 'openChallengeGame', 'openEndlessGame']) {
      for (const hideBeforeRequest of [false, true]) {
        const main = backgroundMain();
        if (hideBeforeRequest) main.onAppHide();
        main[entry](() => main.gameScreen.events.push('ready'));
        const screen = main.gameScreen;
        if (!hideBeforeRequest) main.onAppHide();
        assert(!screen.started, `${entry}: reproduce a background switch while resources are pending`);
        screen.completeLoad();
        assert.deepEqual(screen.events, ['start', 'pause', 'ready'],
          `${entry}: background readiness must pause the newly started run before notifying its caller`);
        main.onAppShow();
        assert.equal(main.appBackgrounded, false, `${entry}: return to foreground must clear the background flag`);
        assert.equal(screen.resumePrompts, 1, `${entry}: paused new run must offer the normal resume prompt`);
      }
      const foreground = backgroundMain();
      foreground[entry](() => foreground.gameScreen.events.push('ready'));
      foreground.gameScreen.completeLoad();
      assert.deepEqual(foreground.gameScreen.events, ['start', 'ready'],
        `${entry}: foreground readiness must leave the run playing`);
    }

    const prepared = backgroundMain();
    prepared.openGame(undefined, true);
    prepared.gameScreen.completeLoad();
    assert(!prepared.gameScreen.started, 'pre-created main game must defer the clock until play begins');
    prepared.onAppHide();
    prepared.startGame();
    assert.deepEqual(prepared.gameScreen.events, ['start', 'pause'],
      'starting an already prepared main game in background must pause its clock');
    assert.equal(prepared.homeScreen.active, false);
    assert.equal(prepared.startingGame, false);
  } finally {
    gameScreenModule.GameScreen = originalGameScreen;
  }
}

(async () => {
  const { main, jobs } = controlledMain();
  main.prepareChallengeLevel(42);
  await tick();
  main.prepareNextMainLevel(6);
  jobs[0].resolve({ level: 100 });
  await tick();
  assert(main.nextLevelPreparing && main.challengeSparePreparing, 'reproduce overlapping main and queued challenge');
  main.nextLevel();
  assert.equal(jobs[1].abort.cancelled, false, 'cancelling challenge must not cancel active main generation');
  jobs[1].resolve({ level: 6 });
  await tick();
  assert.equal(main.opened, 1, 'the queued Next Level callback must enter the main level');
  assert.equal(main.startingGame, false);
  assert.equal(main.nextLevelPreparing, false);
  assert.equal(main.nextLevelReadyWaiters.length, 0);
  assert.equal(jobs.length, 2, 'cancelled queued challenge must skip candidate generation');

  const failed = controlledMain();
  failed.main.prepareNextMainLevel(6);
  await tick();
  failed.main.nextLevel();
  failed.jobs[0].reject(new Error('expected generation failure'));
  await tick();
  assert.equal(failed.main.startingGame, false, 'failed background pre-generation must unlock a waiting Next Level');
  assert.equal(failed.main.nextLevelPreparing, false);
  assert.equal(failed.main.nextLevelReadyWaiters.length, 0);
  assert(toasts.length > 0, 'a waiting player must see a retry message on failure');
  testBackgroundReadiness();
  console.log('Main flow validation passed: request-specific cancellation, Next Level delivery, failure unlock, asynchronous background readiness for all modes and prepared main game.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Toast.show = originalToast;
  gameScreenModule.GameScreen = originalGameScreen;
  Module._load = originalLoad;
});
