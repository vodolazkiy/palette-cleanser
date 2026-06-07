# Palette Cleanser

> Accessibility-first color palette generator. Static site, runs entirely client-side, deployable to GitHub Pages.

Give it one to three brand colors. It produces several complete, role-structured
palettes, shows each one as it appears under the four major forms of color
vision deficiency (CVD), and automatically flags accessibility problems.

This is the flagship demo for a planned Tailwind component library focused on
visual accessibility — pull requests and forks welcome.

## Try it live

> _Link placeholder — set this to your GitHub Pages URL after enabling Pages on the repo._
>
> `https://<your-handle>.github.io/palette-cleanser/`

## Screenshot

> _Screenshot placeholder — drop a PNG at `docs/screenshot.png` and reference it here._

## What it does

- **One to three inputs.** Primary is required; Secondary and Accent are optional
  anchors that are preserved exactly.
- **Five candidate palettes.** Each uses a different harmony strategy
  (analogous, complementary, triadic, split-complementary, monochromatic),
  computed in [OKLCH](https://bottosson.github.io/posts/oklab/) so hue rotation
  is perceptually even.
- **Nine named roles per palette:** `primary`, `secondary`, `accent`,
  `background`, `surface`, `text`, `success`, `warning`, `error`.
- **CVD simulation.** Every palette is rendered four extra times: deuteranopia,
  protanopia, tritanopia, and achromatopsia.
- **Automatic flagging.** Two kinds of warning:
  - **Contrast failures.** Any required text/background pair below WCAG 2.1 AA
    contrast is reported, including failures caused by user-anchored input
    colors (which are never silently altered).
  - **Role collisions.** If two role colors become perceptually indistinguishable
    under a simulation (ΔE in OKLab below threshold), the pair is flagged with
    the simulation that caused it, e.g. _"Primary and Success are nearly
    indistinguishable under deuteranopia."_
- **Export.** Per palette, copy a Tailwind config snippet, a CSS custom
  properties block, or JSON — each with a comment header recording the
  palette's validation status.

## How the simulation works

CVD simulation uses the [Machado, Oliveira, Fernandes (2009)][machado] matrices
at severity 1.0 for the three principal dichromacies, applied in linear RGB:

```
sRGB → linear RGB → matrix multiply → linear RGB → sRGB
```

Achromatopsia is rendered via BT.709 luminance in linear-light space.

We chose Machado over the [Brettel/Viénot/Mollon (1997)][brettel] model because
the matrix form is compact and the visual results match well for the common
red-green deficiencies that affect ~8% of men of European descent. Both are
considered authoritative reference implementations.

[machado]: http://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
[brettel]: https://www.researchgate.net/publication/14087960

## How collision detection works

For each CVD simulation and every pair of roles, we compute perceptual distance
as Euclidean ΔE in [OKLab][oklab]. Any pair below
`CVD_DISTINGUISHABLE_THRESHOLD` (default 0.04 — comfortably above a
just-noticeable difference of ~0.02) is flagged. The threshold lives in
`js/engine.js` and is one constant — tune it to taste.

[oklab]: https://bottosson.github.io/posts/oklab/

## How contrast is computed

WCAG 2.1 contrast ratio, following the spec literally (including the 0.03928
piecewise breakpoint, which is the value the WCAG 2.x reference algorithm uses
verbatim — see [WCAG 2.1 §1.4.3][wcag-contrast-minimum]). The required pairs are:

- Body text on background and on surface — AA normal (4.5:1)
- Primary on background — AA large (3:1)
- White-ish text on each of primary, success, warning, error — AA normal

[wcag-contrast-minimum]: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html

## Project layout

```
index.html           Single-page UI
style.css            Tool's own styles. Card colors come from inline vars.
js/
  engine.js          Pure color math: hex/sRGB/linear/OKLab/OKLCH conversion,
                     WCAG contrast, ΔE, harmonies, palette generation, exports.
                     Zero DOM dependencies — publishable to npm as-is.
  cvd.js             Machado matrices + simulation. Also DOM-free.
  ui.js              The only file that touches the DOM.
tests/
  engine.test.js     Hex, gamma, OKLab/OKLCH, contrast, ΔE, palette gen.
  cvd.test.js        Machado sanity, qualitative shifts, achromatopsia.
.github/workflows/
  deploy.yml         GitHub Pages deploy on push to main.
```

## Run it locally

No build step. Open `index.html` directly, or:

```sh
# any static server works; here's one without dependencies:
python -m http.server 8080
# or:
npx --yes serve .
```

Then visit <http://localhost:8080>.

## Run tests

```sh
node --test tests/*.test.js
```

No test framework dependency — just `node:test` and `node:assert`. Node 18 or
later required.

## Deploying to GitHub Pages

This repo includes `.github/workflows/deploy.yml`. To enable:

1. Push to GitHub.
2. In **Settings → Pages**, set **Source** to "GitHub Actions".
3. Push to `main`. The workflow uploads the repo as a Pages artifact.

## Accessibility of the tool itself

The generator's own UI follows the rules it preaches:

- All controls are keyboard-reachable with a visible focus ring.
- Color is never the only signal: every warning is a labeled icon **and** a
  text description.
- Inputs use proper `<label>` association and `aria-describedby` hints.
- `prefers-reduced-motion` is respected — swatch hover transitions only animate
  if motion is permitted.
- Both light and dark UI themes are available; the palette card visuals look
  identical in both because they're styled from the per-palette colors, not the
  tool's theme.

## Contributing

This is intentionally a small, dependency-free codebase. If you want to extend
it, good places to start:

- More harmony strategies (e.g. tetradic).
- A smarter "fix" suggestion that resolves collisions, not just contrast.
- Severity slider for CVD simulation (Machado supports any severity in [0,1]
  by interpolating the matrix with the identity).
- Better gamut mapping when an OKLCH adjustment pushes outside sRGB.

Open an issue or a PR. Keep the engine DOM-free.

## License

MIT — see [`LICENSE`](LICENSE).
