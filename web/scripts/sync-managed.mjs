// Copies the compiled ZK circuit assets (keys + zkir) from contract/src/managed/oru
// into web/public/managed/oru so Vite serves them as static files the browser's
// FetchZkConfigProvider can fetch by URL.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'contract', 'src', 'managed', 'oru');
const dest = path.resolve(here, '..', 'public', 'managed', 'oru');

if (!existsSync(src)) {
  console.error(`Managed circuit directory not found: ${src}\nRun "npm run compact" at the repo root first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(path.join(src, 'keys'), path.join(dest, 'keys'), { recursive: true });
cpSync(path.join(src, 'zkir'), path.join(dest, 'zkir'), { recursive: true });

console.log(`Synced ZK circuit assets: ${src} -> ${dest}`);
