import { ComboTracker } from '../assets/scripts/ComboTracker';

const tracker = new ComboTracker();
assert(tracker.registerMatch(1000) === 1, 'first match must start at 1');
assert(tracker.registerMatch(2999) === 2, 'fast manual match must continue the streak');
assert(tracker.registerMatch(4999) === 3, 'the exact window boundary must continue the streak');
assert(tracker.registerMatch(7000) === 1, 'match after the window must restart the streak');
tracker.reset();
assert(tracker.currentStreak === 0, 'reset must clear the current streak');
assert(tracker.registerMatch(8000) === 1, 'the first match after reset must start at 1');

console.log('[combo-tracker-test] passed');

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`[combo-tracker-test] ${message}`);
}
