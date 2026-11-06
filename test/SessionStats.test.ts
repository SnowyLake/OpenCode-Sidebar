import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { getCacheHit, getContextUsage } from "../src/SessionStats.ts";

/** Builds host-shaped usage with unrelated output usage to catch denominator regressions. */
function usage(input: number, read: number, write = 0): SessionInfo["tokens"] {
  return { input, output: 1000, reasoning: 500, cache: { read, write } };
}

/** Builds one chronological assistant request using the public client contract. */
function assistant(id: string, tokens?: SessionInfo["tokens"]): SessionMessageInfo {
  return { id, type: "assistant", agent: "build", model: { providerID: "test", id: "test" }, content: [], time: { created: 0 }, ...(tokens && { tokens }) };
}

test("uses the latest request", () => {
  assert.equal(getCacheHit([assistant("msg_1", usage(100, 900)), assistant("msg_2", usage(200, 100, 200))]), 20);
});

test("ignores history that is not part of the displayed request", () => {
  assert.equal(getCacheHit([assistant("msg_2", usage(100, 0))]), 0);
});

test("truncates percentages without turning an exact 58 percent into 57.9 percent", () => {
  assert.equal(getCacheHit([assistant("msg_1", usage(2100, 2900))]), 58);
});

test("ignores user messages, unfinished requests and output-only usage", () => {
  const messages: SessionMessageInfo[] = [assistant("msg_1", usage(100, 300)), { id: "msg_2", type: "user", text: "hello", time: { created: 0 } },
    assistant("msg_3"), assistant("msg_4", usage(0, 0))];
  assert.equal(getCacheHit(messages), 75);
});

test("distinguishes no input usage from a measured zero hit rate", () => {
  assert.equal(getCacheHit([]), undefined);
  assert.equal(getCacheHit([assistant("msg_1", usage(100, 0))]), 0);
  assert.equal(getCacheHit([assistant("msg_1", usage(0, 100))]), 100);
});

test("respects the host's revert boundary for the latest request", () => {
  const messages = [assistant("msg_1", usage(100, 300)), assistant("msg_3", usage(100, 0))];
  assert.equal(getCacheHit(messages, "msg_2"), 75);
  assert.equal(getCacheHit(messages, "msg_1"), undefined);
});

test("measures context fill from the post-compaction step against the model limit", () => {
  const models = [{ providerID: "test", id: "test", limit: { context: 1000 } }];
  const step = (id: string, input: number, output = 0) => assistant(id, { input, output, reasoning: 0, cache: { read: 0, write: 0 } });
  const compaction = (status: "completed" | "running") => ({ id: "cmp", type: "compaction" as const, status, reason: "auto" as const, summary: "", time: { created: 0 } });
  assert.deepEqual(getContextUsage([step("msg_1", 250, 150)], models), { tokens: 400, limit: 1000, percent: 40 });
  assert.deepEqual(getContextUsage([step("msg_1", 255)], models), { tokens: 255, limit: 1000, percent: 25.5 });
  assert.deepEqual(getContextUsage([assistant("msg_1", usage(100, 200, 300))], models), { tokens: 2100, limit: 1000, percent: 210 });
  assert.deepEqual(getContextUsage([step("msg_1", 900), compaction("completed"), step("msg_2", 200)], models), { tokens: 200, limit: 1000, percent: 20 });
  assert.deepEqual(getContextUsage([step("msg_1", 400), compaction("running")], models), { tokens: 400, limit: 1000, percent: 40 });
  assert.equal(getContextUsage([step("msg_1", 400), compaction("completed")], models), undefined);
  assert.deepEqual(getContextUsage([step("msg_1", 400), step("msg_2", 100)], models, "msg_2"), { tokens: 400, limit: 1000, percent: 40 });
  assert.equal(getContextUsage([step("msg_1", 400)], models, "missing"), undefined);
  assert.equal(getContextUsage([step("msg_1", 400)], [{ providerID: "other", id: "m", limit: { context: 1000 } }]), undefined);
  assert.equal(getContextUsage([step("msg_1", 0)], models), undefined);
});

test("recomputing after updates, removal or switching sessions never accumulates stale usage", () => {
  assert.equal(getCacheHit([assistant("msg_1", usage(100, 300))]), 75);
  assert.equal(getCacheHit([assistant("msg_1", usage(100, 900))]), 90);
  assert.equal(getCacheHit([]), undefined);
});
