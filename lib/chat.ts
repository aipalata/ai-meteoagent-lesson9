export type Actor = "user" | "model" | "client" | "server" | "weather";
export type Stage = "received" | "discovered" | "selected" | "calling" | "result" | "answer" | "error";

export interface Trace {
  stage: Stage;
  actor: Actor;
  title: string;
  detail?: string;
  operation?: string;
  city?: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: "running" | "success" | "error" | "empty";
  durationMs?: number;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Turn {
  id: string;
  question: string;
  trace: Trace[];
  retried?: boolean;
  answer?: string;
  error?: string;
}

export type ChatEvent =
  | { type: "trace"; trace: Trace }
  | { type: "answer"; text: string }
  | { type: "error"; text: string };

export const MAX_HISTORY = 12;
export const MAX_QUESTION_LENGTH = 500;
