import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testDeps } from './testing.ts';

// docs/api/openapi.yaml and the server's routes stay in step (IMPLEMENTATION_PLAN.md M5 task 13):
// every /api/v1 route is documented, and nothing is documented that does not exist.

const METHODS = ['get', 'put', 'post', 'delete'];

function documented() {
  const out = new Set<string>();
  let path: string | null = null;
  for (const line of readFileSync('docs/api/openapi.yaml', 'utf8').split('\n')) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) path = p[1] as string;
    else if (/^\S/.test(line)) path = null; // left the paths block
    const m = /^ {4}(get|put|post|delete):/.exec(line);
    if (path && m) out.add(`${(m[1] as string).toUpperCase()} ${path}`);
  }
  return out;
}

function served() {
  const { app } = testDeps();
  const out = new Set<string>();
  for (const r of app.routes) {
    if (!r.path.startsWith('/api/v1/') || !METHODS.includes(r.method.toLowerCase())) continue;
    out.add(`${r.method} ${r.path.slice('/api/v1'.length).replace(/:(\w+)/g, '{$1}')}`);
  }
  return out;
}

describe('the OpenAPI document', () => {
  it('lists exactly the routes the server serves', () => {
    const doc = documented();
    const real = served();
    expect(doc.size).toBeGreaterThan(20);
    expect([...real].filter((r) => !doc.has(r)).sort()).toEqual([]); // undocumented routes
    expect([...doc].filter((r) => !real.has(r)).sort()).toEqual([]); // documented, not served
  });
});
