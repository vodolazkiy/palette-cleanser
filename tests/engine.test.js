// Tests for engine.js — runnable with `node --test tests/`.
// No external test-framework dependency; uses node:test + node:assert.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hexToRgb, rgbToHex,
  srgbToLinear, linearToSrgb,
  linearRgbToOklab, oklabToLinearRgb,
  oklabToOklch, oklchToOklab,
  rgbToOklch, oklchToRgb,
  hexToOklch, oklchToHex,
  contrastRatio, relativeLuminance,
  deltaEOk,
  generatePalette, generateCandidates,
  validatePalette,
  WCAG_AA_NORMAL,
  ensureContrast,
} from "../js/engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hex
// ─────────────────────────────────────────────────────────────────────────────

test("hexToRgb accepts 6-char hex with and without leading #", () => {
  assert.deepEqual(hexToRgb("#ffffff"), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb("ffffff"), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
});

test("hexToRgb accepts 3-char shorthand", () => {
  const a = hexToRgb("#f0a");
  const b = hexToRgb("#ff00aa");
  assert.deepEqual(a, b);
});

test("hexToRgb returns null for invalid input rather than throwing", () => {
  assert.equal(hexToRgb(""), null);
  assert.equal(hexToRgb("#zzzzzz"), null);
  assert.equal(hexToRgb("not a hex"), null);
  assert.equal(hexToRgb(null), null);
  assert.equal(hexToRgb(undefined), null);
});

test("rgbToHex round-trips for common values", () => {
  assert.equal(rgbToHex({ r: 1, g: 1, b: 1 }), "#ffffff");
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), "#000000");
  assert.equal(rgbToHex(hexToRgb("#3b82f6")), "#3b82f6");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gamma + sRGB/Linear round-trip
// ─────────────────────────────────────────────────────────────────────────────

test("sRGB ↔ linear are inverses across the range", () => {
  for (const v of [0, 0.02, 0.04, 0.1, 0.5, 0.9, 1]) {
    const round = linearToSrgb(srgbToLinear(v));
    assert.ok(Math.abs(round - v) < 1e-9, `round(${v}) = ${round}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OKLab / OKLCH
// ─────────────────────────────────────────────────────────────────────────────

test("OKLab → linear RGB round-trips", () => {
  for (const c of [
    { r: 0.05, g: 0.4, b: 0.7 },
    { r: 0.95, g: 0.95, b: 0.95 },
    { r: 0.5, g: 0.1, b: 0.2 },
  ]) {
    const back = oklabToLinearRgb(linearRgbToOklab(c));
    assert.ok(Math.abs(back.r - c.r) < 1e-6);
    assert.ok(Math.abs(back.g - c.g) < 1e-6);
    assert.ok(Math.abs(back.b - c.b) < 1e-6);
  }
});

test("OKLab ↔ OKLCH preserves L and recovers a,b", () => {
  const lab = { L: 0.6, a: 0.1, b: -0.05 };
  const back = oklchToOklab(oklabToOklch(lab));
  assert.ok(Math.abs(back.L - lab.L) < 1e-12);
  assert.ok(Math.abs(back.a - lab.a) < 1e-9);
  assert.ok(Math.abs(back.b - lab.b) < 1e-9);
});

test("hex ↔ OKLCH round-trip stays within one hex unit", () => {
  for (const hex of ["#3b82f6", "#10b981", "#f59e0b", "#1f2937"]) {
    const back = oklchToHex(hexToOklch(hex));
    const a = hexToRgb(hex);
    const b = hexToRgb(back);
    // Allow a single LSB drift per channel from rounding through float space.
    assert.ok(Math.abs(a.r - b.r) <= 1 / 255 + 1e-9, `${hex} → ${back} (r)`);
    assert.ok(Math.abs(a.g - b.g) <= 1 / 255 + 1e-9, `${hex} → ${back} (g)`);
    assert.ok(Math.abs(a.b - b.b) <= 1 / 255 + 1e-9, `${hex} → ${back} (b)`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WCAG contrast
// ─────────────────────────────────────────────────────────────────────────────

test("contrast: black on white = 21, equal colors = 1", () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 1, g: 1, b: 1 };
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio(white, white) - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio(black, black) - 1) < 1e-9);
});

test("contrast: known sample (#777 on white) ≈ 4.48", () => {
  // Cross-check value taken from the standard WCAG ratio for #777777 on white.
  const r = contrastRatio(hexToRgb("#777777"), hexToRgb("#ffffff"));
  assert.ok(Math.abs(r - 4.48) < 0.02, `#777 on white contrast = ${r}`);
});

test("relativeLuminance: white = 1, black = 0", () => {
  assert.ok(Math.abs(relativeLuminance({ r: 1, g: 1, b: 1 }) - 1) < 1e-9);
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 0, b: 0 })) < 1e-12);
});

test("ensureContrast: brightens a mid-gray seed until it passes AA on white", () => {
  const seed = hexToOklch("#9ca3af");
  const result = ensureContrast(seed, { r: 1, g: 1, b: 1 }, WCAG_AA_NORMAL);
  assert.ok(result.passed, `expected AA on white, got ratio ${result.ratio}`);
  // It should darken (white bg → darker text), so L drops.
  assert.ok(result.oklch.L < seed.L);
});

// ─────────────────────────────────────────────────────────────────────────────
// ΔE
// ─────────────────────────────────────────────────────────────────────────────

test("deltaEOk: identical colors → 0; distinct colors → > 0", () => {
  const a = hexToRgb("#3b82f6");
  const b = hexToRgb("#ef4444");
  assert.ok(Math.abs(deltaEOk(a, a)) < 1e-12);
  assert.ok(deltaEOk(a, b) > 0.1);
});

test("deltaEOk: ordering matches perceptual expectation", () => {
  // Two blues should be much closer than blue vs red.
  const blue1 = hexToRgb("#3b82f6");
  const blue2 = hexToRgb("#1d4ed8");
  const red   = hexToRgb("#ef4444");
  assert.ok(deltaEOk(blue1, blue2) < deltaEOk(blue1, red));
});

// ─────────────────────────────────────────────────────────────────────────────
// Palette generation
// ─────────────────────────────────────────────────────────────────────────────

test("generatePalette produces all 9 named roles", () => {
  const p = generatePalette({
    primary: hexToOklch("#3b82f6"),
    secondary: null, accent: null,
    strategy: "analogous",
  });
  for (const role of ["primary","secondary","accent","background","surface","text","success","warning","error"]) {
    assert.ok(p.colors[role] && /^#[0-9a-f]{6}$/.test(p.colors[role]), `bad ${role}: ${p.colors[role]}`);
  }
});

test("generateCandidates produces 5 strategies", () => {
  const list = generateCandidates({ primary: hexToOklch("#3b82f6") });
  assert.equal(list.length, 5);
  const strategies = list.map((p) => p.strategy);
  assert.ok(strategies.includes("analogous"));
  assert.ok(strategies.includes("complementary"));
  assert.ok(strategies.includes("triadic"));
});

test("user anchors are preserved exactly in the palette", () => {
  const p = generatePalette({
    primary:   hexToOklch("#3b82f6"),
    secondary: hexToOklch("#10b981"),
    accent:    hexToOklch("#f59e0b"),
    strategy:  "triadic",
  });
  // Round-trip drift through OKLCH may shift by 1 LSB; verify within tolerance.
  for (const [role, hex] of [["primary","#3b82f6"], ["secondary","#10b981"], ["accent","#f59e0b"]]) {
    const a = hexToRgb(p.colors[role]);
    const b = hexToRgb(hex);
    assert.ok(Math.abs(a.r - b.r) <= 2/255, `${role} drifted: ${p.colors[role]} vs ${hex}`);
    assert.ok(Math.abs(a.g - b.g) <= 2/255, `${role} drifted: ${p.colors[role]} vs ${hex}`);
    assert.ok(Math.abs(a.b - b.b) <= 2/255, `${role} drifted: ${p.colors[role]} vs ${hex}`);
  }
  assert.equal(p.anchors.primary, true);
  assert.equal(p.anchors.secondary, true);
  assert.equal(p.anchors.accent, true);
});

test("validatePalette: a sensible blue-seeded palette passes text/bg AA", () => {
  const p = generatePalette({
    primary: hexToOklch("#3b82f6"),
    strategy: "analogous",
  });
  const r = validatePalette(p);
  // Body text on background and body text on surface are the must-haves.
  const failingLabels = r.contrastFailures.map((f) => f.label);
  assert.ok(
    !failingLabels.includes("Body text on background"),
    `body/bg should pass but failed: ${failingLabels.join(", ")}`,
  );
  assert.ok(
    !failingLabels.includes("Body text on surface"),
    `body/surface should pass but failed: ${failingLabels.join(", ")}`,
  );
});

test("ensureContrast preserves hue: dark-green seed against white doesn't collapse to black", () => {
  // Regression: the previous implementation overrode the binary-search result
  // with whichever extreme (L=0 or L=1) had the highest contrast, which meant
  // every dark-on-light role ended up #000000 regardless of its hue.
  const greenSeed = hexToOklch("#22c55e"); // tailwind green-500
  const adjusted = ensureContrast(greenSeed, { r: 1, g: 1, b: 1 }, WCAG_AA_NORMAL);
  assert.ok(adjusted.passed, "should hit AA against white");
  // The OKLCH chroma must remain > 0 — a fully achromatic result is pure black.
  assert.ok(adjusted.oklch.C > 0.05, `chroma collapsed: ${JSON.stringify(adjusted.oklch)}`);
  // And the L should be > 0 — we only pushed as far as needed.
  assert.ok(adjusted.oklch.L > 0.05, `L collapsed to extreme: ${adjusted.oklch.L}`);
});

test("light-mode palette: semantic colors keep hue identity (not black)", () => {
  // Light mode bg is near-white, so success/warning/error must darken to pass
  // AA — but they should remain identifiably green/amber/red.
  const p = generatePalette({ primary: hexToOklch("#3b82f6"), strategy: "analogous" });
  for (const role of ["success", "warning", "error"]) {
    const rgb = hexToRgb(p.colors[role]);
    // None of these should be pure black or near-black across all channels.
    const maxChannel = Math.max(rgb.r, rgb.g, rgb.b);
    assert.ok(maxChannel > 0.15, `${role} collapsed to near-black: ${p.colors[role]}`);
    // And r/g/b shouldn't all be equal (would mean achromatic).
    const isAchromatic = Math.abs(rgb.r - rgb.g) < 0.02 && Math.abs(rgb.g - rgb.b) < 0.02;
    assert.ok(!isAchromatic, `${role} lost its hue: ${p.colors[role]}`);
  }
});

test("dark-mode palette: 'Button label on primary' picks the high-contrast neutral, not always background", () => {
  // In dark mode the background neutral is dark; using it as a button label
  // on a bright primary would fail. The validator should select `text` (the
  // light neutral) as the foreground instead, and that pair should pass.
  const p = generatePalette({
    primary: hexToOklch("#3b82f6"),
    strategy: "analogous",
    dark: true,
  });
  const r = validatePalette(p);
  const buttonFailure = r.contrastFailures.find((f) => f.label === "Button label on primary");
  assert.equal(
    buttonFailure, undefined,
    `dark palette should pass "Button label on primary" by selecting the right fg; got ratio ${buttonFailure?.ratio}`,
  );
});
