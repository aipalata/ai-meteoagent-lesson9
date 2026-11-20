import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fetch as undiciFetch } from "undici";

const endpoint = "https://weather.chukai.io/mcp";
const timeout = 10_000;
// Use a regular HTTP stream without the Next.js data cache wrapper.
const fetchMcp = undiciFetch as unknown as typeof fetch;

// Expose only the weather features covered by this chat. Tool metadata comes from tools/list.
const allowedTools = new Set(["geocode_location", "get_weather_forecast", "interpret_weather_code"]);

export async function openWeatherMcp(signal: AbortSignal) {
  const url = new URL(process.env.MCP_SERVER_URL || endpoint);
  const client = new Client({ name: "ai-meteoagent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: (input, init) => fetchMcp(input, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }),
  });
  const close = async () => {
    try {
      if (transport.sessionId && !signal.aborted) await transport.terminateSession();
    } catch {
      // Local connection cleanup must still run if the server rejects session termination.
    } finally {
      await client.close();
    }
  };

  try {
    await client.connect(transport, { signal, timeout });
    return { client, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function listWeatherTools(client: Client, signal: AbortSignal) {
  const tools = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await client.listTools({ cursor }, { signal, timeout });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  const available = tools.filter((tool) => allowedTools.has(tool.name));
  if (!available.some((tool) => tool.name === "geocode_location") ||
      !available.some((tool) => tool.name === "get_weather_forecast")) {
    throw new Error("Weather tools unavailable");
  }
  return { available, count: tools.length };
}

export async function callWeatherTool(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  // Keep the tool session open only while making the request. Model inference can
  // take long enough for the remote server to expire an idle MCP session.
  const callSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const connection = await openWeatherMcp(callSignal);
  try {
    const result = await connection.client.callTool(
      { name, arguments: args }, undefined, { signal: callSignal, timeout },
    );
    return toolPayload(result);
  } finally {
    await connection.close();
  }
}

function toolPayload(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (result.isError) throw new Error("MCP tool returned an error");
  if (result.structuredContent) return result.structuredContent;
  if (!Array.isArray(result.content)) return null;

  const payloads = result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => {
      try {
        return JSON.parse(item.text as string) as unknown;
      } catch {
        return item.text as string;
      }
    });
  return payloads.length > 1 ? payloads : (payloads[0] ?? null);
}
