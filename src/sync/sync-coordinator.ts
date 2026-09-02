export type SyncCoordinatorOptions = {
  debounceMs?: number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class SyncCoordinator<T> {
  private readonly debounceMs: number;
  private readonly setTimer: NonNullable<SyncCoordinatorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<SyncCoordinatorOptions["clearTimer"]>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<T> | null = null;
  private dirty = false;
  private disposed = false;

  constructor(
    private readonly task: () => Promise<T>,
    options: SyncCoordinatorOptions = {},
  ) {
    this.debounceMs = Math.max(0, options.debounceMs ?? 750);
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  schedule(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.active) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush().catch(() => {
        // The owner exposes errors through its sync status; a scheduled rejection
        // must not become an unhandled promise rejection.
      });
    }, this.debounceMs);
  }

  flush(): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("The sync coordinator is disposed."));
    this.dirty = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.active) return this.active;

    this.active = this.runUntilClean().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  private async runUntilClean(): Promise<T> {
    let result: T | undefined;
    do {
      this.dirty = false;
      result = await this.task();
    } while (this.dirty && !this.disposed);
    return result as T;
  }
}
