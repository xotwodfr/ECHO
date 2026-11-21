// The sign-in wall's covers (shell/SignIn.tsx): small copies of this account's album covers, kept in
// this browser's own storage after signing in (once a day), so the sign-in page can show them
// without asking the server, which shows covers only to a signed-in user. Coloured tiles stand in
// before the first sign-in.

const KEY = 'echo.wall';
const AT = 'echo.wall.at';
const MAX = 24;
const DAY = 86_400_000;

export function loadWall(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/'))
      : [];
  } catch {
    return [];
  }
}

/** Shrinks a cover to a small JPEG data URL. */
async function shrink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const img = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 120;
    c.getContext('2d')?.drawImage(img, 0, 0, 120, 120);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

/** Keeps up to 24 of `covers`, at most once a day. */
export async function saveWall(covers: (string | undefined)[]) {
  try {
    if (Date.now() - Number(localStorage.getItem(AT) ?? 0) < DAY) return;
    const picked = [...new Set(covers.filter((c): c is string => !!c))]
      .sort(() => Math.random() - 0.5)
      .slice(0, MAX);
    if (picked.length < 6) return;
    const shots = (await Promise.all(picked.map(shrink))).filter((x): x is string => !!x);
    localStorage.setItem(KEY, JSON.stringify(shots));
    localStorage.setItem(AT, String(Date.now()));
  } catch {} // blocked or full storage: the tiles stand in
}
