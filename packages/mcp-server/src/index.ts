import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config';

// M0 skeleton: the WebSocket bridge to the extension and the draft tools arrive in M3.
async function main() {
  loadConfig();
  const server = new McpServer({ name: 'yuzgeo', version: '0.0.0' });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
