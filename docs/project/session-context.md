# Session context — for picking this up cold

**Written 2026-10-17**, replacing the 2026-10-07 version (its arc is fully
absorbed into `plan.md`/`file-browser-plan.md` — nothing durable was lost).
This file exists so the *next* session — on whatever model or account picks
it up — doesn't re-derive any of this from scratch. It complements, not
replaces, two other files:

- **`docs/project/file-browser-plan.md`** — the technical plan: what's
  built, what's tested, what's left. Read this first for "what do I work on
  next." Its section 5 carries the build/verification gotchas.
- **The OTA distribution server's own README** — lives outside this repo
  (don't re-leak this machine's LAN IP/tunnel hostname into git).

## Where things stand right now

`HEAD` is `93acd6b`, this doc update landing right after. Working tree
clean. **94 Rust tests, 227 web tests, `tsc --noEmit` clean**, all green.

1. **Toolbar-fade dead-tap bug fixed** (`14bff30`). The 2026-10-07 session
   flagged it with two fix options; the user chose both: no fade when
   `#main` can't scroll, and the faded toolbar stays tappable — a tap
   reveals it (that first tap swallowed), the next one acts. Verified on
   the device-matched simulator in debug *and* release builds.

2. **iOS release builds unblocked** (`5998aa9`, Tauri 2.11.5 → 2.12.4,
   lockfile-only). Root cause: swift-rs's Swift-side `@_cdecl` exports
   were `internal` up to its 1.0.7 tag (Xcode 27's optimized build makes
   them local), and tauri 2.11.5 pinned SwiftPM to that tag via a shipped
   `Package.resolved`. Release device archive builds; a release simulator
   build ran end to end (startup restore, Shiki/KaTeX/Mermaid, browser).
   The export step still needs the zip-the-`Payload` workaround.

3. **USB debugging is not available — confirmed by the user, and they
   want to keep developing over OTA.** So the app now writes its own log
   (`4bd5f18`, `93acd6b`): `Documents/mdviewer-debug.log`, visible in
   Files → On My iPhone → MDViewer, with startup breadcrumbs, Rust panics
   and forwarded JS errors. Verified on the simulator, including a
   deliberate panic and JS error (temporary, removed before commit).

4. **A diagnostic OTA build is live** (debug archive at `93acd6b`,
   md5-verified through the tunnel). Its instructions say to install
   *over* the existing app, not delete first, so any state that triggers
   the crash survives. Waiting on the user to install it and send back
   `mdviewer-debug.log` plus any `MDViewer-*.ips` from Analytics Data.

## What's next

- **Read what the user sends back** from the diagnostic build: the last
  line of `mdviewer-debug.log` before a crash says which startup step it
  died in; an `.ips` names the faulting thread/frame for native crashes.
  If the app *doesn't* crash with this build, that's information too
  (the old one was built before the Tauri 2.12.4 bump).
- **Release build over OTA** is now possible and a cheap next experiment
  if debug keeps crashing (debug vs. release differ in exactly the
  swift-rs/optimizer area just fixed).
- **Real-device pass of the grant flow** + §2b's `read_dir` spike (code
  kept for it) — needs the phone.
- **Noticed, pre-existing, not fixed**: the file browser offers
  `.. (up one level)` at a grant's root, and following it lands on
  `access_denied: outside the document's folder and no folder has been
  granted` — a dead end the UI invites. Small, but a design call (hide the
  row at the root vs. show a friendlier message).
- If the phone stays unreachable: `file-browser-plan.md` §3/§4 (Android
  `content://` gap, security-scope lifetime gap, desktop never verified,
  sandbox entitlements still absent).

## Patterns worth repeating

Every real bug this project finds is found by *running the thing*. This
session adds two corollaries:

- **Check what SwiftPM actually resolved, not what Cargo says.** The
  swift-rs *crate* version was irrelevant to the release link failure;
  the Swift code came from a git tag pinned by a `Package.resolved` inside
  the tauri crate. `workspace-state.json` in the build dir tells the truth.
- **The a11y tree reports the drawer's rows at identical bounds open or
  closed**, so it can't tell you drawer state; and separate `maestro test`
  runs take seconds to start — long enough for the toolbar to fade again
  between taps. Put multi-tap interactions in one flow, and judge visual
  state from clock-checked screenshots.
