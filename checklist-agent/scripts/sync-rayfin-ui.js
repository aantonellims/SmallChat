import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Copies the checklist UI into the Rayfin app so it is deployed with it: npm run rayfin:sync
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'public', 'index.html');
const toDir = path.join(root, 'rayfin-app', 'packages', 'frontend', 'public', 'checklist');
mkdirSync(toDir, { recursive: true });
copyFileSync(from, path.join(toDir, 'index.html'));
console.log(`Synced ${path.relative(root, from)} -> ${path.relative(root, path.join(toDir, 'index.html'))}`);
