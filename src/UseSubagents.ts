import type { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { applySubagentEvent, descendantSessions, emptySubagentHistory, subagentLastCalled, type SubagentHistory } from "./SubagentStats.ts";

/** Reactive child discovery and execution history owned by the mounted sidebar. */
interface SubagentData {
  readonly ids: Accessor<readonly string[]>;
  readonly history: Readonly<Record<string, SubagentHistory | undefined>>;
  readonly now: Accessor<number>;
  readonly error: Accessor<boolean>;
  readonly reload: () => void;
}

/** Reads every message page while retaining only the timestamps needed for timing and call order. */
export async function loadSubagentMessages(context: Plugin.Context, sessionID: string, signal: AbortSignal): Promise<NonNullable<SubagentHistory["messages"]>> {
  const messages: NonNullable<SubagentHistory["messages"]>[number][] = [];
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await context.client.message.list(cursor ? { sessionID, cursor, limit: 200 } : { sessionID, order: "asc", limit: 200 }, { signal });
    signal.throwIfAborted();
    for (const message of page.data) {
      if (message.type === "user" || message.type === "assistant" || message.type === "idle") messages.push({ id: message.id, type: message.type, time: message.time });
    }
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
  return messages;
}

/** Hydrates the host cache from all child pages, including nested child sessions. */
export async function syncSubagents(context: Plugin.Context, rootID: string, signal: AbortSignal): Promise<void> {
  context.data.session.invalidate(rootID);
  await context.data.session.sync(rootID);
  const parents = [rootID];
  const seen = new Set(parents);
  for (const parentID of parents) {
    let cursor: string | undefined;
    do {
      signal.throwIfAborted();
      const page = await context.client.session.list(cursor ? { cursor, limit: 100 } : { parentID, limit: 100 }, { signal });
      signal.throwIfAborted();
      const children = page.data.filter((child) => child.parentID === parentID && !seen.has(child.id));
      for (const child of children) {
        seen.add(child.id);
        parents.push(child.id);
        context.data.session.invalidate(child.id);
      }
      await Promise.all(children.map((child) => context.data.session.sync(child.id)));
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
  }
}

/** Loads historical timestamps and listens to the host's live bus, which does not require event persistence. */
export function useSubagents(context: Plugin.Context, sessionID: Accessor<string>): SubagentData {
  const rootID = createMemo(() => context.data.session.root(sessionID()));
  const children = createMemo(() => descendantSessions(context.data.session.list(), rootID()));
  const [history, setHistory] = context.storage.memory<Record<string, SubagentHistory | undefined>>("subagents.timing", { initial: {} });
  const [revision, setRevision] = createSignal(0);
  const [error, setError] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const loaders = new Map<string, AbortController>();
  const ids = createMemo(() => children().map((session) => ({ session, lastCalled: subagentLastCalled(history[session.id], session.time.created) }))
    .toSorted((a, b) => b.lastCalled - a.lastCalled || b.session.time.created - a.session.time.created || b.session.id.localeCompare(a.session.id))
    .map(({ session }) => session.id));

  createEffect(() => {
    const root = rootID();
    revision();
    const controller = new AbortController();
    setError(false);
    syncSubagents(context, root, controller.signal).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    onCleanup(() => controller.abort());
  });

  createEffect(() => {
    revision();
    const sessions = children();
    const wanted = new Set(sessions.map((session) => session.id));
    for (const [id, controller] of loaders) {
      if (wanted.has(id)) continue;
      controller.abort();
      loaders.delete(id);
    }
    for (const session of sessions) {
      const { busy, idle } = session.time;
      untrack(() => setHistory((draft) => {
        const current = draft[session.id];
        const state = current ?? emptySubagentHistory(session.time.created);
        const starts = busy === undefined || state.starts.includes(busy) ? state.starts : [...state.starts, busy];
        const ends = idle === undefined || state.ends.includes(idle) ? state.ends : [...state.ends, idle];
        if (!current || starts !== state.starts || ends !== state.ends) draft[session.id] = { ...state, starts, ends };
      }));
      if (loaders.has(session.id)) continue;
      const controller = new AbortController();
      loaders.set(session.id, controller);
      untrack(() => Promise.all([
        loadSubagentMessages(context, session.id, controller.signal),
        context.client.session.inbox.list({ sessionID: session.id }, { signal: controller.signal }),
      ])).then(([messages, pending]) => {
        if (controller.signal.aborted) return;
        setHistory((draft) => {
          const state = draft[session.id] ?? emptySubagentHistory(session.time.created);
          const calls = { ...state.calls };
          let lastCalled = state.lastCalled;
          for (const item of pending) {
            if (item.type !== "user") continue;
            calls[item.id] = item.time.created;
            lastCalled = Math.max(lastCalled, item.time.created);
          }
          draft[session.id] = { ...state, calls, lastCalled, messages };
        });
      }).catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    }
  });

  createEffect(() => {
    if (!children().some((session) => context.data.session.status(session.id) === "running")) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  /** Refreshes missing history after reconnects or explicit retries. */
  function reload(): void {
    for (const controller of loaders.values()) controller.abort();
    loaders.clear();
    setRevision((value) => value + 1);
  }

  for (const type of ["session.inbox.enqueued", "session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"] as const) {
    onCleanup(context.data.on(type, (event) => {
      setHistory((draft) => {
        const id = event.data.sessionID;
        draft[id] = applySubagentEvent(draft[id] ?? emptySubagentHistory(context.data.session.get(id)?.time.created ?? event.created), event);
      });
    }));
  }
  onCleanup(context.data.on("server.connected", reload));
  onCleanup(() => { for (const controller of loaders.values()) controller.abort(); });
  return { ids, history, now, error, reload };
}
