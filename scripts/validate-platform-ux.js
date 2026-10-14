const assert = require('assert');
const path = require('path');
const build = path.resolve(process.argv[2] || '.codex/ux-tests/assets/scripts');
let platform = 'wechat';
require.cache[require.resolve(path.join(build, 'Analytics.js'))] = { exports: { getAnalyticsPlatform: () => platform } };
const { LeaderboardService } = require(path.join(build, 'LeaderboardService.js'));
const { RewardedAdService } = require(path.join(build, 'RewardedAdService.js'));
(async () => {
  let shared = 0;
  global.wx = { shareAppMessage() { shared += 1; } };
  const shares = new LeaderboardService();
  assert.equal(await shares.share({ type: 'level_win', title: '猫咪' }), 'opened');
  assert.equal(shared, 1, 'share must resolve without a platform success callback');
  global.wx.shareAppMessage = () => { throw new Error('expected share failure'); };
  assert.equal(await shares.share({ type: 'level_win', title: '猫咪' }), 'failed');
  let ads = [];
  global.wx.createRewardedVideoAd = () => {
    const ad = { show: () => Promise.resolve(), load: () => Promise.resolve(), onLoad() {}, onError(cb) { this.error = cb; }, onClose(cb) { this.close = cb; }, destroy() { this.destroyed = true; } };
    ads.push(ad); return ad;
  };
  assert.equal(new RewardedAdService('', 'ad').isAvailable(), false, 'unconfigured WeChat ads must hide');
  const service = new RewardedAdService('test-ad', 'ad');
  let watched = service.watch(); ads[0].close({ isEnded: false });
  assert.equal((await watched).completed, false, 'cancel must never grant reward');
  watched = service.watch(); ads[0].close({ isEnded: true });
  ads[1].close({ isEnded: true }); assert.equal((await watched).completed, true);
  assert(ads[0].destroyed && ads[1].destroyed, 'completed ads must dispose');
  const originalTimeout = global.setTimeout;
  let deadline;
  global.setTimeout = cb => { deadline = cb; return 0; };
  watched = service.watch(); deadline(); assert.equal((await watched).completed, false);
  global.setTimeout = originalTimeout;
  watched = service.watch(); ads[2].close({ isEnded: true }); service.destroy();
  assert.equal((await watched).completed, false, 'late callbacks must not settle a new request');
  const originalNow = Date.now;
  let now = 1000;
  let onHide, onShow;
  Date.now = () => now;
  global.setTimeout = cb => { deadline = cb; return 1; };
  global.wx = {
    shareAppMessage() {},
    onHide(cb) { onHide = cb; }, offHide() {},
    onShow(cb) { onShow = cb; }, offShow() {},
  };
  try {
    const shareService = new RewardedAdService('', 'share');
    watched = shareService.watch('revive');
    onHide(); now += 60000; onShow();
    assert.equal((await watched).completed, false, 'suspended timers must not reward a return beyond 30 seconds');
    watched = shareService.watch('revive');
    onHide(); now += 20000; onShow();
    assert.equal((await watched).completed, true, 'a timely share return must reward');
    watched = shareService.watch('revive');
    onShow(); deadline();
    assert.equal((await watched).completed, false, 'return without leaving must not reward');
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalTimeout;
  }
  console.log('Platform UX validation passed: share callback-free, missing ad ID, cancel, complete, timeout, late callback, dispose, suspended share timer.');
})().catch(error => { console.error(error); process.exitCode = 1; });
