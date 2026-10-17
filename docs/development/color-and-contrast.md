# Colour & contrast guidelines

Written 2026-10-17, after a real-device report that parts of the UI were hard
to see on the phone. It sums up the current guidance, says what this project
adopts, and explains how that's enforced. Enforcement is by test, not by
review: `npm run test:visual` in `web/` (see the end).

## The numbers

| What | Minimum | Source |
|---|---|---|
| Body text, UI labels | **4.5:1** | WCAG 2.2 SC 1.4.3 (AA); Apple HIG; App Store "Sufficient Contrast" criteria |
| Large text (≥ 24px, or ≥ 18.66px bold) | **3:1** | WCAG 2.2 SC 1.4.3 |
| Icons, control boundaries, state indicators | **3:1** | WCAG 2.2 SC 1.4.11 (Non-text Contrast); Apple's App Store criteria |
| Custom colours in small text, aim | **7:1** | Apple HIG (Dark Mode → "Aim for sufficient color contrast in all appearances") |
| Body text, perceptual model (draft) | **APCA Lc 75** (Lc 90 preferred) | APCA / WCAG 3 draft, not yet a standard |

The ratios are not rounded: `#777777` on white is 4.47:1 and **fails**. Hover,
focus and active states must meet the same minimums. Decorative graphics,
logos and disabled controls are exempt.

## What Apple asks for specifically

From the HIG's Dark Mode page and App Store Connect's *Sufficient Contrast*
evaluation criteria, which apply to the accessibility labels an App Store
listing can declare:

- **Check both appearances.** The common failure Apple names is passing in
  light mode and failing in dark. Every one of this app's themes is checked.
- **Dark Mode is not an inversion.** It uses dimmer backgrounds and brighter
  foregrounds, and layered UI uses **elevated** backgrounds, which are
  slightly *lighter* than the base, so a sheet or popover reads as in front.
  Here that's `--surface-color`.
- **Avoid hard-coded colours that don't adapt.** Use semantic colours that
  each appearance defines. Here that's the token contract below.
- **Gray-on-black is a known problem** for low vision and light sensitivity.
  Muted text is where most of this app's failures were.
- **Test with Increase Contrast and Reduce Transparency** on, separately and
  together, and check translucent materials (blur, opacity), not just solid
  colours. Text on our frosted toolbar and drawer is measured against the
  pixels actually behind it for this reason.
- Apple recommends 3:1 for non-text elements and controls, such as checkbox
  states, icons and selection indicators.

## General dark-theme practice

From secondary sources summarising Material Design; treat the exact values as
indicative:
- Prefer a dark grey to pure black (Material suggests about `#121212`).
- Express elevation with lighter surfaces, not shadows; shadows vanish on dark
  backgrounds.
- **Desaturate accent colours.** Saturated hues that work on white often fail
  4.5:1 on dark, as Solarized's blue does.
- Use reduced-emphasis text for hierarchy (Material's guidance is about 87%,
  60% and 38% opacity), but never below the 4.5:1 floor for anything people
  have to read.

## What this project adopts

**Semantic tokens, one contract.** Every theme in
`MDViewer/Resources/Web/themes/` defines:

| Token | Role |
|---|---|
| `--bg-color` | page background |
| `--surface-color` | elevated panels: Preferences, dialogs, search bar, drawer |
| `--text-color` | primary text, 7:1 or better where the palette allows |
| `--muted-color` | secondary text, ≥ 4.5:1 on **both** `--bg-color` and `--code-bg` |
| `--link-color` | links, ≥ 4.5:1 |
| `--accent-bg` / `--accent-fg` | filled buttons; the pair itself ≥ 4.5:1 |
| `--border-color`, `--table-*`, `--code-*`, `--blockquote-*`, `--highlight-bg` | content |

`app.css` reads only these tokens. A missing token falls back to a light
value, which is exactly how Dracula's interface ended up white-on-white, so
**a new theme must define all of them.**

**Keep the palette's character, fix only what fails.** For Solarized and Nord,
any official value under 4.5:1 is replaced by the nearest shade of the *same
hue*: lightness changes, hue and saturation don't. Each such substitution is
commented in the theme file.

**Third-party colours we can't edit get overridden in `app.css`.** That covers
Shiki's GitHub palettes (remapped to GitHub Primer's accessible equivalents)
and Mermaid's dark theme (via `themeVariables` in `web/src/mermaid.ts`).
Authors' inline colours in their own documents are left alone; that's their
content.

**Not adopted yet** (candidates for later):
- a `prefers-contrast: more` variant (the CSS side of iOS's Increase
  Contrast);
- raising more small text from AA to the HIG's 7:1. The audit counts these:
  1,764 of 7,488 measured elements were between 4.5:1 and 7:1 on 2026-10-17;
- Apple's guidance to follow the system appearance rather than offering an
  in-app theme picker. The picker is inherited from the Swift app, so changing
  it is a product decision, not a contrast fix.

## Enforcement

```bash
cd web && npm run test:visual   # ~3 minutes, WebKit via Playwright
```

For all six themes, at phone and desktop width, the suite drives every UI
state (welcome, first-launch dialog, the whole document, search, all four
Preferences tabs, file browser). It fails on:
- any text under 4.5:1 (3:1 if large) or any icon under 3:1, measured against
  the real rendered background;
- any control that's off-screen or covered;
- any JS error or failed load.

Screenshots of every state land in `web/visual-output/` for a human look.
Run it after **any** CSS, theme or Mermaid/Shiki change.

## Sources

- W3C, WCAG 2.2 — SC 1.4.3 Contrast (Minimum), SC 1.4.6 Contrast (Enhanced),
  SC 1.4.11 Non-text Contrast; summarised by
  [WebAIM](https://webaim.org/articles/contrast/) and
  [Stark](https://www.getstark.co/wcag-explained/perceivable/distinguishable/contrast-minimum/).
- Apple, [Human Interface Guidelines — Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode).
- Apple, [App Store Connect — Sufficient Contrast evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria).
- Myndex, [APCA introduction](https://github.com/Myndex/apca-introduction)
  (WCAG 3 draft; not a standard yet).
- Material-derived dark-theme practice, via
  [Atmos](https://atmos.style/blog/dark-mode-ui-best-practices) and
  [Uxcel](https://uxcel.com/blog/12-principles-of-dark-mode-design-627).
- Palettes: [Solarized](https://ethanschoonover.com/solarized/),
  [Nord](https://www.nordtheme.com/docs/colors-and-palettes),
  [Dracula](https://draculatheme.com), GitHub
  [Primer](https://primer.style/foundations/color).
