import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK, MAX_SAT, desaturateTo } from "../src/Color.ts";

/** HSL saturation of a 6-digit hex color, matching the production probe. */
function saturation(hex: string): number {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => parseInt(part, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const l = (max + min) / 2;
  return l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
}

test("keeps a muted color and pulls a saturated one down to the reference ceiling", () => {
  assert.equal(desaturateTo("#9CAF8B", MAX_SAT, FALLBACK.success), "#9caf8b");
  const muted = desaturateTo("#00ff00", MAX_SAT, FALLBACK.success);
  assert.notEqual(muted, "#00ff00");
  assert.ok(saturation(muted) <= MAX_SAT + 0.02);
  assert.equal(desaturateTo({ r: 0, g: 1, b: 0 }, MAX_SAT, FALLBACK.success), desaturateTo({ r: 0, g: 255, b: 0 }, MAX_SAT, FALLBACK.success));
  assert.equal(desaturateTo(undefined, MAX_SAT, FALLBACK.error), FALLBACK.error);
});
