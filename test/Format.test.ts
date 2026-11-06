import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatPercent, formatTokens, progressBar } from "../src/Format.ts";

test("displays percentages with one decimal place", () => {
  assert.equal(formatPercent(undefined), "--");
  assert.equal(formatPercent(25), "25.0%");
  assert.equal(formatPercent(25.4), "25.4%");
  assert.equal(formatPercent(25.5), "25.5%");
  assert.equal(formatPercent(25.56), "25.6%");
});

test("formats token counts with compact K and M units", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1K");
  assert.equal(formatTokens(255_000), "255K");
  assert.equal(formatTokens(1_000_000), "1.0M");
  assert.equal(formatTokens(1_024_000), "1.0M");
  assert.equal(formatTokens(1_250_000), "1.3M");
});

test("formats seconds, minutes and hours without losing real zero values", () => {
  assert.equal(formatDuration(undefined), "--");
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(59_999), "59s");
  assert.equal(formatDuration(65_000), "1m05s");
  assert.equal(formatDuration(3_725_000), "1h02m05s");
  assert.equal(formatDuration(4900, true), "~4s");
});

test("rounds the progress bar fill and clamps it to the bar", () => {
  assert.equal(progressBar(0, 4), "\u2591\u2591\u2591\u2591");
  assert.equal(progressBar(100, 4), "\u2588\u2588\u2588\u2588");
  assert.equal(progressBar(75, 2), "\u2588\u2588");
  assert.equal(progressBar(74, 2), "\u2588\u2591");
  assert.equal(progressBar(150, 2), "\u2588\u2588");
});
