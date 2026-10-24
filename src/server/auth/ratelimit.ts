// Login rate limits (SETTINGS_AND_SECURITY.md §4.4), in memory: per client IP 10 attempts a minute
// and 100 a day; per account, 5 consecutive failures lock it for 15 min, doubling up to 24 h. A
// restart clears them, which an attacker cannot trigger.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export function createLoginLimiter() {
  const ips = new Map<string, number[]>();
  const accounts = new Map<string, { fails: number; lockedUntil: number; lockMs: number }>();

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
      const key = username.toLowerCase();
      const a = accounts.get(key) ?? { fails: 0, lockedUntil: 0, lockMs: 0 };
      a.fails++;
      let locked = false;
      if (a.fails >= 5) {
        a.lockMs = Math.min(DAY, a.lockMs ? a.lockMs * 2 : 15 * MIN);
        a.lockedUntil = now + a.lockMs;
        a.fails = 0;
        locked = true;
      }
      accounts.set(key, a);
      return locked;
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
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
