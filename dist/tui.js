// @bun
// src/tui.tsx
import { effect as _$effect2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { use as _$use2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createMemo as createMemo3, createSignal as createSignal3 } from "solid-js";

// src/Color.ts
var MAX_SAT = 0.28;
var FALLBACK = { success: "#9CAF8B", warning: "#C5B88D", error: "#B08A8A" };
function feedback(theme, kind) {
  return desaturateTo(theme.text.feedback[kind].base, MAX_SAT, FALLBACK[kind]);
}
function desaturateTo(raw, maxSat, fallback) {
  const color = rgb(raw);
  if (!color)
    return fallback;
  if (saturation(color.r, color.g, color.b) <= maxSat)
    return hex(color.r, color.g, color.b);
  const luma = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  let lo = 0, hi = 1;
  for (let i = 0;i < 12; i++) {
    const mid = (lo + hi) / 2;
    const mixed = mix(color, luma, mid);
    if (saturation(mixed.r, mixed.g, mixed.b) > maxSat)
      lo = mid;
    else
      hi = mid;
  }
  const mixed = mix(color, luma, hi);
  return hex(mixed.r, mixed.g, mixed.b);
}
function rgb(raw) {
  if (typeof raw === "string" && raw.startsWith("#")) {
    const h = raw.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  if (raw && typeof raw === "object" && "r" in raw && "g" in raw && "b" in raw) {
    const o = raw;
    if (typeof o.r !== "number" || typeof o.g !== "number" || typeof o.b !== "number")
      return;
    const scale = o.r > 1 || o.g > 1 || o.b > 1 ? 1 : 255;
    return { r: Math.round(o.r * scale), g: Math.round(o.g * scale), b: Math.round(o.b * scale) };
  }
  return;
}
function saturation(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (delta === 0)
    return 0;
  const l = (max + min) / 2;
  return l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
}
function mix(color, luma, amount) {
  return {
    r: Math.round(color.r + (luma - color.r) * amount),
    g: Math.round(color.g + (luma - color.g) * amount),
    b: Math.round(color.b + (luma - color.b) * amount)
  };
}
function hex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

// src/Format.ts
function formatPercent(value) {
  return value === undefined ? "--" : `${value.toFixed(1)}%`;
}
function formatTokens(value) {
  return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
}
function formatDuration(milliseconds, approximate = false) {
  if (milliseconds === undefined)
    return "--";
  const seconds = Math.floor(milliseconds / 1000);
  const prefix = approximate ? "~" : "";
  if (seconds < 60)
    return `${prefix}${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = `${String(seconds % 60).padStart(2, "0")}s`;
  return minutes < 60 ? `${prefix}${minutes}m${remainder}` : `${prefix}${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m${remainder}`;
}
function progressBar(percent, width) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round(clamped / 100 * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, width - filled));
}

// src/SessionStats.ts
function getCacheHit(messages, boundary) {
  for (let index = messages.length - 1;index >= 0; index--) {
    const message = messages[index];
    if (message.type !== "assistant" || boundary && message.id >= boundary || !message.tokens)
      continue;
    const input = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write;
    if (input > 0)
      return Math.floor(message.tokens.cache.read * 1000 / input) / 10;
  }
}
function totalTokens(tokens) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}
function getContextUsage(messages, models, boundary) {
  const last = contextMessage(messages, boundary);
  if (!last?.tokens)
    return;
  const tokens = totalTokens(last.tokens);
  const limit = models?.find((model) => model.providerID === last.model.providerID && model.id === last.model.id)?.limit.context;
  return tokens > 0 && limit ? { tokens, limit, percent: tokens * 100 / limit } : undefined;
}
function contextMessage(messages, boundary) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  if (boundary && boundaryIndex === -1)
    return;
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex;
  const compactionIndex = messages.findLastIndex((message, index) => message.type === "compaction" && message.status === "completed" && index < end);
  const last = messages.findLast((message, index) => message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end);
  return last?.type === "assistant" ? last : undefined;
}

// src/SubagentPanel.tsx
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { createEffect as createEffect2, createMemo as createMemo2, createSignal as createSignal2, For, Show } from "solid-js";

// src/SubagentStats.ts
function emptySubagentHistory(created) {
  return { sequence: undefined, lastCalled: created, calls: {}, starts: [], ends: [] };
}
function subagentLastCalled(history, created) {
  let lastCalled = history?.lastCalled ?? created;
  for (const message of history?.messages ?? []) {
    if (message.type === "user")
      lastCalled = Math.max(lastCalled, history?.calls?.[message.id] ?? message.time.created);
  }
  return lastCalled;
}
function applySubagentEvent(history, event) {
  if (history.sequence !== undefined && event.durable.seq <= history.sequence)
    return history;
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
function subagentDuration(history, session, running, now) {
  if (!history?.messages)
    return;
  const starts = new Set(history.starts), ends = new Set(history.ends);
  if (session.time.busy !== undefined)
    starts.add(session.time.busy);
  if (session.time.idle !== undefined)
    ends.add(session.time.idle);
  const timeline = [];
  for (const message of history.messages) {
    if (message.type === "idle")
      ends.add(message.time.created);
    else if (message.type === "user" || message.type === "assistant") {
      timeline.push({ created: message.time.created, type: "message", completed: "completed" in message.time ? message.time.completed : undefined });
    }
  }
  for (const created of starts)
    timeline.push({ created, type: "start" });
  for (const created of ends)
    timeline.push({ created, type: "end" });
  const order = { start: 0, message: 1, end: 2 };
  timeline.sort((a, b) => a.created - b.created || order[a.type] - order[b.type]);
  let startedAt, completedAt, estimated = false, approximate = false, milliseconds = 0;
  for (const marker of timeline) {
    if (marker.type === "start") {
      if (startedAt !== undefined) {
        if (completedAt === undefined || completedAt < startedAt || completedAt > marker.created)
          return;
        milliseconds += completedAt - startedAt;
        approximate = true;
      }
      startedAt = marker.created;
      completedAt = undefined;
      estimated = false;
    } else if (marker.type === "message") {
      if (startedAt === undefined) {
        startedAt = marker.created;
        estimated = true;
      }
      if (marker.completed !== undefined)
        completedAt = Math.max(completedAt ?? marker.completed, marker.completed);
    } else {
      if (startedAt === undefined || marker.created < startedAt)
        return;
      milliseconds += marker.created - startedAt;
      approximate ||= estimated;
      startedAt = undefined;
      completedAt = undefined;
    }
  }
  if (running) {
    if (startedAt === undefined)
      return;
    milliseconds += Math.max(0, now - startedAt);
    approximate ||= estimated;
  } else if (startedAt !== undefined)
    return;
  return { milliseconds, approximate };
}
function subagentStatus(session, running) {
  if (running)
    return "running";
  if (session.time.busy !== undefined && (session.time.idle === undefined || session.time.idle < session.time.busy))
    return "idle";
  return session.outcome ?? "idle";
}
function descendantSessions(sessions, rootID) {
  const children = new Map;
  for (const session of sessions) {
    if (!session.parentID)
      continue;
    const group = children.get(session.parentID) ?? [];
    group.push(session);
    children.set(session.parentID, group);
  }
  const result = [];
  const seen = new Set([rootID]);
  const parents = [rootID];
  for (const parent of parents) {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id))
        continue;
      seen.add(child.id);
      result.push(child);
      parents.push(child.id);
    }
  }
  return result;
}

// src/UseSubagents.ts
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
async function loadSubagentMessages(context, sessionID, signal) {
  const messages = [];
  let cursor;
  do {
    signal.throwIfAborted();
    const page = await context.client.message.list(cursor ? { sessionID, cursor, limit: 200 } : { sessionID, order: "asc", limit: 200 }, { signal });
    signal.throwIfAborted();
    for (const message of page.data) {
      if (message.type === "user" || message.type === "assistant" || message.type === "idle")
        messages.push({ id: message.id, type: message.type, time: message.time });
    }
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
  return messages;
}
async function syncSubagents(context, rootID, signal) {
  context.data.session.invalidate(rootID);
  await context.data.session.sync(rootID);
  const parents = [rootID];
  const seen = new Set(parents);
  for (const parentID of parents) {
    let cursor;
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
function useSubagents(context, sessionID) {
  const rootID = createMemo(() => context.data.session.root(sessionID()));
  const children = createMemo(() => descendantSessions(context.data.session.list(), rootID()));
  const [history, setHistory] = context.storage.memory("subagents.timing", { initial: {} });
  const [revision, setRevision] = createSignal(0);
  const [error, setError] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const loaders = new Map;
  const ids = createMemo(() => children().map((session) => ({ session, lastCalled: subagentLastCalled(history[session.id], session.time.created) })).toSorted((a, b) => b.lastCalled - a.lastCalled || b.session.time.created - a.session.time.created || b.session.id.localeCompare(a.session.id)).map(({ session }) => session.id));
  createEffect(() => {
    const root = rootID();
    revision();
    const controller = new AbortController;
    setError(false);
    syncSubagents(context, root, controller.signal).catch(() => {
      if (!controller.signal.aborted)
        setError(true);
    });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    revision();
    const sessions = children();
    const wanted = new Set(sessions.map((session) => session.id));
    for (const [id, controller] of loaders) {
      if (wanted.has(id))
        continue;
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
        if (!current || starts !== state.starts || ends !== state.ends)
          draft[session.id] = { ...state, starts, ends };
      }));
      if (loaders.has(session.id))
        continue;
      const controller = new AbortController;
      loaders.set(session.id, controller);
      untrack(() => Promise.all([
        loadSubagentMessages(context, session.id, controller.signal),
        context.client.session.inbox.list({ sessionID: session.id }, { signal: controller.signal })
      ])).then(([messages, pending]) => {
        if (controller.signal.aborted)
          return;
        setHistory((draft) => {
          const state = draft[session.id] ?? emptySubagentHistory(session.time.created);
          const calls = { ...state.calls };
          let lastCalled = state.lastCalled;
          for (const item of pending) {
            if (item.type !== "user")
              continue;
            calls[item.id] = item.time.created;
            lastCalled = Math.max(lastCalled, item.time.created);
          }
          draft[session.id] = { ...state, calls, lastCalled, messages };
        });
      }).catch(() => {
        if (!controller.signal.aborted)
          setError(true);
      });
    }
  });
  createEffect(() => {
    if (!children().some((session) => context.data.session.status(session.id) === "running"))
      return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  function reload() {
    for (const controller of loaders.values())
      controller.abort();
    loaders.clear();
    setRevision((value) => value + 1);
  }
  for (const type of ["session.inbox.enqueued", "session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]) {
    onCleanup(context.data.on(type, (event) => {
      setHistory((draft) => {
        const id = event.data.sessionID;
        draft[id] = applySubagentEvent(draft[id] ?? emptySubagentHistory(context.data.session.get(id)?.time.created ?? event.created), event);
      });
    }));
  }
  onCleanup(context.data.on("server.connected", reload));
  onCleanup(() => {
    for (const controller of loaders.values())
      controller.abort();
  });
  return { ids, history, now, error, reload };
}

// src/SubagentPanel.tsx
function SubagentPanel(props) {
  const data = useSubagents(props.context, () => props.sessionID);
  const [view, setView] = props.context.storage.memory("subagents.view", {
    initial: {
      expanded: {}
    }
  });
  const [selected, setSelected] = createSignal2();
  const [focused, setFocused] = createSignal2(false);
  let panel;
  let previousFocus = null;
  const totals = createMemo2(() => {
    let tokens = 0, cost = 0;
    const statuses = [];
    for (const id of data.ids()) {
      const session = props.context.data.session.get(id);
      if (!session)
        continue;
      tokens += totalTokens(session.tokens);
      cost += session.cost;
      statuses.push(subagentStatus(session, props.context.data.session.status(id) === "running"));
    }
    const status = statuses.includes("running") ? "running" : statuses.includes("failed") ? "failed" : statuses.every((value) => value === "succeeded") ? "succeeded" : "idle";
    return {
      tokens,
      cost,
      status
    };
  });
  function focusPanel() {
    if (!panel || panel.isDestroyed || panel.focused)
      return;
    previousFocus = props.context.renderer.currentFocusedRenderable;
    panel.focus();
  }
  function setExpanded(id, expanded) {
    setView((draft) => {
      draft.expanded[id] = expanded;
    });
  }
  function toggle(id) {
    setSelected(id);
    setExpanded(id, !view.expanded[id]);
  }
  function handleKeyDown(event) {
    const id = selected();
    if (event.name === "up" || event.name === "down") {
      const items = data.ids();
      const next = Math.max(0, Math.min(items.length - 1, (id === undefined ? -1 : items.indexOf(id)) + (event.name === "down" ? 1 : -1)));
      setSelected(items[next]);
    } else if (id && (event.name === "return" || event.name === "space"))
      toggle(id);
    else if (id && (event.name === "left" || event.name === "right"))
      setExpanded(id, event.name === "right");
    else if (event.name === "o" && id)
      props.context.ui.router.navigate({
        type: "session",
        sessionID: id
      });
    else if (event.name === "r" && data.error())
      data.reload();
    else if (event.name === "escape") {
      panel?.blur();
      if (previousFocus && !previousFocus.isDestroyed)
        previousFocus.focus();
    } else
      return;
    event.preventDefault();
    event.stopPropagation();
  }
  createEffect2(() => {
    if (selected() && !data.ids().includes(selected()))
      setSelected(undefined);
  });
  props.context.keymap.layer(() => ({
    commands: [{
      id: "subagents.focus",
      title: "Focus subagents",
      group: "SnowySidebar",
      palette: true,
      enabled: data.ids().length > 0 || data.error(),
      run: () => {
        setTimeout(focusPanel, 1);
      }
    }]
  }));
  return _$createComponent(Show, {
    get when() {
      return data.ids().length > 0 || data.error();
    },
    get children() {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$5 = _$createElement("text"), _el$6 = _$createElement("span");
      _$insertNode(_el$, _el$2);
      _$use((el) => {
        panel = el;
        el.focusable = true;
      }, _el$);
      _$setProp(_el$, "width", "100%");
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "marginTop", 1);
      _$setProp(_el$, "onMouseDown", focusPanel);
      _$setProp(_el$, "onKeyDown", handleKeyDown);
      _$setProp(_el$, "on:focused", () => setFocused(true));
      _$setProp(_el$, "on:blurred", () => setFocused(false));
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$2, _el$5);
      _$setProp(_el$2, "width", "100%");
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "height", 1);
      _$insertNode(_el$3, _$createTextNode(`SubAgents`));
      _$setProp(_el$3, "flexShrink", 0);
      _$insertNode(_el$5, _el$6);
      _$setProp(_el$5, "flexGrow", 1);
      _$setProp(_el$5, "minWidth", 0);
      _$setProp(_el$5, "textAlign", "right");
      _$setProp(_el$5, "wrapMode", "none");
      _$setProp(_el$5, "truncate", true);
      _$insertNode(_el$6, _$createTextNode(`\u25CF`));
      _$insert(_el$5, () => `${data.ids().length} ${formatTokens(totals().tokens)} $${totals().cost.toFixed(2)}`, null);
      _$insert(_el$, _$createComponent(For, {
        get each() {
          return data.ids();
        },
        children: (id) => _$createComponent(Show, {
          get when() {
            return props.context.data.session.get(id);
          },
          children: (info) => (() => {
            var _el$0 = _$createElement("box"), _el$1 = _$createElement("box"), _el$10 = _$createElement("text"), _el$11 = _$createElement("text"), _el$13 = _$createElement("text");
            _$insertNode(_el$0, _el$1);
            _$setProp(_el$0, "width", "100%");
            _$setProp(_el$0, "flexDirection", "column");
            _$insertNode(_el$1, _el$10);
            _$insertNode(_el$1, _el$11);
            _$insertNode(_el$1, _el$13);
            _$setProp(_el$1, "width", "100%");
            _$setProp(_el$1, "flexDirection", "row");
            _$setProp(_el$1, "height", 1);
            _$setProp(_el$1, "onMouseUp", (event) => {
              if (event.button === 0)
                toggle(id);
            });
            _$setProp(_el$10, "flexShrink", 0);
            _$insert(_el$10, () => view.expanded[id] ? "\u25BC " : "\u25B6 ");
            _$insertNode(_el$11, _$createTextNode(`\u25CF `));
            _$setProp(_el$11, "flexShrink", 0);
            _$setProp(_el$13, "flexGrow", 1);
            _$setProp(_el$13, "minWidth", 0);
            _$setProp(_el$13, "wrapMode", "none");
            _$setProp(_el$13, "truncate", true);
            _$insert(_el$13, () => info().title || info().agent || "Subagent");
            _$insert(_el$0, _$createComponent(Show, {
              get when() {
                return view.expanded[id];
              },
              children: (_expanded) => {
                const [openHovered, setOpenHovered] = createSignal2(false);
                const duration = createMemo2(() => subagentDuration(data.history[id], info(), props.context.data.session.status(id) === "running", data.now()));
                return (() => {
                  var _el$14 = _$createElement("box"), _el$15 = _$createElement("text");
                  _$insertNode(_el$14, _el$15);
                  _$setProp(_el$14, "width", "100%");
                  _$setProp(_el$14, "flexDirection", "column");
                  _$setProp(_el$14, "paddingLeft", 2);
                  _$insert(_el$14, _$createComponent(Detail, {
                    label: "agent",
                    get value() {
                      return info().agent ?? "--";
                    },
                    get theme() {
                      return props.context.theme;
                    }
                  }), _el$15);
                  _$insert(_el$14, _$createComponent(Detail, {
                    label: "model",
                    get value() {
                      return info().model?.id ?? "--";
                    },
                    get theme() {
                      return props.context.theme;
                    }
                  }), _el$15);
                  _$insert(_el$14, _$createComponent(Detail, {
                    label: "tokens",
                    get value() {
                      return formatTokens(totalTokens(info().tokens));
                    },
                    get theme() {
                      return props.context.theme;
                    }
                  }), _el$15);
                  _$insert(_el$14, _$createComponent(Detail, {
                    label: "cost",
                    get value() {
                      return `$${info().cost.toFixed(4)}`;
                    },
                    get theme() {
                      return props.context.theme;
                    }
                  }), _el$15);
                  _$insert(_el$14, _$createComponent(Detail, {
                    label: "time",
                    get value() {
                      return formatDuration(duration()?.milliseconds, duration()?.approximate);
                    },
                    get theme() {
                      return props.context.theme;
                    }
                  }), _el$15);
                  _$insertNode(_el$15, _$createTextNode(`\u2192 Open session`));
                  _$setProp(_el$15, "onMouseOver", () => setOpenHovered(true));
                  _$setProp(_el$15, "onMouseOut", () => setOpenHovered(false));
                  _$setProp(_el$15, "onMouseUp", (event) => {
                    if (event.button === 0)
                      props.context.ui.router.navigate({
                        type: "session",
                        sessionID: id
                      });
                  });
                  _$effect((_p$) => {
                    var _v$7 = props.context.theme.text.muted, _v$8 = openHovered() ? TextAttributes.UNDERLINE : TextAttributes.NONE;
                    _v$7 !== _p$.e && (_p$.e = _$setProp(_el$15, "fg", _v$7, _p$.e));
                    _v$8 !== _p$.t && (_p$.t = _$setProp(_el$15, "attributes", _v$8, _p$.t));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined
                  });
                  return _el$14;
                })();
              }
            }), null);
            _$effect((_p$) => {
              var _v$4 = focused() && selected() === id ? props.context.theme.text.base : props.context.theme.text.muted, _v$5 = statusColor(props.context.theme, subagentStatus(info(), props.context.data.session.status(id) === "running")), _v$6 = props.context.theme.text.base;
              _v$4 !== _p$.e && (_p$.e = _$setProp(_el$10, "fg", _v$4, _p$.e));
              _v$5 !== _p$.t && (_p$.t = _$setProp(_el$11, "fg", _v$5, _p$.t));
              _v$6 !== _p$.a && (_p$.a = _$setProp(_el$13, "fg", _v$6, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$0;
          })()
        })
      }), null);
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return data.error();
        },
        get children() {
          var _el$8 = _$createElement("text");
          _$insertNode(_el$8, _$createTextNode(`Unable to load subagents. Retry`));
          _$setProp(_el$8, "onMouseUp", (event) => {
            if (event.button === 0)
              data.reload();
          });
          _$effect((_$p) => _$setProp(_el$8, "fg", props.context.theme.text.muted, _$p));
          return _el$8;
        }
      }), null);
      _$effect((_p$) => {
        var _v$ = props.context.theme.text.base, _v$2 = props.context.theme.text.muted, _v$3 = {
          fg: statusColor(props.context.theme, totals().status)
        };
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "style", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$;
    }
  });
}
function Detail(props) {
  return (() => {
    var _el$17 = _$createElement("box"), _el$18 = _$createElement("text"), _el$19 = _$createTextNode(`: `), _el$20 = _$createElement("text");
    _$insertNode(_el$17, _el$18);
    _$insertNode(_el$17, _el$20);
    _$setProp(_el$17, "width", "100%");
    _$setProp(_el$17, "flexDirection", "row");
    _$insertNode(_el$18, _el$19);
    _$setProp(_el$18, "flexShrink", 0);
    _$insert(_el$18, () => props.label, _el$19);
    _$setProp(_el$20, "flexGrow", 1);
    _$setProp(_el$20, "minWidth", 0);
    _$setProp(_el$20, "textAlign", "right");
    _$setProp(_el$20, "wrapMode", "char");
    _$insert(_el$20, () => props.value);
    _$effect((_p$) => {
      var _v$9 = props.theme.text.base, _v$0 = props.theme.text.muted;
      _v$9 !== _p$.e && (_p$.e = _$setProp(_el$18, "fg", _v$9, _p$.e));
      _v$0 !== _p$.t && (_p$.t = _$setProp(_el$20, "fg", _v$0, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$17;
  })();
}
function statusColor(theme, status) {
  return status === "running" ? feedback(theme, "warning") : status === "failed" ? feedback(theme, "error") : status === "succeeded" ? feedback(theme, "success") : theme.text.muted;
}

// src/tui.tsx
function Sidebar(props) {
  const session = createMemo3(() => props.context.data.session.get(props.sessionID));
  const messages = createMemo3(() => props.context.data.session.message.list(props.sessionID));
  const hit = createMemo3(() => getCacheHit(messages(), session()?.revert?.messageID));
  const ctx = createMemo3(() => getContextUsage(messages(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID));
  const [panelWidth, setPanelWidth] = createSignal3(0);
  let box;
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$4 = _$createElement2("text"), _el$5 = _$createElement2("text");
    _$insertNode2(_el$, _el$2);
    _$insertNode2(_el$, _el$4);
    _$insertNode2(_el$, _el$5);
    _$use2((el) => {
      box = el;
    }, _el$);
    _$setProp2(_el$, "width", "100%");
    _$setProp2(_el$, "flexDirection", "column");
    _$setProp2(_el$, "onSizeChange", () => {
      const next = box?.width ?? 0;
      if (next > 0)
        setPanelWidth(next);
    });
    _$insertNode2(_el$2, _$createTextNode2(`SnowySidebar`));
    _$insert2(_el$4, () => "\u2500".repeat(panelWidth()));
    _$insert2(_el$, _$createComponent2(Meter, {
      label: "Hit",
      get rate() {
        return hit();
      },
      get width() {
        return panelWidth();
      },
      get theme() {
        return props.context.theme;
      },
      tone: hitColor
    }), _el$5);
    _$insert2(_el$, _$createComponent2(Meter, {
      label: "Ctx",
      get rate() {
        return ctx()?.percent;
      },
      get width() {
        return panelWidth();
      },
      get theme() {
        return props.context.theme;
      },
      tone: contextColor
    }), _el$5);
    _$setProp2(_el$5, "width", "100%");
    _$setProp2(_el$5, "height", 1);
    _$setProp2(_el$5, "textAlign", "right");
    _$insert2(_el$5, (() => {
      var _c$ = _$memo2(() => !!ctx());
      return () => _c$() ? `${formatTokens(ctx().tokens)} / ${formatTokens(ctx().limit)}` : "--";
    })());
    _$insert2(_el$, _$createComponent2(SubagentPanel, {
      get context() {
        return props.context;
      },
      get sessionID() {
        return props.sessionID;
      }
    }), null);
    _$effect2((_p$) => {
      var _v$ = props.context.theme.text.base, _v$2 = props.context.theme.text.base, _v$3 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$4, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$5, "fg", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}
function Meter(props) {
  const text = () => formatPercent(props.rate);
  const bar = () => props.rate === undefined || props.width <= 0 ? "" : `[${progressBar(props.rate, Math.max(0, props.width - props.label.length - text().length - 4))}] `;
  const color = () => props.rate === undefined ? props.theme.text.base : props.tone(props.theme, props.rate);
  return (() => {
    var _el$6 = _$createElement2("text"), _el$7 = _$createElement2("span"), _el$8 = _$createTextNode2(` `), _el$9 = _$createElement2("span"), _el$0 = _$createElement2("span");
    _$insertNode2(_el$6, _el$7);
    _$insertNode2(_el$6, _el$9);
    _$insertNode2(_el$6, _el$0);
    _$setProp2(_el$6, "width", "100%");
    _$setProp2(_el$6, "height", 1);
    _$insertNode2(_el$7, _el$8);
    _$insert2(_el$7, () => props.label, _el$8);
    _$insert2(_el$9, bar);
    _$insert2(_el$0, text);
    _$effect2((_p$) => {
      var _v$4 = {
        fg: props.theme.text.base
      }, _v$5 = {
        fg: color()
      }, _v$6 = {
        fg: props.theme.text.muted
      };
      _v$4 !== _p$.e && (_p$.e = _$setProp2(_el$7, "style", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp2(_el$9, "style", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp2(_el$0, "style", _v$6, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$6;
  })();
}
function hitColor(theme, rate) {
  return feedback(theme, rate >= 85 ? "success" : rate >= 70 ? "warning" : "error");
}
function contextColor(theme, rate) {
  return feedback(theme, rate >= 85 ? "error" : rate >= 70 ? "warning" : "success");
}
var tui_default = Plugin.define({
  id: "opencode-sidebar",
  setup(context) {
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => _$createComponent2(Sidebar, {
        context,
        get sessionID() {
          return props.sessionID;
        }
      })
    });
  }
});
export {
  tui_default as default
};
