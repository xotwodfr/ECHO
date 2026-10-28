// Login rate limits (SETTINGS_AND_SECURITY.md §4.4), in memory: per client IP 10 attempts a minute
// and 100 a day (password and TOTP steps alike); per account, 5 consecutive wrong passwords, or 5
// wrong second factors, lock it for 15 min, doubling up to 24 h. A restart clears them, which an
// attacker cannot trigger. Also the per-user API budget of §5.6.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** §5.6: bursts of 50 requests, refilled at 10 a second (600 a minute). */
const API_BURST = 50;
const API_PER_S = 10;

export function createLoginLimiter() {
  const ips = new Map<string, number[]>();
  const accounts = new Map<
    string,
    { fails: number; secondFails: number; lockedUntil: number; lockMs: number }
  >();
  // One token bucket per signed-in user: bounded by the number of accounts.
  const api = new Map<number, { tokens: number; at: number }>();
  const account = (username: string) => {
    const key = username.toLowerCase();
    let a = accounts.get(key);
    if (!a) {
      a = { fails: 0, secondFails: 0, lockedUntil: 0, lockMs: 0 };
      accounts.set(key, a);
    }
    return a;
  };
  /** Locks for 15 min, doubling up to 24 h. */
  const lock = (a: { lockedUntil: number; lockMs: number }, now: number) => {
    a.lockMs = Math.min(DAY, a.lockMs ? a.lockMs * 2 : 15 * MIN);
    a.lockedUntil = now + a.lockMs;
  };

  return {
    /** True if this IP may try now; counts the attempt. */
    ipAllows(ip: string, now: number) {
      const recent = (ips.get(ip) ?? []).filter((t) => now - t < DAY);
      const lastMinute = recent.filter((t) => now - t < MIN).length;
      if (lastMinute >= 10 || recent.length >= 100) {
        ips.set(ip, recent);
        return false;
      }
      recent.push(now);
      ips.set(ip, recent);
      return true;
    },
    /** ms until the account unlocks, or 0. */
    lockedFor(username: string, now: number) {
      const a = accounts.get(username.toLowerCase());
      return a && a.lockedUntil > now ? a.lockedUntil - now : 0;
    },
    /** A failed password; returns true when this failure locked the account. */
    fail(username: string, now: number) {
      const a = account(username);
      if (++a.fails < 5) return false;
      a.fails = 0;
      lock(a, now);
      return true;
    },
    /**
     * A wrong TOTP or recovery code: five lock the account like five wrong passwords. Kept apart
     * from password failures, so a correct password does not reset it.
     */
    failSecond(username: string, now: number) {
      const a = account(username);
      if (++a.secondFails < 5) return false;
      a.secondFails = 0;
      lock(a, now);
      return true;
    },
    /** A correct second factor. */
    succeedSecond(username: string) {
      const a = accounts.get(username.toLowerCase());
      if (a) a.secondFails = 0;
    },
    /** A correct password: the failure count resets (the lock length is kept for repeat offenders). */
    succeed(username: string) {
      const a = accounts.get(username.toLowerCase());
      if (a) a.fails = 0;
    },
    /** The admin's unlock. */
    unlock(username: string) {
      accounts.delete(username.toLowerCase());
    },
    /** Forgets addresses with no attempt in the last day (a client rotating addresses); the count. */
    sweep(now: number) {
      let n = 0;
      for (const [ip, times] of ips)
        if (!times.some((t) => now - t < DAY)) {
          ips.delete(ip);
          n++;
        }
      return n;
    },
    /** True if this user may make an API request now (§5.6); spends one from their budget. */
    apiAllows(userId: number, now: number) {
      const b = api.get(userId) ?? { tokens: API_BURST, at: now };
      b.tokens = Math.min(API_BURST, b.tokens + ((now - b.at) / 1000) * API_PER_S);
      b.at = now;
      api.set(userId, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
