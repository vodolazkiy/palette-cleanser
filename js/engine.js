// engine.js — Pure color math: conversions, harmonies, contrast, ΔE, palette generation.
// No DOM dependencies. Intended to also be publishable to npm separately from the UI.
//
// Color spaces used:
//   sRGB         — gamma-encoded display RGB, 0..1 per channel
//   Linear sRGB  — linear-light RGB, 0..1 per channel (used for CVD matrix math)
//   OKLab/OKLCH  — perceptual color space (Björn Ottosson, 2020). Used for harmony
//                  rotation, lightness adjustment, and perceptual ΔE.

// ─────────────────────────────────────────────────────────────────────────────
// Hex / sRGB conversions
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a hex string (with or without #, 3/6/8 chars) to { r,g,b } in 0..1.
 *  Returns null for invalid input — never throws. */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6); // drop alpha
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** Format { r,g,b } in 0..1 as a 6-digit #RRGGBB hex string. */
export function rgbToHex({ r, g, b }) {
  const to2 = (v) => {
    const n = Math.round(clamp01(v) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return "#" + to2(r) + to2(g) + to2(b);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ─────────────────────────────────────────────────────────────────────────────
// sRGB ↔ linear RGB (gamma)
// ─────────────────────────────────────────────────────────────────────────────

/** sRGB component → linear-light. Uses the actual IEC 61966-2-1 piecewise curve. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light → sRGB component (inverse of srgbToLinear). */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export const rgbToLinear = ({ r, g, b }) => ({
  r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b),
});
export const linearToRgb = ({ r, g, b }) => ({
  r: clamp01(linearToSrgb(r)), g: clamp01(linearToSrgb(g)), b: clamp01(linearToSrgb(b)),
});

// ─────────────────────────────────────────────────────────────────────────────
// Linear sRGB ↔ OKLab ↔ OKLCH
// Reference: https://bottosson.github.io/posts/oklab/
// ─────────────────────────────────────────────────────────────────────────────

export function linearRgbToOklab({ r, g, b }) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

export function oklabToLinearRgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r:  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

export function oklabToOklch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

export function oklchToOklab({ L, C, H }) {
  const rad = (H * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

// Convenience: sRGB hex/rgb → OKLCH and back.
export function rgbToOklch(rgb) {
  return oklabToOklch(linearRgbToOklab(rgbToLinear(rgb)));
}
export function oklchToRgb(oklch) {
  // Clamp to displayable sRGB — out-of-gamut OKLCH values get gamut-mapped naively
  // by component clamping. Good enough for UI swatches; sophisticated chroma reduction
  // could be layered later.
  const lin = oklabToLinearRgb(oklchToOklab(oklch));
  return linearToRgb({
    r: clamp01(lin.r), g: clamp01(lin.g), b: clamp01(lin.b),
  });
}
export const hexToOklch = (hex) => {
  const rgb = hexToRgb(hex);
  return rgb && rgbToOklch(rgb);
};
export const oklchToHex = (oklch) => rgbToHex(oklchToRgb(oklch));

// ─────────────────────────────────────────────────────────────────────────────
// WCAG 2.1 contrast
// ─────────────────────────────────────────────────────────────────────────────

/** Relative luminance per WCAG 2.x. Note: spec uses the 0.03928 breakpoint
 *  literally (a minor discrepancy from the formal IEC sRGB curve we use elsewhere).
 *  We follow the spec verbatim here so contrast numbers match official calculators. */
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two sRGB colors. Range 1..21. */
export function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual ΔE in OKLab — Euclidean distance in the OKLab space.
// A JND is roughly 0.02; we use ~0.04 as a "clearly distinguishable" threshold
// for palette role separation under CVD simulation.
// ─────────────────────────────────────────────────────────────────────────────

export function deltaEOk(rgb1, rgb2) {
  const a = linearRgbToOklab(rgbToLinear(rgb1));
  const b = linearRgbToOklab(rgbToLinear(rgb2));
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

export const CVD_DISTINGUISHABLE_THRESHOLD = 0.04;

// ─────────────────────────────────────────────────────────────────────────────
// Harmony strategies — operate on OKLCH so hue rotations are perceptually even.
// Each returns an array of OKLCH colors derived from the seed.
// ─────────────────────────────────────────────────────────────────────────────

const wrapHue = (h) => ((h % 360) + 360) % 360;

export const HARMONY_STRATEGIES = {
  analogous: (seed) => [
    seed,
    { ...seed, H: wrapHue(seed.H + 30) },
    { ...seed, H: wrapHue(seed.H - 30) },
  ],
  complementary: (seed) => [
    seed,
    { ...seed, H: wrapHue(seed.H + 180) },
    { ...seed, H: wrapHue(seed.H + 180), C: seed.C * 0.7 },
  ],
  triadic: (seed) => [
    seed,
    { ...seed, H: wrapHue(seed.H + 120) },
    { ...seed, H: wrapHue(seed.H + 240) },
  ],
  splitComplementary: (seed) => [
    seed,
    { ...seed, H: wrapHue(seed.H + 150) },
    { ...seed, H: wrapHue(seed.H + 210) },
  ],
  monochromatic: (seed) => [
    seed,
    { ...seed, L: clamp01(seed.L + 0.18), C: seed.C * 0.85 },
    { ...seed, L: clamp01(seed.L - 0.22), C: seed.C * 1.05 },
  ],
};

export const HARMONY_LABELS = {
  analogous: "Analogous",
  complementary: "Complementary",
  triadic: "Triadic",
  splitComplementary: "Split-complementary",
  monochromatic: "Monochromatic",
};

// ─────────────────────────────────────────────────────────────────────────────
// Palette generation
//
// A palette is a record of named roles → sRGB hex. Roles:
//   primary, secondary, accent, background, surface, text,
//   success, warning, error
//
// Generation rules:
//   - User-provided anchors (primary/secondary/accent) are never altered.
//     If they cause contrast failures, we flag them — we do not silently fix.
//   - Non-anchor brand colors are derived from a harmony strategy seeded by the
//     primary, then lightness-adjusted to maintain reasonable contrast against
//     the chosen text/background pair.
//   - Neutrals (background/surface/text) are derived from the primary's hue
//     with very low chroma, so they harmonize without competing.
//   - Semantic colors (success/warning/error) start from canonical hues
//     (green / amber / red), then have their lightness nudged to pass AA
//     against the chosen background.
// ─────────────────────────────────────────────────────────────────────────────

/** Adjust an OKLCH color's L until it has at least `target` contrast against
 *  the reference sRGB color. Direction: brighter or darker, whichever is needed
 *  given the reference's luminance. Returns the adjusted OKLCH, or the closest
 *  reachable approximation if AA can't be hit within [0,1] lightness. */
export function ensureContrast(seedOklch, referenceRgb, target = WCAG_AA_NORMAL) {
  const refL = relativeLuminance(referenceRgb);
  const goDarker = refL > 0.5;
  let lo = goDarker ? 0 : seedOklch.L;
  let hi = goDarker ? seedOklch.L : 1;
  let best = { ...seedOklch };
  let bestRatio = contrastRatio(oklchToRgb(seedOklch), referenceRgb);

  // Binary search for the minimum lightness change that achieves the target.
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const candidate = { ...seedOklch, L: mid };
    const ratio = contrastRatio(oklchToRgb(candidate), referenceRgb);
    if (ratio > bestRatio) { best = candidate; bestRatio = ratio; }
    if (ratio >= target) {
      // Reached target; tighten toward seed.L to preserve original lightness.
      if (goDarker) lo = mid; else hi = mid;
    } else {
      if (goDarker) hi = mid; else lo = mid;
    }
  }
  // Final sweep: if binary search didn't find AA within [0,1], step lightness
  // to the extreme and keep whichever side maximizes contrast.
  for (const Lcand of [0, 0.02, 0.05, 0.95, 0.98, 1]) {
    const cand = { ...seedOklch, L: Lcand };
    const r = contrastRatio(oklchToRgb(cand), referenceRgb);
    if (r > bestRatio) { best = cand; bestRatio = r; }
  }
  return { oklch: best, ratio: bestRatio, passed: bestRatio >= target };
}

/** Build a neutral ramp (background, surface, text) tinted with the seed hue.
 *  Light mode bg is near-white with a hint of seed hue; text is near-black.
 *  Surface is between bg and a slightly darker tone for cards/panels. */
function makeNeutrals(seedOklch, dark = false) {
  const tinyC = Math.min(0.015, seedOklch.C * 0.08);
  if (dark) {
    return {
      background: { L: 0.18, C: tinyC, H: seedOklch.H },
      surface:    { L: 0.24, C: tinyC, H: seedOklch.H },
      text:       { L: 0.96, C: tinyC * 0.5, H: seedOklch.H },
    };
  }
  return {
    background: { L: 0.985, C: tinyC * 0.5, H: seedOklch.H },
    surface:    { L: 0.955, C: tinyC, H: seedOklch.H },
    text:       { L: 0.18, C: tinyC, H: seedOklch.H },
  };
}

/** Canonical semantic hues in OKLCH. These are starting points; we
 *  adjust L for contrast and (lightly) shift C/H for harmonization. */
const SEMANTIC_SEEDS = {
  success: { L: 0.62, C: 0.16, H: 150 },  // green
  warning: { L: 0.78, C: 0.18, H: 75 },   // amber/yellow
  error:   { L: 0.58, C: 0.21, H: 25 },   // red
};

/** Snap one of the harmony-derived OKLCH colors to a mid-lightness so swatches
 *  don't all collapse to the same brightness. */
function normalizeRoleLightness(oklch, targetL) {
  return { ...oklch, L: targetL };
}

/**
 * Generate one palette for a given harmony strategy.
 *
 * @param {object}   opts
 * @param {object}   opts.primary       OKLCH for primary (required, anchor)
 * @param {object?}  opts.secondary     OKLCH anchor or null
 * @param {object?}  opts.accent        OKLCH anchor or null
 * @param {string}   opts.strategy      key into HARMONY_STRATEGIES
 * @param {boolean}  opts.dark          generate dark-mode neutrals
 */
export function generatePalette({ primary, secondary, accent, strategy, dark = false }) {
  const harmony = HARMONY_STRATEGIES[strategy](primary);
  // harmony[0] is always the seed (primary). harmony[1], [2] are derived hues.
  // Anchors override derived slots when provided; otherwise we use the harmony picks.
  const sec = secondary ?? normalizeRoleLightness(harmony[1], 0.55);
  const acc = accent    ?? normalizeRoleLightness(harmony[2], 0.65);

  const neutrals = makeNeutrals(primary, dark);
  const bgRgb = oklchToRgb(neutrals.background);

  // Ensure text passes AA against background. Text is a derived neutral, so
  // we're free to push it.
  const textAdj = ensureContrast(neutrals.text, bgRgb, WCAG_AA_NORMAL);

  // Semantic colors: start from canonical hues, lightness-adjust against bg.
  const success = ensureContrast(SEMANTIC_SEEDS.success, bgRgb).oklch;
  const warning = ensureContrast(SEMANTIC_SEEDS.warning, bgRgb).oklch;
  const error   = ensureContrast(SEMANTIC_SEEDS.error, bgRgb).oklch;

  const palette = {
    primary:    oklchToHex(primary),
    secondary:  oklchToHex(sec),
    accent:     oklchToHex(acc),
    background: oklchToHex(neutrals.background),
    surface:    oklchToHex(neutrals.surface),
    text:       oklchToHex(textAdj.oklch),
    success:    oklchToHex(success),
    warning:    oklchToHex(warning),
    error:      oklchToHex(error),
  };

  return {
    strategy,
    label: HARMONY_LABELS[strategy],
    colors: palette,
    // Roles that were user-anchored (untouched). UI uses this to know what
    // it's not allowed to auto-fix.
    anchors: {
      primary: true,
      secondary: secondary != null,
      accent: accent != null,
    },
  };
}

/** Generate the candidate set for a given input. */
export function generateCandidates({ primary, secondary, accent, dark = false }) {
  const strategies = ["analogous", "complementary", "triadic", "splitComplementary", "monochromatic"];
  return strategies.map((strategy) =>
    generatePalette({ primary, secondary, accent, strategy, dark })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — contrast pairs and collision pairs.
// Returns a structured report consumed by the UI.
// ─────────────────────────────────────────────────────────────────────────────

/** Text/background pairs that we require to pass WCAG AA. */
export const REQUIRED_CONTRAST_PAIRS = [
  { fg: "text",      bg: "background", target: WCAG_AA_NORMAL, label: "Body text on background" },
  { fg: "text",      bg: "surface",    target: WCAG_AA_NORMAL, label: "Body text on surface" },
  { fg: "primary",   bg: "background", target: WCAG_AA_LARGE,  label: "Primary on background (large)" },
  { fg: "background", bg: "primary",   target: WCAG_AA_NORMAL, label: "Text on primary button" },
  { fg: "background", bg: "success",   target: WCAG_AA_NORMAL, label: "Text on success" },
  { fg: "background", bg: "warning",   target: WCAG_AA_NORMAL, label: "Text on warning" },
  { fg: "background", bg: "error",     target: WCAG_AA_NORMAL, label: "Text on error" },
];

/** Role pairs whose CVD simulations must remain perceptually distinct. We omit
 *  background/surface/text because they're allowed (and expected) to be close
 *  in hue — they're a neutral ramp. */
export const ROLE_COLLISION_PAIRS = [
  ["primary", "secondary"],
  ["primary", "accent"],
  ["secondary", "accent"],
  ["primary", "success"],
  ["primary", "warning"],
  ["primary", "error"],
  ["success", "warning"],
  ["success", "error"],
  ["warning", "error"],
];

/** Validate a single palette under a given color transform.
 *  transform: rgb→rgb function. For true-color, pass the identity.
 *  Returns { contrastFailures: [...], collisions: [...] } */
export function validateUnderTransform(palette, transform) {
  const transformedHex = {};
  for (const [role, hex] of Object.entries(palette.colors)) {
    transformedHex[role] = rgbToHex(transform(hexToRgb(hex)));
  }
  const rgb = (role) => hexToRgb(transformedHex[role]);

  const contrastFailures = [];
  for (const pair of REQUIRED_CONTRAST_PAIRS) {
    const ratio = contrastRatio(rgb(pair.fg), rgb(pair.bg));
    if (ratio < pair.target) {
      contrastFailures.push({
        ...pair,
        ratio,
        // Whether the failure is caused by a user anchor we can't auto-fix.
        anchored: palette.anchors[pair.fg] || palette.anchors[pair.bg],
      });
    }
  }

  const collisions = [];
  for (const [a, b] of ROLE_COLLISION_PAIRS) {
    const dE = deltaEOk(rgb(a), rgb(b));
    if (dE < CVD_DISTINGUISHABLE_THRESHOLD) {
      collisions.push({ roleA: a, roleB: b, deltaE: dE });
    }
  }
  return { contrastFailures, collisions, transformedColors: transformedHex };
}

/** Run validation under true color (identity) — used for the score badge. */
export function validatePalette(palette) {
  return validateUnderTransform(palette, (rgb) => rgb);
}

// ─────────────────────────────────────────────────────────────────────────────
// One-shot "fix" suggestion: nudge a non-anchor color's lightness in OKLCH
// to resolve a specific contrast failure. Returns a new palette or null if
// the failure is on an anchored role (we refuse to silently edit those).
// ─────────────────────────────────────────────────────────────────────────────

export function suggestFix(palette, failure) {
  const fgAnchored = palette.anchors[failure.fg];
  const bgAnchored = palette.anchors[failure.bg];
  // Prefer fixing the non-anchored side. If both anchored, we can't.
  let roleToFix;
  if (!fgAnchored) roleToFix = failure.fg;
  else if (!bgAnchored) roleToFix = failure.bg;
  else return null;

  const other = roleToFix === failure.fg ? failure.bg : failure.fg;
  const otherRgb = hexToRgb(palette.colors[other]);
  const seed = hexToOklch(palette.colors[roleToFix]);
  const adjusted = ensureContrast(seed, otherRgb, failure.target);
  const newColors = { ...palette.colors, [roleToFix]: oklchToHex(adjusted.oklch) };
  return { ...palette, colors: newColors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export formats
// ─────────────────────────────────────────────────────────────────────────────

export function exportTailwind(palette, statusComment = "") {
  const header = statusComment ? `// ${statusComment}\n` : "";
  const entries = Object.entries(palette.colors)
    .map(([role, hex]) => `      ${role}: "${hex}",`)
    .join("\n");
  return `${header}// theme.extend.colors — drop into tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
${entries}
      },
    },
  },
};
`;
}

export function exportCssVariables(palette, statusComment = "") {
  const header = statusComment ? `/* ${statusComment} */\n` : "";
  const entries = Object.entries(palette.colors)
    .map(([role, hex]) => `  --color-${role}: ${hex};`)
    .join("\n");
  return `${header}:root {
${entries}
}
`;
}

export function exportJson(palette, statusComment = "") {
  return JSON.stringify(
    { _comment: statusComment || undefined, strategy: palette.strategy, colors: palette.colors },
    null,
    2,
  );
}
