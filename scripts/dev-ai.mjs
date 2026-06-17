import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

const winPath = join(ROOT, 'apps/ai/.venv/Scripts/ba-chat-server.exe');
const unixPath = join(ROOT, 'apps/ai/.venv/bin/ba-chat-server');

const exePath = process.platform === 'win32' ? winPath : unixPath;

if (!existsSync(exePath)) {
  console.error(`AI server executable not found at: ${exePath}`);
  console.error(`Please verify that your Python virtual environment is set up in apps/ai/.venv`);
  process.exit(1);
}

console.log(`Starting AI chatbot server from ${exePath}...`);

const child = spawn(exePath, [], {
  cwd: join(ROOT, 'apps/ai'),
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start AI server process:', err);
  process.exit(1);
});
