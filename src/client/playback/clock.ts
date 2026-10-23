// Time source for providers without real audio. The browser uses the real clock (Playwright's
// page.clock can still drive it); unit tests use ManualClock and advance it by hand.

type Handle = ReturnType<typeof setTimeout>;

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): Handle;
  clearTimeout(handle: Handle): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

/** A clock that only moves when told to; due timers run in order as it passes them. */
export class ManualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; cb: () => void }>();

  now() {
    return this.t;
  }

  setTimeout(cb: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), cb });
    return id as unknown as Handle;
  }

  clearTimeout(handle: Handle) {
    this.timers.delete(handle as unknown as number);
  }

  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; cb: () => void }] | undefined;
      for (const entry of this.timers)
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].cb();
    }
    this.t = end;
  }
}
