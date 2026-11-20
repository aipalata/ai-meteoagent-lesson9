"use client";

import {
  Activity, ArrowDown, ArrowRight, ArrowUp, Braces, ChevronDown, CircleAlert, CircleCheck,
  CloudSun, Code2, Layers, LoaderCircle, MapPin, MessageCircle, Plus, RotateCcw, Sparkles, UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_HISTORY, MAX_QUESTION_LENGTH, type Actor, type ChatEvent, type Message, type Trace, type Turn } from "../lib/chat";

const actors = [
  { id: "user", label: "Пользователь", icon: UserRound, description: "Задаёт вопрос в чате" },
  { id: "model", label: "AI-модель", icon: Sparkles, description: "Учитывает историю и выбирает инструмент" },
  { id: "client", label: "MCP-клиент", icon: Code2, description: "Читает инструменты и выполняет вызовы" },
  { id: "server", label: "MCP-сервер", icon: Layers, description: "Передаёт запрос к погодному сервису" },
  { id: "weather", label: "Open-Meteo", icon: CloudSun, description: "Возвращает погодные данные" },
] as const;
const firstQuestion = "Какая сейчас погода в Екатеринбурге?";
const nextQuestion = "А в Казани?";
const storageKey = "ai-meteoagent-dialog-v1";

type ServerStatus = { value: "checking" | "online" | "offline"; count?: number };

function readHistory(): Turn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]") as Turn[];
    return Array.isArray(saved) ? saved.filter((turn) => turn.answer || turn.error) : [];
  } catch {
    return [];
  }
}

async function readEvents(response: Response, receive: (event: ChatEvent) => void) {
  if (!response.ok || !response.body) throw new Error("Request failed");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let complete = false;
  function dispatch(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatEvent;
    receive(event);
    if (event.type === "answer" || event.type === "error") complete = true;
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) dispatch(line);
    }
    dispatch(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!complete) throw new Error("Stream ended before completion");
}

function HeroGraphic() {
  return (
    <div className="hero-graphic" aria-hidden="true">
      <div className="hero-node hero-city">
        <MapPin size={22} />
        <span>Город</span>
      </div>
      <span className="hero-wire wire-city" />
      <div className="hero-node hero-mcp">
        <Layers size={23} />
        <span>MCP</span>
      </div>
      <span className="hero-wire wire-mcp" />
      <div className="hero-core"><Sparkles size={39} strokeWidth={1.7} /></div>
      <span className="hero-wire wire-weather" />
      <div className="hero-node hero-weather">
        <CloudSun size={24} />
        <span>Погода</span>
      </div>
    </div>
  );
}

function ConnectionBadge({ status }: { status: ServerStatus }) {
  const label = { checking: "Проверяем MCP", online: "MCP доступен", offline: "MCP недоступен" }[status.value];
  return <div className={`connection ${status.value}`} role="status" title={status.count ? `Инструментов на сервере: ${status.count}` : undefined}>
    <span className="status-dot" /> {label}
  </div>;
}

function Pipeline({ trace, busy }: { trace: Trace[]; busy: boolean }) {
  const [inspected, setInspected] = useState<Actor | null>(null);
  const current = trace.at(-1);
  const selected = actors.find((actor) => actor.id === inspected);
  return (
    <div className="pipeline" aria-label="Как AI-агент получает погоду">
      <ol className="pipeline-track">
        {actors.map((actor) => {
          const Icon = actor.icon;
          const active = current?.actor === actor.id;
          const seen = trace.some((item) => item.actor === actor.id);
          return (
            <li key={actor.id}>
              <button
                type="button"
                className={`actor actor-${actor.id} ${seen ? "seen" : ""} ${active ? "current" : ""} ${active && busy ? "working" : ""} ${active && current.status === "error" ? "actor-error" : ""}`}
                onClick={() => setInspected(inspected === actor.id ? null : actor.id)}
                aria-pressed={inspected === actor.id}
                title={actor.description}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{actor.label}</span>
              </button>
              <ArrowRight className="path-arrow" size={12} aria-hidden="true" />
            </li>
          );
        })}
      </ol>
      {selected && <div className={`pipeline-note actor-${selected.id}`}><strong>{selected.label}</strong> {selected.description}</div>}
    </div>
  );
}

function StatusMark({ status }: { status: Trace["status"] }) {
  if (status === "running") return <span className="trace-status pending"><LoaderCircle size={13} /> Выполняется</span>;
  if (status === "error") return <span className="trace-status failed"><CircleAlert size={13} /> Ошибка</span>;
  if (status === "empty") return <span className="trace-status failed"><CircleAlert size={13} /> Нет данных</span>;
  return <span className="trace-status done"><CircleCheck size={13} /> Успешно</span>;
}

function getTraceRows(trace: Trace[]) {
  return trace.filter((item) => {
    if (item.stage === "selected") return !trace.some((entry) => entry.callId === item.callId && entry.stage === "calling");
    if (item.stage === "calling") return !trace.some((entry) => entry.callId === item.callId && entry.stage === "result");
    return true;
  });
}

function TraceRow({ entry }: { entry: Trace }) {
  const advanced = !!entry.operation || !!entry.arguments || entry.result !== undefined;
  const isCall = !!entry.callId;
  const Icon = isCall ? Braces : entry.stage === "discovered" ? Layers : entry.stage === "received" ? MessageCircle :
    entry.stage === "error" ? CircleAlert : Sparkles;

  const line = <>
    <span className={`trace-icon actor-${entry.actor}`}><Icon size={15} strokeWidth={1.9} /></span>
    <span className="trace-label">
      <strong>{entry.operation || entry.title}</strong>
      {(entry.city || entry.detail) && <small>{entry.city || entry.detail}</small>}
    </span>
    {entry.status && <StatusMark status={entry.status} />}
    {advanced && <ChevronDown className="disclosure-icon" size={14} />}
  </>;

  if (!advanced) return <div className="trace-row simple">{line}</div>;
  return (
    <details className="trace-row" data-tool={entry.operation}>
      <summary>{line}</summary>
      <div className="trace-detail">
        {isCall && <div className="trace-meta">
          <span>tools/call</span>
          <span>Выбор AI-модели</span>
          {entry.durationMs !== undefined && <span>{entry.durationMs} мс</span>}
        </div>}
        {entry.arguments && <><p>Аргументы</p><pre>{JSON.stringify(entry.arguments, null, 2)}</pre></>}
        {entry.result !== undefined && <><p>{isCall ? "Результат MCP" : "Инструменты и схемы"}</p>
          <pre>{JSON.stringify(entry.result, null, 2)}</pre></>}
        {entry.status === "error" && entry.detail && <p className="trace-failure">{entry.detail}</p>}
      </div>
    </details>
  );
}

function TracePanel({
  turns, activeTurn, selectTurn, busy,
}: {
  turns: Turn[]; activeTurn?: Turn; selectTurn: (id: string) => void; busy: boolean;
}) {
  const rows = getTraceRows(activeTurn?.trace || []);
  const currentBusy = busy && activeTurn?.id === turns.at(-1)?.id;
  return (
    <section className="panel trace-panel" aria-labelledby="trace-heading">
      <div className="panel-header">
        <div className="panel-icon tech"><Activity size={20} /></div>
        <div>
          <h2 id="trace-heading">Как работает AI-агент</h2>
          <p>От вопроса до результата Open-Meteo</p>
        </div>
      </div>
      <Pipeline trace={activeTurn?.trace || []} busy={currentBusy} />
      <div className="trace-body">
        <div className="trace-heading"><h3>Трассировка MCP</h3>
          {!!activeTurn && <span className="trace-count">{rows.filter((row) => row.callId).length} выз.</span>}
        </div>
        {turns.length > 1 && <div className="turn-selector" aria-label="Выбор запроса">
          {turns.slice(-12).map((turn, index, visible) => <button
            type="button"
            key={turn.id}
            onClick={() => selectTurn(turn.id)}
            aria-pressed={turn.id === activeTurn?.id}
            title={turn.question}
          >{turns.length - visible.length + index + 1}. {turn.question}</button>)}
        </div>}
        {rows.length > 0 ? (
          <div className="trace-list" key={activeTurn?.id} role="region" aria-label="События MCP" tabIndex={0}>
            {rows.map((entry, index) => <TraceRow key={entry.callId || `${entry.stage}-${index}`} entry={entry} />)}
          </div>
        ) : (
          <div className="trace-empty">
            {currentBusy ? <LoaderCircle size={21} className="spin" /> : <Braces size={23} strokeWidth={1.6} />}
            <p>{currentBusy ? "Запрос отправлен" : "Здесь появятся вызовы инструментов"}</p>
            <span>{currentBusy ? "Ожидаем события сервера" : "Задайте вопрос, чтобы увидеть аргументы и результаты."}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function WeatherApp() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState<ServerStatus>({ value: "checking" });
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeTurn = turns.find((turn) => turn.id === selected) ?? turns.at(-1);

  useEffect(() => {
    setTurns(readHistory());
    setReady(true);
    let active = true;
    const controller = new AbortController();
    const check = () => fetch("/api/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (active) setStatus({ value: response.ok ? "online" : "offline", count: data.count });
      })
      .catch(() => {
        if (active) setStatus({ value: "offline" });
      });
    void check();
    const interval = window.setInterval(check, 120_000);
    return () => {
      active = false;
      controller.abort();
      pending.current?.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(turns.filter((turn) => turn.answer || turn.error).slice(-12)));
      } catch {
        // The conversation still works when browser storage is disabled or full.
      }
    }
  }, [turns, ready]);

  useEffect(() => {
    if (turns.length) {
      const container = messagesEnd.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
    }
  }, [turns]);

  function reset() {
    pending.current?.abort();
    pending.current = null;
    setTurns([]);
    setQuestion("");
    setSelected(undefined);
    setBusy(false);
    inputRef.current?.focus();
  }

  async function submit(raw: string, retryId?: string) {
    const cleaned = raw.trim();
    if (!cleaned || cleaned.length > MAX_QUESTION_LENGTH || pending.current) return;
    const retry = retryId ? turns.at(-1) : undefined;
    if (retryId && (retry?.id !== retryId || !retry.error || retry.retried)) return;
    const existing = retry ? turns.slice(0, -1) : turns;
    const controller = new AbortController();
    const id = crypto.randomUUID();
    pending.current = controller;
    setTurns([...existing, { id, question: cleaned, trace: [], retried: !!retry }]);
    setSelected(id);
    setQuestion("");
    setBusy(true);

    const history: Message[] = existing.flatMap((turn) => turn.answer ? [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ] : []);
    const update = (change: (turn: Turn) => Turn) => {
      if (!controller.signal.aborted) setTurns((current) => current.map((turn) => turn.id === id ? change(turn) : turn));
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history.slice(-MAX_HISTORY), { role: "user", content: cleaned }] }),
        signal: controller.signal,
      });
      await readEvents(response, (event) => {
        if (event.type === "trace") {
          if (event.trace.stage === "discovered") setStatus({ value: "online" });
          if (event.trace.stage === "error" && event.trace.actor === "server") setStatus({ value: "offline" });
          update((turn) => ({ ...turn, trace: [...turn.trace, event.trace] }));
        } else if (event.type === "answer") {
          update((turn) => ({ ...turn, answer: event.text }));
        } else {
          update((turn) => ({ ...turn, error: event.text }));
        }
      });
    } catch {
      update((turn) => ({ ...turn, error: "Связь с приложением прервалась. Попробуйте повторить запрос." }));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(question);
  }

  const last = turns.at(-1);
  const showFollowUp = !busy && !!last?.answer && last.question === firstQuestion;

  return (
    <>
      <header className="site-header">
        <div className="shell topbar">
          <div className="school">
            <span className="brand-mark"><Sparkles size={20} strokeWidth={1.85} /></span>
            <span><strong>Университет искусственного интеллекта</strong>
              <small>Занятие 9 · ДЗ Light</small></span>
          </div>
          <ConnectionBadge status={status} />
        </div>
      </header>
      <main className="shell app-shell">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <div className="hero-kicker"><i /> Tool Calling · Model Context Protocol</div>
            <h1 id="page-title">AI-метеоагент</h1>
            <p>Узнайте погоду в любом городе с помощью AI и MCP.</p>
          </div>
          <HeroGraphic />
        </section>
        <div className="workspace">
          <section className="panel chat-panel" aria-labelledby="chat-heading">
            <div className="panel-header chat-header">
              <div className="panel-icon chat"><MessageCircle size={20} /></div>
              <div><h2 id="chat-heading">Чат с метеоагентом</h2><p>Текущая погода и прогноз</p></div>
              <button className="new-chat" type="button" onClick={reset}>
                <Plus size={16} /> <span>Новый диалог</span>
              </button>
            </div>
            <div className="messages" role="log" aria-live="polite" aria-label="Сообщения" tabIndex={0}>
              {turns.length === 0 && <div className="empty-chat">
                <div className="empty-emblem"><CloudSun size={34} strokeWidth={1.55} /></div>
                <h3>Какая погода в вашем городе?</h3>
                <button type="button" className="suggestion" onClick={() => void submit(firstQuestion)}>
                  <MapPin size={15} /> {firstQuestion} <ArrowRight size={15} className="suggestion-arrow" />
                </button>
              </div>}
              {turns.map((turn) => <div className="conversation-turn" key={turn.id}>
                <div className="user-message">{turn.question}</div>
                {(turn.answer || turn.error || turn.id === last?.id && busy) && <div className="response">
                  <div className="agent-avatar"><Sparkles size={17} /></div>
                  <div className="response-content">
                    <span className="sender">AI-метеоагент</span>
                    {turn.answer && <p className="answer">{turn.answer}</p>}
                    {turn.error && <div className="chat-error" role="alert">
                      <p><CircleAlert size={16} />{turn.error}</p>
                      {turn.id === last?.id && !turn.retried && <button type="button" onClick={() => void submit(turn.question, turn.id)} disabled={busy}>
                        <RotateCcw size={14} /> Повторить
                      </button>}
                    </div>}
                    {!turn.answer && !turn.error && <p className="loading"><LoaderCircle size={15} /> Получаю данные о погоде…</p>}
                  </div>
                </div>}
              </div>)}
              {showFollowUp && <button type="button" className="suggestion follow-up" onClick={() => void submit(nextQuestion)}>
                {nextQuestion} <ArrowRight size={15} className="suggestion-arrow" />
              </button>}
              <div ref={messagesEnd} />
            </div>
            <div className="composer-area">
              <form className="composer" onSubmit={handleSubmit}>
                <textarea
                  ref={inputRef} aria-label="Вопрос о погоде" placeholder="Спросите о погоде…"
                  value={question} maxLength={MAX_QUESTION_LENGTH} rows={1}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void submit(question);
                    }
                  }}
                />
                <button type="submit" aria-label="Отправить вопрос" disabled={busy || !question.trim()}>
                  {busy ? <LoaderCircle size={20} className="spin" /> : <ArrowUp size={20} strokeWidth={2.2} />}
                </button>
              </form>
            </div>
          </section>
          <a className="mobile-trace-link" href="#trace-heading">Как работает AI-агент <ArrowDown size={15} /></a>
          <TracePanel turns={turns} activeTurn={activeTurn} selectTurn={setSelected} busy={busy} />
        </div>
        <footer className="site-footer">
          <span>Данные о погоде · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></span>
          <span><Code2 size={14} /> MCP · Streamable HTTP</span>
        </footer>
      </main>
    </>
  );
}
