// Tests for cvd.js — verifies the Machado matrices produce the expected
// qualitative shifts and that achromatopsia yields a true grayscale.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hexToRgb, rgbToHex, deltaEOk } from "../js/engine.js";
import { makeCvdTransform, simulateHex, simulateAll, CVD_MATRICES } from "../js/cvd.js";

// ─────────────────────────────────────────────────────────────────────────────
// Machado matrix sanity checks
// ─────────────────────────────────────────────────────────────────────────────

test("Each CVD matrix preserves white approximately (rows ≈ sum to 1)", () => {
  // The Machado matrices are derived such that pure white in linear RGB stays
  // white under simulation — important so we don't accidentally tint a neutral
  // background. Row sums should be ≈ 1.
  for (const [type, M] of Object.entries(CVD_MATRICES)) {
    for (let i = 0; i < 3; i++) {
      const sum = M[i][0] + M[i][1] + M[i][2];
      assert.ok(Math.abs(sum - 1) < 0.01, `${type} row ${i} sums to ${sum}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Qualitative reference shifts (pure red under deuteranopia → yellow/brown)
// ─────────────────────────────────────────────────────────────────────────────

test("pure red under deuteranopia shifts toward yellow/brown, not gray", () => {
  const sim = simulateHex("deuteranopia", "#ff0000");
  const rgb = hexToRgb(sim);
  // The G channel must rise significantly (red + green = yellow). If the result
  // were gray, R ≈ G ≈ B. If it were unchanged, G ≈ 0. We expect G in mid range.
  assert.ok(rgb.g > 0.25, `expected green to rise; got ${JSON.stringify(rgb)} (${sim})`);
  // Red should remain the dominant or co-dominant channel (yellow-brown, not green).
  assert.ok(rgb.r >= rgb.g - 0.1, `expected r ≳ g; got ${JSON.stringify(rgb)}`);
  // Blue should stay low (not a desaturated gray).
  assert.ok(rgb.b < rgb.r * 0.5, `expected low blue; got ${JSON.stringify(rgb)}`);
  // And it should be perceptibly different from gray of equivalent luminance.
  const lumGray = { r: 0.4, g: 0.4, b: 0.4 };
  assert.ok(deltaEOk(rgb, lumGray) > 0.05, "result should not be near-gray");
});

test("pure red under protanopia shifts toward yellow/brown, not gray", () => {
  const sim = simulateHex("protanopia", "#ff0000");
  const rgb = hexToRgb(sim);
  assert.ok(rgb.g > 0.15, `expected g to rise; got ${JSON.stringify(rgb)}`);
  assert.ok(rgb.b < 0.2, `expected low blue; got ${JSON.stringify(rgb)}`);
});

test("pure green under deuteranopia shifts toward dull yellow/khaki", () => {
  const sim = simulateHex("deuteranopia", "#00ff00");
  const rgb = hexToRgb(sim);
  // Green collapses into the red axis under deuteranopia.
  assert.ok(rgb.r > 0.3, `expected r to rise; got ${JSON.stringify(rgb)}`);
  assert.ok(rgb.b < rgb.r, `expected b < r; got ${JSON.stringify(rgb)}`);
});

test("pure blue under tritanopia shifts (B-axis is collapsed)", () => {
  const sim = simulateHex("tritanopia", "#0000ff");
  const rgb = hexToRgb(sim);
  // Under tritanopia, blue takes on a cyan/teal cast (G rises substantially).
  assert.ok(rgb.g > 0.3, `expected g to rise; got ${JSON.stringify(rgb)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Achromatopsia
// ─────────────────────────────────────────────────────────────────────────────

test("achromatopsia yields a true grayscale (R = G = B)", () => {
  for (const hex of ["#ff0000", "#3b82f6", "#10b981", "#f59e0b", "#7c3aed"]) {
    const sim = simulateHex("achromatopsia", hex);
    const rgb = hexToRgb(sim);
    assert.ok(Math.abs(rgb.r - rgb.g) < 1e-6, `${hex} → ${sim}: r != g`);
    assert.ok(Math.abs(rgb.g - rgb.b) < 1e-6, `${hex} → ${sim}: g != b`);
  }
});

test("achromatopsia: brighter inputs map to brighter grays", () => {
  // BT.709 luminance: white > yellow > red > blue (roughly).
  const grayHex = (h) => hexToRgb(simulateHex("achromatopsia", h)).r;
  const white = grayHex("#ffffff");
  const yellow = grayHex("#ffff00");
  const red = grayHex("#ff0000");
  const blue = grayHex("#0000ff");
  assert.ok(white > yellow);
  assert.ok(yellow > red);
  assert.ok(red > blue);
});

// ─────────────────────────────────────────────────────────────────────────────
// White / black should remain themselves (or very close) under all simulations
// ─────────────────────────────────────────────────────────────────────────────

test("white stays white under all CVD simulations", () => {
  const all = simulateAll("#ffffff");
  for (const [type, hex] of Object.entries(all)) {
    const rgb = hexToRgb(hex);
    assert.ok(rgb.r > 0.97, `${type}: white shifted to ${hex}`);
    assert.ok(rgb.g > 0.97, `${type}: white shifted to ${hex}`);
    assert.ok(rgb.b > 0.97, `${type}: white shifted to ${hex}`);
  }
});

test("black stays black under all CVD simulations", () => {
  const all = simulateAll("#000000");
  for (const [type, hex] of Object.entries(all)) {
    assert.equal(hex, "#000000", `${type}: black shifted to ${hex}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// makeCvdTransform integration
// ─────────────────────────────────────────────────────────────────────────────

test("makeCvdTransform returns a function with the expected shape", () => {
  const t = makeCvdTransform("deuteranopia");
  assert.equal(typeof t, "function");
  const out = t(hexToRgb("#ff0000"));
  assert.ok(out.r >= 0 && out.r <= 1);
  assert.ok(out.g >= 0 && out.g <= 1);
  assert.ok(out.b >= 0 && out.b <= 1);
});
