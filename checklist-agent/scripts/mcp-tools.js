// Lists tools of the hosted Power BI authoring MCP using the az CLI token: node scripts/mcp-tools.js [url]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execSync } from 'node:child_process';

const url = process.argv[2] ?? 'https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring';
const token = execSync('az account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv', { shell: 'cmd.exe' }).toString().trim();
const c = new Client({ name: 'probe', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
for (const t of (await c.listTools()).tools) console.log(t.name, '-', (t.description ?? '').slice(0, 110).replace(/\s+/g, ' '));
await c.close();
