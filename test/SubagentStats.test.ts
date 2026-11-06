import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEventDurable, SessionInfo } from "@opencode/client";
import { applySubagentEvent, descendantSessions, emptySubagentHistory, subagentDuration, subagentStatus, type SubagentHistory } from "../src/SubagentStats.ts";

/** Builds an actual host-shaped session without relying on wall-clock age. */
function session(id = "child", parentID = "root"): SessionInfo {
  return { id, parentID, projectID: "project", cost: 0, tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 30, write: 2 } },
    time: { created: 1000, updated: 1000 }, location: { directory: "D:/project" } };
}

/** Builds durable execution events with the same ordering contract as the public log. */
function execution(type: "started" | "succeeded" | "failed" | "interrupted", sequence: number, created: number): SessionEventDurable {
  const base = { id: `evt_${sequence}`, created, durable: { aggregateID: "child", seq: sequence, version: 1 as const } };
  if (type === "failed") return { ...base, type: "session.execution.failed", data: { sessionID: "child", error: { type: "test", message: "Failed" } } };
  if (type === "interrupted") return { ...base, type: "session.execution.interrupted", data: { sessionID: "child", reason: "shutdown" } };
  return { ...base, type: type === "started" ? "session.execution.started" : "session.execution.succeeded", data: { sessionID: "child" } };
}

/** Builds an invocation that can arrive while an earlier execution is still running. */
function invocation(sequence: number, created: number): SessionEventDurable {
  return { id: `evt_${sequence}`, created, type: "session.inbox.enqueued", durable: { aggregateID: "child", seq: sequence, version: 1 },
    data: { sessionID: "child", inboxID: `input_${sequence}`, item: { type: "user", payload: { text: "Continue" }, delivery: "queue" } } };
}

/** Builds minimal timestamp evidence with stable message IDs. */
function message(type: "user" | "assistant" | "idle", created: number, completed?: number): NonNullable<SubagentHistory["messages"]>[number] {
  return { id: `message_${created}`, type, time: { created, completed } };
}

test("sums completed runs and freezes the result across days of idle time", () => {
  let history: SubagentHistory = { ...emptySubagentHistory(1000), messages: [] };
  for (const event of [execution("started", 0, 2000), execution("succeeded", 1, 5000), execution("started", 2, 100_000), execution("failed", 3, 102_000)]) {
    history = applySubagentEvent(history, event);
  }
  assert.deepEqual(subagentDuration(history, session(), false, 102_000), { milliseconds: 5000, approximate: false });
  assert.deepEqual(subagentDuration(history, session(), false, 102_000 + 7 * 86400_000), { milliseconds: 5000, approximate: false });
  assert.equal(subagentStatus({ ...session(), outcome: "failed" }, false), "failed");
});

test("adds only the current active interval and preserves shutdown boundaries", () => {
  let history = emptySubagentHistory(1000);
  for (const event of [execution("started", 1, 2000), execution("interrupted", 2, 5000), execution("started", 3, 100_000)]) history = applySubagentEvent(history, event);
  history = { ...history, messages: [] };
  assert.deepEqual(subagentDuration(history, session(), true, 105_000), { milliseconds: 8000, approximate: false });
  assert.equal(subagentDuration(history, session(), false, 105_000), undefined);
  history = applySubagentEvent(history, execution("succeeded", 4, 106_000));
  assert.deepEqual(subagentDuration(history, session(), false, 999_999), { milliseconds: 9000, approximate: false });
  assert.equal(subagentStatus({ ...session(), outcome: "interrupted" }, false), "interrupted");
});

test("replay duplicates do not double count and queued calls update order immediately", () => {
  let history = emptySubagentHistory(1000);
  history = applySubagentEvent(history, invocation(1, 2000));
  history = applySubagentEvent(history, execution("started", 2, 3000));
  history = applySubagentEvent(history, invocation(3, 4000));
  assert.equal(history.lastCalled, 4000);
  history = applySubagentEvent(history, execution("succeeded", 4, 6000));
  history = applySubagentEvent(history, execution("succeeded", 4, 6000));
  history = applySubagentEvent(history, execution("started", 2, 3000));
  history = applySubagentEvent(history, execution("started", 5, 9000));
  assert.deepEqual(subagentDuration({ ...history, messages: [] }, session(), true, 10_000), { milliseconds: 4000, approximate: false });
  assert.equal(history.lastCalled, 4000);
});

test("missing or corrupt execution boundaries stay unknown instead of using current time", () => {
  for (const events of [
    [execution("succeeded", 1, 10_000)],
    [execution("started", 1, 2000), execution("started", 2, 10_000), execution("succeeded", 3, 12_000)],
    [execution("started", 1, 10_000), execution("succeeded", 2, 9000)],
  ]) {
    let history = emptySubagentHistory(1000);
    for (const event of events) history = applySubagentEvent(history, event);
    history = { ...history, messages: [] };
    assert.equal(subagentDuration(history, session(), false, 999_999_999), undefined);
  }
  const empty = { ...emptySubagentHistory(1000), messages: [] };
  assert.deepEqual(subagentDuration(empty, session(), false, 10_000), { milliseconds: 0, approximate: false });
  assert.equal(subagentDuration(emptySubagentHistory(1000), session(), false, 10_000), undefined);
});

test("accepts live sequence gaps without counting duplicate boundaries from the host snapshot", () => {
  let history = applySubagentEvent(emptySubagentHistory(1000), execution("started", 1, 2000));
  history = applySubagentEvent(history, execution("succeeded", 5, 5000));
  history = applySubagentEvent(history, execution("started", 6, 2000));
  history = applySubagentEvent(history, execution("succeeded", 7, 5000));
  history = { ...history, messages: [message("user", 2100), message("idle", 5000)] };
  const info = { ...session(), time: { created: 1000, updated: 5000, busy: 2000, idle: 5000 } };
  assert.deepEqual(subagentDuration(history, info, false, 10_000), { milliseconds: 3000, approximate: false });
  assert.deepEqual(history.starts, [2000]);
  assert.deepEqual(history.ends, [5000]);
  assert.equal(history.sequence, 7);
});

test("recovers an exact single run from busy and idle when the durable log is empty", () => {
  const history = { ...emptySubagentHistory(1000), messages: [message("user", 2100), message("idle", 5000)] };
  const info = { ...session(), time: { created: 1000, updated: 5000, busy: 2000, idle: 5000 } };
  assert.deepEqual(subagentDuration(history, info, false, 99_999_999), { milliseconds: 3000, approximate: false });
});

test("estimates old runs once per idle boundary and excludes long idle gaps", () => {
  const history = { ...emptySubagentHistory(1000), messages: [
    message("user", 2100), message("user", 3000), message("idle", 5000),
    message("user", 100_100), message("idle", 102_000),
  ] };
  const info = { ...session(), time: { created: 1000, updated: 102_000, busy: 100_000, idle: 102_000 } };
  const duration = subagentDuration(history, info, false, 99_999_999);
  assert.deepEqual(duration, { milliseconds: 4900, approximate: true });
});

test("retains live precision after reconnect and includes an observed shutdown without an idle message", () => {
  let history = emptySubagentHistory(1000);
  for (const event of [execution("started", 1, 2000), execution("interrupted", 2, 5000), execution("started", 3, 100_000)]) history = applySubagentEvent(history, event);
  history = { ...history, messages: [message("user", 2100), message("user", 100_100), message("idle", 102_000)] };
  const info = { ...session(), time: { created: 1000, updated: 102_000, busy: 100_000, idle: 102_000 } };
  assert.deepEqual(subagentDuration(history, info, false, 99_999_999), { milliseconds: 5000, approximate: false });
});

test("a running snapshot uses its real start and leaves earlier estimates marked", () => {
  const history = { ...emptySubagentHistory(1000), messages: [message("user", 2000), message("idle", 5000)] };
  const info = { ...session(), time: { created: 1000, updated: 100_000, busy: 100_000, idle: 5000 } };
  assert.deepEqual(subagentDuration(history, info, true, 102_000), { milliseconds: 5000, approximate: true });
});

test("an old shutdown without an idle message uses the last completed assistant instead of losing the run", () => {
  const history: SubagentHistory = { ...emptySubagentHistory(1000), messages: [
    message("user", 2000), message("assistant", 2100, 5000),
    message("user", 100_100), message("idle", 102_000),
  ] };
  const info = { ...session(), time: { created: 1000, updated: 102_000, busy: 100_000, idle: 102_000 } };
  assert.deepEqual(subagentDuration(history, info, false, 99_999_999), { milliseconds: 5000, approximate: true });
});

test("history with no usable completion boundary stays unknown instead of becoming an exact zero", () => {
  const history: SubagentHistory = { ...emptySubagentHistory(1000), messages: [
    message("user", 2000), message("assistant", 2100),
  ] };
  assert.equal(subagentDuration(history, session(), false, 99_999_999), undefined);
  const resumed = { ...session(), time: { created: 1000, updated: 102_000, busy: 100_000, idle: 102_000 } };
  assert.equal(subagentDuration(history, resumed, false, 99_999_999), undefined);
});

test("includes nested descendants exactly once and excludes other session families", () => {
  const child = session("child", "root");
  const nested = session("nested", "child");
  assert.deepEqual(descendantSessions([nested, session("other", "elsewhere"), child, child], "root").map((item) => item.id), ["child", "nested"]);
  assert.deepEqual(descendantSessions([child, nested], "elsewhere"), []);
});

test("running and unfinished snapshots take precedence over the previous outcome", () => {
  assert.equal(subagentStatus({ ...session(), outcome: "succeeded" }, true), "running");
  assert.equal(subagentStatus({ ...session(), time: { created: 1000, updated: 5000, busy: 5000, idle: 2000 }, outcome: "succeeded" }, false), "idle");
});
