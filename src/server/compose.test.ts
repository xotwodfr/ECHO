import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// SEC-09 (static part): the shipped compose example and Dockerfile run ECHO non-root on a
// read-only root filesystem with every capability dropped, no-new-privileges, and no published
// port. The `docker inspect` half runs on the deployed container (docs/reviews/M8-security.md).

describe('SEC-09: container hardening as shipped', () => {
  const compose = parse(readFileSync('compose.example.yaml', 'utf8')) as {
    services: { echo: Record<string, unknown>; 'echo-stems': Record<string, unknown> };
    networks: Record<string, { internal?: boolean; external?: boolean }>;
    secrets: Record<string, { file?: string }>;
  };
  const echo = compose.services.echo;

  it('compose: non-root, read-only, no capabilities, no-new-privileges, no published ports', () => {
    expect(echo.user).toBe('1000:1000');
    expect(echo.read_only).toBe(true);
    expect(echo.cap_drop).toEqual(['ALL']);
    expect(echo.security_opt).toContain('no-new-privileges:true');
    expect(echo).not.toHaveProperty('ports');
    expect(echo).not.toHaveProperty('privileged');
    // The master key is a Docker secret, not an environment variable.
    expect(echo.secrets).toEqual(['echo_master_key']);
    expect(JSON.stringify(echo.environment ?? {})).not.toMatch(/KEY|SECRET|PASSWORD|TOKEN/i);
  });

  // ON-DEP-1: bounded on a shared box; the proxy setting it cannot work without is in the file.
  it('compose: memory, processes and CPU are limited; ECHO_TRUSTED_PROXY is there to set', () => {
    expect(echo.mem_limit).toBeTruthy();
    expect(echo.pids_limit).toBeGreaterThan(0);
    expect(echo.cpus).toBeGreaterThan(0);
    expect(echo.environment).toHaveProperty('ECHO_TRUSTED_PROXY');
  });

  it('Dockerfile: runs as uid 1000, digest-pinned bases, no secrets baked in', () => {
    const df = readFileSync('Dockerfile', 'utf8');
    const from = df.split('\n').filter((l) => l.startsWith('FROM '));
    expect(from.length).toBeGreaterThan(0);
    for (const l of from) expect(l).toMatch(/@sha256:[0-9a-f]{64}/);
    const lastUser = df
      .split('\n')
      .filter((l) => l.startsWith('USER '))
      .at(-1);
    expect(lastUser).toBe('USER 1000:1000');
    expect(df).not.toMatch(/ENV .*(KEY|SECRET|PASSWORD|TOKEN)=/i);
  });

  it('the stem service (Karaoke): hardened the same, on an internal network with ECHO only', () => {
    const stems = compose.services['echo-stems'];
    expect(stems.user).toBe('1000:1000');
    expect(stems.read_only).toBe(true);
    expect(stems.cap_drop).toEqual(['ALL']);
    expect(stems.security_opt).toContain('no-new-privileges:true');
    expect(stems).not.toHaveProperty('ports');
    expect(stems.cpus).toBeLessThanOrEqual(2);
    expect(stems.mem_limit).toBeTruthy();
    expect(stems.networks).toEqual(['stems']);
    expect(compose.networks.stems?.internal).toBe(true);
    const df = readFileSync('stems/Dockerfile', 'utf8');
    for (const l of df.split('\n').filter((x) => x.startsWith('FROM ')))
      expect(l).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(df).toMatch(/sha256sum -c/); // the model is checked against its pinned hash
    expect(
      df
        .split('\n')
        .filter((l) => l.startsWith('USER '))
        .at(-1),
    ).toBe('USER 1000:1000');
  });
});
