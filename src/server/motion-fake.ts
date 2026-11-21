import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for the motion service (motion/server.py) in unit and E2E tests: it answers like the
// real one without rendering anything. A cover's "video" is the bytes it was sent behind an MP4
// header, its "still" a JPEG marker; it can hold a job, refuse keys and go away.

const NAMES = ['tall.mp4', 'square.mp4', 'tall.jpg', 'square.jpg'];

export function fakeMotionService() {
  const files = new Map<string, Buffer>(); // `${key}/${name}`
  const order: string[] = []; // keys in the order the service was asked to make them
  const deleted: string[] = [];
  const sent = new Map<string, Buffer>(); // what each key was made from
  const state = {
    hold: null as null | Promise<void>,
    refuse: new Set<string>(), // answered 422
    fail: new Map<string, number>(), // answered 500 this many times
  };

  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
  const json = (res: ServerResponse, status: number, obj: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  /** Answers a request whose path (after any prefix) is [path]; false when it is not the service's. */
  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const [route = '', query = ''] = path.split('?');
    const parts = route.split('/').slice(1);
    const [verb = '', key = '', name = ''] = parts;
    if (req.method === 'PUT' && (verb === 'render' || verb === 'transcode')) {
      await make(
        req,
        res,
        verb === 'transcode',
        key,
        Number(new URLSearchParams(query).get('loop')),
      );
      return true;
    }
    if (req.method === 'DELETE' && verb === 'motion') {
      deleted.push(key);
      let n = 0;
      for (const x of NAMES) n += files.delete(`${key}/${x}`) ? 1 : 0;
      json(res, 200, { deleted: n });
      return true;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && verb === 'motion') {
      serve(
        req,
        res,
        files.get(`${key}/${name}`),
        name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
      );
      return true;
    }
    if (route === '/stats') {
      const bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
      json(res, 200, { covers: files.size / 4, bytes, working: null });
      return true;
    }
    if (route === '/health') {
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  async function make(
    req: IncomingMessage,
    res: ServerResponse,
    video: boolean,
    key: string,
    loop: number,
  ) {
    const data = await body(req);
    order.push(key);
    sent.set(key, data);
    if (state.hold) await state.hold;
    const fails = state.fail.get(key) ?? 0;
    if (fails > 0) {
      state.fail.set(key, fails - 1);
      return json(res, 500, { error: 'boom' });
    }
    if (state.refuse.has(key) || (video && data.toString('latin1', 4, 8) !== 'ftyp'))
      return json(
        res,
        422,
        video ? { error: 'bad_video', detail: 'longer than 60 s' } : { error: 'render_failed' },
      );
    const mp4 = Buffer.concat([Buffer.from('\0\0\0\x18ftypisom'), data.subarray(0, 64)]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(key.slice(0, 8))]);
    for (const n of NAMES) files.set(`${key}/${n}`, n.endsWith('.mp4') ? mp4 : jpg);
    json(res, 200, {
      bytes: mp4.length * 2 + jpg.length * 2,
      seconds: video ? 3 : loop,
      style: video ? 'video' : data.subarray(1, 4).toString() === 'PNG' ? 'light' : 'depth',
      took: 0.01,
    });
  }

  function serve(
    req: IncomingMessage,
    res: ServerResponse,
    file: Buffer | undefined,
    type: string,
  ) {
    if (!file) return json(res, 404, { error: 'not_found' });
    const head = req.method === 'HEAD';
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (!m) {
      res.writeHead(200, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': file.length,
      });
      return res.end(head ? undefined : file);
    }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), file.length - 1) : file.length - 1;
    res.writeHead(206, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${file.length}`,
      'content-length': end - start + 1,
    });
    res.end(head ? undefined : file.subarray(start, end + 1));
  }

  return { handle, files, order, deleted, sent, state };
}

export type FakeMotion = ReturnType<typeof fakeMotionService>;

/** The fake on its own port (unit tests). */
export async function startFakeMotion() {
  const fake = fakeMotionService();
  const server = http.createServer(async (req, res) => {
    if (!(await fake.handle(req, res, req.url ?? ''))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...fake, url, close: () => server.close() };
}
