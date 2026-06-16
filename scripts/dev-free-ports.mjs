#!/usr/bin/env node
// Free TCP ports used by `pnpm dev` so api/web halves don't fail to bind.
// Reads API_PORT/WEB_PORT from env (with .env fallback), then terminates any
// process holding them. Cross-platform (Linux/macOS/WSL/Windows).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

function loadDotenv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// env > apps/api/.env > root .env > defaults
const fileEnv = {
  ...loadDotenv(resolve(ROOT, '.env')),
  ...loadDotenv(resolve(ROOT, 'apps/api/.env')),
};
const apiPort = Number(process.env.API_PORT || fileEnv.API_PORT || 3000);
const webPort = Number(process.env.WEB_PORT || fileEnv.WEB_PORT || 5173);
const aiPort = Number(process.env.BA_CHAT_PORT || fileEnv.BA_CHAT_PORT || 8000);
const ports = [...new Set([apiPort, webPort, aiPort].filter((p) => Number.isInteger(p) && p > 0))];

function pidsOnPort(port) {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
    ], { encoding: 'utf8' });
    return (r.stdout || '').split(/\s+/).map((s) => Number(s)).filter(Boolean);
  }
  // Prefer ss (always present on modern Linux/WSL); fall back to lsof.
  let r = spawnSync('ss', ['-ltnp', `sport = :${port}`], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    const pids = new Set();
    for (const m of r.stdout.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    if (pids.size) return [...pids];
  }
  r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (r.status === 0) return (r.stdout || '').split(/\s+/).map((s) => Number(s)).filter(Boolean);
  return [];
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function freePort(port) {
  const pids = pidsOnPort(port);
  if (!pids.length) return { port, freed: [] };
  for (const pid of pids) killPid(pid, 'SIGTERM');
  // Give them a moment to exit cleanly, then SIGKILL stragglers.
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    if (!pidsOnPort(port).length) return { port, freed: pids };
    spawnSync('sleep', ['0.05']);
  }
  for (const pid of pidsOnPort(port)) killPid(pid, 'SIGKILL');
  return { port, freed: pids };
}

const results = ports.map(freePort);
for (const { port, freed } of results) {
  if (freed.length) console.log(`[dev] freed :${port} (killed pid ${freed.join(', ')})`);
}
