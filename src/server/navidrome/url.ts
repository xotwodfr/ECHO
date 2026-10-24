import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// The Navidrome URL a user may connect (SETTINGS_AND_SECURITY.md §6.1, SSRF rules): the default
// internal URL (ECHO_NAVIDROME_URL) is always allowed. Any other URL must be https and resolve only
// to public addresses, unless the admin allow-listed it. The address it resolved to is pinned for
// the requests that follow, so a DNS answer cannot change between the check and the use.

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

export interface Target {
  url: URL; // normalised: no credentials, query or fragment; path without a trailing slash
  address: string; // the pinned IP
}

export type UrlProblem = 'bad_url' | 'https_required' | 'private_address' | 'unresolvable';

export class UrlRejected extends Error {
  readonly code: UrlProblem;
  constructor(code: UrlProblem) {
    super(code);
    this.code = code;
  }
}

const v4 = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0) >>> 0;
const inV4 = (ip: string, net: string, bits: number) =>
  bits === 0 || v4(ip) >>> (32 - bits) === v4(net) >>> (32 - bits);

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

/** The 16 bytes of an IPv6 address (`::` and a trailing dotted IPv4 allowed), or null. */
export function ipv6Bytes(ip: string): number[] | null {
  let a = ip.toLowerCase().replace(/%.*$/, ''); // drop a zone id
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) {
    if (isIP(dotted[1] as string) !== 4) return null;
    const n = v4(dotted[1] as string);
    a = `${a.slice(0, -(dotted[1] as string).length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    bytes.push(v >> 8, v & 255);
  }
  return bytes.length === 16 ? bytes : null;
}

const v4Of = (b: number[], at: number) => b.slice(at, at + 4).join('.');

/** True for loopback, private, link-local, metadata, CGNAT, documentation and multicast space. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some(([n, bits]) => inV4(ip, n, bits));
  const b = ipv6Bytes(ip);
  if (!b) return true; // unparseable: refuse
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // IPv4 inside IPv6, in every form an address can hide behind: mapped (::ffff:0:0/96),
  // compatible (::/96, which also covers :: and ::1), and 6to4 (2002::/16).
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateAddress(v4Of(b, 12));
  if (zero(0, 12)) return true;
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateAddress(v4Of(b, 2));
  const w0 = ((b[0] as number) << 8) | (b[1] as number);
  const w1 = ((b[2] as number) << 8) | (b[3] as number);
  return (
    (w0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
    (w0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (w0 & 0xff00) === 0xff00 || // multicast
    (w0 === 0x0064 && w1 === 0xff9b) || // 64:ff9b::/96 NAT64: maps onto IPv4 we cannot see
    (w0 === 0x2001 && w1 === 0x0000) || // 2001::/32 Teredo: tunnels to an IPv4 we cannot see
    (w0 === 0x2001 && w1 === 0x0db8) // documentation
  );
}

export async function checkUrl(
  raw: string,
  opts: { defaultUrl: string | null; allowList: string[]; resolve?: Resolver },
): Promise<Target> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected('bad_url');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw new UrlRejected('bad_url');
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  // Compared as origin + path without trailing slashes, so `http://navidrome:4533/` matches.
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return x.origin + x.pathname.replace(/\/+$/, '');
    } catch {
      return null;
    }
  };
  const self = norm(url.href);
  const trusted =
    (opts.defaultUrl !== null && self === norm(opts.defaultUrl)) ||
    opts.allowList.some((a) => self === norm(a));
  if (!trusted && url.protocol !== 'https:') throw new UrlRejected('https_required');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await (opts.resolve ?? systemResolver)(host)).map((r) => r.address);
    } catch {
      throw new UrlRejected('unresolvable');
    }
  }
  if (!addresses.length) throw new UrlRejected('unresolvable');
  // Every answer must be public: a name that also resolves privately could be steered there.
  if (!trusted && addresses.some(isPrivateAddress)) throw new UrlRejected('private_address');
  return { url, address: addresses[0] as string };
}
