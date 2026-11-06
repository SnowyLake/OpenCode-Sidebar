import { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { feedback } from "./Color.ts";
import { formatPercent, formatTokens, progressBar } from "./Format.ts";
import { getCacheHit, getContextUsage } from "./SessionStats.ts";
import { SubagentPanel } from "./SubagentPanel.tsx";

/** Composes the current session's usage meters and its subagent panel. */
function Sidebar(props: { readonly context: Plugin.Context; readonly sessionID: string }): JSX.Element {
  const session = createMemo(() => props.context.data.session.get(props.sessionID));
  const messages = createMemo(() => props.context.data.session.message.list(props.sessionID));
  const hit = createMemo(() => getCacheHit(messages(), session()?.revert?.messageID));
  const ctx = createMemo(() => getContextUsage(messages(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID));
  const [panelWidth, setPanelWidth] = createSignal(0);
  let box: { readonly width: number } | undefined;

  return (
    <box width="100%" flexDirection="column" ref={(el) => { box = el; }} onSizeChange={() => {
      const next = box?.width ?? 0;
      if (next > 0) setPanelWidth(next);
    }}>
      <text fg={props.context.theme.text.base}>SnowySidebar</text>
      <text fg={props.context.theme.text.base}>{"\u2500".repeat(panelWidth())}</text>
      <Meter label="Hit" rate={hit()} width={panelWidth()} theme={props.context.theme} tone={hitColor} />
      <Meter label="Ctx" rate={ctx()?.percent} width={panelWidth()} theme={props.context.theme} tone={contextColor} />
      <text width="100%" height={1} textAlign="right" fg={props.context.theme.text.muted}>
        {ctx() ? `${formatTokens(ctx()!.tokens)} / ${formatTokens(ctx()!.limit)}` : "--"}
      </text>
      <SubagentPanel context={props.context} sessionID={props.sessionID} />
    </box>
  );
}

/** Fits a labeled bar and percentage into one sidebar row. */
function Meter(props: {
  readonly label: string;
  readonly rate: number | undefined;
  readonly width: number;
  readonly theme: Plugin.Context["theme"];
  readonly tone: (theme: Plugin.Context["theme"], rate: number) => string;
}): JSX.Element {
  const text = () => formatPercent(props.rate);
  const bar = () => props.rate === undefined || props.width <= 0 ? "" : `[${progressBar(props.rate, Math.max(0, props.width - props.label.length - text().length - 4))}] `;
  const color = () => props.rate === undefined ? props.theme.text.base : props.tone(props.theme, props.rate);

  return (
    <text width="100%" height={1}>
      <span style={{ fg: props.theme.text.base }}>{props.label} </span>
      <span style={{ fg: color() }}>{bar()}</span>
      <span style={{ fg: props.theme.text.muted }}>{text()}</span>
    </text>
  );
}

/** Maps a measured hit rate onto the reference plugin's desaturated feedback color. */
function hitColor(theme: Plugin.Context["theme"], rate: number) {
  return feedback(theme, rate >= 85 ? "success" : rate >= 70 ? "warning" : "error");
}

/** Maps context-window fill onto the inverse of the hit colors, so a full window reads as an error. */
function contextColor(theme: Plugin.Context["theme"], rate: number) {
  return feedback(theme, rate >= 85 ? "error" : rate >= 70 ? "warning" : "success");
}

export default Plugin.define({
  id: "opencode-sidebar",
  /** Adds cache statistics while preserving the host's existing sidebar content. */
  setup(context) {
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <Sidebar context={context} sessionID={props.sessionID} />,
    });
  },
});
