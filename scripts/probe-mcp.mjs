import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_SERVER_URL || "https://weather.chukai.io/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "ai-meteoagent-probe", version: "1.0.0" });

try {
  await client.connect(transport, { timeout: 8000 });
  let cursor;
  do {
    const page = await client.listTools({ cursor }, { timeout: 8000 });
    for (const { name, inputSchema } of page.tools) console.log(name, JSON.stringify(inputSchema));
    cursor = page.nextCursor;
  } while (cursor);
} finally {
  try {
    if (transport.sessionId) await transport.terminateSession();
  } finally {
    await client.close();
  }
}
