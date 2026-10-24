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

/** True for loopback, private, link-local, metadata, CGNAT, documentation and multicast space. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some(([n, b]) => inV4(ip, n, b));
  const a = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivateAddress(mapped[1] as string);
  if (a === '::' || a === '::1') return true;
  const first = Number.parseInt(a.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // multicast
    a.startsWith('64:ff9b:') || // NAT64: maps onto IPv4 we cannot see
    a.startsWith('2001:db8:') // documentation
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
