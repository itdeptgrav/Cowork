/**
 * The autosaver — debounce and de-duplication for background saving.
 *
 * A spreadsheet emits a change on every keystroke; saving each one would be a
 * request storm and a race. This coalesces a burst into ONE save (requirement
 * 6): each change reschedules a single timer, and only the last state in the
 * burst is written. It also skips a save when nothing actually changed — the
 * no-op change a load or an undo-to-baseline produces — by comparing the
 * serialized JSON to what was last saved.
 *
 * It is pure of React and of the network: it holds a timer and a `save`
 * callback, nothing more, so the debounce and dedupe are unit-testable with fake
 * timers while the React hook supplies the actual server call.
 */

export interface AutosaverOptions<T> {
  delayMs: number;
  /** Persist the data. Resolving marks it saved; rejecting leaves it dirty so a
      later change (or flush) retries. */
  save: (data: T) => Promise<void>;
  /** Called when `save` rejects, so the caller can surface the failure. */
  onError?: (error: unknown) => void;
  /** Called when a scheduled save turned out to be a no-op (the data matched
      what was already saved), so a caller showing "Saving…" can settle back. */
  onNoChange?: () => void;
}

export class Autosaver<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedJson: string | null = null;
  private pending: T | null = null;
  /** A deferred payload builder from `pushLazy`, invoked when the save fires. */
  private producer: (() => T) | null = null;
  private readonly options: AutosaverOptions<T>;

  constructor(options: AutosaverOptions<T>) {
    this.options = options;
  }

  /** Record data as already persisted (after a load), so it is not re-saved. */
  setBaseline(data: T): void {
    this.lastSavedJson = JSON.stringify(data);
    this.pending = null;
    this.producer = null;
  }

  /**
   * Note the current state. Schedules a debounced save if it differs from what
   * was last saved, and returns whether it did — so the caller can show
   * "Saving…" only when a save is actually coming.
   */
  push(data: T): boolean {
    if (JSON.stringify(data) === this.lastSavedJson) return false;
    this.pending = data;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.options.delayMs);
    return true;
  }

  /**
   * Note that something changed, WITHOUT building the payload yet.
   *
   * `push` has to serialize on every call to compare against the last save —
   * measured at ~49 ms per keystroke on a 100,000-cell workbook, which is the
   * one cost a debounce is supposed to avoid. This defers that work to the
   * moment the save actually fires: `produce` is called once, when the burst
   * has settled, so a run of keystrokes costs one serialization rather than one
   * per key. The no-op check still happens then, and reports through
   * `onNoChange` so a caller showing "Saving…" can settle back to "Saved".
   */
  pushLazy(produce: () => T): boolean {
    this.producer = produce;
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.options.delayMs);
    return true;
  }

  /** Save the pending change now, cancelling the debounce. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.run();
  }

  private async run(): Promise<void> {
    this.timer = null;
    /* A lazy push builds its payload here — once per settled burst. */
    if (this.producer) {
      this.pending = this.producer();
      this.producer = null;
    }
    if (this.pending === null) return;
    const data = this.pending;
    const json = JSON.stringify(data);
    if (json === this.lastSavedJson) {
      this.pending = null;
      this.options.onNoChange?.();
      return;
    }
    try {
      await this.options.save(data);
      this.lastSavedJson = json;
    } catch (error) {
      /* Leave `lastSavedJson` unchanged so the next change re-attempts. */
      this.options.onError?.(error);
    }
  }

  /** Drop any pending timer — on unmount. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
