// colorpicker.js — Minimal, dependency-free HSV color picker.
//
// Renders as a popover positioned beneath the anchor element. Drag in the
// saturation/value square to pick S and V, drag on the hue strip to pick H,
// or type a hex value directly. Pointer events are used so mouse, touch, and
// pen all work. Arrow keys nudge the focused control (Shift = bigger steps).
//
// Public API:
//   initPicker()                          — set up the singleton popover in the DOM
//   openPicker({ anchorEl, initialHex, onChange, onClose })
//                                         — opens the picker for one input.
//                                           onChange fires on every adjustment
//                                           with the new hex string.

let popoverEl = null;
let currentHsv = { h: 0, s: 1, v: 1 };
let onChangeCb = null;
let onCloseCb = null;
let activeAnchor = null;
let svDragging = false;
let hueDragging = false;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ─────────────────────────────────────────────────────────────────────────────
// HSV ↔ RGB helpers. We keep these local rather than importing from engine.js
// because the picker is conceptually a UI widget that happens to need color
// conversions — coupling it to the palette engine would make it harder to
// pull out as its own thing later.
// ─────────────────────────────────────────────────────────────────────────────

function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1)      [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else             [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: r + m, g: g + m, b: b + m };
}

function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let hh = 0;
  if (d !== 0) {
    if (max === r)      hh = ((g - b) / d) % 6;
    else if (max === g) hh = (b - r) / d + 2;
    else                hh = (r - g) / d + 4;
  }
  const h = ((hh * 60) + 360) % 360;
  return { h, s, v };
}

function rgbToHex({ r, g, b }) {
  const to2 = (x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

function normalizeHex(v) {
  let h = String(v || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
  return null;
}

function hexToHsv(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  return rgbToHsv({ r, g, b });
}

// ─────────────────────────────────────────────────────────────────────────────
// Popover lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function initPicker() {
  if (popoverEl) return;
  popoverEl = document.createElement("div");
  popoverEl.className = "color-popover";
  popoverEl.setAttribute("role", "dialog");
  popoverEl.setAttribute("aria-label", "Color picker");
  popoverEl.hidden = true;
  popoverEl.innerHTML = `
    <div class="cp-sv" tabindex="0" role="slider" aria-label="Saturation and value"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
      <div class="cp-sv-cursor"></div>
    </div>
    <div class="cp-hue" tabindex="0" role="slider" aria-label="Hue"
         aria-valuemin="0" aria-valuemax="360" aria-valuenow="0">
      <div class="cp-hue-cursor"></div>
    </div>
    <div class="cp-foot">
      <span class="cp-swatch" aria-hidden="true"></span>
      <input class="cp-hex" type="text" aria-label="Hex value" maxlength="7" spellcheck="false" />
      <button type="button" class="cp-close">Done</button>
    </div>
  `;
  document.body.appendChild(popoverEl);
  wirePicker();
  document.addEventListener("pointerdown", closeOnOutsideClick, true);
  document.addEventListener("keydown", closeOnEsc);
}

export function openPicker({ anchorEl, initialHex, onChange, onClose }) {
  initPicker();
  currentHsv = hexToHsv(initialHex) ?? { h: 0, s: 0, v: 1 };
  onChangeCb = onChange;
  onCloseCb = onClose;
  activeAnchor = anchorEl;
  positionPopover(anchorEl);
  renderPicker();
  popoverEl.hidden = false;
  // Focus the SV square so keyboard users land on the main control.
  popoverEl.querySelector(".cp-sv").focus();
}

function closePopover() {
  if (popoverEl.hidden) return;
  popoverEl.hidden = true;
  const wasActive = activeAnchor;
  activeAnchor = null;
  onChangeCb = null;
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
  // Return focus to the trigger for keyboard continuity.
  if (wasActive) wasActive.focus();
}

function positionPopover(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 240;
  let left = window.scrollX + rect.left;
  // Don't let the popover spill off the right edge of the viewport.
  const maxLeft = window.scrollX + document.documentElement.clientWidth - popoverWidth - 8;
  if (left > maxLeft) left = maxLeft;
  popoverEl.style.position = "absolute";
  popoverEl.style.top = (window.scrollY + rect.bottom + 8) + "px";
  popoverEl.style.left = left + "px";
}

function closeOnOutsideClick(e) {
  if (popoverEl.hidden) return;
  if (popoverEl.contains(e.target)) return;
  if (activeAnchor && activeAnchor.contains(e.target)) return;
  closePopover();
}

function closeOnEsc(e) {
  if (e.key === "Escape" && !popoverEl.hidden) closePopover();
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction wiring
// ─────────────────────────────────────────────────────────────────────────────

function wirePicker() {
  const sv = popoverEl.querySelector(".cp-sv");
  const hue = popoverEl.querySelector(".cp-hue");
  const hex = popoverEl.querySelector(".cp-hex");
  const closeBtn = popoverEl.querySelector(".cp-close");

  const setSV = (clientX, clientY) => {
    const rect = sv.getBoundingClientRect();
    currentHsv.s = clamp01((clientX - rect.left) / rect.width);
    currentHsv.v = 1 - clamp01((clientY - rect.top) / rect.height);
    renderPicker();
    emit();
  };
  sv.addEventListener("pointerdown", (e) => {
    sv.setPointerCapture(e.pointerId);
    svDragging = true;
    setSV(e.clientX, e.clientY);
  });
  sv.addEventListener("pointermove", (e) => {
    if (svDragging) setSV(e.clientX, e.clientY);
  });
  sv.addEventListener("pointerup", (e) => {
    svDragging = false;
    try { sv.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  });

  const setHue = (clientX) => {
    const rect = hue.getBoundingClientRect();
    currentHsv.h = clamp01((clientX - rect.left) / rect.width) * 360;
    renderPicker();
    emit();
  };
  hue.addEventListener("pointerdown", (e) => {
    hue.setPointerCapture(e.pointerId);
    hueDragging = true;
    setHue(e.clientX);
  });
  hue.addEventListener("pointermove", (e) => {
    if (hueDragging) setHue(e.clientX);
  });
  hue.addEventListener("pointerup", (e) => {
    hueDragging = false;
    try { hue.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  });

  // Keyboard control on the SV square: arrows nudge s/v.
  sv.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if      (e.key === "ArrowLeft")  currentHsv.s = clamp01(currentHsv.s - step);
    else if (e.key === "ArrowRight") currentHsv.s = clamp01(currentHsv.s + step);
    else if (e.key === "ArrowUp")    currentHsv.v = clamp01(currentHsv.v + step);
    else if (e.key === "ArrowDown")  currentHsv.v = clamp01(currentHsv.v - step);
    else return;
    e.preventDefault();
    renderPicker();
    emit();
  });
  hue.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 20 : 4;
    if      (e.key === "ArrowLeft")  currentHsv.h = (currentHsv.h - step + 360) % 360;
    else if (e.key === "ArrowRight") currentHsv.h = (currentHsv.h + step) % 360;
    else return;
    e.preventDefault();
    renderPicker();
    emit();
  });

  hex.addEventListener("input", () => {
    const norm = normalizeHex(hex.value);
    if (norm) {
      currentHsv = hexToHsv(norm);
      renderPicker({ skipHex: true });
      emit();
    }
  });
  hex.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); closePopover(); }
  });

  closeBtn.addEventListener("click", closePopover);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

function renderPicker({ skipHex = false } = {}) {
  const sv = popoverEl.querySelector(".cp-sv");
  const svCursor = popoverEl.querySelector(".cp-sv-cursor");
  const hue = popoverEl.querySelector(".cp-hue");
  const hueCursor = popoverEl.querySelector(".cp-hue-cursor");
  const hex = popoverEl.querySelector(".cp-hex");
  const swatch = popoverEl.querySelector(".cp-swatch");

  // SV square background = horizontal white→hue gradient overlaid by
  // vertical transparent→black gradient. Stacking order: first listed is on top.
  const pureHue = rgbToHex(hsvToRgb({ h: currentHsv.h, s: 1, v: 1 }));
  sv.style.background =
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})`;
  svCursor.style.left = (currentHsv.s * 100) + "%";
  svCursor.style.top = ((1 - currentHsv.v) * 100) + "%";
  // Pick a contrast color for the cursor outline so it stays visible on
  // any background.
  const cursorColor = currentHsv.v > 0.55 && currentHsv.s < 0.6 ? "#222" : "#fff";
  svCursor.style.borderColor = cursorColor;

  hueCursor.style.left = (currentHsv.h / 360 * 100) + "%";

  const outHex = rgbToHex(hsvToRgb(currentHsv));
  swatch.style.background = outHex;
  if (!skipHex && document.activeElement !== hex) hex.value = outHex;

  sv.setAttribute("aria-valuenow", String(Math.round(currentHsv.s * 100)));
  hue.setAttribute("aria-valuenow", String(Math.round(currentHsv.h)));
}

function emit() {
  if (onChangeCb) onChangeCb(rgbToHex(hsvToRgb(currentHsv)));
}
