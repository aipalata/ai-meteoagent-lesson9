import { MAX_HISTORY, MAX_QUESTION_LENGTH, type ChatEvent, type Message } from "../../../lib/chat";
import { AgentError, runWeatherAgent } from "../../../lib/weather-agent";

export const runtime = "nodejs";
export const maxDuration = 60;
const maxChatBodyBytes = 64_000;

function validMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Message>;
  return (message.role === "assistant" || message.role === "user") &&
    typeof message.content === "string" && !!message.content.trim() &&
    message.content.length <= (message.role === "user" ? MAX_QUESTION_LENGTH : 2500);
}

export async function POST(request: Request) {
  let messages: unknown;
  try {
    if (Number(request.headers.get("content-length")) > maxChatBodyBytes) throw new Error();
    const body = await request.text();
    if (Buffer.byteLength(body) > maxChatBodyBytes) throw new Error();
    messages = JSON.parse(body).messages;
  } catch {
    return Response.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_HISTORY + 1 ||
      messages.at(-1)?.role !== "user" || !messages.every(validMessage)) {
    return Response.json({ error: "Введите вопрос о погоде длиной до 500 символов." }, { status: 400 });
  }

  const abort = new AbortController();
  const timeout = AbortSignal.timeout(52_000);
  const signal = AbortSignal.any([abort.signal, request.signal, timeout]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        if (!abort.signal.aborted && !request.signal.aborted) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      };

      try {
        const answer = await runWeatherAgent(messages, emit, signal);
        emit({ type: "answer", text: answer });
      } catch (error) {
        if (abort.signal.aborted || request.signal.aborted) return;
        if (!(error instanceof AgentError)) {
          console.warn("Weather agent request failed:", error instanceof Error ? error.name : "unknown");
        }
        const expired = timeout.aborted || (error instanceof Error && error.name === "TimeoutError");
        const text = expired ? "Время ожидания истекло. Попробуйте повторить запрос." :
          error instanceof AgentError ? error.message : "Не удалось завершить запрос. Попробуйте ещё раз.";
        emit({ type: "trace", trace: {
          stage: "error", actor: error instanceof AgentError ? error.actor : "model",
          title: "Запрос завершился ошибкой", detail: text, status: "error",
        } });
        emit({ type: "error", text });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
