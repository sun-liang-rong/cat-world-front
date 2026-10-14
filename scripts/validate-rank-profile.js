const assert = require('assert');
const Module = require('module');
const path = require('path');
const build = path.resolve(process.argv[2] || '.codex/ux-tests/assets/scripts');
const values = new Map();
const localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'cc') return { sys: { localStorage } };
  return originalLoad.call(this, request, parent, isMain);
};
require.cache[require.resolve(path.join(build, 'Analytics.js'))] = { exports: { getAnalyticsPlatform: () => 'wechat' } };
const { ApiClient } = require(path.join(build, 'ApiClient.js'));
const { LeaderboardService } = require(path.join(build, 'LeaderboardService.js'));
const { ProfileCoordinator } = require(path.join(build, 'ProfileCoordinator.js'));
const token = 'a'.repeat(64);
let generated = 0;
const submitted = [];
let failSubmit = false;
global.wx = {
  request(options) {
    if (options.url.endsWith('/user/generate')) {
      generated += 1;
      options.success({ statusCode: 200, data: { code: 200, data: { user_id: 'ABCDEFGH', name: '猫友', submit_token: token } } });
      return {};
    }
    if (options.url.endsWith('/rank/submit')) {
      assert.equal(options.header.Authorization, `Bearer ${token}`, 'scores must carry the private credential');
      assert(!Object.values(options.data).includes(token), 'credential must not be part of score data');
      if (failSubmit) options.fail(new Error('expected offline request'));
      else {
        submitted.push(options.data);
        options.success({ statusCode: 200, data: { code: 200, data: { updated: true } } });
      }
      return {};
    }
    throw new Error('Unexpected API path');
  },
};
const store = {
  id: 'JKLMNPQR', name: '旧昵称', coins: 321, stars: 18,
  hasProfile() { return !!this.id; }, getUserId() { return this.id; }, getUserName() { return this.name; },
  setProfile(id, name) { this.id = id; this.name = name; },
  getLevel: () => 7, getTotalStarsEarned: () => 18,
  getEndlessProgress: () => ({ lastEliminated: 120, lastDurationMs: 60000 }),
};
const leaderboard = new LeaderboardService(new ApiClient('http://rank.test'));
const options = { playerStore: store, leaderboard, isAlive: () => true };

(async () => {
  const coordinator = new ProfileCoordinator(options);
  assert.equal(coordinator.hasProfile(), false, 'a public legacy ID is not a submission credential');
  await Promise.all([coordinator.ensure(), coordinator.ensure()]);
  assert.equal(generated, 1, 'identity migration must remain single-flight');
  assert.equal(coordinator.hasProfile(), true);
  assert.equal(store.coins, 321, 'migration must preserve gameplay currency');
  assert.equal(store.stars, 18);
  await coordinator.syncForBoard();
  assert(submitted.some(score => score.type === 1 && score.star_count === 18));
  assert(submitted.some(score => score.type === 2 && score.clear_count === 120 && score.duration_ms === 60000));
  const restored = new ProfileCoordinator(options);
  assert.equal(restored.hasProfile(), true, 'credential must restore independently from gameplay state');
  await restored.ensure();
  assert.equal(generated, 1, 'restored credential must reuse the anonymous identity');
  failSubmit = true;
  await assert.rejects(restored.submitChallenge(45000));
  assert.equal(JSON.parse(values.get('cat-world-rank-pending-v1')).length, 1, 'failed scores must remain queued');
  failSubmit = false;
  const restarted = new ProfileCoordinator(options);
  await restarted.flush();
  assert.equal(JSON.parse(values.get('cat-world-rank-pending-v1')).length, 0);
  assert(submitted.some(score => score.type === 3 && score.duration_ms === 45000));
  let alive = true;
  let finishOldRequest;
  const old = new ProfileCoordinator({
    ...options,
    isAlive: () => alive,
    leaderboard: { ...leaderboard,
      isRemoteProfile: id => leaderboard.isRemoteProfile(id),
      isSubmitToken: value => leaderboard.isSubmitToken(value),
      submitScore: () => new Promise(resolve => { finishOldRequest = resolve; }),
    },
  });
  const oldSubmission = old.submitEndless(100, 60000);
  await new Promise(resolve => setImmediate(resolve));
  alive = false;
  failSubmit = true;
  const nextSession = new ProfileCoordinator(options);
  await assert.rejects(nextSession.submitEndless(200, 120000));
  finishOldRequest({ updated: true });
  await oldSubmission;
  const remaining = JSON.parse(values.get('cat-world-rank-pending-v1'));
  assert.equal(remaining.length, 1, 'a destroyed session must not overwrite the new offline queue');
  assert.equal(remaining[0].clear_count, 200);
  assert.equal(remaining[0].duration_ms, 120000);
  console.log('Rank profile validation passed: legacy migration, credential headers, single-flight identity, local persistence, offline retry, destroyed-session callback.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  delete global.wx;
});
