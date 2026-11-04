import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The unit tests make their folders with mkdtemp(tmpdir()) and leave them; where /tmp is RAM (the
// OptiPlex's tmpfs), every run kept ~140, 350 MB in all by 2026-11-04. Each run's go under one
// folder, removed at its end: Vitest runs this before it starts the workers, which inherit TMPDIR.
export default function setup() {
  const root = mkdtempSync(join(tmpdir(), 'echo-unit-'));
  process.env.TMPDIR = root;
  return () => rmSync(root, { recursive: true, force: true });
}
