import type { SessionInfo, SessionMessageInfo } from "@opencode/client";

/** Calculates the latest request's hit rate without counting output or reasoning tokens. */
export function getCacheHit(messages: readonly SessionMessageInfo[], boundary?: string): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.type !== "assistant" || (boundary && message.id >= boundary) || !message.tokens) continue;
    const input = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write;
    if (input > 0) return Math.floor(message.tokens.cache.read * 1000 / input) / 10;
  }
}

/** Includes input, output, reasoning, and both cache counters in a usage total. */
export function totalTokens(tokens: SessionInfo["tokens"]): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/** Token usage, model limit, and unrounded context percent for the same step the host sidebar uses. */
export function getContextUsage(
  messages: readonly SessionMessageInfo[],
  models: readonly { readonly providerID: string; readonly id: string; readonly limit: { readonly context: number } }[] | undefined,
  boundary?: string,
): { readonly tokens: number; readonly limit: number; readonly percent: number } | undefined {
  const last = contextMessage(messages, boundary);
  if (!last?.tokens) return undefined;
  const tokens = totalTokens(last.tokens);
  const limit = models?.find((model) => model.providerID === last.model.providerID && model.id === last.model.id)?.limit.context;
  return tokens > 0 && limit ? { tokens, limit, percent: tokens * 100 / limit } : undefined;
}

/** Latest assistant step after the last completed compaction and before the revert boundary. */
function contextMessage(messages: readonly SessionMessageInfo[], boundary?: string) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  if (boundary && boundaryIndex === -1) return undefined;
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex;
  const compactionIndex = messages.findLastIndex((message, index) => message.type === "compaction" && message.status === "completed" && index < end);
  const last = messages.findLast((message, index) => message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end);
  return last?.type === "assistant" ? last : undefined;
}
