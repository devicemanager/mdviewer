# MDViewer — TypeScript port

Porting the shipped macOS app (Swift/SwiftUI + WKWebView, v1.2.1) to
TypeScript, targeting 5 platforms: macOS, Windows, Linux, Android, iOS.

**Host: Tauri 2** (Rust core + the OS's system webview), decided 2026-09-06
specifically because it's the one host in this table that reaches all 5
platforms — Electron is desktop-only (no iOS/Android) and was the original
choice before the mobile targets were confirmed. If the platform list or the
host changes again, the host-glue section below is wrong — stop and ask
before continuing.

The Swift tree is the reference implementation. Do not modify it.
Behaviour parity with v1.2.1 is the goal, not improvement — for now. This is
a stabilization measure for the transition itself, not a permanent verdict
on the Swift app's design: known issues and improvements (some inspired by
mdviewer.org) are deliberately deferred until the TypeScript port has a
working version across all 5 target platforms. Keep flagging deviations you
find; don't block on them or feel obliged to revert reasonable fixes already
made during porting.

## Source of truth

- Swift source and `Resources/Web/**` are authoritative.
- `docs/development/architecture.md` has drifted from the implementation
  (PDF export, sandbox, sanitization, theme count). Do not trust it.
  Read the Swift.
- `docs/project/changelog.md` is accurate. Use it to understand why
  something is the way it is before changing it.

## What does not get ported

`Resources/Web/**` is mostly already JavaScript and CSS and moves across
unchanged: `renderer.html`, `mdviewer-base.css`, `vendor/*`, `themes/*`.
Do not rewrite these, do not "modernise" them, do not swap library versions.

**Exception — themes (2026-10-17, at the user's explicit request after a
real-device contrast report):** `themes/*` now define a shared token
contract (`--bg-color`, `--surface-color`, `--text-color`, `--muted-color`,
`--link-color`, `--accent-bg`/`--accent-fg`, …) that `app.css` reads, with
every text pair at WCAG 2.2 AA. `solarized-light.css`, `solarized-dark.css`
and `nord.css` were added: those themes were listed in Swift's
`MarkdownTheme.swift` but the files never existed (404 in v1.2.1 too).
`npm run test:visual` (web/) checks all of it in WebKit — run it after any
CSS or theme change. `mdviewer-base.css` and `renderer.html` are still
untouched; port-only overrides live in `app.css`.

`mdviewer.js` was the exception (decided 2026-09-06): it was rewritten in
TypeScript under `web/src`, one concern per change, and now **is**
`MDViewer/Resources/Web/mdviewer.js` — `web`'s build step
(`npm run build` in `web/`) compiles directly to that path and reached
parity 2026-09-09, replacing the hand-written file for good (see
`plan.md`'s Milestone D). Editing `MDViewer/Resources/Web/mdviewer.js`
directly is a mistake now; it gets silently overwritten by the next
`web/` build. The source of truth for renderer behavior is `web/src/*.ts`.
Vendor libraries stay pinned globals loaded by `renderer.html` — the
TypeScript calls `marked`/`shiki`/`katex`/`mermaid`/`DOMPurify` as globals,
it does not reimplement or bundle them.

Pinned: marked 18.0.6, Shiki 4.3.1, KaTeX 0.18.11, Mermaid 11.17.2,
DOMPurify 3.4.17. Version bumps are otherwise a separate task — Mermaid
and DOMPurify were bumped 2026-09-07 specifically to close known
vulnerabilities (below), at the user's explicit request; DOMPurify and
KaTeX again 2026-10-17 when `npm audit` reported new advisories (below),
under the same standing "don't distribute CVEs" instruction.

**Security fixes applied (2026-09-07):**

- **DOMPurify 3.4.12 → 3.4.15.** The pinned version had a moderate XSS
  advisory, GHSA-55q2-fjhq-7xh7 ("IN_PLACE hook removal leaves a detached
  subtree executable"). `MDViewer/Resources/Web/vendor/dompurify.min.js`
  is DOMPurify's own stock `dist/purify.min.js` UMD build — swapped for
  3.4.15's, byte-identical in structure, verified by loading it as a
  `<script>` in jsdom (matching how `renderer.html` actually loads it) and
  confirming `sanitize()` still behaves as `sanitize.ts`'s tests expect.
  `web/`'s test-pinned `dompurify` devDependency bumped to match; `npm
  audit` in `web/` is now clean.
- **Mermaid 11.16.0 → 11.17.2.** The pinned version had five moderate
  advisories: prototype pollution in the config APIs and in Architecture
  diagrams, CSS injection affecting sibling elements of a diagram, and DoS
  bugs in XY Charts and radar diagrams (GHSA-c4c3-pg64-4m4v,
  GHSA-3rrr-jr9j-h3q3, GHSA-6x64-9x62-f2gx, GHSA-2v8p-3f2j-5mp7,
  GHSA-rhh3-jpg6-66xh). `MDViewer/Resources/Web/vendor/mermaid.min.js`
  turned out to be mermaid's own stock `dist/mermaid.min.js` build too
  (confirmed byte-identical to a fresh 11.16.0 install before swapping) —
  same drop-in approach as DOMPurify, verified the same way (loads as a
  `<script>`, exposes `.initialize`/`.run`). This was a minor version
  bump, not a patch, so it carried more behavioral-change risk than
  DOMPurify's. Manual verification: 2026-09-08, a `graph LR` flowchart
  rendered correctly in the real desktop Tauri app alongside tables,
  task lists, KaTeX math, Shiki-highlighted code, emoji shortcodes, and
  a DOMPurify sanitization check, user-confirmed visually — only one
  diagram type at that point, though. Closed out 2026-09-09, through the
  now-production compiled pipeline (Milestone D's flip): sequence,
  class, and state diagrams all confirmed rendering correctly too
  (`docs/project/screenshots/mermaid-diagram-types*.png`,
  `mermaid-state-diagram.png`). The Mermaid version bump is fully
  verified across diagram types now, not just the one.

**Security fixes applied (2026-10-17):** `npm audit` in `web/` reported new
advisories against two shipped libraries; bumped under the same standing
instruction, verified byte-identical against both the npm tarball and the
jsDelivr CDN, hashes in `supply-chain.md`.

- **DOMPurify 3.4.15 → 3.4.17** — GHSA-p98j-92pf-mc4p and
  GHSA-6688-9rhm-gjv2, both low and both in `IN_PLACE` mode only, which
  `sanitize.ts` never uses (it sanitizes strings) — not exploitable here,
  bumped anyway. Note Mermaid's stock build bundles its *own* DOMPurify
  (3.4.12); Mermaid only calls `sanitize(string)`, so the `IN_PLACE`
  advisories don't reach it either.
- **KaTeX 0.17.0 → 0.18.11** — GHSA-238p-pmpm-9mq7 (low; needs a
  pre-existing prototype pollution to bypass `trust`). `katex.min.js` and
  `katex.min.css` swapped; the 20 vendored fonts are byte-identical across
  the two versions, so unchanged. Verified by the unit suite and the visual
  audit (KaTeX inline + block render in every theme).
- `source-map-js` (high) is a build-time dependency of the test tooling,
  never shipped; left to a routine `npm audit fix`.

**Known follow-up, not done:** `MDViewer/App/MDViewerApp.swift`'s About
panel Credits text hardcodes library versions. It was evidently updated after
the 2026-09-07 bumps (it reads Mermaid 11.17.2 / DOMPurify 3.4.15 as of
2026-10-17, contrary to this note's earlier wording), but the 2026-10-17
bumps leave it stale again: it still says KaTeX 0.17.0 and DOMPurify 3.4.15.
The TypeScript port's `aboutPanel.ts` is current and test-pinned to the
vendored versions. Left alone deliberately: that's Swift source, not a vendored asset,
and the version-bump authorization was about the libraries themselves, not
license-text UI. `THIRD_PARTY_NOTICES.md` and
`supply-chain.md` are already updated to the new versions.

## Out of scope

- The Quick Look extension. No Tauri equivalent; it stays Swift or is dropped.
- Native (OS-level) window tabs, `NSDocumentController` recent files. (An
  app-managed single-window/multi-tab document model is a different,
  Phase-2 idea — see `plan.md` — not this.)
- New features. Parity first.

## Host glue — Swift to Tauri 2

Desktop (macOS/Windows/Linux) and mobile (Android/iOS) share the same Rust
core and the same web frontend (`web/`); host-glue commands live in the
Tauri app's Rust crate (`src-tauri`) and are called from the frontend via
`@tauri-apps/api`. Flag anything in this table that turns out to need a
per-platform (not just per-OS-family) implementation — mobile sandboxing in
particular may force a split that isn't visible yet.

| Swift | Tauri 2 |
|---|---|
| `FileWatcher` (DispatchSource kqueue, 0.5s debounce) | Rust `notify` crate in a Tauri command, keep the 0.5s debounce, events pushed to the frontend via `emit` |
| `LocalSchemeHandler` (`mdviewer-local://`) | Custom URI scheme registered on the Tauri builder (`register_uri_scheme_protocol`), or the scoped `asset:` protocol |
| `BookmarkManager` (security-scoped bookmarks) | Persisted folder grants via a Tauri store/plugin (e.g. `tauri-plugin-store`); mobile has no security-scoped bookmarks, so granted access there is via each platform's document-picker persisted-URI mechanism instead — needs its own decision when Milestone B starts |
| `ExportViewModel` PDF (`NSPrintOperation.runModal`) | Native on macOS/iOS (PDFKit / `UIGraphicsPDFRenderer`); Windows/Linux/Android approach undecided — open question, see "Open questions" in `plan.md` |
| `NSSavePanel` / `NSOpenPanel` | `@tauri-apps/plugin-dialog` save/open |
| `WKScriptMessageHandler` bridge | `invoke` (frontend → Rust commands) and `listen`/`emit` (Rust → frontend events) via `@tauri-apps/api` |

## Security invariants — do not relax

These were added deliberately in 1.2.0. Carry each one across:

- Renderer is served over a custom scheme, never `file://`.
- Strict CSP enforced (via Tauri's `app.security.csp` in `tauri.conf.json` —
  the mechanism differs from a literal response header, the guarantee
  doesn't).
- All rendered Markdown passes through DOMPurify before insertion.
- Links restricted to `http`, `https`, `mailto`, and local `.md`.
- Remote images gated by the Ask / Always / Never policy.
- Local image access is per-folder and explicit, never whole-disk.

**Known gap (2026-09-08):** the last two aren't actually enforced in the
Tauri build yet. There's no App Sandbox entitlement of any kind configured
(`tauri.conf.json`, `Cargo.toml` — nothing), so every file read today works
only because there's no sandbox restricting it, not because access is
correctly scoped. `BookmarkManager.swift`/`FolderAccessManager`'s two-tier
model (automatic single-file, explicit opt-in per-folder, no whole-disk
tier — see `plan.md`'s Milestone B) needs porting *and* the app needs
actual sandbox entitlements before this invariant is genuinely met, not
just "works because nothing stops it."

## Deliberate simplification

Swift parses each document twice — `swift-markdown` for the TOC, marked for HTML.
In TypeScript, derive the TOC from `marked.lexer()` so both come from one parse.
Slugs must match the anchors the renderer emits. This removes the only SPM
dependency; do not reintroduce a second parser.

**No `evaluateJavaScript`-style string building** (decided 2026-09-06,
while starting `RenderViewModel`). Swift's `RenderViewModel` builds and
escapes JS-source strings (`escapeForJS`) to call into the WKWebView from
a separate native process — `MDViewer.setContent('\(escaped)')` via
`webView.evaluateJavaScript`. The assumption for this port is that the
whole UI (toolbar, sidebar, content) lives in one Tauri webview alongside
`mdviewer.js`, so `RenderViewModel`/`DocumentViewModel`/`SidebarViewModel`
port to TypeScript in `web/` (per Conventions, below) and call
`window.MDViewer.*` directly as plain function calls — no string
serialization, no escaping, and consequently no `isRendererReady`
pending-call queue either (there's no cross-process load race when it's
all one page). Rust stays limited to what genuinely needs OS access
(Milestone B) plus the app shell (Milestone A).

This rests on an architecture default Milestone E hasn't formally decided
yet — single webview for the whole app, not native chrome around a
content-only webview. If Milestone E goes a different way (e.g. separate
webviews for chrome vs. content), this section needs revisiting; flag it
rather than silently re-adding the eval/escape/queue machinery.

## Conventions

- TypeScript strict, ESM, Node 22 — for the `web/` frontend (renderer logic,
  ported models/view models).
- Host-glue commands (Milestones A/B) are Rust in the Tauri app's
  `src-tauri` crate. No Rust style conventions decided yet; settle them when
  that work starts rather than guessing here.
- Swift optionals become `T | undefined`. Never `null`.
- Swift structs become interfaces and plain objects, not classes.
- One Swift file maps to one module of the same name in camelCase.
- vitest. Port `MDViewerTests` alongside the code under test.

## Working agreement

- One file per change. Do not port a directory in a single pass.
- If the Swift does something that looks wrong, say so — do not silently fix it.
  Several oddities (print-based PDF, custom scheme handler) are workarounds for
  real bugs and must be preserved in spirit.
