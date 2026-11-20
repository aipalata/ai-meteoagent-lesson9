import { listWeatherTools, openWeatherMcp } from "../../../lib/weather-mcp";

export const runtime = "nodejs";
export const maxDuration = 12;

export async function GET() {
  const signal = AbortSignal.timeout(7_000);
  try {
    const connection = await openWeatherMcp(signal);
    try {
      const { count } = await listWeatherTools(connection.client, signal);
      return Response.json({ status: "online", count }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      await connection.close();
    }
  } catch {
    return Response.json({ status: "offline" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
