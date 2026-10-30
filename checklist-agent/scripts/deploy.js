// One-command deployment: builds the Rayfin UI, deploys it to Fabric, remembers the hosting URL,
// then starts the agent so the deployed page can reach it.
//   npm run deploy -- --workspace-id <guid>           (or --workspace-uri <fabric workspace url>)
//   npm run deploy -- --capacity-id <guid>            (no workspace yet)
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'rayfin-app');
const urlFile = path.join(root, '.hosting-url');
const rest = process.argv.slice(2);

if (!rest.some((a) => /^--(workspace-id|workspace-uri|capacity-id|workspace)$/.test(a))) {
  console.error('Usage: npm run deploy -- --workspace-id <workspace-guid>\n   or: npm run deploy -- --workspace-uri https://app.fabric.microsoft.com/groups/<id>/list\n   or: npm run deploy -- --capacity-id <capacity-guid>   (creates the workspace)');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', shell: true, encoding: 'utf8', ...opts });
}
function must(r, what) {
  if (r.status !== 0) { console.error(`\n${what} failed.`); process.exit(r.status || 1); }
  return r;
}

console.log('Step 1/4: build the app');
must(run('node', ['scripts/sync-rayfin-ui.js'], { cwd: root }), 'Syncing the UI');
if (!fs.existsSync(path.join(app, 'node_modules'))) must(run('npm', ['ci'], { cwd: app }), 'Installing the Rayfin app');
must(run('npm', ['run', 'build'], { cwd: app }), 'Building the Rayfin app');

console.log('\nStep 2/4: sign in to Fabric (skipped if already signed in)');
const status = spawnSync('npx', ['rayfin', 'login', 'status'], { cwd: app, shell: true, encoding: 'utf8' });
if (status.status !== 0 || !/signed in/i.test(`${status.stdout}${status.stderr}`)) must(run('npx', ['rayfin', 'login'], { cwd: app }), 'Fabric sign-in');

console.log('\nStep 3/4: deploy to Fabric');
const up = must(run('npx', ['rayfin', 'up', '--yes', '--json', '--item-name', 'semantic-model-checklist-agent', ...rest], { cwd: app, capture: true }), 'Deployment');
process.stdout.write(up.stdout || '');
const m = /https:\/\/[A-Za-z0-9.-]+\.fabricapps\.net/.exec(up.stdout || '');
if (!m) { console.error('\nDeployed, but the hosting URL was not found in the output. Start the agent with ALLOWED_ORIGINS=<hosting url> npm start.'); process.exit(1); }
fs.writeFileSync(urlFile, m[0] + '\n');
console.log(`\nDeployed: ${m[0]}`);

console.log('\nStep 4/4: starting the agent (keep this window open; Ctrl+C to stop)');
console.log(`Open the app from the Fabric portal or ${m[0]}\n`);
const child = spawn(process.execPath, ['src/server.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, ALLOWED_ORIGINS: [process.env.ALLOWED_ORIGINS, m[0]].filter(Boolean).join(',') } });
child.on('exit', (code) => process.exit(code || 0));
