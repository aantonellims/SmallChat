import { createCopilotClient, modelSessionOptions } from '../src/copilotEnv.js';

// Verifies which model a session really uses: node scripts/model-check.js <model-id>
const client = createCopilotClient();
await client.start();
const session = await client.createSession({
  ...modelSessionOptions(process.argv[2]),
  availableTools: [],
  onPermissionRequest: () => ({ kind: 'approve-once' }),
});
const seen = new Set();
session.on((e) => {
  const m = e.data?.model ?? e.data?.newModel;
  if (m) seen.add(`${e.type}:${m}`);
});
const r = await session.sendAndWait({ prompt: 'Reply with the single word OK.' }, 120000);
console.log('reply:', r?.data?.content);
console.log('models seen:', [...seen].join(' | '));
await session.disconnect();
await client.stop();
