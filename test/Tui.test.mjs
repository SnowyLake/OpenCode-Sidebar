import { expect, test } from "bun:test";
import { Host } from "@opencode/plugin/host";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { fileURLToPath } from "node:url";
import { FALLBACK, MAX_SAT, desaturateTo } from "../src/Color.ts";

/** RGB of a theme feedback color after the reference plugin's desaturation. */
function muted(kind) {
  const raw = { success: "#00aa00", warning: "#aa8800", error: "#aa0000" }[kind];
  const hex = desaturateTo(raw, MAX_SAT, FALLBACK[kind]);
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => parseInt(part, 16));
}

/** Returns one rendered row that contains the label, without trailing padding. */
function row(view, label) {
  return view.captureCharFrame().split("\n").map((line) => line.trimEnd()).find((line) => line.includes(label));
}

/** Returns the cache hit meter without trailing padding. */
function hitLine(view) {
  return row(view, "Hit");
}

/** Returns the context meter without trailing padding. */
function ctxLine(view) {
  return row(view, "Ctx");
}

/** Returns the RGB of the bracketed bar on the requested row. */
function barColor(view, label) {
  for (const line of view.captureSpans().lines) {
    if (!line.spans.some((span) => span.text.includes(label))) continue;
    for (const span of line.spans) {
      if (span.text.includes("[")) return [span.fg.r, span.fg.g, span.fg.b].map((channel) => Math.round(channel * 255));
    }
  }
}

test("package entry renders reactive cache statistics and unregisters cleanly", async () => {
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const entry = Host.resolve({ directory });
  expect(entry.server).toBeUndefined();
  expect(entry.tui).toContain("tui.tsx");
  const { default: plugin } = await Host.load(entry.tui);
  const [sessionID, setSessionID] = createSignal("first");
  const [tokens, setTokens] = createSignal({ input: 100, output: 0, reasoning: 0, cache: { read: 300, write: 0 } });
  const [limit, setLimit] = createSignal(1000);
  const [hasChild, setHasChild] = createSignal(false);
  const child = { id: "child", parentID: "first", title: "Inspect files", agent: "explorer", cost: 0.01,
    tokens: { input: 1000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1000, busy: 2000, idle: 5000 } };
  let claim;
  let registered = false;
  const cleanup = plugin.setup({
    client: {
      session: { list: async ({ parentID }) => ({ data: hasChild() && parentID === "first" ? [child] : [], cursor: {} }), inbox: { list: async () => [] } },
      message: { list: async () => ({ data: [], cursor: {} }) },
    },
    storage: { memory: (_, { initial }) => {
      const [state, setState] = createStore(initial);
      return [state, (mutation) => setState(produce(mutation))];
    } },
    keymap: { layer: () => {} },
    theme: {
      text: {
        base: "#ffffff",
        muted: "#aaaaaa",
        feedback: {
          success: { base: "#00aa00" },
          warning: { base: "#aa8800" },
          error: { base: "#aa0000" },
        },
      },
    },
    data: {
      on: () => () => {},
      session: {
        root: (id) => id,
        list: () => hasChild() ? [child] : [],
        sync: async () => {},
        invalidate: () => {},
        get: (id) => id === "first" ? { tokens: tokens() } : id === "child" ? child : undefined,
        status: () => "idle",
        message: {
          list: (id) => id === "first" ? [{ id: "msg_1", type: "assistant", model: { providerID: "test", id: "test" }, tokens: tokens() }] : [],
        },
      },
      location: {
        model: {
          list: () => [{ providerID: "test", id: "test", limit: { context: limit() } }],
        },
      },
    },
    ui: {
      slot(value) {
        claim = value;
        registered = true;
        return () => { registered = false; };
      },
    },
  });
  expect(claim.prepend).toBe("sidebar.content");
  const view = await testRender(() => claim.render({ get sessionID() { return sessionID(); } }), { width: 30, height: 8 });
  try {
    await view.waitForFrame((frame) => frame.includes("Ctx [") && frame.includes("Hit ["));
    expect(hitLine(view)).toBe(`Hit [${"\u2588".repeat(14)}${"\u2591".repeat(4)}] 75.0%`);
    expect(ctxLine(view)).toBe(`Ctx [${"\u2588".repeat(7)}${"\u2591".repeat(11)}] 40.0%`);
    expect(view.captureCharFrame().trimEnd().split("\n").map((line) => line.trimEnd())).toEqual([
      "SnowySidebar", "\u2500".repeat(30), hitLine(view), ctxLine(view), "400 / 1K".padStart(30),
    ]);
    expect(hitLine(view)).not.toContain("400");
    expect(view.captureCharFrame()).not.toContain("Total Hit");
    expect(barColor(view, "Ctx")).toEqual(muted("success"));
    expect(barColor(view, "Hit")).toEqual(muted("warning"));
    const initialFrame = view.captureCharFrame();
    await view.mockMouse.moveTo(6, 3);
    await view.renderOnce();
    expect(view.captureCharFrame()).toBe(initialFrame);
    await view.mockMouse.moveTo(1, 3);
    await view.renderOnce();
    expect(view.captureCharFrame()).toBe(initialFrame);

    setTokens({ input: 100, output: 5000, reasoning: 2000, cache: { read: 900, write: 0 } });
    await view.renderOnce();
    expect(hitLine(view)).toContain("90.0%");
    expect(ctxLine(view)).toBe(`Ctx [${"\u2588".repeat(17)}] 800.0%`);
    expect(row(view, " / ")).toBe("8K / 1K".padStart(30));
    expect(hitLine(view)).not.toContain("1.0K");
    expect(barColor(view, "Ctx")).toEqual(muted("error"));
    expect(barColor(view, "Hit")).toEqual(muted("success"));

    setSessionID("empty");
    await view.renderOnce();
    expect(hitLine(view)).toBe("Hit --");
    expect(ctxLine(view)).toBe("Ctx --");
    expect(view.captureCharFrame().split("\n")[2].trimEnd()).toBe("Hit --");
    expect(view.captureCharFrame()).not.toContain("\u2588");
    expect(view.captureCharFrame()).not.toContain("\u2591");
    expect(view.captureCharFrame()).not.toContain("Hit [");
    expect(view.captureCharFrame()).not.toContain("90.0%");
    expect(row(view, " / ")).toBeUndefined();
    expect(view.captureCharFrame().split("\n")[4]).toBe("--".padStart(30));

    setSessionID("first");
    await view.waitForFrame((frame) => frame.includes("Hit ["));
    expect(hitLine(view)).toContain("90.0%");
    expect(row(view, " / ")).toBe("8K / 1K".padStart(30));
    expect(hitLine(view)).not.toContain("1.0K");

    setTokens({ input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });
    await view.renderOnce();
    expect(hitLine(view)).toBe(`Hit [${"\u2591".repeat(19)}] 0.0%`);

    setTokens({ input: 189_975, output: 0, reasoning: 0, cache: { read: 65_025, write: 0 } });
    setLimit(1_000_000);
    await view.renderOnce();
    expect(row(view, " / ")).toBe("255K / 1.0M".padStart(30));
    expect(ctxLine(view)).toContain("25.5%");
    expect(hitLine(view)).toContain("25.5%");

    for (const width of [40, 26]) {
      const barWidth = width - 12;
      const bar = `[${"\u2588".repeat(Math.round(barWidth * 0.255))}${"\u2591".repeat(barWidth - Math.round(barWidth * 0.255))}] 25.5%`;
      view.resize(width, 8);
      await view.waitForFrame((frame) => frame.split("\n")[2] === `Hit ${bar}` && frame.split("\n")[3] === `Ctx ${bar}`);
      expect(view.captureCharFrame().split("\n")[1]).toBe("\u2500".repeat(width));
      expect(ctxLine(view).length).toBe(width);
      expect(hitLine(view).length).toBe(width);
      expect(view.captureCharFrame().split("\n")[4]).toBe("255K / 1.0M".padStart(width));
    }

    setHasChild(true);
    await view.waitForFrame((frame) => frame.includes("SubAgents"));
    expect(view.captureCharFrame().split("\n")[3]).toBe(ctxLine(view));
    expect(view.captureCharFrame().split("\n")[4]).toBe("255K / 1.0M".padStart(26));
    expect(view.captureCharFrame().split("\n")[5].trim()).toBe("");
    const subagentHeader = view.captureCharFrame().split("\n")[6];
    expect(subagentHeader).toStartWith("SubAgents");
    expect(view.captureCharFrame().split("\n")[7]).toContain("Inspect files");
    await view.mockMouse.moveTo(6, 3);
    await view.renderOnce();
    expect(view.captureCharFrame().split("\n")[4]).toBe("255K / 1.0M".padStart(26));
    expect(view.captureCharFrame().split("\n")[6]).toBe(subagentHeader);
  } finally {
    await view.dispose();
    cleanup();
  }
  expect(registered).toBe(false);
});
