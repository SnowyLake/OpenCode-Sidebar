import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes, type BoxRenderable, type KeyEvent, type Renderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { feedback } from "./Color.ts";
import { formatDuration, formatTokens } from "./Format.ts";
import { totalTokens } from "./SessionStats.ts";
import { subagentDuration, subagentStatus, type SubagentStatus } from "./SubagentStats.ts";
import { useSubagents } from "./UseSubagents.ts";

/** Keeps view choices across routes and hot reloads, but not across TUI restarts. */
interface SubagentViewState {
  readonly expanded: Record<string, boolean>;
}

/** Host context and the currently viewed member of a session family. */
interface SubagentPanelProps {
  readonly context: Plugin.Context;
  readonly sessionID: string;
}

/** Shows the current root's child sessions and their cumulative usage and execution time. */
export function SubagentPanel(props: SubagentPanelProps): JSX.Element {
  const data = useSubagents(props.context, () => props.sessionID);
  const [view, setView] = props.context.storage.memory<SubagentViewState>("subagents.view", { initial: { expanded: {} } });
  const [selected, setSelected] = createSignal<string | undefined>();
  const [focused, setFocused] = createSignal(false);
  let panel: BoxRenderable | undefined;
  let previousFocus: Renderable | null = null;
  const totals = createMemo(() => {
    let tokens = 0, cost = 0;
    const statuses: SubagentStatus[] = [];
    for (const id of data.ids()) {
      const session = props.context.data.session.get(id);
      if (!session) continue;
      tokens += totalTokens(session.tokens);
      cost += session.cost;
      statuses.push(subagentStatus(session, props.context.data.session.status(id) === "running"));
    }
    const status: SubagentStatus = statuses.includes("running") ? "running" : statuses.includes("failed") ? "failed" : statuses.every((value) => value === "succeeded") ? "succeeded" : "idle";
    return { tokens, cost, status };
  });

  /** Saves the previous input focus before mouse or command navigation enters the panel. */
  function focusPanel(): void {
    if (!panel || panel.isDestroyed || panel.focused) return;
    previousFocus = props.context.renderer.currentFocusedRenderable;
    panel.focus();
  }

  /** Changes one disclosure without affecting other entries or session families. */
  function setExpanded(id: string, expanded: boolean): void {
    setView((draft) => { draft.expanded[id] = expanded; });
  }

  /** Toggles one child row and makes it the keyboard selection. */
  function toggle(id: string): void {
    setSelected(id);
    setExpanded(id, !view.expanded[id]);
  }

  /** Provides keyboard equivalents for disclosure, row navigation, and opening a session. */
  function handleKeyDown(event: KeyEvent): void {
    const id = selected();
    if (event.name === "up" || event.name === "down") {
      const items = data.ids();
      const next = Math.max(0, Math.min(items.length - 1, (id === undefined ? -1 : items.indexOf(id)) + (event.name === "down" ? 1 : -1)));
      setSelected(items[next]);
    } else if (id && (event.name === "return" || event.name === "space")) toggle(id);
    else if (id && (event.name === "left" || event.name === "right")) setExpanded(id, event.name === "right");
    else if (event.name === "o" && id) props.context.ui.router.navigate({ type: "session", sessionID: id });
    else if (event.name === "r" && data.error()) data.reload();
    else if (event.name === "escape") {
      panel?.blur();
      if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus();
    }
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  createEffect(() => { if (selected() && !data.ids().includes(selected()!)) setSelected(undefined); });
  props.context.keymap.layer(() => ({ commands: [{
    id: "subagents.focus", title: "Focus subagents", group: "SnowySidebar", palette: true,
    // The host restores focus on a 1 ms timer when closing the command palette.
    enabled: data.ids().length > 0 || data.error(), run: () => { setTimeout(focusPanel, 1); },
  }] }));

  return (
    <Show when={data.ids().length > 0 || data.error()}>
      <box width="100%" flexDirection="column" marginTop={1} ref={(el) => { panel = el; el.focusable = true; }} onMouseDown={focusPanel}
           onKeyDown={handleKeyDown} on:focused={() => setFocused(true)} on:blurred={() => setFocused(false)}>
        <box width="100%" flexDirection="row" height={1}>
          <text fg={props.context.theme.text.base} flexShrink={0}>SubAgents</text>
          <text fg={props.context.theme.text.muted} flexGrow={1} minWidth={0} textAlign="right" wrapMode="none" truncate>
            <span style={{ fg: statusColor(props.context.theme, totals().status) }}>{"\u25cf"}</span>{`${data.ids().length} ${formatTokens(totals().tokens)} $${totals().cost.toFixed(2)}`}
          </text>
        </box>
        <For each={data.ids()}>{(id) => (
          <Show when={props.context.data.session.get(id)}>{(info) => (
            <box width="100%" flexDirection="column">
              <box width="100%" flexDirection="row" height={1} onMouseUp={(event) => { if (event.button === 0) toggle(id); }}>
                <text fg={focused() && selected() === id ? props.context.theme.text.base : props.context.theme.text.muted} flexShrink={0}>
                  {view.expanded[id] ? "\u25bc " : "\u25b6 "}
                </text>
                <text fg={statusColor(props.context.theme, subagentStatus(info(), props.context.data.session.status(id) === "running"))} flexShrink={0}>{"\u25cf "}</text>
                <text fg={props.context.theme.text.base} flexGrow={1} minWidth={0} wrapMode="none" truncate>{info().title || info().agent || "Subagent"}</text>
              </box>
              <Show when={view.expanded[id]}>{(_expanded) => {
                const [openHovered, setOpenHovered] = createSignal(false);
                const duration = createMemo(() => subagentDuration(data.history[id], info(), props.context.data.session.status(id) === "running", data.now()));
                return <box width="100%" flexDirection="column" paddingLeft={2}>
                  <Detail label="agent" value={info().agent ?? "--"} theme={props.context.theme} />
                  <Detail label="model" value={info().model?.id ?? "--"} theme={props.context.theme} />
                  <Detail label="tokens" value={formatTokens(totalTokens(info().tokens))} theme={props.context.theme} />
                  <Detail label="cost" value={`$${info().cost.toFixed(4)}`} theme={props.context.theme} />
                  <Detail label="time" value={formatDuration(duration()?.milliseconds, duration()?.approximate)}
                          theme={props.context.theme} />
                  <text fg={props.context.theme.text.muted} attributes={openHovered() ? TextAttributes.UNDERLINE : TextAttributes.NONE}
                        onMouseOver={() => setOpenHovered(true)} onMouseOut={() => setOpenHovered(false)} onMouseUp={(event) => {
                    if (event.button === 0) props.context.ui.router.navigate({ type: "session", sessionID: id });
                  }}>{"\u2192 Open session"}</text>
                </box>;
              }}</Show>
            </box>
          )}</Show>
        )}</For>
        <Show when={data.error()}>
          <text fg={props.context.theme.text.muted} onMouseUp={(event) => { if (event.button === 0) data.reload(); }}>Unable to load subagents. Retry</text>
        </Show>
      </box>
    </Show>
  );
}

/** Aligns every detail value on the right while keeping the field order readable. */
function Detail(props: { readonly label: string; readonly value: string; readonly theme: Plugin.Context["theme"] }): JSX.Element {
  return <box width="100%" flexDirection="row">
    <text fg={props.theme.text.base} flexShrink={0}>{props.label}: </text>
    <text fg={props.theme.text.muted} flexGrow={1} minWidth={0} textAlign="right" wrapMode="char">{props.value}</text>
  </box>;
}

/** Reuses the meters' feedback palette and leaves interrupted or unknown states muted. */
function statusColor(theme: Plugin.Context["theme"], status: SubagentStatus) {
  return status === "running" ? feedback(theme, "warning") : status === "failed" ? feedback(theme, "error") : status === "succeeded" ? feedback(theme, "success") : theme.text.muted;
}
