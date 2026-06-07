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

  const report = validatePalette(palette);
  const cvdReports = {};
  for (const type of CVD_TYPES) {
    cvdReports[type] = validateUnderTransform(palette, makeCvdTransform(type));
  }

  card.appendChild(renderHeader(palette, report, cvdReports));
  card.appendChild(renderSwatchRows(palette, report, cvdReports));
  card.appendChild(renderWarnings(palette, report, cvdReports));
  card.appendChild(renderPreview(palette));
  card.appendChild(renderExportRow(palette, report, cvdReports));
  return card;
}

function renderHeader(palette, report, cvdReports) {
  const totalWarnings =
    report.contrastFailures.length +
    report.collisions.length +
    Object.values(cvdReports).reduce(
      (sum, r) => sum + r.contrastFailures.length + r.collisions.length,
      0,
    );
  const header = el("header", { className: "card-header" });
  const title = el("h3", { textContent: palette.label });
  const badge = el("span", { className: "badge" });
  if (totalWarnings === 0) {
    badge.classList.add("badge-ok");
    badge.textContent = "✓ CVD-safe";
  } else {
    badge.classList.add("badge-warn");
    badge.textContent = `⚠ ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`;
  }
  badge.setAttribute("aria-label", `${totalWarnings} accessibility warnings`);
  header.append(title, badge);
  return header;
}

function renderSwatchRows(palette, report, cvdReports) {
  const wrap = el("div", { className: "swatch-rows" });
  wrap.appendChild(renderSwatchRow(palette.colors, "True color", report, palette));
  if (state.showCvd) {
    for (const type of CVD_TYPES) {
      const transformed = {};
      for (const role of ROLES) {
        transformed[role] = simulateHex(type, palette.colors[role]);
      }
      wrap.appendChild(renderSwatchRow(transformed, CVD_LABELS[type], cvdReports[type], palette));
    }
  }
  return wrap;
}

function renderSwatchRow(colors, label, report, palette) {
  const row = el("div", { className: "swatch-row" });
  row.appendChild(el("div", { className: "swatch-row-label", textContent: label }));
  const strip = el("div", { className: "swatch-strip", role: "list" });

  // Flagged roles get an icon. Build a set of affected roles from this report.
  const flaggedRoles = new Set();
  for (const f of report.contrastFailures) { flaggedRoles.add(f.fg); flaggedRoles.add(f.bg); }
  for (const c of report.collisions) { flaggedRoles.add(c.roleA); flaggedRoles.add(c.roleB); }

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
    if (flaggedRoles.has(role)) {
      const flag = el("span", { className: "swatch-flag", textContent: "⚠", "aria-label": "has an accessibility warning in this row" });
      sw.appendChild(flag);
    }
    sw.addEventListener("click", () => copyToClipboard(hex, sw));
    strip.appendChild(sw);
  }
  row.appendChild(strip);
  return row;
}

function renderWarnings(palette, report, cvdReports) {
  const wrap = el("div", { className: "warnings" });
  const items = [];

  for (const f of report.contrastFailures) items.push(formatContrastFailure(f, "true color"));
  for (const c of report.collisions)        items.push(formatCollision(c, "true color"));
  for (const type of CVD_TYPES) {
    const r = cvdReports[type];
    const ctx = CVD_LABELS[type].split(" (")[0];
    for (const f of r.contrastFailures) items.push(formatContrastFailure(f, ctx));
    for (const c of r.collisions)        items.push(formatCollision(c, ctx));
  }

  if (items.length === 0) {
    wrap.appendChild(el("p", { className: "warnings-empty", textContent: "No accessibility issues detected." }));
    return wrap;
  }

  const heading = el("h4", { textContent: "Issues" });
  wrap.appendChild(heading);
  const list = el("ul", { className: "warning-list" });
  for (const item of items) {
    const li = el("li", { className: "warning-item" });
    const msg = el("span", { textContent: item.text });
    li.appendChild(msg);
    if (item.fixable && item.failure) {
      const fixBtn = el("button", { className: "fix-btn", type: "button", textContent: "Try fix" });
      fixBtn.addEventListener("click", () => applyFix(palette, item.failure));
      li.appendChild(fixBtn);
    } else if (item.anchorBlocked) {
      const note = el("span", { className: "anchor-note", textContent: "(user-anchored)" });
      li.appendChild(note);
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

function formatContrastFailure(f, context) {
  const ratioStr = f.ratio.toFixed(2);
  const targetStr = f.target.toFixed(1);
  return {
    text: `${context}: ${f.label} has ${ratioStr}:1 contrast (needs ${targetStr}:1).`,
    fixable: !f.anchored,
    failure: f,
    anchorBlocked: f.anchored,
  };
}

function formatCollision(c, context) {
  return {
    text: `${context}: ${c.roleA} and ${c.roleB} are nearly indistinguishable (ΔE ${c.deltaE.toFixed(3)}).`,
    fixable: false, // collision auto-fix is non-trivial; we report only
  };
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

function renderExportRow(palette, report, cvdReports) {
  const row = el("div", { className: "export-row" });
  const totalWarnings =
    report.contrastFailures.length + report.collisions.length +
    Object.values(cvdReports).reduce((s, r) => s + r.contrastFailures.length + r.collisions.length, 0);
  const status = totalWarnings === 0
    ? "Validation: passes WCAG AA and CVD distinguishability."
    : `Validation: ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"} — review before shipping.`;

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
