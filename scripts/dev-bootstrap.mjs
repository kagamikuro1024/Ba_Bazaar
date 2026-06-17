#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

console.log('[bootstrap] Starting development environment checks...');

// 1. Verify Node.js dependencies
const nodeModulesPath = resolve(ROOT, 'node_modules');
if (!existsSync(nodeModulesPath)) {
  console.log('[bootstrap] node_modules not found. Installing node dependencies via pnpm...');
  const pnpmRes = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    stdio: 'inherit',
    shell: true,
    cwd: ROOT
  });
  if (pnpmRes.status !== 0) {
    console.error('[bootstrap] Error: pnpm install failed.');
    process.exit(1);
  }
  console.log('[bootstrap] Node dependencies installed successfully!');
} else {
  console.log('[bootstrap] Node dependencies are already installed.');
}

// 2. Verify Python virtual environment for the AI chatbot
const venvPath = resolve(ROOT, 'apps/ai/.venv');
const isWin = process.platform === 'win32';
const venvBinDir = isWin ? resolve(venvPath, 'Scripts') : resolve(venvPath, 'bin');

let pipPath = null;
const pipNames = isWin ? ['pip.exe', 'pip3.exe', 'pip3.12.exe'] : ['pip', 'pip3', 'pip3.12'];
for (const name of pipNames) {
  const candidate = resolve(venvBinDir, name);
  if (existsSync(candidate)) {
    pipPath = candidate;
    break;
  }
}

const serverExePath = isWin
  ? resolve(venvPath, 'Scripts', 'ba-chat-server.exe')
  : resolve(venvPath, 'bin', 'ba-chat-server');

const pyprojectPath = resolve(ROOT, 'apps/ai/pyproject.toml');
const markerPath = resolve(venvPath, '.last-install');

let needsVenvCreate = !existsSync(venvPath) || !pipPath || !existsSync(serverExePath);
let needsDepsInstall = needsVenvCreate;

if (!needsVenvCreate && existsSync(pyprojectPath)) {
  if (!existsSync(markerPath)) {
    needsDepsInstall = true;
  } else {
    try {
      const pyprojectMtime = statSync(pyprojectPath).mtimeMs;
      const markerMtime = statSync(markerPath).mtimeMs;
      if (pyprojectMtime > markerMtime) {
        needsDepsInstall = true;
      }
    } catch {
      needsDepsInstall = true;
    }
  }
}

if (needsVenvCreate) {
  console.log('[bootstrap] Python virtual environment not found or incomplete. Setting up apps/ai/.venv...');
  
  // Find python command
  let pythonCmd = null;
  for (const cmd of ['python', 'python3']) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (res.status === 0) {
      pythonCmd = cmd;
      break;
    }
  }

  if (!pythonCmd) {
    console.error('[bootstrap] Error: Python was not found on your system PATH. Please install Python 3.11+.');
    process.exit(1);
  }
  console.log(`[bootstrap] Using Python binary: ${pythonCmd}`);

  // Create venv
  console.log('[bootstrap] Creating virtual environment...');
  const venvRes = spawnSync(pythonCmd, ['-m', 'venv', venvPath], { stdio: 'inherit', cwd: ROOT });
  if (venvRes.status !== 0) {
    console.error('[bootstrap] Error: Failed to create virtual environment.');
    process.exit(1);
  }

  // Resolve pip again after creating venv
  pipPath = null;
  for (const name of pipNames) {
    const candidate = resolve(venvBinDir, name);
    if (existsSync(candidate)) {
      pipPath = candidate;
      break;
    }
  }
  if (!pipPath) {
    pipPath = resolve(venvBinDir, isWin ? 'pip.exe' : 'pip');
  }

  // Upgrade pip, setuptools, wheel
  console.log('[bootstrap] Upgrading pip, setuptools, and wheel in virtual environment...');
  const upgradeRes = spawnSync(pipPath, ['install', '--no-cache-dir', '--upgrade', 'pip', 'setuptools', 'wheel'], {
    stdio: 'inherit',
    cwd: ROOT
  });
  if (upgradeRes.status !== 0) {
    console.warn('[bootstrap] Warning: Failed to upgrade pip/setuptools/wheel, trying directly...');
  }
}

if (needsDepsInstall) {
  // On Windows + Python 3.11 or 3.12, pre-install precompiled annoy wheel from GitHub to bypass C++ Build Tools requirement
  if (isWin) {
    const venvPythonPath = resolve(venvBinDir, 'python.exe');
    const pyVersionRes = spawnSync(venvPythonPath, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { encoding: 'utf8' });
    const pyVersion = (pyVersionRes.stdout || '').trim();
    if (pyVersion === '3.11' || pyVersion === '3.12') {
      console.log(`[bootstrap] Windows + Python ${pyVersion} detected. Pre-installing precompiled annoy wheel...`);
      const wheelUrl = `https://github.com/Sprocketer/annoy-wheels/raw/main/annoy-1.17.3-cp${pyVersion.replace('.', '')}-cp${pyVersion.replace('.', '')}-win_amd64.whl`;
      const wheelRes = spawnSync(pipPath, ['install', '--no-cache-dir', wheelUrl], {
        stdio: 'inherit',
        cwd: ROOT
      });
      if (wheelRes.status === 0) {
        console.log('[bootstrap] Precompiled annoy wheel installed successfully!');
      } else {
        console.warn('[bootstrap] Warning: Failed to install precompiled annoy wheel, will attempt standard build...');
      }
    }
  }

  console.log('[bootstrap] Installing/updating apps/ai package and dependencies in virtual environment...');
  const installRes = spawnSync(pipPath, ['install', '-e', resolve(ROOT, 'apps/ai')], {
    stdio: 'inherit',
    cwd: ROOT
  });
  if (installRes.status !== 0) {
    console.error('[bootstrap] Error: Failed to install apps/ai dependencies.');
    process.exit(1);
  }
  
  // Write the marker file to save installation state
  try {
    writeFileSync(markerPath, JSON.stringify({ installedAt: new Date().toISOString() }));
  } catch (err) {
    // Ignore marker write error
  }
  console.log('[bootstrap] Python dependencies up-to-date!');
} else {
  console.log('[bootstrap] Python virtual environment and dependencies are already up-to-date.');
}

// 3. Clear active development ports
console.log('[bootstrap] Clearing active development ports...');
const portsRes = spawnSync('node', [resolve(ROOT, 'scripts', 'dev-free-ports.mjs')], {
  stdio: 'inherit',
  cwd: ROOT
});
if (portsRes.status !== 0) {
  console.warn('[bootstrap] Warning: Failed to clean ports.');
}

console.log('[bootstrap] All checks completed successfully. Starting development servers...\n');
