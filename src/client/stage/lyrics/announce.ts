// Opt-in line announcements (LYRICS_EXPERIENCE.md §11): the active line's text at each hand-over,
// at most one per 1.5 s. A line that arrives inside the window waits for it; a newer one replaces it.

export const ANNOUNCE_GAP_MS = 1500;

export class Announcer {
  private clock = 0;
  private last = Number.NEGATIVE_INFINITY;
  private seen = -2;
  private pending: string | null = null;

  /** One frame. `quiet`: scrubbing or a still frame, where nothing is announced. Returns the text to speak now. */
  update(active: number, text: string, dt: number, on: boolean, quiet: boolean) {
    this.clock += dt;
    if (active !== this.seen) {
      this.seen = active;
      this.pending = on && !quiet && active >= 0 ? text : null;
    }
    if (!on || quiet) this.pending = null;
    if (this.pending === null || this.clock - this.last < ANNOUNCE_GAP_MS) return null;
    const out = this.pending;
    this.pending = null;
    this.last = this.clock;
    return out;
  }
}
