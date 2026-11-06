import { expect, test } from "bun:test";
import { TextareaRenderable, TextAttributes } from "@opentui/core";
import { testRender, useRenderer } from "@opentui/solid";
import { createComponent, createSignal, ErrorBoundary, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { SubagentPanel } from "../src/SubagentPanel.tsx";
import { loadSubagentMessages, syncSubagents } from "../src/UseSubagents.ts";

/** Creates a session whose aggregate usage includes every token category. */
function session(id, parentID, created, cost = 0.005) {
  return { id, parentID, title: id, agent: "explorer", model: { providerID: "test", id: "test-model" }, cost,
    tokens: { input: 500, output: 200, reasoning: 100, cache: { read: 150, write: 50 } },
    time: { created, updated: created + 10_000, busy: created + 1000, idle: created + 6000 }, outcome: "succeeded" };
}

/** Creates a durable event, including queued calls that do not start another execution immediately. */
function event(sessionID, sequence, type, created) {
  return { id: `${sessionID}_${sequence}`, created, durable: { aggregateID: sessionID, seq: sequence, version: 1 }, type: `session.${type}`,
    data: type === "inbox.enqueued" ? { sessionID, inboxID: `input_${sequence}`, item: { type: "user", payload: { text: "Continue" }, delivery: "queue" } } : { sessionID } };
}

/** Runs the panel against reactive host data, historical messages, and real-time events without a durable log. */
function fixture() {
  const initial = [session("root", undefined, 0), session("Alpha", "root", 1000), session("Beta", "root", 2000),
    session("Nested", "Alpha", 3000), session("other", undefined, 4000), session("Unrelated", "other", 5000)];
  const [sessions, setSessions] = createStore(Object.fromEntries(initial.map((info) => [info.id, info])));
  const [statuses, setStatuses] = createStore({});
  const messages = Object.fromEntries(initial.map((info) => [info.id, [
    { id: `${info.id}_input`, type: "user", time: { created: info.time.busy + 10 } }, { id: `${info.id}_idle`, type: "idle", time: { created: info.time.idle } },
  ]]));
  const pending = {}, enqueued = new Map();
  const stores = new Map(), listeners = new Map(), requests = [];
  const [sessionID, setSessionID] = createSignal("root");
  const commands = new Set();
  const navigation = [];
  const context = {
    theme: { text: { base: "#ffffff", muted: "#aaaaaa", feedback: {
      success: { base: "#00aa00" }, warning: { base: "#aa8800" }, error: { base: "#aa0000" },
    } } },
    storage: { memory(key, { initial }) {
      if (!stores.has(key)) {
        const [state, setState] = createStore(initial);
        stores.set(key, [state, (mutation) => setState(produce(mutation))]);
      }
      return stores.get(key);
    } },
    keymap: { layer(factory) { commands.add(factory); onCleanup(() => commands.delete(factory)); } },
    ui: { router: { navigate(destination) { navigation.push(destination); setSessionID(destination.sessionID); } } },
    data: {
      on(type, handler) { listeners.set(type, handler); return () => listeners.delete(type); },
      session: {
        root(id) { while (sessions[id]?.parentID) id = sessions[id].parentID; return id; },
        list: () => Object.values(sessions), get: (id) => sessions[id], status: (id) => statuses[id] ?? "idle",
        sync: async () => {}, invalidate: () => {},
      },
    },
    client: {
      session: {
        list: async ({ parentID }) => ({ data: Object.values(sessions).filter((info) => info.parentID === parentID), cursor: {} }),
        inbox: { list: async ({ sessionID }) => pending[sessionID] ?? [] },
      },
      message: { list: async (input) => { requests.push(input); return { data: messages[input.sessionID] ?? [], cursor: {} }; } },
    },
  };
  return { context, sessions, setSessions, setStatuses, messages, pending, commands, listeners, requests, navigation, setSessionID,
    render: () => { context.renderer = useRenderer(); return createComponent(SubagentPanel, { context, get sessionID() { return sessionID(); } }); },
    emit(id, item) {
      listeners.get(item.type)?.(item);
      if (item.type === "session.inbox.enqueued") { enqueued.set(id, item.data.inboxID); return; }
      if (item.type === "session.execution.started") {
        setSessions(id, "time", "busy", item.created);
        setStatuses(id, "running");
        (messages[id] ??= []).push({ id: enqueued.get(id), type: "user", time: { created: item.created + 1 } });
      }
      else {
        setSessions(id, "time", "idle", item.created);
        setStatuses(id, "idle");
        if (!(messages[id] ??= []).some((message) => message.type === "idle" && message.time.created === item.created)) {
          messages[id].push({ id: `${id}_idle_${item.created}`, type: "idle", time: { created: item.created } });
        }
      }
    },
  };
}

/** Clicks a visible label using the renderer's actual mouse routing. */
async function click(view, label) {
  const y = view.captureCharFrame().split("\n").findIndex((line) => line.includes(label));
  expect(y).toBeGreaterThanOrEqual(0);
  await view.mockMouse.click(4, y);
  await view.renderOnce();
}

/** Reads the visible task order without including expanded detail rows. */
function titles(view) {
  return view.captureCharFrame().split("\n").filter((line) => line.includes("\u25cf ")).map((line) => line.trim().slice(4));
}

test("subagents disclose cumulative data, reorder on a new call, and preserve view state within a family", async () => {
  const host = fixture();
  host.context.storage.memory("subagents.view", { initial: { collapsed: { root: true }, expanded: {} } });
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitFor(() => host.requests.length === 3);
    await view.waitForFrame((frame) => frame.includes("Nested"));
    expect(titles(view)).toEqual(["Nested", "Beta", "Alpha"]);
    expect(view.captureCharFrame()).toContain("\u25cf3 3K $0.01");
    expect(view.captureCharFrame()).not.toMatch(/agent:|status:|session ID|v1\.|\u2500|Unrelated/);
    await click(view, "Alpha");
    await view.waitForFrame((frame) => /time: +5s/.test(frame));
    expect(view.captureSpans().lines.flatMap((line) => line.spans).some((span) => span.attributes & TextAttributes.UNDERLINE)).toBe(false);
    const details = view.captureCharFrame().split("\n").filter((line) => /agent:|model:|tokens:|cost:|time:/.test(line)).map((line) => line.trim());
    expect(details.map((line) => line.split(":")[0])).toEqual(["agent", "model", "tokens", "cost", "time"]);
    expect(details[0]).toMatch(/explorer$/);
    expect(details[1]).toMatch(/test-model$/);
    expect(details[2]).toMatch(/1K$/);
    expect(details[3]).toMatch(/\$0\.0050$/);
    const linkRow = view.captureCharFrame().split("\n").findIndex((line) => line.includes("Open session"));
    await view.mockMouse.moveTo(4, linkRow);
    await view.renderOnce();
    const link = view.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Open session"));
    expect(link.attributes & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE);
    expect([link.fg.r, link.fg.g, link.fg.b].map((value) => Math.round(value * 255))).toEqual([170, 170, 170]);
    await view.mockMouse.moveTo(0, 0);
    await view.renderOnce();
    expect(view.captureSpans().lines.flatMap((line) => line.spans).some((span) => span.attributes & TextAttributes.UNDERLINE)).toBe(false);

    host.setStatuses("Alpha", "running");
    await view.renderOnce();
    expect(titles(view)).toEqual(["Nested", "Beta", "Alpha"]);
    const started = Date.now() - 2500;
    host.emit("Alpha", event("Alpha", 4, "inbox.enqueued", started - 100));
    await view.waitFor(() => titles(view)[0] === "Alpha");
    host.emit("Alpha", event("Alpha", 5, "execution.started", started));
    await view.waitForFrame((frame) => /time: +[78]s/.test(frame));
    host.emit("Alpha", event("Alpha", 6, "execution.succeeded", started + 3000));
    host.setStatuses("Alpha", "idle");
    host.setSessions("Alpha", "tokens", { input: 1500, output: 200, reasoning: 100, cache: { read: 150, write: 50 } });
    host.setSessions("Alpha", "cost", 0.015);
    await view.waitForFrame((frame) => /time: +8s/.test(frame) && frame.includes("\u25cf3 4K $0.03"));
    await click(view, "Open session");
    expect(host.navigation.at(-1)).toEqual({ type: "session", sessionID: "Alpha" });
    expect(titles(view)).toEqual(["Alpha", "Nested", "Beta"]);
    expect(view.captureCharFrame()).toMatch(/time: +8s/);

    await click(view, "SubAgents");
    expect(titles(view)).toEqual(["Alpha", "Nested", "Beta"]);
    expect(view.captureCharFrame().split("\n").find((line) => line.includes("SubAgents"))).toStartWith("SubAgents");
    host.setSessionID("other");
    await view.waitForFrame((frame) => frame.includes("Unrelated"));
    host.setSessionID("root");
    await view.waitForFrame((frame) => frame.includes("\u25cf3"));
    await view.waitForFrame((frame) => /time: +8s/.test(frame));
    expect(titles(view)).toEqual(["Alpha", "Nested", "Beta"]);

    view.resize(26, 30);
    await view.waitForFrame((frame) => frame.split("\n").some((line) => line.includes("SubAgents") && line.includes("4K $0.03")));
    expect(view.captureCharFrame()).toMatch(/time: +8s/);
    [...host.commands][0]().commands[0].run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await view.mockInput.pressKeys(["ARROW_DOWN", "ARROW_LEFT", "o"]);
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain("agent:");
    expect(host.navigation.at(-1)).toEqual({ type: "session", sessionID: "Alpha" });
    await view.mockInput.pressKeys(["ARROW_RIGHT"]);
    await view.waitForFrame((frame) => frame.includes("agent:"));
    expect(view.captureSpans().lines.flatMap((line) => line.spans).some((span) => span.attributes & TextAttributes.UNDERLINE)).toBe(false);
  } finally {
    await view.dispose();
  }
  expect(host.commands.size).toBe(0);
  expect(host.listeners.size).toBe(0);
});

test("Escape returns typing focus to the prompt after mouse or command navigation", async () => {
  const host = fixture();
  const view = await testRender(host.render, { width: 40, height: 30 });
  const prompt = new TextareaRenderable(view.renderer, { id: "test-prompt", height: 1, width: 40 });
  view.renderer.root.add(prompt);
  try {
    await view.waitForFrame((frame) => frame.includes("Alpha"));
    prompt.focus();
    await click(view, "Alpha");
    expect(prompt.focused).toBe(false);
    await view.mockInput.pressKeys(["ESCAPE"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await view.mockInput.typeText("continue");
    expect(prompt.plainText).toBe("continue");
    prompt.blur();
    setTimeout(() => prompt.focus(), 1);
    [...host.commands][0]().commands[0].run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(prompt.focused).toBe(false);
    await view.mockInput.pressKeys(["ESCAPE"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await view.mockInput.typeText(" again");
    expect(prompt.plainText).toBe("continue again");
  } finally {
    await view.dispose();
  }
});

test("reconnect reloads messages without losing observed starts or counting an event twice", async () => {
  const host = fixture();
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitForFrame((frame) => frame.includes("Alpha"));
    await click(view, "Alpha");
    await view.waitForFrame((frame) => /time: +5s/.test(frame));
    host.emit("Alpha", event("Alpha", 4, "inbox.enqueued", 1_000_000));
    host.emit("Alpha", event("Alpha", 5, "execution.started", 1_000_100));
    // The finish event was lost offline, but the host retains its idle message and latest timestamps.
    host.messages.Alpha.push({ id: "Alpha_idle_2", type: "idle", time: { created: 1_003_100 } });
    host.setSessions("Alpha", "time", "idle", 1_003_100);
    host.setStatuses("Alpha", "idle");
    host.listeners.get("server.connected")();
    await view.waitForFrame((frame) => /time: +8s/.test(frame));
    expect(host.requests.filter((request) => request.sessionID === "Alpha")).toEqual([
      { sessionID: "Alpha", order: "asc", limit: 200 }, { sessionID: "Alpha", order: "asc", limit: 200 },
    ]);
    host.emit("Alpha", event("Alpha", 8, "execution.succeeded", 1_003_100));
    await view.renderOnce();
    expect(view.captureCharFrame()).toMatch(/time: +8s/);
    expect(titles(view)[0]).toBe("Alpha");
  } finally {
    await view.dispose();
  }
  expect(host.listeners.size).toBe(0);
});

test("historical estimates display a tilde while the latest snapshot remains exact", async () => {
  const host = fixture();
  host.messages.Alpha.unshift({ id: "old_input", type: "user", time: { created: -3000 } }, { id: "old_idle", type: "idle", time: { created: 0 } });
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitForFrame((frame) => frame.includes("Alpha"));
    await click(view, "Alpha");
    await view.waitForFrame((frame) => /time: +~8s/.test(frame));
    host.listeners.get("server.connected")();
    await view.renderOnce();
    expect(view.captureCharFrame()).toMatch(/time: +~8s/);
  } finally {
    await view.dispose();
  }
});

test("queued calls retain enqueue order after late delivery and history reload", async () => {
  const host = fixture();
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitFor(() => host.requests.length === 3);
    host.emit("Alpha", event("Alpha", 4, "inbox.enqueued", 1_000_000));
    host.emit("Beta", event("Beta", 4, "inbox.enqueued", 1_000_010));
    await view.waitFor(() => titles(view)[0] === "Beta");
    host.messages.Alpha.push({ id: "input_4", type: "user", time: { created: 1_000_020 } });
    host.listeners.get("server.connected")();
    await view.waitFor(() => host.requests.length === 6);
    await view.renderOnce();
    expect(titles(view)).toEqual(["Beta", "Alpha", "Nested"]);
  } finally {
    await view.dispose();
  }
});

test("initial pending inputs participate in call order before they have a delivered message", async () => {
  const host = fixture();
  host.pending.Alpha = [{ id: "queued", type: "user", time: { created: 1_000_000 } }];
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitFor(() => titles(view)[0] === "Alpha");
    expect(titles(view)).toEqual(["Alpha", "Nested", "Beta"]);
    expect(host.messages.Alpha.some((message) => message.id === "queued")).toBe(false);
  } finally {
    await view.dispose();
  }
});

test("hot reload accepts timing memory from before per-message call times were added", async () => {
  const host = fixture();
  const [timing, setTiming] = host.context.storage.memory("subagents.timing", { initial: {} });
  setTiming((draft) => {
    draft.Alpha = { sequence: 3, lastCalled: 1000, starts: [2000], ends: [7000], messages: host.messages.Alpha };
  });
  const errors = [];
  const view = await testRender(() => createComponent(ErrorBoundary, {
    fallback: (error) => { errors.push(error.message); return undefined; },
    get children() { return host.render(); },
  }), { width: 40, height: 30 });
  try {
    expect(errors).toEqual([]);
    await view.waitForFrame((frame) => frame.includes("Alpha"));
    await click(view, "Alpha");
    await view.waitForFrame((frame) => /time: +5s/.test(frame));
    expect(titles(view)).toEqual(["Nested", "Beta", "Alpha"]);
    expect(timing.Alpha.starts).toEqual([2000]);
    expect(timing.Alpha.ends).toEqual([7000]);
    expect(timing.Alpha.calls).toEqual({});
    expect(errors).toEqual([]);
  } finally {
    await view.dispose();
  }
});

test("message hydration follows ascending pagination and retries failed history requests", async () => {
  const pages = [{ data: [{ id: "input", type: "user", time: { created: 1000 } }], cursor: { next: "older-run-end" } },
    { data: [{ id: "idle", type: "idle", time: { created: 4000 } }], cursor: {} }];
  const requests = [];
  const context = { client: { message: { list: async (input) => { requests.push(input); return pages[input.cursor ? 1 : 0]; } } } };
  expect(await loadSubagentMessages(context, "Alpha", new AbortController().signal)).toEqual(pages.flatMap((page) => page.data));
  expect(requests).toEqual([{ sessionID: "Alpha", order: "asc", limit: 200 }, { sessionID: "Alpha", cursor: "older-run-end", limit: 200 }]);

  const host = fixture();
  const list = host.context.client.message.list;
  host.context.client.message.list = async () => { throw new Error("Disconnected"); };
  const view = await testRender(host.render, { width: 40, height: 30 });
  try {
    await view.waitForFrame((frame) => frame.includes("Unable to load subagents. Retry"));
    host.context.client.message.list = list;
    await click(view, "Unable to load subagents. Retry");
    await click(view, "Alpha");
    await view.waitForFrame((frame) => /time: +5s/.test(frame) && !frame.includes("Retry"));
  } finally {
    await view.dispose();
  }
});

test("empty families stay hidden and failed discovery can be retried from the keyboard", async () => {
  const host = fixture();
  host.setSessionID("empty");
  const list = host.context.client.session.list;
  host.context.client.session.list = async () => { throw new Error("Disconnected"); };
  const view = await testRender(host.render, { width: 40, height: 20 });
  try {
    await view.waitForFrame((frame) => frame.includes("Unable to load subagents. Retry"));
    const focus = [...host.commands][0]().commands[0];
    expect(focus.enabled).toBe(true);
    focus.run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    host.context.client.session.list = list;
    await view.mockInput.pressKeys(["r"]);
    await view.waitForFrame((frame) => !frame.includes("SubAgents"));
    host.setSessions("New child", session("New child", "empty", 6000));
    await view.waitForFrame((frame) => frame.includes("New child"));
    expect(view.captureCharFrame()).not.toContain("agent:");
    host.setSessions(produce((draft) => { delete draft["New child"]; }));
    await view.waitForFrame((frame) => !frame.includes("SubAgents"));
  } finally {
    await view.dispose();
  }
  expect(host.listeners.size).toBe(0);
});

test("child discovery follows every cursor and descendant and surfaces failed requests", async () => {
  const pages = {
    root: { data: [session("Alpha", "root", 1000)], cursor: { next: "next-page" } },
    "next-page": { data: [session("Beta", "root", 2000)], cursor: {} },
    Alpha: { data: [session("Nested", "Alpha", 3000)], cursor: {} },
  };
  const requested = [], synced = [];
  const context = {
    data: { session: { invalidate: () => {}, sync: async (id) => { synced.push(id); } } },
    client: { session: { list: async (input) => { requested.push(input); return pages[input.cursor ?? input.parentID] ?? { data: [], cursor: {} }; } } },
  };
  await syncSubagents(context, "root", new AbortController().signal);
  expect(synced).toEqual(["root", "Alpha", "Beta", "Nested"]);
  expect(requested[1]).toEqual({ cursor: "next-page", limit: 100 });
  context.client.session.list = async () => { throw new Error("Disconnected"); };
  await expect(syncSubagents(context, "root", new AbortController().signal)).rejects.toThrow("Disconnected");
});
