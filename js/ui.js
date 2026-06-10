// ui.js — DOM wiring for the palette generator.
// Pulls pure logic from engine.js and cvd.js; this file is the only one that
// touches the DOM.

import {
  hexToOklch, hexToRgb, oklchToHex,
  generateCandidates, validatePalette, validateUnderTransform,
  exportTailwind, exportCssVariables, exportJson,
  suggestFix, contrastRatio,
} from "./engine.js";
import { CVD_TYPES, CVD_LABELS, makeCvdTransform, simulateHex } from "./cvd.js";

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  primary: "#3b82f6",
  secondary: null,
  accent: null,
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  showCvd: true,
  candidates: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  wireInputs();
  wireGlobalControls();
  applyTheme();
  regenerate();
});

// ─────────────────────────────────────────────────────────────────────────────
// Input handling
// ─────────────────────────────────────────────────────────────────────────────

function wireInputs() {
  for (const role of ["primary", "secondary", "accent"]) {
    const picker = document.getElementById(`pick-${role}`);
    const text = document.getElementById(`hex-${role}`);
    const clear = document.getElementById(`clear-${role}`);

    // Two-way bind picker ↔ text.
    picker.addEventListener("input", () => {
      text.value = picker.value;
      state[role] = picker.value;
      flashValidity(text, true);
    });
    text.addEventListener("input", () => {
      const norm = normalizeHex(text.value);
      if (norm) {
        picker.value = norm;
        state[role] = norm;
        flashValidity(text, true);
      } else if (text.value.trim() === "" && role !== "primary") {
        state[role] = null;
        flashValidity(text, true);
      } else {
        flashValidity(text, false);
      }
    });
    if (clear) {
      clear.addEventListener("click", () => {
        text.value = "";
        state[role] = null;
        flashValidity(text, true);
      });
    }
  }
  document.getElementById("generate").addEventListener("click", regenerate);
}

function normalizeHex(v) {
  let h = String(v || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
  return null;
}

function flashValidity(el, ok) {
  el.setAttribute("aria-invalid", ok ? "false" : "true");
}

// ─────────────────────────────────────────────────────────────────────────────
// Global controls (theme, CVD toggle)
// ─────────────────────────────────────────────────────────────────────────────

function wireGlobalControls() {
  document.getElementById("toggle-theme").addEventListener("click", () => {
    state.dark = !state.dark;
    applyTheme();
    regenerate();
  });
  document.getElementById("toggle-cvd").addEventListener("change", (e) => {
    state.showCvd = e.target.checked;
    render();
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  const btn = document.getElementById("toggle-theme");
  btn.setAttribute("aria-pressed", String(state.dark));
  btn.textContent = state.dark ? "Light mode" : "Dark mode";
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

function regenerate() {
  const primary = hexToOklch(state.primary);
  if (!primary) return;
  const secondary = state.secondary ? hexToOklch(state.secondary) : null;
  const accent = state.accent ? hexToOklch(state.accent) : null;
  state.candidates = generateCandidates({ primary, secondary, accent, dark: state.dark });
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = [
  "primary", "secondary", "accent",
  "background", "surface", "text",
  "success", "warning", "error",
];

function render() {
  const root = document.getElementById("palettes");
  root.replaceChildren();
  for (const palette of state.candidates) {
    root.appendChild(renderCard(palette));
  }
}

function renderCard(palette) {
  const card = el("article", { className: "card", role: "article" });
  card.style.setProperty("--card-bg", palette.colors.background);
  card.style.setProperty("--card-surface", palette.colors.surface);
  card.style.setProperty("--card-text", palette.colors.text);

  const issues = computeIssues(palette);

  card.appendChild(renderHeader(palette, issues));
  card.appendChild(renderBody(palette, issues));
  card.appendChild(renderWarnings(palette, issues));
  card.appendChild(renderExportRow(palette, issues));
  return card;
}

/**
 * Compute the deduped issue list for one palette.
 *
 * - Contrast failures are deduped by their `label` — if "Body text on background"
 *   fails in true color, we don't repeat it for every CVD type. We only surface
 *   a CVD-specific contrast failure if it isn't already a true-color failure.
 * - Collisions are grouped by role pair, so "primary and accent collide" under
 *   deuteranopia + protanopia becomes a single item listing both contexts.
 */
function computeIssues(palette) {
  const trueReport = validatePalette(palette);
  const cvdReports = {};
  for (const type of CVD_TYPES) {
    cvdReports[type] = validateUnderTransform(palette, makeCvdTransform(type));
  }

  const items = [];
  const seenContrastLabels = new Set();

  for (const f of trueReport.contrastFailures) {
    items.push({
      kind: "contrast",
      contexts: ["True color"],
      label: f.label,
      ratio: f.ratio,
      target: f.target,
      fg: f.fg,
      bg: f.bg,
      anchored: f.anchored,
      failure: f,
    });
    seenContrastLabels.add(f.label);
  }
  for (const type of CVD_TYPES) {
    const ctx = cvdShortLabel(type);
    for (const f of cvdReports[type].contrastFailures) {
      if (seenContrastLabels.has(f.label)) continue;
      items.push({
        kind: "contrast",
        contexts: [ctx],
        label: f.label,
        ratio: f.ratio,
        target: f.target,
        fg: f.fg,
        bg: f.bg,
        anchored: f.anchored,
        failure: f,
      });
      seenContrastLabels.add(f.label);
    }
  }

  // Collisions grouped by unordered role pair.
  const collisionByPair = new Map();
  const addCollision = (c, ctx) => {
    const key = [c.roleA, c.roleB].sort().join("|");
    const entry = collisionByPair.get(key) ?? {
      kind: "collision", roleA: c.roleA, roleB: c.roleB,
      contexts: [], minDeltaE: Infinity,
    };
    entry.contexts.push(ctx);
    entry.minDeltaE = Math.min(entry.minDeltaE, c.deltaE);
    collisionByPair.set(key, entry);
  };
  for (const c of trueReport.collisions) addCollision(c, "True color");
  for (const type of CVD_TYPES) {
    const ctx = cvdShortLabel(type);
    for (const c of cvdReports[type].collisions) addCollision(c, ctx);
  }
  for (const entry of collisionByPair.values()) items.push(entry);

  // Roles flagged anywhere — used to badge swatches in the true-color row.
  const flaggedRoles = new Set();
  for (const it of items) {
    if (it.kind === "contrast") { flaggedRoles.add(it.fg); flaggedRoles.add(it.bg); }
    else { flaggedRoles.add(it.roleA); flaggedRoles.add(it.roleB); }
  }

  return { items, flaggedRoles, cvdReports };
}

const cvdShortLabel = (type) => CVD_LABELS[type].split(" (")[0];

function renderHeader(palette, issues) {
  const total = issues.items.length;
  const header = el("header", { className: "card-header" });
  const title = el("h3", { textContent: palette.label });
  const badge = el("span", { className: "badge" });
  if (total === 0) {
    badge.classList.add("badge-ok");
    badge.textContent = "✓ CVD-safe";
  } else {
    badge.classList.add("badge-warn");
    badge.textContent = `⚠ ${total} issue${total === 1 ? "" : "s"}`;
  }
  badge.setAttribute("aria-label", `${total} accessibility issues`);
  header.append(title, badge);
  return header;
}

/** The card body — swatch rows on the left, mini-preview on the right (on
 *  wide screens). Stacks vertically on narrow viewports via CSS. */
function renderBody(palette, issues) {
  const body = el("div", { className: "card-body" });
  body.appendChild(renderSwatchRows(palette, issues));
  body.appendChild(renderPreview(palette));
  return body;
}

function renderSwatchRows(palette, issues) {
  const wrap = el("div", { className: "swatch-rows" });
  wrap.appendChild(renderSwatchRow(palette.colors, "True color", issues.flaggedRoles, palette));
  if (state.showCvd) {
    for (const type of CVD_TYPES) {
      const transformed = {};
      for (const role of ROLES) {
        transformed[role] = simulateHex(type, palette.colors[role]);
      }
      // CVD rows don't repeat the true-color swatch flags; only the true-color
      // row carries the ⚠ icons. The CVD rows are about visual comparison.
      wrap.appendChild(renderSwatchRow(transformed, cvdShortLabel(type), null, palette));
    }
  }
  return wrap;
}

function renderSwatchRow(colors, label, flaggedRoles, palette) {
  const row = el("div", { className: "swatch-row" });
  row.appendChild(el("div", { className: "swatch-row-label", textContent: label }));
  const strip = el("div", { className: "swatch-strip", role: "list" });

  for (const role of ROLES) {
    const hex = colors[role];
    const sw = el("button", {
      className: "swatch",
      type: "button",
      role: "listitem",
      title: `${role}: ${hex} (click to copy)`,
    });
    sw.style.background = hex;
    sw.style.color = textColorFor(hex);
    sw.dataset.role = role;
    sw.dataset.hex = hex;

    const roleLabel = el("span", { className: "swatch-role", textContent: role });
    const hexLabel = el("span", { className: "swatch-hex", textContent: hex });
    sw.append(roleLabel, hexLabel);

    if (palette.anchors[role]) {
      const lock = el("span", { className: "swatch-anchor", textContent: "🔒", "aria-label": "user-anchored — won't be altered" });
      sw.appendChild(lock);
    }
    if (flaggedRoles && flaggedRoles.has(role)) {
      const flag = el("span", { className: "swatch-flag", textContent: "⚠", "aria-label": "involved in an accessibility issue" });
      sw.appendChild(flag);
    }
    sw.addEventListener("click", () => copyToClipboard(hex, sw));
    strip.appendChild(sw);
  }
  row.appendChild(strip);
  return row;
}

function renderWarnings(palette, issues) {
  const wrap = el("div", { className: "warnings" });

  if (issues.items.length === 0) {
    wrap.appendChild(el("p", { className: "warnings-empty", textContent: "No accessibility issues detected." }));
    return wrap;
  }

  wrap.appendChild(el("h4", { textContent: "Issues" }));
  const list = el("ul", { className: "warning-list" });
  for (const item of issues.items) {
    const li = el("li", { className: "warning-item" });
    li.appendChild(el("span", { textContent: formatIssueText(item) }));
    if (item.kind === "contrast" && !item.anchored) {
      const fixBtn = el("button", { className: "fix-btn", type: "button", textContent: "Try fix" });
      fixBtn.addEventListener("click", () => applyFix(palette, item.failure));
      li.appendChild(fixBtn);
    } else if (item.kind === "contrast" && item.anchored) {
      li.appendChild(el("span", { className: "anchor-note", textContent: "(user-anchored)" }));
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

/** Render one issue item to a human-readable string. Contexts (true color +
 *  any CVD types) are joined so a collision affecting multiple simulations
 *  reads as a single line. */
function formatIssueText(item) {
  const ctxStr = item.contexts.join(" / ");
  if (item.kind === "contrast") {
    return `${ctxStr} — ${item.label}: ${item.ratio.toFixed(2)}:1 (needs ${item.target.toFixed(1)}:1).`;
  }
  return `${ctxStr} — ${item.roleA} and ${item.roleB} are nearly indistinguishable (ΔE ${item.minDeltaE.toFixed(3)}).`;
}

function applyFix(palette, failure) {
  const fixed = suggestFix(palette, failure);
  if (!fixed) return; // both anchors locked
  const idx = state.candidates.indexOf(palette);
  if (idx >= 0) state.candidates[idx] = fixed;
  render();
}

function renderPreview(palette) {
  const c = palette.colors;
  const preview = el("div", { className: "preview", "aria-label": "Mini UI preview" });
  preview.style.background = c.background;
  preview.style.color = c.text;
  preview.innerHTML = `
    <div class="preview-card" style="background:${c.surface}">
      <p class="preview-text">A short headline.</p>
      <p class="preview-sub" style="opacity:.75">Supporting copy in the body text role.</p>
      <div class="preview-buttons">
        <button class="preview-btn" style="background:${c.primary};color:${textColorFor(c.primary)}">Primary</button>
        <button class="preview-btn-secondary" style="background:transparent;color:${c.primary};border:1px solid ${c.primary}">Secondary</button>
      </div>
      <div class="preview-alerts">
        <span class="preview-pill" style="background:${c.success};color:${textColorFor(c.success)}">Success</span>
        <span class="preview-pill" style="background:${c.warning};color:${textColorFor(c.warning)}">Warning</span>
        <span class="preview-pill" style="background:${c.error};color:${textColorFor(c.error)}">Error</span>
        <span class="preview-pill" style="background:${c.accent};color:${textColorFor(c.accent)}">Accent</span>
      </div>
    </div>
  `;
  return preview;
}

function renderExportRow(palette, issues) {
  const row = el("div", { className: "export-row" });
  const total = issues.items.length;
  const status = total === 0
    ? "Validation: passes WCAG AA and CVD distinguishability."
    : `Validation: ${total} issue${total === 1 ? "" : "s"} — review before shipping.`;

  for (const [label, fn] of [
    ["Tailwind", exportTailwind],
    ["CSS vars", exportCssVariables],
    ["JSON", exportJson],
  ]) {
    const btn = el("button", { className: "export-btn", type: "button", textContent: `Copy ${label}` });
    btn.addEventListener("click", () => copyToClipboard(fn(palette, status), btn, `Copied ${label}`));
    row.appendChild(btn);
  }
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Pick black or white for legible text on a given background hex. */
function textColorFor(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#000";
  const onWhite = contrastRatio(rgb, { r: 1, g: 1, b: 1 });
  const onBlack = contrastRatio(rgb, { r: 0, g: 0, b: 0 });
  return onBlack >= onWhite ? "#000" : "#fff";
}

async function copyToClipboard(text, sourceEl, successLabel = "Copied!") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers without permission: select-and-copy via a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* give up silently */ }
    ta.remove();
  }
  if (sourceEl) {
    const original = sourceEl.textContent;
    sourceEl.classList.add("copied");
    sourceEl.textContent = successLabel;
    setTimeout(() => {
      sourceEl.classList.remove("copied");
      sourceEl.textContent = original;
    }, 900);
  }
}

function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "textContent") node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}
