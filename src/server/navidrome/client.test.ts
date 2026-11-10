import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient } from './client.ts';

// The idle timeout of a media request (PLAYBACK_ARCHITECTURE.md §5.5): it ends a stream whose server
// went silent, and never one whose reader stopped reading.

let server: http.Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

async function clientOf(handler: http.RequestListener, idleMs: number) {
  server = http.createServer(handler);
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const url = new URL(`http://127.0.0.1:${port}`);
  return createClient({ url, address: '127.0.0.1' }, { username: 'ada', password: 'x' }, idleMs);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a media request', () => {
  it('outlives a reader that stops reading for longer than the idle timeout', async () => {
    const body = Buffer.alloc(4 * 1024 * 1024, 7);
    const client = await clientOf((_req, res) => res.end(body), 100);
    const res = await client.request('stream', { id: 's' });
    let read = 0;
    res.on('data', (d: Buffer) => {
      read += d.length;
    });
    await new Promise((r) => res.once('data', r));
    res.pause();
    await wait(400);
    expect(res.destroyed).toBe(false);
    res.resume();
    await new Promise((r) => res.once('end', r));
    expect(read).toBe(body.length);
  });

  it('ends with a timeout when the server goes silent mid-stream', async () => {
    const client = await clientOf((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 });
      res.write('only the start');
    }, 100);
    const res = await client.request('stream', { id: 's' });
    const err = await new Promise<Error>((r) => res.on('error', r).resume());
    expect(err.message).toBe('aborted');
  });

  it('rejects with a timeout when the server never answers', async () => {
    const client = await clientOf(() => {}, 100);
    await expect(client.request('stream', { id: 's' })).rejects.toThrow('timeout');
  });
});
