/** Pulls saturated theme colors down to the reference plugin's Morandi ceiling. */

import type { Plugin } from "@opencode/plugin/tui";

export const MAX_SAT = 0.28;

export const FALLBACK = { success: "#9CAF8B", warning: "#C5B88D", error: "#B08A8A" } as const;

/** Uses one consistent desaturated feedback color across meters and status lights. */
export function feedback(theme: Plugin.Context["theme"], kind: keyof typeof FALLBACK): string {
  return desaturateTo(theme.text.feedback[kind].base, MAX_SAT, FALLBACK[kind]);
}

/** Returns a hex color no more saturated than `maxSat`, or `fallback` when the input cannot be read. */
export function desaturateTo(raw: unknown, maxSat: number, fallback: string): string {
  const color = rgb(raw);
  if (!color) return fallback;
  if (saturation(color.r, color.g, color.b) <= maxSat) return hex(color.r, color.g, color.b);
  const luma = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const mixed = mix(color, luma, mid);
    if (saturation(mixed.r, mixed.g, mixed.b) > maxSat) lo = mid;
    else hi = mid;
  }
  const mixed = mix(color, luma, hi);
  return hex(mixed.r, mixed.g, mixed.b);
}

/** Reads a 6-digit hex string or an RGB object, scaling 0-1 channels up to 0-255. */
function rgb(raw: unknown): { r: number; g: number; b: number } | undefined {
  if (typeof raw === "string" && raw.startsWith("#")) {
    const h = raw.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  if (raw && typeof raw === "object" && "r" in raw && "g" in raw && "b" in raw) {
    const o = raw as { r: number; g: number; b: number };
    if (typeof o.r !== "number" || typeof o.g !== "number" || typeof o.b !== "number") return undefined;
    const scale = o.r > 1 || o.g > 1 || o.b > 1 ? 1 : 255;
    return { r: Math.round(o.r * scale), g: Math.round(o.g * scale), b: Math.round(o.b * scale) };
  }
  return undefined;
}

/** HSL saturation of an 0-255 RGB color. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (delta === 0) return 0;
  const l = (max + min) / 2;
  return l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
}

/** Mixes a color toward grey by `amount`. */
function mix(color: { r: number; g: number; b: number }, luma: number, amount: number) {
  return {
    r: Math.round(color.r + (luma - color.r) * amount),
    g: Math.round(color.g + (luma - color.g) * amount),
    b: Math.round(color.b + (luma - color.b) * amount),
  };
}

/** Formats clamped RGB channels as a 6-digit hex color. */
function hex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
