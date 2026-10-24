import { describe, expect, it } from 'vitest';
import { checkUrl, isPrivateAddress, type Resolver } from './url.ts';

// SETTINGS_AND_SECURITY.md §6.1: the SSRF rules for a user's Navidrome URL.

const dns =
  (table: Record<string, string[]>): Resolver =>
  async (host) => {
    const a = table[host];
    if (!a) throw new Error('ENOTFOUND');
    return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
const opts = (over = {}) => ({
  defaultUrl: 'http://navidrome:4533',
  allowList: [] as string[],
  resolve: dns({
    navidrome: ['172.18.0.4'],
    'music.example.com': ['93.184.216.34'],
    'sneaky.example.com': ['93.184.216.34', '10.0.0.5'],
    'metadata.example.com': ['169.254.169.254'],
    'v6.example.com': ['2606:4700::1111'],
    'ula.example.com': ['fd00:ec2::254'],
    'home.lan': ['192.168.1.20'],
  }),
  ...over,
});

describe('private address space', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00:ec2::254',
    'fc00::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
    'ff02::1',
    '64:ff9b::a00:1',
    '2001:db8::1',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('the Navidrome URL (SSRF)', () => {
  it('the default internal URL is always allowed, over http, privately', async () => {
    const t = await checkUrl('http://navidrome:4533/', opts());
    expect(t.url.href).toBe('http://navidrome:4533/');
    expect(t.address).toBe('172.18.0.4');
  });

  it('any other URL must be https and public', async () => {
    await expect(checkUrl('http://music.example.com', opts())).rejects.toThrow('https_required');
    expect((await checkUrl('https://music.example.com/nd/', opts())).address).toBe('93.184.216.34');
    expect((await checkUrl('https://v6.example.com', opts())).address).toBe('2606:4700::1111');
  });

  it('private, metadata and mixed answers are refused; so are literal private IPs', async () => {
    for (const u of [
      'https://home.lan',
      'https://metadata.example.com',
      'https://ula.example.com',
      'https://sneaky.example.com', // one public, one private answer
      'https://127.0.0.1',
      'https://[::1]:4533',
      'https://169.254.169.254/latest/meta-data',
    ])
      await expect(checkUrl(u, opts()), u).rejects.toThrow('private_address');
  });

  it('the admin’s allow-list opens a private URL, exactly as listed', async () => {
    const o = opts({ allowList: ['http://home.lan:4533'] });
    expect((await checkUrl('http://home.lan:4533', o)).address).toBe('192.168.1.20');
    await expect(checkUrl('http://home.lan:4534', o)).rejects.toThrow('https_required');
  });

  it('refuses credentials in the URL, other schemes and names that do not resolve', async () => {
    await expect(checkUrl('https://u:p@music.example.com', opts())).rejects.toThrow('bad_url');
    await expect(checkUrl('ftp://music.example.com', opts())).rejects.toThrow('bad_url');
    await expect(checkUrl('not a url', opts())).rejects.toThrow('bad_url');
    await expect(checkUrl('https://nowhere.example.com', opts())).rejects.toThrow('unresolvable');
  });
});
