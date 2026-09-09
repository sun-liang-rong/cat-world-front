/** Tracks successful match events without depending on Cocos UI state. */
export class ComboTracker {
  static readonly WINDOW_MS = 2000;

  private streak = 0;
  private lastMatchAt = Number.NEGATIVE_INFINITY;

  registerMatch(now = Date.now()) {
    // Intermediate tray taps are allowed while building the next match. Only
    // the time between successful matches determines whether the streak holds.
    const withinWindow = now >= this.lastMatchAt
      && now - this.lastMatchAt <= ComboTracker.WINDOW_MS;
    this.streak = withinWindow ? this.streak + 1 : 1;
    this.lastMatchAt = now;
    return this.streak;
  }

  reset() {
    this.streak = 0;
    this.lastMatchAt = Number.NEGATIVE_INFINITY;
  }

  get currentStreak() {
    return this.streak;
  }
}
