import { CopilotClient } from '@github/copilot-sdk';
import { permissionHandler } from '../src/agent.js';
import { azCliTokenProvider } from '../src/fabric.js';

// Checks that the hosted Power BI MCP is available to a Copilot session: node scripts/mcp-session-probe.js [availableTools-pattern]
const pattern = process.argv[2] ?? 'mcp:*';
const token = await azCliTokenProvider()('https://api.fabric.microsoft.com');
const client = new CopilotClient();
await client.start?.();
const session = await client.createSession({
  mcpServers: { 'powerbi-modeling': { type: 'http', url: 'https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring', headers: { Authorization: `Bearer ${token}` }, tools: ['*'] } },
  availableTools: [pattern, 'tool_search_tool'],
  onPermissionRequest: permissionHandler,
});
session.on((e) => {
  if (/mcp|tool\.execution_start/.test(e.type)) console.log(e.type, JSON.stringify(e.data ?? {}).slice(0, 220));
});
const r = await session.sendAndWait({ prompt: 'List the exact names of every tool you can call that belongs to an MCP server. Then call connection_operations with operation "help" (request is a JSON string) and summarize the result in 3 lines.' }, 180000);
console.log(r?.data?.content);
await session.disconnect();
await client.stop?.();
