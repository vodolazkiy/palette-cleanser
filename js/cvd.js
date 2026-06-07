// cvd.js — Color vision deficiency simulation.
//
// Implements the Machado, Oliveira, Fernandes (2009) simulation matrices for
// the three principal dichromacies (protanopia, deuteranopia, tritanopia), plus
// a luminance-based grayscale for achromatopsia.
//
// The Machado matrices are derived from a physiological model of the cone
// fundamentals and are designed to be applied in linear RGB. The full pipeline:
//   sRGB → linear RGB → matrix multiply → linear RGB → sRGB
//
// Severity is 1.0 (full dichromacy). Lower severities are obtainable by
// interpolating with the identity matrix; we ship 1.0 only for the simulator.
//
// References:
//   Machado, G. M., Oliveira, M. M., Fernandes, L. A. F.
//   "A Physiologically-based Model for Simulation of Color Vision Deficiency."
//   IEEE TVCG 15(6), 2009. http://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
//
//   Brettel, H., Viénot, F., Mollon, J. D. (1997) is an alternative model;
//   we chose Machado because the matrix form is simpler and the results match
//   well for the most common red/green deficiencies.

import {
  hexToRgb, rgbToHex, rgbToLinear, linearToRgb,
} from "./engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Machado severity-1.0 simulation matrices (row-major, applied to column vec).
// Sourced from the supplementary tables of the Machado et al. (2009) paper.
// ─────────────────────────────────────────────────────────────────────────────

export const CVD_MATRICES = {
  protanopia: [
    [ 0.152286,  1.052583, -0.204868],
    [ 0.114503,  0.786281,  0.099216],
    [-0.003882, -0.048116,  1.051998],
  ],
  deuteranopia: [
    [ 0.367322,  0.860646, -0.227968],
    [ 0.280085,  0.672501,  0.047413],
    [-0.011820,  0.042940,  0.968881],
  ],
  tritanopia: [
    [ 1.255528, -0.076749, -0.178779],
    [-0.078411,  0.930809,  0.147602],
    [ 0.004733,  0.691367,  0.303900],
  ],
};

export const CVD_TYPES = ["deuteranopia", "protanopia", "tritanopia", "achromatopsia"];

export const CVD_LABELS = {
  deuteranopia:  "Deuteranopia (red-green, ~6% of men)",
  protanopia:    "Protanopia (red-green, ~1% of men)",
  tritanopia:    "Tritanopia (blue-yellow, rare)",
  achromatopsia: "Achromatopsia (total color blindness, very rare)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────────────────────

/** Multiply a 3x3 matrix by a {r,g,b} column vector. */
function applyMatrix(M, { r, g, b }) {
  return {
    r: M[0][0] * r + M[0][1] * g + M[0][2] * b,
    g: M[1][0] * r + M[1][1] * g + M[1][2] * b,
    b: M[2][0] * r + M[2][1] * g + M[2][2] * b,
  };
}

/** Simulate one of the dichromacies on a linear-RGB color. */
export function simulateLinear(type, linearRgb) {
  const M = CVD_MATRICES[type];
  if (!M) throw new Error(`Unknown CVD type: ${type}`);
  return applyMatrix(M, linearRgb);
}

/** Full sRGB→sRGB CVD transform.
 *  Returns a transform function suitable for engine.validateUnderTransform. */
export function makeCvdTransform(type) {
  if (type === "achromatopsia") {
    // Convert luminance back to a gray sRGB triplet. We use BT.709 luma in
    // linear-light space (the perceptually correct route), not the sRGB-encoded
    // shortcut, because that's what the rod-only response corresponds to.
    return (rgb) => {
      const lin = rgbToLinear(rgb);
      const y = 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
      return linearToRgb({ r: y, g: y, b: y });
    };
  }
  return (rgb) => {
    const lin = rgbToLinear(rgb);
    const sim = simulateLinear(type, lin);
    return linearToRgb({
      r: Math.max(0, Math.min(1, sim.r)),
      g: Math.max(0, Math.min(1, sim.g)),
      b: Math.max(0, Math.min(1, sim.b)),
    });
  };
}

/** Convenience: simulate a hex color under one CVD type and return hex. */
export function simulateHex(type, hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(makeCvdTransform(type)(rgb));
}

/** Simulate all four CVD types for a hex color. Returns { type: hex }. */
export function simulateAll(hex) {
  const out = {};
  for (const t of CVD_TYPES) out[t] = simulateHex(t, hex);
  return out;
}
