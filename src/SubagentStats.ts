import type { SessionEventDurable, SessionInfo, SessionMessageInfo } from "@opencode/client";

/** Retains exact live boundaries alongside the message timeline used for older runs. */
export interface SubagentHistory {
  readonly sequence: number | undefined;
  readonly lastCalled: number;
  readonly calls?: Readonly<Record<string, number>>;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  readonly messages?: readonly Pick<SessionMessageInfo, "id" | "type" | "time">[];
}

/** Marks totals containing message-derived historical estimates. */
interface SubagentDuration {
  readonly milliseconds: number;
  readonly approximate: boolean;
}

/** The status light also distinguishes inactive or interrupted sessions from successful ones. */
export type SubagentStatus = "running" | "succeeded" | "failed" | "interrupted" | "idle";

/** Starts collecting timing evidence without treating missing history as zero. */
export function emptySubagentHistory(created: number): SubagentHistory {
  return { sequence: undefined, lastCalled: created, calls: {}, starts: [], ends: [] };
}

/** Prefers observed enqueue times over delivered-message timestamps when ordering sessions. */
export function subagentLastCalled(history: SubagentHistory | undefined, created: number): number {
  let lastCalled = history?.lastCalled ?? created;
  for (const message of history?.messages ?? []) {
    // Timing memory can survive a hot reload from a version without the per-message call map.
    if (message.type === "user") lastCalled = Math.max(lastCalled, history?.calls?.[message.id] ?? message.time.created);
  }
  return lastCalled;
}

/** Captures live timing once even when the host snapshot already contains the same boundary. */
export function applySubagentEvent(history: SubagentHistory, event: SessionEventDurable): SubagentHistory {
  if (history.sequence !== undefined && event.durable.seq <= history.sequence) return history;
  const next = { ...history, sequence: event.durable.seq };
  if (event.type === "session.inbox.enqueued" && event.data.item.type === "user") {
    return { ...next, lastCalled: Math.max(history.lastCalled, event.created), calls: { ...history.calls, [event.data.inboxID]: event.created } };
  }
  if (event.type === "session.execution.started") {
    return { ...next, starts: history.starts.includes(event.created) ? history.starts : [...history.starts, event.created] };
  }
  if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
    return { ...next, ends: history.ends.includes(event.created) ? history.ends : [...history.ends, event.created] };
  }
  return next;
}

/** Uses real boundaries where available and estimates older runs between message idle markers. */
export function subagentDuration(history: SubagentHistory | undefined, session: SessionInfo, running: boolean, now: number): SubagentDuration | undefined {
  if (!history?.messages) return undefined;
  const starts = new Set(history.starts), ends = new Set(history.ends);
  if (session.time.busy !== undefined) starts.add(session.time.busy);
  if (session.time.idle !== undefined) ends.add(session.time.idle);
  const timeline: { created: number; type: "start" | "message" | "end"; completed?: number }[] = [];
  // shortcut: old runs without captured starts use message timestamps; replace with exact history when the host exposes it.
  for (const message of history.messages) {
    if (message.type === "idle") ends.add(message.time.created);
    else if (message.type === "user" || message.type === "assistant") {
      timeline.push({ created: message.time.created, type: "message", completed: "completed" in message.time ? message.time.completed : undefined });
    }
  }
  for (const created of starts) timeline.push({ created, type: "start" });
  for (const created of ends) timeline.push({ created, type: "end" });
  const order = { start: 0, message: 1, end: 2 };
  timeline.sort((a, b) => a.created - b.created || order[a.type] - order[b.type]);
  let startedAt: number | undefined, completedAt: number | undefined, estimated = false, approximate = false, milliseconds = 0;
  for (const marker of timeline) {
    if (marker.type === "start") {
      if (startedAt !== undefined) {
        if (completedAt === undefined || completedAt < startedAt || completedAt > marker.created) return undefined;
        // A shutdown can omit the idle message; the last completed assistant bounds the old estimate.
        milliseconds += completedAt - startedAt;
        approximate = true;
      }
      startedAt = marker.created;
      completedAt = undefined;
      estimated = false;
    } else if (marker.type === "message") {
      if (startedAt === undefined) { startedAt = marker.created; estimated = true; }
      if (marker.completed !== undefined) completedAt = Math.max(completedAt ?? marker.completed, marker.completed);
    } else {
      if (startedAt === undefined || marker.created < startedAt) return undefined;
      milliseconds += marker.created - startedAt;
      approximate ||= estimated;
      startedAt = undefined;
      completedAt = undefined;
    }
  }
  if (running) {
    if (startedAt === undefined) return undefined;
    milliseconds += Math.max(0, now - startedAt);
    approximate ||= estimated;
  } else if (startedAt !== undefined) return undefined;
  return { milliseconds, approximate };
}

/** Keeps failed and interrupted outcomes separate from successful completion. */
export function subagentStatus(session: SessionInfo, running: boolean): SubagentStatus {
  if (running) return "running";
  if (session.time.busy !== undefined && (session.time.idle === undefined || session.time.idle < session.time.busy)) return "idle";
  return session.outcome ?? "idle";
}

/** Collects every descendant without including unrelated roots or counting an ID twice. */
export function descendantSessions(sessions: readonly SessionInfo[], rootID: string): SessionInfo[] {
  const children = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const group = children.get(session.parentID) ?? [];
    group.push(session);
    children.set(session.parentID, group);
  }
  const result: SessionInfo[] = [];
  const seen = new Set([rootID]);
  const parents = [rootID];
  for (const parent of parents) {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      parents.push(child.id);
    }
  }
  return result;
}
