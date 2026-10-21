# MDViewer TypeScript port — plan

Living progress tracker for the Swift → TypeScript/Tauri port, targeting 5
platforms (macOS, Windows, Linux, Android, iOS). Rules and conventions live
in `porting-brief.md`; history and rationale for past decisions live in
`changelog.md`. This file just tracks what's left, in what order, and gets
pruned into the changelog as milestones complete.

## Status snapshot (2026-09-06)

- `web/` TS workspace scaffolded: vitest, `tsc --strict`, and an esbuild
  `build` script bundling `web/src` to `web/dist/mdviewer.js` (IIFE).
- Milestone D: 7 of `mdviewer.js`'s concerns ported (`dom.ts`, `emoji.ts`,
  `math.ts` incl. restore, `remote.ts`, `localResources.ts`, `sanitize.ts`,
  `markedRenderer.ts`). Remaining: `highlightCode` (blocked on the Shiki
  question), Mermaid, the public `window.MDViewer` API that assembles all
  of this, the Tauri bridge swap, scroll/link listeners. 76/76 `web/` tests
  passing, `tsc --noEmit` and the esbuild bundle both clean. `marked`,
  `dompurify`, and `katex` are pinned exact-version devDependencies for
  testing only — not bundled into `web/dist/mdviewer.js` (verified).
- Host decided as Tauri 2, not Electron — Electron can't reach the mobile
  targets. Minimal shell boots (`src-tauri` crate at the repo root, window
  creation verified via `npm run tauri dev`, serving the untouched
  `MDViewer/Resources/Web` over Tauri's own protocol, never `file://`), and
  the vendored render pipeline (`marked`, KaTeX, DOMPurify) confirmed working
  unmodified under Tauri. Open/Save/Save As all work against real files,
  relative image paths resolve via a real `mdviewer-local://` scheme
  handler, the CSP matches `renderer.html`'s exactly, and external edits to
  the open file are picked up and re-rendered via a debounced
  `FileWatcher` port (Milestones A & B) — all tested headlessly with
  `tauri::test::mock_app()`, 30 `cargo test` cases total, no window, no
  dialog click, no visible screen needed.
  **Known gap, not just unfinished work:** the app has zero sandbox
  entitlements — every file access today works only because nothing
  restricts it, not because it's correctly scoped; see the Security
  invariants note in `porting-brief.md` and Milestone B's
  `BookmarkManager`/`FolderAccessManager` item. Also not yet done: the rest
  of the command/event bridge (no recent-files, no reload-on-change, no
  restoring the last document at launch), and mobile (`android`/`ios init`
  not run).
- Milestone C: 2 of 7 Swift files ported as new `web/` modules
  (`markdownTheme.ts`, `renderViewModel.ts` + `toc.ts` for the
  `marked.lexer()` TOC item), 2 more determined to need no dedicated port
  (`MarkdownDocument.swift`, `HTMLBuilder.swift` — see Milestone C for why),
  1 nearly done (`SidebarViewModel.swift`'s TOC extraction is ported, only a
  trivial single-case-enum persistence bit remains), 1 deferred
  (`DocumentViewModel.swift`, mostly Milestone B glue). 58/58 `web/` tests
  passing. One real anchor bug found and fixed in the shipped app along the
  way (a second suspected one didn't hold up under verification and was
  retracted) — see the `marked.lexer()` TOC item for detail.

## Open questions (host-enabled)

Decisions the Tauri switch opened up. Neither blocks the host choice
itself, but each changes what a later milestone should actually build, so
resolve before starting the item it affects.

- **PDF export approach, non-Apple platforms** (affects Milestone B,
  unresolved). macOS/iOS have native PDF generation (PDFKit /
  `UIGraphicsPDFRenderer`) reachable from Rust — straightforward there.
  Windows, Linux, and Android need research: check each platform's
  underlying webview for a built-in print-to-PDF path before reaching for
  a standalone crate — WebView2 has `PrintToPdfAsync` on Windows,
  Android's WebView integrates with the system `PrintManager`'s "Save as
  PDF". WebKitGTK on Linux is unclear; needs checking. Fall back to a
  Rust PDF crate only where no native path exists.
- **Syntax highlighting engine** (affected Milestone D's `highlightCode`
  item — **resolved 2026-09-08, in favor of Shiki as-is**, before
  starting that item, per this note's own instruction). The Rust-backend
  alternative this note originally raised — `syntect`, invoked as a
  command, dropping `wasm-unsafe-eval` from the CSP — is still a real,
  worthwhile improvement, just not a parity-work blocker: see the
  `highlightCode` entry in Milestone D below for the full reasoning
  (porting-brief.md's vendor-globals architecture already named Shiki
  specifically, and `window.__shikiReady` was confirmed actually working,
  not dead code, before relying on it). Revisit `syntect` post-Phase-1 if
  the CSP relaxation is worth the re-theming and IPC cost.

## Phase 1 — port to parity (current phase)

Strict behaviour parity with the shipped Swift v1.2.1 app, per
`porting-brief.md`. Flag deviations found along the way; don't block on them.

### Milestone A — Tauri app shell

- [x] Root Tauri 2 scaffold: `src-tauri` Rust crate, `tauri.conf.json`,
      root `package.json` with `@tauri-apps/cli` (2026-09-06). `frontendDist`
      currently points at `MDViewer/Resources/Web` as-is — correct for now
      per the "don't overwrite mdviewer.js early" rule.
      **Correction (2026-09-08):** this note originally said to "repoint
      `frontendDist` to `web/dist` once at parity" — wrong, caught while
      actually starting Milestone D's final item. `web/dist` only ever
      contains the compiled `mdviewer.js`, never `renderer.html`/
      `vendor/*`/`themes/*`/`mdviewer-base.css`, so pointing
      `frontendDist` there directly would break the app (nothing to serve
      renderer.html from). CLAUDE.md already says what actually happens,
      correctly: `web`'s build step compiles *directly to*
      `MDViewer/Resources/Web/mdviewer.js`. `frontendDist` never changes
      at all — only the build's `--outfile` does, from the current safe
      staging location (`web/dist/mdviewer.js`, so a partial/broken build
      can never clobber the authoritative file) to the real one, once
      Milestone D's port is verified at parity. Not flipped yet — see
      that item below for why.
- [x] Window creation, renderer loaded over a custom scheme — never `file://`
      (2026-09-06, verified: `cargo check` clean, `npm run tauri dev` boots
      and stays up with no errors in the log — Tauri's own asset protocol,
      not `file://`). Window content is currently blank since nothing calls
      `MDViewer.setContent` yet; that's expected at this stage.
- [x] `mdviewer-local://` custom scheme (2026-09-08), replacing
      `LocalSchemeHandler.swift`: `register_uri_scheme_protocol` in
      `src-tauri/src/lib.rs`, resolving requests against a `DocumentBaseDir`
      managed-state directory (set by `render_file` — see the `NSOpenPanel`
      item above — to the opened file's parent). Ported both real bugs found
      and fixed in the Swift original (see `LocalSchemeHandlerTests.swift`
      and this file's own `resolve_local_path` tests): the traversal check
      now `canonicalize()`s both sides before comparing, same fix shape as
      Swift's. The *other* Swift bug — `hasPrefix` on raw strings accepting
      a sibling directory like `/Web-evil` as if it were inside `/Web` —
      doesn't exist here at all: `Path::starts_with` is component-wise,
      verified empirically before relying on it. 9 new `cargo test` cases
      (`resolve_local_path`, `mime_type_for`), all headless.
- [x] Strict CSP via `app.security.csp` in `tauri.conf.json` (2026-09-08) —
      set to the exact same policy string as `renderer.html`'s meta tag
      (byte-identical, not just equivalent), so both stay active
      redundantly rather than one replacing the other; `renderer.html`
      itself is unmodified, per the "moves across unchanged" rule.
      Verified `generate_context!()` (which parses this at compile time)
      still builds clean.
- [x] Command/event bridge exposing the `WKScriptMessageHandler`
      equivalents. **Re-scoped (2026-09-08)** after re-reading
      `WebRendererView.swift`'s `Coordinator` against the single-webview
      decision above ("No `evaluateJavaScript`-style string building"):
      most of the six message names don't need a Rust bridge at all.
      `headingsExtracted` (→ sidebar TOC), `renderComplete` (a no-op in
      Swift too — `handleRenderComplete()` is empty), and
      `scrollPositionChanged` (also currently a no-op in Swift — the
      `case` just `break`s) are pure UI state that will live entirely in
      `web/src` once Milestone D builds the `window.MDViewer` surface;
      routing them through `invoke`/`emit` would add an IPC hop the
      single-webview architecture exists to avoid. `linkHovered` is the
      same — status-bar text is a DOM update, no OS access needed.
      Only two of the six genuinely need Rust: `linkClicked`, when the
      target is a local `.md`/`.markdown` file (switch the "current
      document" — reuses `render_file`'s state/watcher logic) or an
      `http`/`https`/`mailto` URL (needs an OS call to open the system
      default handler — JS can't do that itself); and
      `remoteContentBlocked`'s "Always Allow" choice, which needs to
      persist a preference outside the page (Swift: `UserDefaults`) —
      the "Load"/"Don't Load" choices themselves are in-page state.
      **Still blocked**, not just unstarted: none of this is callable
      until Milestone D swaps `mdviewer.js`'s
      `window.webkit.messageHandlers.*.postMessage(...)` calls for
      something Tauri actually provides — confirmed by reading
      `mdviewer.js` directly (2026-09-08): every one of the six calls is
      guarded by `if (window.webkit && window.webkit.messageHandlers &&
      ...)`, so right now, under Tauri, all six are silent no-ops. This
      is a real functional gap today (sidebar TOC never populates, link
      clicks do nothing, hover status never shows, the remote-content
      prompt never fires) — expected at this stage of the port, not a
      regression introduced this session, but worth naming rather than
      leaving implicit. One thing this rules out as unnecessary: Swift's
      `decidePolicyFor`/`createWebViewWith` navigation-interception
      duplicate the link-click logic as defense-in-depth for navigations
      JS doesn't catch; `mdviewer.js`'s click handler already calls
      `e.preventDefault()` unconditionally for every non-fragment link
      before checking `window.webkit` at all, so real browser navigation
      never happens regardless of transport — no Rust-side navigation
      interceptor is needed to match this, just the two `invoke` calls
      above once Milestone D reaches them.

      **Both `invoke` commands landed (2026-09-08)**, unblocked by
      Milestone D's `interactionListeners.ts`/`mdviewerApi.ts` completing
      first. `handle_link_click` (`src-tauri/src/lib.rs`): scheme
      dispatch split into a pure `classify_link` (→ `LinkAction::
      OpenLocalDocument`/`OpenExternal`/`Ignore`) purely for testability
      — `app.opener()` panics under `tauri::test::mock_app()` unless the
      opener plugin is actually registered, and registering it for real
      in a test would risk actually launching a browser/mail client, so
      the OS-touching dispatch itself stays thin and untested, same
      pattern as `open_document`'s dialog call. Added
      `tauri-plugin-opener` (already resolved transitively at 2.5.5, so
      this promotes an existing version rather than introducing a new
      one) and the `url` crate (same — already in `Cargo.lock` at 2.5.8
      via other dependencies) for `Url::parse`/`.to_file_path()`.

      **Found a real, shared limitation while building this, not
      assumed**: confirmed by reading `mdviewer.js` directly that it sets
      no `<base>` element, so a *relative* markdown link
      (`[other](other.md)`) resolves its `.href` against the page's own
      origin (`tauri://localhost/other.md` on desktop, `http://
      tauri.localhost/other.md` on Android) — never a real filesystem
      path, never matching `classify_link`'s `file://` check here, and
      never matching Swift's own `url.scheme == "file"` check either.
      Relative document-to-document links do not actually work as
      navigation in *either* version, only an absolute `file://` URL a
      document author wrote explicitly would. Preserved as-is, not
      silently fixed beyond parity; covered by its own test
      (`classify_link_a_relative_markdown_link_resolved_to_the_page_origin_is_ignored`).

      `set_remote_content_policy_always` (the other genuinely-Rust
      piece): persists to a plain text file in
      `app.path().app_config_dir()` (no `UserDefaults` equivalent in
      Rust/Tauri, and one string doesn't justify a full key-value-store
      plugin) rather than the actual system config directory during
      tests — split into `read_remote_content_policy_from`/
      `write_remote_content_policy_always_to` (pure, path injected) plus
      thin `AppHandle`-resolving wrappers, so `cargo test` never touches
      real user files, same split as `write_document`/`save_document`.
      Also wired the *read* side into `render_file`/
      `reload_current_document` — pushing `setRemoteContentPolicy`
      before every `setContent`, matching `RenderViewModel.
      renderMarkdown()` calling `applyRemoteContentPolicy()` immediately
      beforehand — without this, a persisted "always"/"never" choice
      would have nowhere to actually take effect, so this wasn't optional
      scope creep, just the other half of "persist a preference" actually
      mattering.

      19 new `cargo test` cases (57 total in `src-tauri`), all headless.
      Verified the new dependencies don't break the Android build either
      (`cargo tauri android build --debug` still succeeds).
- [x] iOS confirmed (2026-09-08); Android not attempted — no SDK/NDK
      installed in this environment (no `ANDROID_HOME`, no `adb`), a much
      bigger install than iOS needed (Xcode 26.6 with the iOS 26.5 SDK was
      already present; only `rustup` plus the `aarch64-apple-ios`/
      `-ios-sim`/`x86_64-apple-ios` targets were missing). Deferred rather
      than done — the user chose iOS-only for this pass.

      `cargo tauri ios init` generated the Xcode project cleanly
      (`src-tauri/gen/apple`, gitignored — already covered by the repo's
      existing `/src-tauri/gen/` rule). First build attempt failed with a
      real, useful finding: `tauri::menu` (so a native File menu) and
      `FileDialogBuilder::{pick_folder, blocking_pick_folder}` are both
      `#[cfg(desktop)]`-only in Tauri/`tauri-plugin-dialog` — no menu bar
      and no folder-picker API exist on mobile at all, not just untested
      ones. This directly hits code from this session: the File menu
      wiring `open_document`/`save_document`/`save_document_as` to menu
      items, and the `request_folder_access` command just added for
      `GrantedFolders`. Fixed by `#[cfg(desktop)]`-gating the menu
      construction and the `blocking_pick_folder` branch of
      `request_folder_access` (falls back to `false` — "not granted" — on
      mobile) in `src-tauri/src/lib.rs`; `cargo test` (38 desktop tests)
      still fully green after. **Real, load-bearing gap this confirms, not
      a hypothetical:** on mobile there is currently *no* trigger at all
      for opening or saving a document — no menu, no `invoke`-based
      command either yet. Milestone D/F needs to expose Open/Save/Save As
      (and a mobile-appropriate substitute for folder access — Tauri's
      dialog plugin has no folder picker on mobile to build on) as
      `invoke` commands the web UI can call, not just the two link-click
      cases the "Command/event bridge" re-scoping above already flagged.
      This also means the desktop menu items are no longer the *only*
      reasonable way to trigger Open/Save even on desktop — worth
      reconsidering once that command surface exists, rather than running
      two parallel trigger mechanisms indefinitely.

      With the crate compiling for `aarch64-apple-ios-sim`, `cargo tauri
      ios build --target aarch64-sim --debug` succeeded
      (`gen/apple/build/arm64-sim/MDViewer.app`). Verified headlessly, no
      screenshot: installed and launched on a booted iPhone 17 simulator
      via `xcrun simctl install`/`launch`, confirmed still running after a
      few seconds with no crash report, then read the simulator's own
      unified log (`xcrun simctl spawn <udid> log show`) and found
      multiple resources served through a WebKit URL scheme handler
      (`WebURLSchemeTaskProxy` / `schemeHandler=3` entries) and the main
      frame reaching `didFinishLoadForFrame` with
      `DidFirstVisuallyNonEmptyLayout`/`DidFirstMeaningfulPaint`
      milestones. **Correction (2026-09-08, caught doing the Android
      check below):** this log evidence does not actually distinguish
      which of the two scheme handlers this app registers — the custom
      `mdviewer-local` one (`register_uri_scheme_protocol` in `run()`) or
      Tauri's own built-in `frontendDist` protocol handler that serves
      `renderer.html` itself. It can't have been `mdviewer-local`: no
      document was open (`DocumentBaseDir` was `None`), and
      `handle_local_scheme_request` 404s immediately in that case — so
      the *successful* loads seen must have been Tauri's own handler.
      `mdviewer-local` itself stays functionally unverified on mobile
      until something can actually open a document there, same gap the
      "no invocation path on mobile" finding above already names. Same
      frontend as desktop either way, same Rust core, no code fork
      required to get this far — just don't cite this as evidence for
      the custom scheme specifically.
- [x] Android confirmed (2026-09-08, same pass, user opted to also set
      this up after seeing the iOS result). Nothing needed installing —
      Homebrew already had a full SDK at
      `/opt/homebrew/share/android-commandlinetools` (4.4GB: NDK 27.1,
      platforms 35/36, build-tools, `adb`) and OpenJDK 17/26, just not
      wired up (`ANDROID_HOME`/`JAVA_HOME` unset, nothing on `PATH`) —
      same "already there, just not linked" shape as the `rustup`
      discovery for iOS. Only a system image
      (`system-images;android-35;default;arm64-v8a`, arm64 chosen to run
      at native speed under Apple Silicon's Hypervisor.framework instead
      of translated x86_64) needed downloading, after checking disk space
      first per the user's request — the machine's actual free space
      turned out to be ~100GB, not the ~6GB `df` first reported (APFS
      purgeable-space accounting understated it).

      Added the four Android Rust targets via `rustup`. `cargo tauri
      android init` and `cargo tauri android build --debug --target
      aarch64` both succeeded on the **first** attempt — the
      `#[cfg(desktop)]` gating added for iOS already correctly excludes
      the same code on Android too (`tauri::menu` and
      `blocking_pick_folder` are gated on the same `desktop` cfg for both
      mobile platforms, not iOS-specific). Build warnings confirm the
      same mobile gap the iOS pass found: `open_document`,
      `render_file`, `save_document`, `save_document_as`, and friends are
      all reported dead code on this target, since only the
      `#[cfg(desktop)]`-gated menu ever calls them.

      Verified on a booted `mdviewer_test` AVD (Pixel-profile-less,
      arm64-v8a, API 35): `adb install` + `adb shell am start`, process
      stayed up. This time got a *positive*, unambiguous confirmation
      rather than absence-of-error-only evidence: forwarded the
      WebView's Chrome DevTools port (`adb forward tcp:9222
      localabstract:webview_devtools_remote_<pid>`) and queried
      `http://localhost:9222/json` — returned the actual loaded page,
      `title: "MDViewer"`, `url: "http://tauri.localhost/renderer.html"`.
      Also pulled a `screencap` (blank white, as expected with no
      document open — same state as desktop/iOS). **Platform detail
      worth keeping**: Android serves the frontend over
      `http://tauri.localhost/`, not a custom scheme like desktop/iOS's
      `tauri://localhost` — a known Tauri/Android WebView constraint
      (custom non-http schemes aren't reliably usable for main-frame
      navigation there). Still not `file://`, still an app-controlled
      origin, so the security invariant holds — but it's a real
      cross-platform origin difference, not a detail to gloss over if
      anything ever needs to reason about same-origin behavior.

      Cleaned up after: forwarded port removed, app force-stopped,
      emulator killed via `adb emu kill`. AVD (`mdviewer_test`) and the
      downloaded system image were left in place rather than deleted —
      cheap to reuse next time, and disk space is no longer a real
      constraint at ~100GB free.
- [x] Cross-platform mobile UI test framework (2026-09-08, user request,
      same pass): installed Maestro (`mobile-dev-inc/tap/maestro`, real
      one — not the Homebrew Cask literally named `maestro`, an unrelated
      "AI agent command center" product; installed via the project's own
      official tap instead). Drives Android through Google's UiAutomator2
      (over `adb`, the same connection used above) and iOS through
      Apple's XCUITest — no extra iOS-side install needed beyond Maestro
      itself for simulator targets.

      Added `tests/maestro/smoke.yaml`: launch, screenshot, stop, against
      the shared `org.devicemanager.mdviewer` identifier (same on both
      platforms — see `tauri.conf.json`). It's a launch-only smoke test
      deliberately, not a richer flow — there's nothing else to assert on
      yet given the "no invocation path on mobile" gap documented above;
      extend it once Milestone D/F gives mobile a way to open a document.
      Verified it actually exercises the real device, not a stub: ran it
      against the booted Android emulator (`maestro test
      tests/maestro/smoke.yaml`, auto-selected the running emulator) and
      then explicitly against the iOS simulator (`maestro --device
      <udid> test ...` — the bare command re-ran against Android again
      since it was still running and got auto-selected; needed the
      explicit `--device` to actually target iOS). Both completed all
      three steps cleanly. Maestro's own per-run output (including
      screenshots) lands in `~/.maestro/tests/<timestamp>/`, outside the
      repo — nothing to commit there.

      Needs `JAVA_HOME=$(brew --prefix openjdk@17)` on `PATH` (same
      keg-only-not-linked situation as the Android SDK/NDK above); analytics
      are on by default upstream, set `MAESTRO_CLI_NO_ANALYTICS=1` to
      disable per the project's general security-conscious posture — not
      done automatically by Maestro's own install, worth remembering
      whenever a flow gets scripted or CI'd.
- [x] Mobile test-document hook, and a real bug it found (2026-09-08, user
      request, same pass: "share documents with the emulator and open
      these in mdviewer"). The honest answer going in: pushing a file
      onto a device/simulator is trivial, but nothing could open it — no
      menu, no `invoke` command, and confirmed by reading them directly
      that neither the generated `AndroidManifest.xml` (only a
      `LAUNCHER` intent-filter) nor the iOS `Info.plist` (no
      `CFBundleDocumentTypes`) declares any document-opening
      capability either. That's Milestone D/F-shaped production work, not
      something to improvise. What's small enough to do now: a test-only
      hook mirroring `ContentView.swift`'s `MDVIEWER_TEST_DOCUMENT_PATH`
      exactly (same env var name, same purpose), added as
      `load_test_document_if_configured` in `src-tauri/src/lib.rs`,
      `#[cfg(debug_assertions)]`-gated so it's compiled out of release
      builds entirely — stricter than Swift's version, which stays
      compiled in and relies only on the env var being unset normally.
      Falls back to a fixed path, `/data/local/tmp/mdviewer_test_document.md`,
      when the env var isn't set: `adb shell am start` can't set a
      launched process's real environment the way `xcrun simctl launch`
      can (via `SIMCTL_CHILD_*`, which Apple documents for exactly this)
      or a desktop test scheme can, so an env var alone doesn't reach
      Android — `adb push` to a fixed path does. `/data/local/tmp` is
      shell-owned and world-readable, outside scoped storage's reach,
      the same spot Android's own instrumentation tooling stages test
      fixtures — confirmed the app's own UID can actually read it via
      `adb shell run-as org.devicemanager.mdviewer cat ...` before
      relying on it.

      **Found a real, general bug while verifying this on Android, not
      just a mobile-specific quirk:** first wired the hook into `.setup()`
      (called it there since that already had `AppHandle` access), and
      `render_file`'s `window.eval` silently did nothing — confirmed via
      Chrome DevTools Protocol (forwarded the WebView's
      `webview_devtools_remote_<pid>` socket, queried
      `document.body.innerText`, got `""`). Root cause: `.setup()` runs
      before the "main" window's *first* real navigation to
      `renderer.html` completes, so the injected
      `if (window.MDViewer) {...}` one-shot check ran in a transient
      blank JS context that got wiped out the moment the real page
      navigated in — never retried, never applied. Fixed two ways
      together: (1) `build_set_content_script` now polls for
      `window.MDViewer` for up to 5s (100×50ms, matching the FileWatcher
      test's own real-world-latency slack) instead of checking once —
      this is a genuine robustness fix to code every other caller
      (`open_document`'s menu action, `save_as_to`) also uses, not
      mobile-only, though those callers never actually hit the race
      since they only fire well after the page has loaded; (2) moved the
      test hook's trigger from `.setup()` to the builder's
      `on_page_load` hook (`tauri::Builder::on_page_load`, fires
      per-navigation from Rust, not a JS-injected event), gated on
      `PageLoadEvent::Finished` and a `once`-style `AtomicBool` guard so
      a later unrelated page load can't re-fire it. Confirmed fixed on
      **both** platforms, not just where the bug was found: pushed a
      real test document, rebuilt, and used the same CDP `innerText`
      check on Android (got the actual rendered text back, not `""`) and
      `SIMCTL_CHILD_MDVIEWER_TEST_DOCUMENT_PATH=<path> xcrun simctl
      launch` on iOS, screenshotting both — headings, paragraph, bullet
      list, bold/italic, inline code all rendered correctly on real
      device webviews, first genuine non-blank mobile render this port
      has produced. `cargo test` (38 desktop tests) still fully green
      throughout; the debug `eprintln!`s used to trace the original
      failure were removed once it was confirmed fixed, not left in.
- [x] Render pipeline sanity check (2026-09-07, superseded 2026-09-08):
      confirmed visually (desktop, macOS) that headings, bold/italic, inline
      code, a fenced code block, and KaTeX math all render correctly under
      Tauri — first real evidence `marked`/KaTeX/DOMPurify work unmodified
      hosted by Tauri instead of WKWebView. Was a throwaway `on_page_load`
      hook `eval`-ing a hardcoded document; replaced by the real "File >
      Open…" flow in Milestone B below, which renders an actual chosen file
      instead.
- [x] Cross-platform baseline screenshots (2026-09-08, user request — "for
      later comparison"). `docs/project/screenshots/document.md`: a richer
      demo document than the render-pipeline check above, covering every
      renderer concern at once — text formatting, nested lists, task
      lists, a table, three fenced code languages (Shiki), inline/block
      KaTeX math, a Mermaid flowchart, emoji shortcodes, and a raw
      `<script>` tag to visually confirm DOMPurify strips it. Rendered on
      all three currently-working platforms via the
      `MDVIEWER_TEST_DOCUMENT_PATH` hook above (desktop directly, iOS via
      `SIMCTL_CHILD_MDVIEWER_TEST_DOCUMENT_PATH`, Android via the fixed
      `/data/local/tmp` fallback), screenshotted to
      `docs/project/screenshots/{desktop,ios,android}-2026-09-08.png`.
      User confirmed the desktop render looked correct before the mobile
      pair was captured to match.

      Desktop's first capture used a full-screen `screencapture -x`,
      which leaked unrelated windows and this very session's own terminal
      content into the image — wrong to keep, deleted immediately.
      Re-captured properly cropped to just the app window using
      `screencapture -R<x,y,w,h>` with exact bounds read from Tauri's own
      `WebviewWindow::outer_position()`/`outer_size()` (a temporary
      `eprintln!` in the debug-only `on_page_load` hook, removed again
      once the coordinates were captured) — sidesteps the Accessibility
      permission `osascript`/System Events would have needed for window
      geometry (not granted in this environment, consistent with the
      screen-recording-permission friction noted earlier this session)
      without ever risking a wider capture again.

- [x] `FileWatcher.swift` → Rust `notify-debouncer-mini` crate (2026-09-08),
      keeping the 0.5s debounce (matches Swift's `debounceDelay`, and
      happens to equal the crate's own default — set explicitly anyway for
      parity-with-source clarity, not coincidence). `watch_file` mirrors
      `start(url:)`: storing a new `Debouncer` in the `FileWatcher`
      managed-state `Mutex` drops (and so stops) whatever was watched
      before, same as Swift's `start()` calling `stop()` first. Wired into
      `adopt_current_document`, shared by `render_file` (open) and
      `save_as_to` (save as) — the two places Swift also (re)starts the
      watcher; a plain `save()` to the same path does not, since it's
      already being watched. On a debounced change, `reload_current_document`
      re-reads the file and pushes `setContent` — no base-dir reset, no
      watcher restart, matching Swift's `reload()`.
      Found and fixed a real bug while writing the test for this: the
      debouncer's event-filter closure compared the fired event's path
      against the *original*, uncanonicalized path passed to `watch_file`.
      On macOS, `notify`'s FSEvents backend reports paths with symlinks
      resolved — `/var/folders/...` (what `std::env::temp_dir()` returns,
      and what a real document path can be too, since `/var` is itself a
      symlink to `/private/var`) becomes `/private/var/folders/...` in the
      event — so the equality check silently never matched and
      `reload_current_document` never fired. Root-caused with a standalone
      throwaway repro (raw `notify-debouncer-mini` watching a temp file
      directly, confirmed the event *does* fire, just with a different
      path than the one requested) before touching the real code. Fixed by
      `canonicalize()`-ing the watched path before comparison — same shape
      of fix as `resolve_local_path`'s traversal check above. 4 new
      `cargo test` cases (30 total), headless — one drives a real
      filesystem write against a real temp file and polls (with a few
      seconds' slack for actual FSEvents latency) for the reload to land,
      the others cover no-op/replacement behaviour without touching disk.
- [ ] `BookmarkManager.swift` + `FolderAccessManager` (same file) → not
      started. Read the real Swift source (2026-09-08) rather than assume;
      the actual model is two tiers, deliberately no third:
      1. Automatic, single file: opening a document via `NSOpenPanel`
         grants that one file, via the `files.user-selected.read-write`
         entitlement — the panel interaction *is* the consent, no separate
         system dialog.
      2. Explicit, opt-in, one folder at a time: `MarkdownRenderView.swift`
         shows an in-app banner ("This document references local images")
         when a document's relative images can't load; its "Grant Folder
         Access…" button calls `FolderAccessManager.requestAccess`, a
         second `NSOpenPanel` in folder-picking mode. Granted access
         persists as a security-scoped bookmark
         (`files.bookmarks.app-scope`), reused automatically for that
         folder or any subfolder (`FolderAccessManager.covers()`) —
         granted once, never re-asked.
      No third tier exists — confirmed by reading `MDViewer.entitlements`
      directly: only `user-selected` and `bookmarks.app-scope` are
      declared, no blanket/protected-folder entitlement. Matches
      porting-brief.md's "never whole-disk" invariant by construction, not
      by convention — worth preserving exactly, not simplifying away.

      **Also confirmed while investigating this:** the Tauri prototype
      currently has *no* sandbox entitlements at all (no `.entitlements`
      file, nothing in `tauri.conf.json`) — every file read today (the
      `NSOpenPanel`-equivalent dialog, `render_file`, the
      `mdviewer-local://` handler) works only because there's no sandbox
      yet to restrict it. That's a real gap against the security invariants
      in `porting-brief.md`, not just an unported feature — until this
      milestone lands *and* the app is actually sandboxed for distribution,
      the Tauri build's access model is strictly looser than the shipped
      app's.

      Security-scoped bookmarks have no cross-platform equivalent, so this
      needs real macOS-specific code. The mobile equivalent (no
      security-scoped bookmarks there) is a separate concern — don't
      conflate the two.

      **`tauri-plugin-scoped-bookmarks` investigated and audited
      (2026-09-10), not yet adopted — a real decision needed before
      writing any code against it.** Confirmed real (crates.io, not a
      typosquat/placeholder): `cargo info` matches the description quoted
      above exactly, doc says it exists specifically to close
      [tauri-apps/tauri#3716](https://github.com/tauri-apps/tauri/issues/3716)
      — persisting Tauri's own allowlist is not the same as persisting the
      macOS sandbox's security-scoped grant, so on relaunch the kernel
      still denies a path Tauri itself still lists as allowed. That's
      exactly this item's own gap.

      Trust signals are genuinely weak, checked via crates.io's API
      rather than assumed from the README: published 2026-08-17 (about
      three weeks before this check), single version (0.1.0), 22 total
      downloads for the Tauri-plugin crate / 120 for the underlying FFI
      crate, single publisher account (`CrispStrobe`) created only three
      weeks before that. No community vetting exists to lean on.

      So the code was read in full instead of judged by reputation —
      both crates are small enough to (`tauri-plugin-scoped-bookmarks`:
      ~286 lines; the underlying `apple-scoped-bookmarks`: ~203 lines),
      fetched directly from crates.io's download endpoint, not installed
      into this project's `Cargo.lock` first. Findings, concern by
      concern:
        - **`build.rs`**: trivial, no network I/O, no code execution
          beyond `tauri_plugin::Builder::new(COMMANDS).build()` —
          standard Tauri-plugin permission-manifest generation, the same
          shape every Tauri 2 plugin's build script has. Build scripts
          are the classic supply-chain injection point; this one has
          nothing to hide behind.
        - **Dependency graph**: `tauri`, `serde`, `serde_json`,
          `thiserror` (all mainstream, heavily-audited) plus the sibling
          `apple-scoped-bookmarks` crate, which itself only depends on
          `objc2`/`objc2-foundation` — the standard, actively-maintained
          Rust↔Cocoa binding ecosystem (used by e.g. Zed's `gpui`,
          `winit`), gated `cfg(any(target_os = "macos", target_os =
          "ios"))`. Not hand-rolled `extern "C"` FFI.
        - **The actual `unsafe` surface** (`apple-scoped-bookmarks::imp`):
          minimal and precisely scoped — `bookmarkDataWithOptions...`,
          `URLByResolvingBookmarkData...`, `startAccessingSecurityScopedResource`/
          `stopAccessingSecurityScopedResource`. Correctly distinguishes
          `WithSecurityScope` (macOS-only creation flag; iOS
          document-picker URLs are already scoped and rejects that flag)
          — matches real, non-obvious Apple platform behavior, not a
          copy-pasted guess. `ScopedAccess`'s `Drop` calls `stop...`
          exactly once, matching Apple's own documented warning (quoted
          in the crate's doc comment) that a leaked
          start/stop pair disables the sandbox extension until relaunch.
          One sequencing comment in particular reads as genuine
          domain understanding rather than boilerplate: `start...` is
          called *before* the `ScopedAccess`/`Drop` guard is constructed,
          specifically so a refusal can't leave an unbalanced `stop()`
          armed with nothing having started.
        - **Error handling**: `AccessDenied`'s message correctly names
          the actual entitlement (`com.apple.security.files.bookmarks.
          app-scope`) and the actual usual cause (bookmark created by a
          differently-signed build) — accurate, specific troubleshooting
          text, not generic. A corrupt or missing store file loads empty
          rather than panicking (own test:
          `corrupt_store_file_loads_empty_rather_than_failing`, with a
          comment naming exactly why: "the user would lose access to
          every folder with no way back except reinstall").
        - **No telemetry, no network calls anywhere in either crate** —
          checked directly, not inferred from the absence of an `http`/
          `reqwest`/similar dependency (there is none).

      **Conclusion: the code itself passes audit. What's unresolved is
      pure provenance/reputation, not a code-quality or safety finding —
      and that's a real decision, not a technical one, so it isn't made
      here.** Two live options, both reasonable: (a) adopt the crate now
      that its actual content is vetted, accepting a low-reputation
      dependency for a security-relevant capability; (b) skip the
      dependency and port the ~200 lines of `apple-scoped-bookmarks`'
      `imp` module directly into `src-tauri` (feasible — the logic is
      short, `objc2`/`objc2-foundation` are worth depending on directly
      either way, and the audit above already amounts to a working
      reference implementation to adapt) — more code to own, but zero
      dependency on an unvetted-by-anyone-else publisher for the actual
      sandbox-access logic. Matches this project's established pattern of
      surfacing security/supply-chain calls explicitly rather than
      deciding them unilaterally (see the DOMPurify/Mermaid version-bump
      note above — investigated independently, bumped only "at the
      user's explicit request"). Asked the user directly rather than
      picking one — decided in favor of vendoring: the two options are
      UX-identical (same one-time grant, same cross-launch persistence
      either way), so the only real axis is supply-chain exposure, and
      this project's own established posture (`SUPPLY_CHAIN.md`,
      byte-identical vendor-file verification, CVE-only version bumps)
      already leans toward owning security-relevant code directly rather
      than depending on a low-reputation publisher for it.

      **Vendored and wired in (2026-09-10).** `src-tauri/src/
      scoped_bookmarks.rs`: a close, deliberately line-for-line port of
      the audited `apple-scoped-bookmarks` 0.1.0 `imp` module (`Bookmark`/
      `ScopedAccess`/`Error`, the macOS/iOS Cocoa calls via `objc2`/
      `objc2-foundation`, the non-Apple `Unsupported` stub) — see that
      file's own header for the full provenance note. `objc2 = "0.6.4"`/
      `objc2-foundation = "0.3.2"` added to `Cargo.toml` under
      `[target.'cfg(any(target_os = "macos", target_os = "ios"))'.
      dependencies]`, pinned to the exact versions the audited crate's own
      `Cargo.lock` resolved (inheriting an already-verified API surface,
      not "latest"). `serde`/`serde_json` promoted from transitive
      (already in `Cargo.lock` via Tauri itself, 1.0.229/1.0.151) to
      direct dependencies for the store file — same "promotes an existing
      version rather than introducing a new one" reasoning as
      `tauri-plugin-opener`/`url` had.

      Persistence itself follows this file's own established convention
      (`remote_content_policy.txt`/`last_opened_document.txt`: a plain
      file in `app.path().app_config_dir()`, pure path-injected read/write
      core + thin `AppHandle` wrapper) rather than the audited crate's own
      Tauri-command surface — `granted_folder_bookmarks.json`, one entry
      per granted folder (JSON rather than a raw string only because this
      is a map, not a single value; "deliberately dumb so the file stays
      inspectable," matching the audited crate's own stated reasoning for
      the same format). `grant_folder_access` now also calls
      `bookmark_granted_folder` (creates + persists + opens a bookmark,
      best-effort — failure there doesn't affect this session's existing
      `GrantedFolders` grant, only whether it survives a relaunch). New
      `restore_granted_folders` runs from a new `.setup()` hook in
      `run()` (not `on_page_load`+`spawn` like `restore_last_opened_document`
      — this never touches the webview or calls `eval()`, so it has none
      of that function's documented Android UI-thread deadlock risk, and
      can run before the first page load rather than waiting for it):
      reads every persisted bookmark, resolves and re-opens each,
      refreshes and re-persists any the OS reports as stale (same
      staleness handling as the audited crate), and repopulates
      `GrantedFolders`' plain `Vec<PathBuf>` — the same structure
      `resolve_local_path`/`folder_covers` already consult, unchanged by
      any of this, so a restored grant behaves identically to a freshly
      granted one. New `GrantedFolderAccess` managed state holds the live
      `ScopedAccess` handles open for the app's lifetime (dropping one
      would close the sandbox extension — Apple's own documented
      consequence, quoted in `scoped_bookmarks.rs`).

      8 new `cargo test` cases (74 total in `src-tauri`), including one
      that isn't mocked at all:
      `scoped_bookmarks::tests::create_and_resolve_a_temp_dir` creates and
      resolves a real security-scoped bookmark against this machine's
      actual Cocoa APIs (unsandboxed, so it succeeds trivially — matches
      porting-brief.md's own "Known gap" note) — genuine evidence the
      vendored FFI works, not just that it compiles. The rest are pure
      read/write-core tests against real temp files, mirroring
      `write_remote_content_policy_to`'s own test suite shape exactly.

      **Honest limitation, checked rather than assumed away**: confirmed
      (same empirical finding this file already records for
      `remote_content_policy`/`last_opened_document`) that
      `app.path().app_config_dir()` fails to resolve under
      `tauri::test::mock_app()`, so `bookmark_granted_folder`'s and
      `restore_granted_folders`' actual file I/O — as opposed to the pure
      functions underneath them — never fires through any test in this
      file, `grant_folder_access`'s own existing tests included. Not a new
      gap this change introduces; the exact same constraint every other
      `app_config_dir()`-backed persisted value here already has, and
      accepted here for the same reason: what's real and novel (the Cocoa
      FFI itself) does have a real, non-mocked test; what's routine
      (read a path, write a path, wire them into an already-tested state
      struct) is covered by pure-function tests plus manual code review,
      not by pretending `mock_app()` exercises a code path it
      demonstrably cannot reach.

      **What's still genuinely open, not done here**: there is still no
      UI trigger for `request_folder_access` at all (Milestone E/F's
      "Grant Folder Access…" banner, per the item's own earlier note —
      unaffected by this change) — so cross-launch persistence exists and
      is tested at the mechanism level, but cannot yet be exercised
      end-to-end through the real running app, since nothing can grant a
      folder through the UI in the first place yet. Also still open: the
      real macOS sandbox entitlements that would make any of this
      *enforced* rather than advisory (`porting-brief.md`'s "Known gap" —
      unchanged by this item, since there is still no
      `.entitlements`/sandbox config anywhere in this port).

      **Not verified this pass, flagged rather than assumed clean**:
      `cargo check --target aarch64-apple-ios`/`--target
      aarch64-linux-android` both failed with "can't find crate for
      `std`" in this session, despite `rustup show`/`rustup target list
      --installed` reporting both targets present — a generic toolchain
      issue in this environment (identical failure on both, including
      Android, which has no `objc2` dependency at all to blame), not
      something this change caused or something specific to `objc2`/
      `objc2-foundation`. Real macOS desktop compilation and all 74
      `cargo test` cases (including the non-mocked `scoped_bookmarks`
      test) are solid evidence for the code itself; cross-target
      compilation specifically is not re-confirmed here. Not chased
      further — mobile security-scoped-bookmark support is explicitly a
      separate, deferred concern (this module's own doc comment, and the
      `GrantedFolders` comment above), so diagnosing an unrelated rustup
      toolchain issue in this session isn't this item's job. Worth an
      actual `cargo tauri ios/android build` next mobile pass, the same
      way Milestone A originally confirmed both platforms — not assumed
      fine just because it compiles on macOS.

      **Tier two's mechanism ported (2026-09-08), its persistence and
      trigger UI still not:** `GrantedFolders` managed state in
      `src-tauri/src/lib.rs` mirrors `FolderAccessManager.covers()` /
      `useAccessIfAvailable` — a session-lifetime allowlist of granted
      folders (no macOS security-scope start/stop bookkeeping ported,
      since that's App Sandbox-specific with nothing to balance outside
      it), consulted by `resolve_local_path` alongside tier one's
      `base_dir` so a document's relative images can resolve outside its
      own directory once a covering folder is granted — `Path::starts_with`
      again making Swift's manual sibling-directory guard in `covers()`
      unnecessary, same simplification as `LocalSchemeHandler`'s port. A
      `request_folder_access` Tauri command (folder-picker dialog →
      `grant_folder_access`, split the same way `open_document`/
      `render_file` are) is registered and ready for Milestone F's
      "Grant Folder Access…" banner to call — nothing calls it yet, since
      that banner doesn't exist, so it's currently reachable only via
      direct test calls to `grant_folder_access`, same status
      `open_document`'s dialog wrapper had before the File menu existed.
      8 new `cargo test` cases (38 total in `src-tauri`), headless.

      **What's still open:** cross-launch persistence (the actual
      "bookmark" part — investigate `tauri-plugin-scoped-bookmarks` per
      above), the real macOS sandbox entitlements that would make any of
      this enforced rather than advisory (tracked in porting-brief.md's
      "Known gap"), and the in-page banner UI that would ever call
      `request_folder_access` for real.
- [ ] `ExportViewModel.swift` (PDF) → see "Open questions" above: native on
      macOS/iOS, approach for Windows/Linux/Android not yet decided
- [x] `NSOpenPanel`/`NSSavePanel` →
      `tauri-plugin-dialog`'s **Rust** API (2026-09-08), not the
      `@tauri-apps/plugin-dialog` JS package the brief originally named:
      there's no frontend JS calling into Tauri yet (`renderer.html` is
      still unmodified), so a native "File > Open…" menu item
      (`tauri::menu`, ⌘O) is handled entirely host-side —
      `blocking_pick_file()` (matches `NSOpenPanel.runModal()` being
      synchronous) → `std::fs::read_to_string` → `window.eval(...)`, same
      shape as `RenderViewModel.renderMarkdown`. `src-tauri/src/lib.rs`'s
      `escape_for_js` ports `RenderViewModel.escapeForJS` — while extracting
      it for testing, found it was missing the 5th replacement
      (`"</"` → `"<\/"`), fixed. Split into `open_document` (impure: dialog +
      i/o) and `render_file`/`build_set_content_script`/`escape_for_js`
      (pure or headlessly-testable), 13 `cargo test` cases via
      `tauri::test::mock_app()` — no real window, no file dialog, no visible
      screen needed, the Rust equivalent of `KeyboardShortcutTests`'
      app-hosted approach.

      **Save/Save As added same day.** `CurrentDocument` managed state
      (path + text) is populated by `render_file` on every successful open;
      "Save" (⌘S) rewrites that path directly (`DocumentViewModel.save()`);
      "Save As…" (⌘⇧S) shows `blocking_save_file()` pre-filled with the
      current name/directory when there is one, writes, and adopts the new
      path as current (`writeDocument(to:adoptAsCurrent: true)`). `save()`'s
      Swift fallback to `saveAs()` when there's no backing file is ported
      too, even though nothing in today's UI can reach it yet (no File >
      New) — matches the source rather than only what's currently
      exercisable. `write_document`/`save_as_to` split out the same way
      `render_file` was, for the same reason: testable without a real
      dialog. 13 more `cargo test` cases (26 total in `src-tauri`), still
      fully headless.

      **Caveat carried over from `render_file`'s own doc comment:**
      `CurrentDocument.text` can never actually diverge from disk right now
      — there's no editor yet (Milestone E), so "Save" is presently a
      same-bytes rewrite. The plumbing (state, write-and-adopt, dialogs) is
      real and tested; only the "something changed the text" trigger is
      missing, and that's out of scope until an editor exists.

      Still not ported: `DocumentViewModel`'s recent-documents tracking,
      reload-on-external-change, and `restoreLastOpened()` on launch.

### Milestone C — core models & view models

All port to TypeScript in `web/src/`, not Rust — see "No
`evaluateJavaScript`-style string building" in `porting-brief.md`. They
don't have a bundle/entry point of their own yet; that's Milestone E's
concern once the UI shell exists to host them.

- [x] `MarkdownDocument.swift` → **no dedicated port** (2026-09-06). It's a
      SwiftUI `FileDocument`/`UTType`/`FileWrapper` conformance — binding to
      macOS's document-app architecture, not a data model. Tauri has no
      equivalent abstraction; "porting" this is just "read/write a UTF-8
      text file," which is Milestone B (file-dialog/fs) work, not a `web/`
      module.
- [x] `MarkdownTheme.swift` → `web/src/markdownTheme.ts` (2026-09-06, incl.
      the co-located `PDFPageSize` enum, kept in the same file to mirror the
      Swift source's odd grouping rather than splitting it up)

      **Significant finding (2026-09-09), contradicts recorded project
      history — flagging prominently rather than either trusting or
      silently fixing.** `MDViewer/Resources/Web/themes/` — the real
      directory, shared unchanged between Swift and this port — contains
      exactly three files: `github-light.css`, `github-dark.css`,
      `dracula.css`. `markdownTheme.ts`'s `themes` array (ported 1:1 from
      `MarkdownTheme.swift`) lists six: those three, plus Solarized Light,
      Solarized Dark, and Nord, whose `cssFileName`s
      (`solarized-light`/`solarized-dark`/`nord`) have no matching file
      anywhere in the repo. `mdviewerApi.ts`'s `setTheme` (the only theme-
      loading code that exists, in either the port or — since `Resources/
      Web/**` is unchanged — the shipped Swift app) does exactly one
      thing: `document.getElementById('theme-css').href =
      'themes/${themeName}.css'`. No other theme-CSS mechanism exists
      anywhere in the codebase — checked, not assumed (grepped for
      `solarized`/`nord` outside `markdownTheme.ts`/the missing-filename
      strings themselves: nothing). Selecting any of the three missing
      themes points the `<link>` at a 404.

      This directly contradicts commit `b8b7193` ("Revert incorrect theme
      count fix - all 6 themes are verified working"), which asserts
      Solarized Light/Dark and Nord were "manually tested... and confirmed
      to work correctly" and that the missing files are "likely generated
      or bundled differently" — a claim that commit itself never verifies
      (no file path, no generation mechanism named) and that reading the
      actual `setTheme` implementation now rules out. This is exactly the
      kind of stale/unverified claim `porting-brief.md`'s "Source of
      truth" section already warns about generically ("`docs/development/
      architecture.md` has drifted... theme count. Do not trust it.") —
      this finding is likely what that note was originally about, now
      tracked down to its root cause instead of just flagged as drift.
      Confirmed genuinely reachable in this port too, not just a
      theoretical read of the code: `toolbar.ts`'s theme `<select>`
      (built this same session) lists and can select any of these three
      broken options exactly like the three working ones, with nothing
      to indicate they'd fail.

      **Not fixed here — flagged per the working agreement, not silently
      patched or silently trusted.** Two real options once decided: (a)
      the three missing theme CSS files never existed and `MarkdownTheme.all`
      has been wrong since 1.2.0 (in which case porting the picker
      "as-is" is porting a real bug, same category as the async-Mermaid-
      rejection gap in Milestone D — preserve it, or fix it, but only on
      purpose), or (b) they exist somewhere not yet found (a build step,
      a different resources path, something `git log`/`find` missed) and
      this port is missing a real asset. Given `Resources/Web/**` is
      supposed to move across completely unchanged and `find` across the
      whole repo turned up nothing, (a) looks far more likely than (b) —
      but this needs a decision from the user before doing anything else
      with it, not a unilateral call either way.
- [x] `TOCItem.swift` → `web/src/toc.ts` (2026-09-06), together with the
      `marked.lexer()` TOC extraction below — see that item for two real
      bugs found and fixed as a side effect of the already-approved
      simplification, not as separate improvement decisions.
- [ ] `DocumentViewModel.swift` — mostly Milestone B glue (NSOpenPanel/
      NSSavePanel, file read/write, FileWatcher, BookmarkManager,
      NSDocumentController); only a thin pure slice (dirty-tracking, text
      state) is a real `web/` model.

      **Update (2026-09-08): the glue side is now essentially done, in
      Rust, not deferred anymore.** `openFile`/`load(url:)` →
      `open_document`/`render_file`; `save()`/`saveAs()`/
      `writeDocument(to:adoptAsCurrent:)` → `save_document`/
      `save_document_as`/`save_as_to`; the `FileWatcher` integration →
      `watch_file`/`reload_current_document`; and — landed this pass —
      `restoreLastOpened()`/`saveLastOpened(url:)` →
      `restore_last_opened_document`/`record_last_opened_document`,
      hooked into `adopt_current_document` exactly where Swift's own
      `saveLastOpened` calls are (`load(url:)` and `writeDocument(...,
      adoptAsCurrent: true)`, not a plain `save()`). Verified live, not
      just unit-tested: launched with the debug test hook to open and
      persist a document, quit, relaunched *without* the hook, and it
      reopened automatically — real cross-launch behavior, not simulated.
      Swift persists a security-scoped bookmark for this specifically so
      access survives sandbox re-authorization on relaunch; this port has
      no sandbox entitlements configured at all yet (porting-brief.md's
      "Known gap"), so a plain persisted path is genuinely equivalent to
      what Swift's bookmark buys today, not a simplification that drops
      real behavior — flagged in the code to revisit once real
      entitlements exist. 6 new `cargo test` cases (63 total in
      `src-tauri`).

      **What's still genuinely `web/`-side work, deferred correctly**:
      just the dirty-tracking/text-state slice this note originally
      called out — still has no consumer, since there's no editor
      (Milestone E, not started) to call `updateText()` from. Not stalled
      on a missing dependency anymore, only on the UI that would use it.
- [x] `RenderViewModel.swift` → `web/src/renderViewModel.ts` (2026-09-06).
      No `evaluateJavaScript`/`escapeForJS`/ready-queue — calls
      `window.MDViewer.*` directly (see the simplification note). Two Swift
      dependencies not built yet are injected instead of assumed: the
      persisted-preferences backing store (`@AppStorage` equivalent) and
      granting the `mdviewer-local://` handler a base directory.
- [x] `SidebarViewModel.swift` — TOC extraction is done (above, now
      superseded by `mdviewerApi.ts`'s single-parse design — see the
      `toc.ts` dead-code cleanup note under Milestone E's Sidebar item).
      The remaining piece — `mode`, a single-case enum (`SidebarMode.toc`
      the only case) persisted via `@AppStorage` — **no dedicated port**
      (2026-09-10), not folded into `sidebar.ts` as originally planned.
      Checked before closing rather than assumed: `grep -rn "SidebarMode\|
      setMode" MDViewer/ --include="*.swift"` turns up only the
      declaration itself (`enum SidebarMode`, the `mode`/`storedMode`
      properties, `init`, `setMode`'s own definition) — no SwiftUI view
      anywhere calls `setMode`, and `mode` is read only where it's
      declared. This isn't "trivial persistence to add," it's genuinely
      unreachable: there is no UI path in the shipped app that ever sets
      `mode` to anything but its default `.toc`, so the enum, its
      `@AppStorage` round-trip, and `setMode` are all dead code today, not
      a real feature `sidebar.ts` is missing. `sidebar.ts` already
      reflects this correctly — it renders the TOC unconditionally, with
      no mode concept anywhere — so no follow-up change was needed there
      either. Same category as `MarkdownDocument.swift`/`HTMLBuilder.swift`
      above (no Tauri-side equivalent needed) and the Preferences item's
      "Code Font is a genuine dead control" finding — one more piece of
      Swift-side infrastructure that looks like a feature but isn't one,
      caught by reading the source rather than assuming the plan's
      original framing ("trivial... fold it in") was right.
- [x] `HTMLBuilder.swift` → **no dedicated port** (2026-09-06). It resolves
      `renderer.html`'s and the Web resources directory's URLs in the app
      bundle. `src-tauri/tauri.conf.json`'s `frontendDist`/window `url`
      (Milestone A) already does this declaratively — nothing left to port.
- [x] TOC derived from `marked.lexer()` → `web/src/toc.ts::extractTOC`
      (2026-09-06, tested against the pinned `marked@18.0.6`). Found one
      real anchor bug in the shipped app while doing this, fixed as a side
      effect of using one parse + one `slugify` (dom.ts) for both the TOC
      and the renderer, not as a separate fix: `SidebarViewModel` has its
      own separate Foundation-based `slugify()` for TOC anchors, different
      from `mdviewer.js`'s `\w`-based one — e.g. `Hello_World` anchors to
      `hello_world` in the rendered HTML but `hello-world` from the TOC.
      Narrower in practice than it sounds: `MarkdownRenderView.swift` fires
      `renderMarkdown()` (async JS render, ending in a `headingsExtracted`
      message that overwrites `tocItems` with the renderer's own correct
      anchors) immediately before the synchronous, buggy
      `sidebarVM.extractTOC()` — so the bad anchors get clobbered by the
      good ones moments later in normal use. It's a real but brief
      race-condition window right after opening or editing a document, not
      a persistent break. Worth noting `SidebarViewModel.extractTOC`
      appears to do nothing durably useful at all in the current app for
      this reason — one more point in favor of the single-source-of-truth
      simplification, independent of the anchor bug itself.

      **Correction, same day:** an earlier version of this note also
      claimed `mdviewer.js`'s marked `Renderer.heading`/`code` overrides
      hit a "legacy (text, level)" dispatch path in the main app (per that
      file's own comment) that mangles formatted headings before
      slugifying. That's wrong — checked against marked 18.0.6's actual
      parser source (`node_modules/marked/lib/marked.esm.js`), which calls
      `renderer.heading(token)` with exactly one argument, unconditionally,
      with no dispatch branching at all. The "legacy" branch in
      `mdviewer.js` is unreachable dead code, most likely a leftover from
      before some past marked upgrade, not a real observed split — so no
      such bug exists in the shipped app. Still relevant for Milestone D:
      the `heading`/`code` overrides can be ported using only the
      token-object shape, dropping the dead legacy branch rather than
      preserving it "in spirit" — it isn't a deliberate workaround like the
      print-based PDF or custom scheme handler oddities the working
      agreement asks to preserve, it looks like a mistaken premise.

      See "Deliberate simplification" in `porting-brief.md`.

### Milestone D — finish the `mdviewer.js` TypeScript port

Already ported: `dom.ts`, `emoji.ts`, `math.ts` (protect + restore),
`remote.ts`, `localResources.ts`, `sanitize.ts`, `markedRenderer.ts`
(`heading`/`code`). Remaining, one concern per change:

- [x] `marked.Renderer` overrides (`heading`/`code`) → `web/src/markedRenderer.ts`
      (2026-09-06). Token-object dispatch only, not the dual legacy/
      token-object handling mdviewer.js has — see the file header and the
      "Correction" note above: marked 18.0.6 never actually dispatches the
      legacy shape, verified against marked's own parser source.
- [x] `highlightCode` → `web/src/highlightCode.ts` (2026-09-08). Resolved
      the "Open questions" engine choice above in favor of Shiki-as-is
      before starting, per that note's own instruction: porting-brief.md's
      "What does not get ported" section already settles it architecturally
      ("the TypeScript calls marked/shiki/katex/mermaid/DOMPurify as
      globals" names Shiki specifically), and syntect would mean a new
      Rust dependency, an IPC round trip per code block, and re-theming to
      match its different token output — a real improvement (drops
      `wasm-unsafe-eval` from the CSP) worth revisiting post-Phase-1, not
      a parity-work blocker now. Checked, not assumed, that Shiki actually
      works today: `window.__shikiReady` looked like dead code at first
      (referenced only in `mdviewer.js`, never visibly assigned in
      `renderer.html`) until reading `vendor/shiki.bundle.js` directly
      turned up the real assignment at the very end of that custom-built
      bundle (`window.__shikiReady=Qt({themes:[...],langs:[...],engine:...})`).
      Same dependency-injection shape as `math.ts`'s `restoreMath`/
      `KatexLike` and for the same reason: the highlighter is a parameter
      (`ShikiHighlighterLike | undefined`, `undefined` modeling Shiki's
      "not resolved yet" state that mdviewer.js represents as `null`),
      not read from `window.__shikiReady` inside the module — keeps this
      testable against the real pinned `shiki` package and leaves the
      actual `window.__shikiReady` wiring (and the async-readiness race
      it exists for) to the not-yet-built `window.MDViewer` assembly
      layer. `shiki` pinned as an exact-version (`4.3.1`, matching the
      vendored copy) devDependency for testing only, same convention as
      `marked`/`katex`/`dompurify`. 7 new tests against a real
      `createHighlighter()` instance (wrapper/lang-label shape, the
      unloaded-language → `'text'` fallback, no-lang raw output, and the
      not-ready/throwing fallback paths) — 83/83 `web/` tests passing,
      `tsc --noEmit` clean, bundle still builds. `renderCode` itself
      untouched, exactly as anticipated — it already took highlighting as
      an injected parameter.
- [x] Mermaid `initialize`/`run` and theme switching → `web/src/mermaid.ts`
      (2026-09-08). The vendored `mermaid.min.js` itself was bumped
      11.16.0 → 11.17.2 (2026-09-07) for five security advisories — see
      `porting-brief.md`'s security-fixes note; that manual verification
      gap is now closed too (a `graph LR` flowchart confirmed rendering
      correctly in the real desktop app, see the cross-platform baseline
      screenshots entry in Milestone A) — **and fully closed 2026-09-09**,
      after the flip made the compiled pipeline production: sequence,
      class, and state diagrams all separately confirmed rendering
      correctly too (`docs/project/screenshots/mermaid-diagram-types*.png`,
      `mermaid-state-diagram.png`), not just the one flowchart type this
      note originally asked for. Same injected-dependency shape as
      `math.ts`'s `KatexLike`/`highlightCode.ts`'s `ShikiHighlighterLike`,
      but tested against a mock (`MermaidLike`), not the real `mermaid`
      package — real diagram rendering is a full SVG/DOM pipeline (~84MB
      installed) jsdom can't meaningfully exercise; that side is already
      covered by the real-app screenshot instead. This module only owns
      the option-shape/call-sequence contract, which a mock verifies fine.

      **Found and preserved, not silently fixed, a real gap in
      mdviewer.js**: checked `mermaid@11.17.2`'s actual type declarations
      (fetched `mermaid.d.ts` directly rather than assume) and confirmed
      `run()` returns `Promise<void>`. mdviewer.js's `try { mermaid.run(
      {...}) } catch (e) { console.warn(...) }` has no `await` and no
      `.catch()`, so it only catches a *synchronous* throw — an actual
      per-diagram parse/render failure rejects the promise after the try
      block has already exited, surfacing as an unhandled rejection
      instead of the intended friendly warning. Ported exactly as-is per
      the working agreement ("do not silently fix it"); flagged in
      `mermaid.ts`'s file header and covered by a test
      (`does NOT catch an async rejection...`) that documents the gap
      rather than papering over it. 5 new tests, 88/88 `web/` total,
      `tsc --noEmit` and the bundle build both clean.
- [x] `DOMPurify.sanitize` call and its options → `web/src/sanitize.ts`
      (2026-09-06), tested against the pinned `dompurify`. Found a live XSS
      advisory in the originally-pinned 3.4.12 (GHSA-55q2-fjhq-7xh7) while
      pinning it for tests — bumped to 3.4.15 (2026-09-07, at the user's
      request) in both the vendored shipping file and the test dependency;
      see the security note in `porting-brief.md` for detail and
      verification. Also prompted a check of the other three pinned
      libraries: Mermaid had five advisories and got the same treatment
      (see Mermaid item below); marked and KaTeX were clean.
- [x] Math restore half → `web/src/math.ts::restoreMath` (2026-09-06),
      tested against the pinned `katex@0.17.0`. Uses `throwOnError: false`
      exactly like mdviewer.js (KaTeX renders its own inline error message
      rather than throwing for a bad expression; the surrounding try/catch
      is for other exceptions) — caught and fixed an inverted first draft
      of this before it shipped.
- [x] Public `window.MDViewer` API → `web/src/mdviewerApi.ts`'s
      `createMDViewerApi` (2026-09-08): `setContent`, `setTheme`,
      `setFontSize`, `scrollToAnchor`, `findText`, `setBaseURL`,
      `setRemoteContentPolicy`, `loadRemoteResources` — the assembly
      layer wiring every already-ported concern (protectMath/restoreMath,
      the marked renderer overrides, sanitizeHtml, highlightCode,
      resolveEmoji, remote gating, local-resource rewriting, Mermaid)
      into the actual render pipeline. State (`localBaseURL`,
      `remoteContentPolicy`, the resolved `shikiHighlighter`) lives as
      closure variables over the returned object, mirroring mdviewer.js's
      IIFE closure exactly. All vendor libraries (marked, DOMPurify,
      KaTeX, Shiki, Mermaid) injected via `MDViewerDependencies`, same
      reasoning as every other module here.

      Two concerns setContent also owns in mdviewer.js are deliberately
      *not* in this module, left for the next two items below instead:
      notifying the host of headings/render-completion/blocked-remote-
      content (this `setContent` returns `{ headings, blockedRemoteCount
      }` instead of calling any messageHandler, so the bridge item below
      is purely "wire this return value to invoke/emit," not a change
      here), and scroll/link listeners (outside `window.MDViewer` in
      mdviewer.js too, its own module next).

      `MarkedLike` is typed against marked's own real types
      (`Pick<typeof marked, "Renderer" | "parse">`), not a hand-rolled
      interface like this port's other injected dependencies — marked's
      `Renderer` has 20+ methods with defaults (paragraph, list, link, …)
      that `new marked.Renderer()` relies on unmodified, only overriding
      `heading`/`code`; a narrow custom interface would've forced every
      caller to stub out methods this module never touches. Caught a real
      bug while writing this against real marked, not assumed: marked
      calls `renderer.heading(token)` as a method, so the override must
      be a plain `function`, not an arrow function — an arrow function's
      lexical `this` would silently break `this.parser.parseInline(...)`
      (verified the correct behavior directly against the real `marked`
      package before writing the port, not assumed from mdviewer.js's own
      source).

      16 new tests, all against real pinned packages (marked, DOMPurify,
      KaTeX) plus a mock `Mermaid` (real Mermaid needs a full SVG/DOM
      pipeline jsdom can't meaningfully exercise — see `mermaid.ts`'s own
      entry above) — covering the full render pipeline end-to-end
      (headings extracted with correct anchors, math rendered, `<script>`
      stripped, emoji resolved, mermaid fences wrapped and `.run()`
      called, remote-image gating under both `'ask'` and `'always'`,
      relative-image rewriting against a base URL, the Shiki-not-ready
      fallback, and the `shikiReady` race actually resolving before the
      first highlight). 104/104 `web/` tests total, `tsc --noEmit` and the
      bundle build (11.8kb now) both clean.

      **Left for later, not fixed here**: `web/src/renderViewModel.ts`'s
      existing `MDViewerBridge` interface (Milestone C, 2026-09-06) isn't
      fully aligned with `MDViewerApi`'s real shape — it's missing
      `findText`/`loadRemoteResources` and types `setRemoteContentPolicy`
      more strictly than mdviewer.js's actual defensive-string runtime
      behavior. Not a conflict today (they're two separate interfaces,
      nothing currently type-checks one against the other), but whatever
      finally wires `RenderViewModel` to a real `MDViewerApi` instance
      should reconcile them rather than silently working around the gap.
- [x] Scroll-position tracking and link hover/click listeners →
      `web/src/interactionListeners.ts`'s `attachInteractionListeners`
      (2026-09-08). Ported from mdviewer.js's trailing listener block —
      the part outside `window.MDViewer` entirely, attached once at
      script-load rather than per-render. Same callback-injection shape
      as `mdviewerApi.ts`'s `setContent` return value, and for the same
      reason: this *is* most of what the "swap
      `window.webkit.messageHandlers.*`" item below actually meant for
      `scrollPositionChanged`/`linkHovered`/`linkClicked` — wiring a
      callback to `invoke`/`emit` is the caller's job, not this module's.
      100ms scroll debounce, hover empty-string-on-mouseout, and the
      unconditional `preventDefault()` for non-fragment links (already
      noted above as ruling out any need for a Rust-side navigation
      interceptor) all preserved exactly. 11 new tests via jsdom event
      dispatch (`dispatchEvent`, fake timers for the debounce) — 115/115
      `web/` tests total, bundle now 12.9kb.
- [x] Swap `window.webkit.messageHandlers.*` calls for the Tauri bridge
      built in Milestone A — **effectively closed by the two items above,
      not a separate module.** Re-reading what's left after
      `mdviewerApi.ts` (returns `{ headings, blockedRemoteCount }` instead
      of notifying) and `interactionListeners.ts` (callbacks instead of
      notifying) land: there is no `window.webkit.messageHandlers`
      reference left anywhere in the ported TypeScript. What remains is
      exactly the two genuinely-Rust pieces the Milestone A re-scoping
      note already identified — `linkClicked`'s local-`.md`-file-switch
      and external-URL-open cases, and `remoteContentBlocked`'s "Always
      Allow" persisted preference — and those are `invoke` commands to
      write in `src-tauri`, not TypeScript-side work; tracked as their
      own item there, not duplicated here.
- [x] Point the Tauri app at `web/dist/mdviewer.js` and retire the
      hand-written `MDViewer/Resources/Web/mdviewer.js` once verified at
      parity — not before. **Mechanism corrected** (see Milestone A's
      root-scaffold entry above): the build's `--outfile` changes,
      `frontendDist` never does.

      **Wiring landed (2026-09-08), the flip itself deliberately not
      thrown yet.** `web/src/main.ts` is the real bundle entry point now
      (`package.json`'s `build` script points at it, not `index.ts`,
      which stays a side-effect-free barrel export for tests) — it calls
      `createMDViewerApi` with the real `window.marked`/`DOMPurify`/
      `katex`/`mermaid`/`__shikiReady` globals and assigns the result to
      `window.MDViewer`. Still builds to the safe `web/dist/mdviewer.js`
      staging location, per the "don't let a partial build overwrite it"
      rule — the `--outfile` itself hasn't moved.

      **Updated once the Milestone A bridge commands landed** (same
      pass): `onLinkClicked` now calls the real `handle_link_click`
      command via `window.__TAURI__.core.invoke` —
      `tauri.conf.json`'s `app.withGlobalTauri: true` was already set, so
      this needed no `@tauri-apps/api` npm dependency, consistent with
      the rest of this port treating vendor/host capabilities as globals
      rather than bundling them. `onScroll`/`onLinkHovered` and
      `setContent`'s returned `{ headings, blockedRemoteCount }` stay
      genuinely unconsumed, not an oversight: no sidebar exists to show
      headings in, no status bar for hover text or scroll position, and
      no remote-content prompt UI to trigger
      `set_remote_content_policy_always` from — all Milestone E (UI
      shell), not started. 115/115 `web/` tests still pass, `tsc
      --noEmit` clean, bundle builds (13.3kb).

      **Correcting a claim before it became a false one**: an earlier
      draft of this note said the cross-platform baseline screenshots
      already confirm the compiled TypeScript pipeline's visual output —
      wrong, caught immediately on re-reading. `frontendDist` never
      changed and the build `--outfile` is still `web/dist/mdviewer.js`,
      not `MDViewer/Resources/Web/mdviewer.js`, so every screenshot this
      session took (the render-pipeline sanity check, the Mermaid
      verification, the three-platform baseline set) rendered through
      the **hand-written** `mdviewer.js`, exactly as intended at this
      stage — none of them are evidence about `mdviewerApi.ts`/
      `highlightCode.ts`/`mermaid.ts`'s real-app behavior yet, only their
      unit-test behavior. Flipping the build target today would ship a
      renderer with genuinely *no in-app visual verification at all* —
      that alone is reason enough not to, regardless of the wiring state.

      **Updated**: the link-click gap this paragraph originally cited
      alongside that is now closed (see above — `onLinkClicked` calls the
      real `handle_link_click` command). TOC display and the
      remote-content prompt remain genuinely unwired, but only because
      Milestone E's sidebar/prompt UI doesn't exist yet to trigger them
      from — not something a Rust or `web/src` change could unblock
      further right now.

      **The in-app visual check happened (2026-09-08), and it passed —
      still not flipping the real build target, for a narrower reason.**
      Never touched `frontendDist` or the real `mdviewer.js`: copied
      `MDViewer/Resources/Web` to a scratch directory, swapped in
      `web/dist/mdviewer.js` there, and pointed a temporary
      `tauri.conf.json` edit at *that* copy instead — reverted (`git
      diff` clean) the moment the check was done, `cargo test`/`npm test`
      rerun after to confirm. Loaded the same demo document via
      `MDVIEWER_TEST_DOCUMENT_PATH`. Hit the same screen-recording
      permission flakiness noted early this session (a full-screen
      capture came back solid black; deleted immediately, never kept)
      — the user confirmed the permission toggle was already on, so the
      real fix wasn't re-granting it but restarting Ghostty for macOS to
      actually apply it to newly spawned processes; window-region
      capture (`screencapture -R`) worked cleanly after that.
      `docs/project/screenshots/desktop-ts-pipeline-{check,full}.png`:
      headings, text formatting, nested lists, task-list checkboxes, and
      the full table all render pixel-identical to the hand-written
      version's own baseline. Math and the Mermaid diagram weren't
      re-confirmed in this particular pass — reaching them needed real
      scrolling, which needed Accessibility permission this session
      didn't have at the time.

      **Resolved 2026-09-09**, not by scrolling but by a taller window
      instead (same workaround used here, this time landing on the right
      section): verifying `app.html`'s skeleton (see Milestone E below)
      happened to load the same demo document through this exact
      compiled pipeline, and the screenshot
      (`app-shell-content-full.png`, plus a second capture that happened
      to scroll to the math/Mermaid section) shows KaTeX math and a full
      Mermaid flowchart — all five platform nodes, edges, styling —
      rendering correctly. Real pixels, not the unit-test/hand-written-JS
      evidence this paragraph used to rest on. That closes the specific
      gap this note flagged.

      **What's actually still open before flipping**: nothing code-side.
      TOC/remote-content-prompt wiring needs Milestone E's UI to exist
      first (not a blocker for the flip itself — mdviewer.js is in the
      same boat today, nothing shows a TOC either). The honest remaining
      gate is human judgment, not missing evidence anymore: flipping
      retires the hand-written file for good, which still deserves a
      second, deliberate look before doing it rather than treating a
      green checklist as the same thing as a decision.

      **Flipped for real, 2026-09-09.** One more bug found first, while
      re-verifying `app.html`'s skeleton with a real screenshot (Screen
      Recording was fixed by then — see Milestone E below): the
      document-open state stayed stuck on the welcome screen. Root cause
      wasn't the compiled pipeline itself — `main.ts` looked up
      `#welcome`/`#content` at top-level script scope, which runs
      *before* `<body>` exists (a `<script src="mdviewer.js">` in
      `<head>`, same placement `renderer.html` already used, executes
      during head-parsing). `document.getElementById` returning `null`
      isn't an error, so the 118 passing tests and every prior clean
      unified-log read missed it — only actually looking caught it.
      Fixed by deferring the lookup to `DOMContentLoaded`
      (`web/src/main.ts`). Re-verified after the fix: welcome/content
      toggling works, and the same screenshot pass gave the first real
      pixel confirmation of the compiled pipeline's KaTeX math and
      Mermaid rendering (see above).

      With that fixed and confirmed, asked the user directly whether to
      throw the switch rather than deciding alone — approved. Changed
      `web/package.json`'s build script `--outfile` from the safe
      `dist/mdviewer.js` staging path straight to
      `../MDViewer/Resources/Web/mdviewer.js` (`frontendDist` and
      `renderer.html` untouched, per the corrected mechanism above) and
      ran it for real — `MDViewer/Resources/Web/mdviewer.js` is now the
      esbuild output (455 lines, `"use strict"; (() => { // src/dom.ts`
      …) instead of the hand-written IIFE (419 lines); the original stays
      recoverable from git history, plus a scratch copy kept for the
      session. Confirmed `renderer.html`'s own `#content` (no `hidden`
      attribute, no `#welcome` on that page at all) makes the appShell
      wiring a safe no-op there before flipping, not after. Verified
      against the **real** `tauri.conf.json` and the **real** file this
      time, no scratch copy needed — `docs/project/screenshots/
      production-flip-check.png` matches the established baseline
      exactly. 63/63 Rust and 118/118 web tests still green throughout.
      `porting-brief.md`'s "What does not get ported" section updated to
      stop describing `mdviewer.js` as pending and start warning that
      hand-editing it directly is now a mistake — the next `web/` build
      silently overwrites it.

      **A second, more serious bug found immediately after, verifying
      the flip on Android — not desktop-only work, since `mdviewer.js`
      is shared by every platform.** Same demo document, same compiled
      bundle that had just been confirmed working on desktop and iOS:
      Android showed a blank page. Not the same welcome-screen bug —
      `renderer.html` has no `#welcome` at all, so `appShell.ts`'s
      wiring is a no-op there by design. Chrome DevTools Protocol (which
      worked reliably for every earlier Android check this session)
      hung indefinitely trying to even connect — itself a clue, not just
      an inconvenience. Traced properly with `eprintln!`/`console.log`
      breadcrumbs rather than guessed at: JS started fine
      (`window.MDViewer` got assigned), Rust's `on_page_load` fired and
      found the test document, `render_file` was called — and then
      nothing. No return, no error, no panic. Silence exactly where a
      deadlock would produce silence.

      Root cause: `on_page_load`'s callback runs *on Android's UI
      thread* (Chromium WebView requires all WebView interaction from
      that thread). `render_file` calls `window.eval()` synchronously
      from inside that same callback — and `eval()` on Android needs to
      hand off to that very thread. A callback can't return to free the
      thread that the call it's making is blocked waiting for; classic
      self-deadlock. WKWebView (macOS/iOS) doesn't have this constraint,
      which is exactly why desktop and iOS both looked completely fine
      first — this was never visible without testing the specific
      platform whose threading model actually differs. Fixed by moving
      the test-hook/restore-last-opened call inside
      `tauri::async_runtime::spawn(async move { ... })`, off the
      callback's own stack, so Tauri's internal thread-hop for `eval()`
      isn't reentrant (`src-tauri/src/lib.rs`). Confirmed via the same
      breadcrumbs that `render_file` now actually returns
      (`Ok(())`) and `setContent` resolves, then confirmed visually —
      `docs/project/screenshots/android-flip-fixed.png` matches the
      baseline exactly. Also rebuilt and re-checked iOS after the fix
      (`ios-flip-check.png`) specifically because this was a real,
      previously-undiscovered concurrency bug in shared Rust code, not
      a per-platform asset — worth confirming the fix didn't regress the
      platform that didn't have the bug. All debug instrumentation
      removed once confirmed; 63/63 Rust and 118/118 web tests still
      green after.

      **Why this matters beyond the one bug**: this is the first
      `on_page_load`-adjacent Rust code this port has run on a real
      Android device rather than just compiled for one — the Milestone A
      mobile-confirmation entry's own build-and-boot check never
      exercised this code path (no document was opened there), and nor
      did any unit test, since `tauri::test::mock_app()` has no
      Android-specific threading model to catch this against. Worth
      remembering for any *future* code that calls `eval()` (or anything
      else requiring the UI thread) from inside a callback that might
      itself already be running on it — the desktop-only testing habit
      this session mostly relied on genuinely cannot catch this class of
      bug.

### Milestone E — UI shell

**Architecture decided before starting (2026-09-08), user asked directly
rather than assumed.** `renderer.html` is currently only the content
region — Swift's toolbar/sidebar/preferences are native SwiftUI views
entirely outside the WKWebView, with nothing in `renderer.html` to "port"
them from. The single-webview decision (porting-brief.md) means that UI
now needs to live in the same page as the content, which puts it in
tension with `renderer.html`/`mdviewer-base.css` being flagged as files
that "move across unchanged." Two options were on the table: extend
`renderer.html` directly, or add a new shell page that hosts the UI shell
and wraps the same content region. Chose the new page —
`MDViewer/Resources/Web/app.html` (+ `app.css`) — so `renderer.html`
itself stays genuinely untouched and reusable standalone (e.g. a future
export/print view), at the cost of some duplicated vendor `<script>`/
`<link>` tags between the two files.

- [ ] Preferences window/UI (`PreferencesView`, `AppearancePrefsView`,
      `GeneralPrefsView` equivalents) → `web/src/preferences.ts`
      (2026-09-09), scoped to the Privacy tab — General and Appearance
      show honest placeholder text, no fake controls; see the file's own
      header for exactly why each is deferred (General: `restoreLastFile`/
      `autoReload` have no Rust-side "disable" hook to control, since
      `restore_last_opened_document`/`watch_file` run unconditionally;
      Appearance: Theme/Font Size already live in the toolbar, and Code
      Font is a genuine dead control in the shipped Swift app — see the
      finding under `MarkdownTheme.swift` above for a related, more
      significant one).

      **A real architecture call, made and flagged rather than asked
      about separately**: Swift's Settings scene is a second native
      window (`Settings { PreferencesView() }`, `MDViewerApp.swift`,
      opened via Cmd+, or the app menu). Ported as an in-page modal
      instead — direct continuation of the single-webview decision
      already in `porting-brief.md`, not a new fork of it: mobile has no
      concept of a second app window at all, so *something* other than a
      native window was always going to be needed there, and a modal is
      the one shape that works identically on every platform this port
      targets. Opened via a new "Preferences…" button in the toolbar
      (`toolbar.ts`) rather than a menu item/keyboard shortcut — the
      toolbar is the one trigger surface that already exists on both
      desktop and mobile; Cmd+, isn't wired (no keyboard on mobile
      either, so it'd only ever be a desktop-only nicety) — worth adding
      as a fast follow, not required for the feature to work.

      **Also surfaced, not fixed, a separate real gap while placing that
      button**: the app's entire native menu bar is one custom
      `.menu()` builder with only a File submenu (Open/Save/Save As) —
      confirmed by reading `tauri::Menu::default()`'s own source
      (vendored `tauri-2.11.5`) that a custom `.menu()` *replaces* the
      framework's default App/Edit/Window/Help menus entirely rather
      than extending them, meaning this app currently has no Quit menu
      item, no Edit menu (Cut/Copy/Paste/Select All), no Window menu, no
      About. Out of scope for this change (a full menu-bar rebuild is a
      different, larger concern than adding a Preferences trigger,
      touching Milestone A's original menu setup, not Milestone E) —
      flagged here since it was found in the course of deciding where a
      menu item *would* go, not chased down and fixed unprompted.

      Two new Rust commands, `get_remote_content_policy`/
      `set_remote_content_policy` (generalizing beyond the existing
      `set_remote_content_policy_always`, which only ever writes
      `"always"` for a different, still-not-built caller — the
      remote-content prompt's own "Always Allow" button). 3 new
      `cargo test` cases (66 total), 13 new `web/` tests (146 total across
      `preferences.test.ts` + `toolbar.test.ts`'s new Preferences-button
      coverage). `tsc --noEmit` clean, production bundle rebuilds clean
      (28.3kb).

      Verified live on the real production app (not a scratch copy — see
      "Main window layout"'s flip note, already real by this point): the
      toolbar's new Preferences button opens the modal, General tab
      selected by default (matching Swift), showing "Not available yet."
      — `docs/project/screenshots/prefs-{toolbar-button,modal-open}.png`.
      Closing it (both the × button and clicking the overlay backdrop)
      and the Privacy tab's live policy round trip (`get`/
      `set_remote_content_policy`) were **not** re-confirmed by pixels
      this pass — Screen Recording/Accessibility flaked out again after
      those first two screenshots (same intermittent class of issue as
      earlier this session; the unified log confirmed the window
      genuinely rendered — `View is visible`, layer tree unhidden,
      display refreshed — even while `screencapture`/`System Events`
      reported nothing, so this is the observation tooling, not the app).
      Tried across a fresh relaunch and several waits before stopping,
      per this file's own established practice. What the rest of this
      entry rests on instead: `preferences.test.ts`'s real jsdom coverage
      of tab-switching, both close paths, and the policy `change` event
      firing `onPolicyChange` with the right value, composed with 66/66
      passing `cargo test` for the new commands' read/write/validation
      logic. Worth an actual look next time the permission cooperates.
- [x] Sidebar + table of contents (`SidebarView`, `TableOfContentsView`) →
      `web/src/sidebar.ts` (2026-09-09). Combined both Swift files into
      one module — `SidebarView` is a thin wrapper
      (`TableOfContentsView(sidebarVM) { anchor in
      renderVM.scrollToAnchor(anchor) }`) with nothing else worth its own
      file. `renderTOC` matches `TableOfContentsView`'s body exactly: the
      "No headings found" empty state, and otherwise a flat list indented
      `(level - 1) * 12` points per item with three font-size tiers
      matching `fontForLevel`'s `.headline`/`.subheadline`/`.caption`.
      `attachTOCClickHandler` uses event delegation on `#sidebar` itself
      rather than per-item listeners, since `renderTOC` replaces the list
      wholesale on every call — per-item listeners would silently leak
      and re-attach each time. Wired into `main.ts` alongside the
      `#welcome`/`#content` toggle, both hanging off `setContent`'s
      return value the same way (`headings` was the other half of
      `SetContentResult` still unconsumed there). `app.html`'s `#sidebar`
      is no longer conditionally hidden — matches Swift, where the
      sidebar is a permanent part of `NavigationSplitView` regardless of
      whether a document is open, not something that appears once one
      is. 11 new tests (real jsdom DOM assertions, not snapshot-only).

      **Cleaned up dead code discovered while starting this**: `toc.ts`/
      `toc.test.ts` (`TOCItem`, `extractTOC`) were structurally identical
      to `ExtractedHeading` (`markedRenderer.ts`) and completely unused —
      `mdviewerApi.ts`'s actual design derives headings during the single
      `marked.parse()` pass instead (via `renderHeading`'s accumulator),
      which is strictly better than `extractTOC`'s separate
      `marked.lexer()` call would have been (avoids a second parse,
      exactly what the "Deliberate simplification" in porting-brief.md
      was for). An earlier attempt superseded by `mdviewerApi.ts`'s
      later, better-integrated design, left in place and silently
      confusing rather than removed. Deleted outright rather than kept
      as unused-but-harmless — two structurally-identical types for the
      same concept is exactly the kind of thing worth flagging and
      fixing, not quietly working around. Fixed two stale comments that
      referenced the deleted file (`sanitize.ts`,
      `markedRenderer.test.ts`) and `index.ts`'s barrel-export claims
      about `mdviewer.js` still being "not before" Milestone D's flip
      (it already happened).

      **Found and fixed a real CSS bug while looking at the result, not
      caught by any test**: `#welcome`'s own `display: flex` rule in
      `app.css` is an ID selector, which outranks the browser's built-in
      `[hidden] { display: none }` (an attribute selector, lower
      specificity) — so `appShell.ts` setting `.hidden = true` did
      nothing visually. The welcome message stayed on screen right
      alongside real rendered content, only caught by actually loading a
      document and looking. `#content` never had this problem (nothing
      in `app.css` sets its `display`, so the built-in rule wins
      uncontested) — the bug was specific to elements that need both
      `[hidden]`-toggling *and* their own non-default `display` value.
      Fixed with an explicit `#welcome[hidden] { display: none; }`
      override (higher specificity than the bare `#welcome` rule).
      Screenshots: `docs/project/screenshots/sidebar-{empty,populated}.png`.

      **Verified, not assumed, against real Swift source**: the TOC shows
      raw `:shortcode:` text (e.g. "MDViewer Demo :rocket:") instead of
      the resolved 🚀 emoji the rendered heading itself shows. Confirmed
      this matches Swift, not a new regression — `SidebarViewModel.
      extractTOC` uses swift-markdown's `Heading.plainText` directly,
      which never resolves emoji shortcodes at all; that's purely a
      `mdviewer.js`-side `resolveEmoji()` concept applied to the
      rendered HTML string, never touched by native TOC extraction on
      either platform. Left as-is, per the working agreement — not a bug
      to silently fix, a genuine parity match.
- [ ] Toolbar (`MainToolbar`) → `web/src/toolbar.ts` (2026-09-09). Search
      (`SearchBarView`) is a separate concern, not started — see its own
      note below. Scoped down the same way Sidebar+TOC was: Open button,
      font size (decrease/reset-showing-current-value/increase), and the
      theme picker (`<select>`, all 6 themes) are real and wired end-to-
      end. Deliberately not built, each blocked on something else, not an
      oversight — flagged in `toolbar.ts`'s own header comment too:
        - Editor-mode toggle: no editor exists yet (this milestone's own
          "Main window layout" item, not started).
        - Save: Swift disables it unless `documentVM.isDirty`; the
          dirty-tracking slice (`DocumentViewModel`, Milestone C) has no
          consumer without an editor either.
        - Export (PDF/HTML/Print) menu: `ExportViewModel` isn't ported —
          the non-Apple-platform PDF approach is still an open question
          (porting-brief.md's host-glue table).

      First real caller of `renderViewModel.ts`'s `RenderViewModel` in
      this port (instantiated in `main.ts`'s new `wireToolbar()`,
      `renderer` bound directly to `window.MDViewer` — every method
      `MDViewerBridge` needs was already implemented and tested).
      Persistence (`loadStoredThemeId`/`storeThemeId`/`loadStoredFontSize`/
      `storeFontSize`) is `localStorage`, the closest equivalent to
      Swift's `@AppStorage` for this per-webview UI-preference state — not
      a Tauri store/plugin, since nothing here needs to survive outside
      this webview or be readable from Rust.

      **Found and documented, not silently worked around, a real
      architectural asymmetry**: `RenderViewModel.renderMarkdown()`/
      `getRemoteContentPolicy` are supplied but never actually invoked
      from `wireToolbar()`. In Swift, `RenderViewModel` is the *only* path
      to the WebView — `renderMarkdown()` is how a document's text
      reaches it. In this port, Rust's `render_file` (`src-tauri/src/lib.rs`)
      already calls `window.MDViewer.setContent` and pushes the
      remote-content policy directly via `eval`, bypassing
      `RenderViewModel.renderMarkdown()` entirely. So `RenderViewModel`'s
      render path is presently dead code in the actual pipeline — only its
      theme/font-size methods have a real caller. Not fixed here (out of
      scope for a toolbar change); worth a decision later about whether
      `render_file` should call through `RenderViewModel` instead, or
      whether `renderMarkdown()`/`getRemoteContentPolicy` should be
      trimmed from the TypeScript port as Swift-only concepts that don't
      apply to this architecture.

      **Closed a real, previously-flagged mobile gap, not just built UI**:
      `open_document` had no `invoke` surface — only reachable via
      desktop's File menu (`#[cfg(desktop)]`-only, see `run()`'s own
      comment, written 2026-09-08). Added `open_document_command`, a thin
      `#[tauri::command]` wrapper `toolbar.ts`'s Open button calls via
      `invoke`. Checked, not assumed, that this actually helps mobile:
      read `tauri-plugin-dialog` 2.7.3's vendored source directly —
      `pick_file`/`blocking_pick_file` (what `open_document` uses) has
      both a `desktop.rs` and a `mobile.rs` implementation, no
      `#[cfg(desktop)]` gate anywhere, unlike `blocking_pick_folder`
      (confirmed desktop-only, see `request_folder_access`'s own note).
      So Open is now genuinely reachable on Android/iOS via `invoke`, the
      same as desktop's menu — not verified end-to-end on a real device
      this pass (see "Honest limitation" below), but the surface is real.
      6 new Rust tests would be the usual next step; none added here since
      `open_document_command` is a one-line delegation to already-tested
      `open_document` — nothing new to unit-test beyond what compiling
      and registering it in `generate_handler!` already proves.

      15 new `web/` tests (`toolbar.test.ts`), 133/133 total. `tsc --noEmit`
      clean, 63/63 `cargo test`, production bundle rebuilds clean
      (23.5kb).

      **Resolved (2026-09-09, same day).** The Screen Recording/
      Accessibility flakiness cleared on its own on the next attempt —
      same pattern as earlier in this file (intermittent for the Claude
      Code CLI process specifically, not a real app problem). Verified
      properly, on the real production window (see "Main window layout"'s
      own flip note below, done in the same pass): the theme picker's
      native `<select>` opened via a real click, all six themes listed
      correctly, and selecting "Dracula" swapped the stylesheet live —
      background, text, code blocks, sidebar, and toolbar all recolored
      together, the picker itself showing "Dracula" selected —
      `docs/project/screenshots/production-flip-{theme-attempt,dracula}.png`.
      Font-size controls re-confirmed the same way as before (16 → 20 via
      two real "A+" clicks).

      **Also verified on Android**, not just desktop — standard practice
      for any change reaching the real app, doubly warranted here since
      the earlier Android `on_page_load`/`eval` deadlock (Milestone D)
      was exactly this class of "works on WKWebView, breaks on Android's
      WebView" bug. Built and ran on the `mdviewer_test` AVD: sidebar,
      toolbar, and content all rendered correctly, no deadlock, no JS
      errors in `logcat`.

      **Found and fixed a real bug from that Android check, not silently
      ignored**: at phone width the toolbar's controls overflowed the
      viewport with no way to reach the cut-off ones (font-size/theme
      picker pushed off the right edge) — `#toolbar` had no wrap or
      scroll behavior, only fine at the 1000px desktop width it was built
      against. Confirmed genuinely fixed, not just "looks plausible":
      inspected the live Android webview via Chrome DevTools Protocol
      (`adb forward` to `webview_devtools_remote_<pid>`) and confirmed
      `#toolbar`'s `scrollWidth` (420) exceeds `clientWidth` (172) with
      `overflow-x: auto` applied, then set `scrollLeft` via CDP and
      re-screenshotted to see the previously-unreachable theme picker
      scroll into view — `docs/project/screenshots/android-flip-fixed.png`
      (before) and the CDP-scrolled screenshot (after) both taken this
      pass. Fix: `app.css`'s `#toolbar` gets `overflow-x: auto` plus
      `flex-shrink: 0` on every child, so controls scroll horizontally
      instead of being squished or clipped — a normal touch-device
      pattern, unlike SwiftUI's native toolbar (which collapses overflow
      into an automatic "more" menu HTML has no equivalent of). iOS not
      re-checked this pass (no simulator session running); the same fix
      applies identically since it's pure CSS, not platform-specific
      code — flagged rather than assumed, worth a quick look next mobile
      pass.
- [x] Search (`SearchBarView`) → `web/src/search.ts` (2026-09-09), 16 new
      `web/` tests (163 total). The cross-platform "no native find-in-page
      surface" question this item originally flagged got resolved in
      favor of the closer architectural match, not a hand-rolled
      highlighter: `window.find(...)`, the browser's own legacy find API
      — non-standard and deprecated, but present in both engines (WebKit,
      Chromium) this port's webviews are built on, and it keeps the same
      "delegate to the platform, don't reimplement it" spirit Swift's own
      `webView.find()` call has. Rejected the alternative (DOM text
      walking + `<mark>` wrapping + scroll-into-view) specifically because
      it would also have to not corrupt KaTeX's rendered MathML or
      Shiki's syntax-highlighting spans — real, nontrivial surface area
      for a part of the app search doesn't need to touch. Opened via a
      new "Find…" toolbar button (same reasoning as Preferences' button —
      Swift's Cmd+F/"Find…" menu command has no mobile equivalent) plus a
      Cmd+F/Ctrl+F `keydown` listener for desktop parity as a bonus, not
      required for the feature to work.

      **A real, functional bug found live and fixed, not just a
      documented deviation.** `window.find()` moves the browser's own
      selection/focus to the matched text — calling it synchronously on
      every keystroke (an undebounced first attempt, matching Swift's own
      undebounced `.onChange(of: searchText)`) stole keyboard focus away
      from the search `<input>` mid-typing. Refocusing the input right
      after each call sounded like it should fix that but didn't fully:
      rapid native keystrokes arriving while focus was mid-bounce between
      the input and the matched document text lost characters to a race.
      Not caught by any test — jsdom's `find` is the injected mock, which
      doesn't move real selection/focus the way a browser's `window.find()`
      does, so this class of bug is invisible to unit tests by
      construction. Found by actually typing into the real desktop app
      and confirming the *real* input value via the OS accessibility API
      (`System Events`'s `value of text field`), not a screenshot —
      typing "blockquote" landed as a single, seemingly arbitrary
      leftover character (`"b"` one run, `"l"` another, both confirmed
      via the accessibility read, not inferred from pixels). Fixed by
      debouncing the search-as-you-type trigger 200ms
      (`SEARCH_DEBOUNCE_MS`) so `find()` only runs once typing actually
      pauses, never interleaved with a keystroke burst — re-verified the
      same way afterward: the real accessibility-read input value came
      back as the full, correct `"blockquote"`. A genuine, deliberate
      deviation from Swift's undebounced version, not independently
      confirmed necessary in the real Swift app (no way to drive it in
      this environment) but well-justified by a bug this port can
      actually reproduce and fix. `docs/project/screenshots/
      search-{toolbar-button,bar-open,fix-confirmed,done-close}.png`.

      **Also inferred, not independently verified**: `WKWebView.find`'s
      exact continuation semantics between successive calls (does
      retyping restart from the top, or continue from the current match?)
      aren't visible from `SearchBarView.swift` alone. This port makes an
      explicit, reasonable choice — a changed query restarts from the
      document start (`searchFromStart`, clearing the selection first),
      Enter continues forward (`searchNext`) — documented as inferred in
      `search.ts`'s own header, not assumed identical to WKWebView's
      internal behavior.

      Not yet re-verified on mobile (Android/iOS) — `window.find()` is
      present in Android's WebView engine too (Chromium-based, same as
      desktop's reasoning), but this wasn't confirmed live this pass; a
      real follow-up, not forgotten, same as the toolbar-overflow fix's
      own iOS gap.
- [ ] Main window layout (`ContentView`, `MarkdownRenderView`,
      `WebRendererView`, `MarkdownEditorView` equivalents)

      **Skeleton landed (2026-09-08), not wired to anything yet.**
      `app.html`: same `<head>` (CSP, vendor scripts, `mdviewer-base.css`)
      as `renderer.html`, plus a new `app.css` and a structural skeleton —
      `#sidebar` (`<nav>`, empty, `hidden`), `#toolbar` (`<header>`,
      empty, `hidden`), `#welcome` (static "Open a Markdown file to get
      started" message, matching `WelcomeView`'s show condition:
      `documentVM.text.isEmpty && documentVM.fileURL == nil`), and the
      same `id="content"` every already-ported render-pipeline module
      (`mdviewerApi.ts`, `localResources.ts`, `remote.ts`) already
      targets, unchanged contract. `app.css` moves `mdviewer-base.css`'s
      body padding onto `#main` instead (so a full-height `#sidebar`
      isn't inset by it) without editing that file. Sidebar/toolbar
      visibility toggling is *not* wired up yet — genuinely static
      markup, deliberately, one concern at a time; that's what "Sidebar +
      table of contents"/"Toolbar + search" above are for.

      **Welcome/content toggle wired (2026-09-08, same pass)**:
      `web/src/appShell.ts`'s `showContent`/`showWelcome` flip the
      `hidden` attribute on `#welcome`/`#content` — new logic, not a
      Swift port (`WelcomeView` is conditionally-mounted SwiftUI;
      `app.html` has no SwiftUI equivalent, just two static DOM nodes to
      toggle). `main.ts` calls `showWelcome` at startup and wraps
      `window.MDViewer.setContent` to call `showContent` after it
      resolves — guarded on `#welcome` actually existing, since
      `renderer.html` (still the real page today) has no such element and
      shouldn't error just because this bundle happens to run against it.
      3 new tests, 118/118 `web/` total. Also fixed two stale claims
      caught while touching `index.ts`: its "what's still unwired" list
      still named `linkClicked` and the remote-content preference as
      blocked on Tauri commands that don't exist — both now do (see the
      Command/event bridge entry above) — and `renderViewModel.ts`/
      `markdownTheme.ts`/`toc.ts` were never actually added to the
      barrel's `export *` list despite the file header claiming
      everything ported was in it; added them (no naming collisions,
      checked before adding).

      Verified live twice more (compiled bundle + `app.html`, same safe
      scratch-copy technique): once with no document (confirms the
      startup `showWelcome` call and vendor-global wiring don't error),
      once with the test-hook document loaded (confirms the full
      `setContent` → `showContent` path runs end-to-end). Both produced a
      clean `didFinishLoadForFrame` with no `ReferenceError`/`TypeError`/
      `SyntaxError`/`Uncaught` in the unified log. Screen Recording
      permission was still not cooperating (confirmed by byte-identical
      file size to the earlier known-black capture, not just assumed) —
      didn't retry a third time; log evidence plus 118 passing tests is
      real signal even without pixels, and is what this relies on rather
      than a screenshot that isn't happening this session.

      Verified the same safe way as the compiled-JS pipeline check: a
      scratch copy of `Resources/Web` (this time already containing
      `app.html`/`app.css` too) with a temporary `tauri.conf.json` edit
      pointing `frontendDist` and the window `url` at it — never the real
      config, reverted (`git diff` clean) the moment the check was done.

      **Honest limitation, not a false "verified":** couldn't get a
      pixel screenshot this pass — the same intermittent Screen Recording
      permission issue flagged earlier in this session came back (a
      full-screen capture returned solid black again; a region-based
      capture failed outright with "could not create image from rect"
      even after confirming the window's exact on-screen position via
      the same `outer_position()`/`outer_size()` debug-print technique
      used before — ruling out wrong coordinates as the cause). Tried
      three times across a few minutes rather than immediately giving up,
      then stopped rather than keep burning turns on a known-flaky
      permission. What this entry rests on instead: careful manual
      review (every `id` in `app.html` cross-checked against every
      selector in `app.css` — no typos), and the real desktop app's
      unified log confirming a clean page load (`didFinishDocumentLoadForFrame`/
      `didFinishLoadForFrame`) with no resource-load errors for `app.css`
      or any vendor asset. That's real evidence, not nothing — but it's
      not the same as seeing it render, and this entry says so rather
      than implying otherwise. Worth an actual look next time Screen
      Recording permission cooperates, before building further on top of
      this skeleton.

      **Resolved (2026-09-09).** Root cause of the flakiness: Screen
      Recording was granted to Ghostty, but the actual process invoking
      `screencapture` is the Claude Code CLI itself — a separate TCC
      grant. User confirmed and enabled it directly. Screenshots work
      reliably now.

      Visually confirmed the welcome state first (`app.html`, no
      document): the "Open a Markdown file to get started." message
      centered exactly as designed, sidebar/toolbar correctly invisible.
      Then tried the document-open state and it **stayed on the welcome
      screen** — a real bug, not the expected result, caught only by
      actually looking. Root-caused properly rather than guessed:
      `main.ts` is loaded via a plain `<script src="mdviewer.js">` in
      `<head>` (same placement as `renderer.html`'s own script tag), which
      executes synchronously during head-parsing — *before* `<body>` (and
      so `#welcome`/`#content`) exists in the DOM at all.
      `document.getElementById` returning `null` isn't an error, so
      nothing in the unified log or the 118 passing tests flagged it —
      the welcome screen just silently never went away, regardless of
      which page was open, exactly the kind of gap only real visual
      testing catches. Fixed by deferring the element lookup and
      `setContent` wrapping to `DOMContentLoaded` (immediate fallback if
      the script somehow loads after body-parsing) — `web/src/main.ts`.
      Re-verified: the compiled pipeline now correctly hides `#welcome`
      and shows `#content` once a document loads.

      While there, got the first real visual confirmation of the
      **compiled TypeScript pipeline** rendering KaTeX math and a full
      Mermaid diagram (all five platform nodes, edges, styling all
      correct) — `mdviewerApi.ts`/`math.ts`/`mermaid.ts` end-to-end
      through actual pixels, not just unit tests or a hand-written-JS
      baseline. Also re-confirmed the top of the document (headings,
      text formatting, lists, task checkboxes, table) pixel-matches the
      existing baseline exactly. `docs/project/screenshots/app-shell-{
      welcome,content,content-full}.png`. `tauri.conf.json` reverted
      cleanly after (`git diff` empty), 63/63 Rust and 118/118 web tests
      still green.

      **Flipped to production (2026-09-09).** Everything above was
      scratch-copy-verified only, the same caution Milestone D used
      before its own flip. With Sidebar+TOC and Toolbar both landed and
      real, the remaining gap between `app.html` and shipping was purely
      `tauri.conf.json` still pointing the window at `renderer.html` —
      closed by changing `windows[0].url` from `"renderer.html"` to
      `"app.html"` for real this time, not a scratch copy.
      `build.frontendDist` didn't need to change (already the real
      `Resources/Web` directory; `app.html` lives there too). No Rust
      code references `renderer.html` by name (checked, not assumed —
      grepped `src-tauri/src`; the two hits were comments) so nothing
      else needed touching. `renderer.html` itself is untouched and
      still a real, working page — just no longer the one the window
      loads by default, exactly as designed back when `app.html` was
      created as a new page rather than an edit.

      Verified on the real app, not a scratch copy: welcome state,
      document-loaded state, sidebar TOC, toolbar (Open/font-size/theme
      picker, the last one exercised live — see "Toolbar" above for detail),
      and cross-launch persistence (`restore_last_opened_document`
      reopened the last document automatically on a fresh relaunch, with
      the toolbar's `localStorage`-backed theme/font-size preferences
      surviving alongside it) —
      `docs/project/screenshots/production-flip-{content,theme-attempt,
      dracula,restore}.png`. Also verified on Android (see "Toolbar"
      above — same pass, since `tauri.conf.json` is shared across every
      platform, mobile included, so this flip reached Android too and
      needed the same reverification any Rust/shared-config change gets).

      **Noticed, not a bug**: `localStorage` under the desktop app's
      `tauri://localhost` origin persisted across the temporary
      scratch-copy runs and this real one — different `frontendDist`
      paths still share the same custom-scheme origin, so preferences set
      while scratch-testing showed up in the real app afterward (font
      size read back as 20, not the default 16, on first real launch).
      Expected behavior of origin-keyed browser storage, not a leak
      between "test" and "real" state in any meaningful sense — but worth
      knowing before mistaking a scratch-test's leftover state for a real
      app bug next time.

      Not yet touched by this flip: `MarkdownEditorView`'s equivalent —
      no editor exists, so this checklist item stays open until one does.
      Windows/Linux not re-verified (no hardware — see Milestone F); iOS
      not re-verified this pass either (see "Toolbar" above's note on the
      same gap for the toolbar-overflow fix specifically).

### Milestone F — package and verify on every target platform

Target platforms: macOS, Windows, Linux, Android, iOS.

- [ ] `tauri build` packaging config for each desktop platform (macOS,
      Windows, Linux)

      **macOS: real installable artifacts produced (2026-09-09)**, at the
      user's request ("Can you create installable items?"). `npm run
      tauri build` (real release build, `bundle.targets` already `"all"`
      in `tauri.conf.json`) produced a working `MDViewer.app` (5.6MB) —
      `src-tauri/target/release/bundle/macos/MDViewer.app`. The `.dmg`
      bundler's own script failed (`bundle_dmg.sh`'s AppleScript step,
      which arranges the Finder window/icon positions, hit "AppleEvent
      timed out (-1712)" — the same broad class of macOS automation-
      permission flakiness this session hit earlier for Screen Recording/
      Accessibility, now for Finder automation specifically); worked
      around it by building a plain `.dmg` directly via `hdiutil create`
      (MDViewer.app + an `Applications` symlink, the standard drag-to-
      install layout, just without the custom background/icon
      arrangement) — `src-tauri/target/release/bundle/dmg/
      MDViewer_0.1.0_aarch64.dmg` (3.8MB), mounted and its contents
      verified directly, not just assumed from a "created" message.

      Both are **ad-hoc signed only** (Tauri's default when no signing
      identity is configured) — deliberately not code-signed with a real
      identity or notarized, even though real ones exist in this
      machine's keychain (`security find-identity` turned up a
      "Developer ID Application: Rene Geers" identity, among others).
      Using someone's real Apple Developer identity to sign/notarize
      software is a real action on their account, not a build-config
      detail — flagged rather than silently used or silently skipped;
      ask before doing that if real distribution (no Gatekeeper warning
      on first launch) is wanted.

      Windows/Linux: not attempted, not possible from this machine as-is
      — Tauri's Windows bundler needs WiX/NSIS tooling that only runs on
      Windows, and Linux `.deb`/`.AppImage`/`.rpm` bundling needs to run
      on Linux (or a cross-build container setup, not present here). Real
      gap, not silently skipped — would need either that hardware/tooling
      or a CI-based build pipeline neither exists yet.
- [ ] Tauri mobile packaging/signing setup for Android and iOS

      **Android: a real installable debug APK produced (2026-09-09)**,
      same request as above. `npm run tauri android build --debug --apk
      --target aarch64` (arm64-only — virtually every real Android
      device — rather than the default universal build, which bundled
      all four ABIs into a 542MB file; arm64-only is 141MB) —
      `src-tauri/gen/android/app/build/outputs/apk/universal/debug/
      app-universal-debug.apk`. Not just "built" — actually installed
      (`adb install`) and launched on the `mdviewer_test` emulator,
      confirmed rendering correctly via screenshot. Debug-signed (the
      auto-generated Android debug keystore, same as every `tauri
      android dev` run this session used) — genuinely installable/
      sideloadable as-is, but not a Play-Store-ready release build:
      `build.gradle.kts`'s `release` build type has no `signingConfig` at
      all, so an actual release APK would come out unsigned and need a
      real keystore (a new one could be generated — that's a local,
      reversible action, not touching any of the user's existing
      identities — but wasn't done without asking, since it's still a
      new decision, not just flipping a build flag).

      **iOS: builds and installs on the Simulator only (2026-09-09).**
      `npm run tauri ios build --debug --target aarch64-sim` succeeded
      (after clearing a stale output directory left over from an earlier
      session's build, which made Tauri's own post-archive rename step
      fail with "Directory not empty" — the underlying `xcodebuild
      archive` itself had already succeeded) — `src-tauri/gen/apple/
      build/arm64-sim/MDViewer.app` (95MB). Installed and launched on the
      iPhone 17 simulator (UDID `F345EC60-0B0F-4160-A316-44C70B39E26F`),
      confirmed via screenshot. **Not installable on a real physical
      iPhone** — checked, not assumed: real Apple Development/
      Distribution signing identities exist in this machine's keychain,
      but no provisioning profile matches this app's bundle identifier
      (`org.devicemanager.mdviewer`); the one installed profile
      (`crowdsecmanagermobile.mobileprovision`) is for a different,
      unrelated app. A real-device build needs a profile registered to
      that specific device's UDID via Apple's Developer portal —
      interactive access this environment doesn't have and can't do
      headlessly. Contradicts this file's own earlier framing of iOS
      packaging as blocked purely on "missing Apple Developer
      credentials" — the credentials exist; what's missing is a
      device-specific provisioning profile, a different and smaller gap.

      **Real-device OTA install achieved and debugged live (2026-09-10),
      on the user's own iPhone 16 Pro Max ("triton").** The user obtained
      a real ad-hoc provisioning profile
      (`org.devicemanager.mdviewer`, team `64G8P2LG44`, one device,
      expires 2027-05-23) via the Developer portal and installed it on
      this Mac. `CODE_SIGN_STYLE = Manual`, `DEVELOPMENT_TEAM =
      64G8P2LG44`, `PROVISIONING_PROFILE_SPECIFIER =
      "org.devicemanager.mdviewer"`, `CODE_SIGN_IDENTITY = "Apple
      Distribution"` added directly to `src-tauri/gen/apple/
      mdviewer.xcodeproj/project.pbxproj` (both debug and release
      configs) — Tauri's default `"iPhone Developer"` identity doesn't
      match an ad-hoc distribution profile's certificate. `npm run tauri
      ios build --debug --target aarch64` then archives successfully,
      but Tauri's own `xcodebuild -exportArchive` step still fails
      ("requires a provisioning profile") since it doesn't generate a
      manual-signing `ExportOptions.plist` for ad-hoc — worked around by
      exporting manually: a hand-written `src-tauri/gen/apple/build/
      ExportOptions-AdHoc.plist` (method `ad-hoc`, matching team/
      identity/profile) plus a direct `xcodebuild -exportArchive` call,
      confirmed via `DistributionSummary.plist` matching every expected
      value (cert SHA1, profile UUID, team, bundle ID). Installed
      directly via `xcrun devicectl device install app` /
      `process launch` for fast iterate-test-fix cycles, bypassing
      Xcode's GUI entirely.

      OTA distribution (`itms-services://`) also built and verified
      working end-to-end this pass — a Caddy setup (Caddyfile +
      `serve/{install.html,manifest.plist,MDViewer.ipa,
      build-report.json}`) served locally on <lan-host>:4000 and tunneled
      through the user's existing Pangolin setup at
      `<ota-tunnel-host>`. Not part of this port's own build
      tooling (a manual/local workflow, not a script), but real and
      working — the user installed this exact build over the tunnel,
      not just via direct USB installs. (This tooling briefly lived at
      `ota/` in this repo; moved to a separate untracked local folder
      2026-09-13 once it turned out to carry this machine's LAN
      IP/hostname into project history — see `file-browser-plan.md`.)

      **Four real, live-found-and-fixed bugs came out of actually
      installing and using this build on real hardware — every one of
      them invisible to every prior desktop/simulator verification pass
      this whole port has done:**

      1. **CSP blocked every `invoke()` call, silently.** Tapping "Open…"
         did nothing at all — no crash, no error, no console output
         through any tool tried first (`devicectl --console`, which
         turned out to only capture native stdout/stderr, never JS-level
         events). First suspected a main-thread deadlock (the exact
         shape of the already-fixed Android `on_page_load` bug from
         Milestone D) and fixed `open_document_command` to be `async` +
         `tauri::async_runtime::spawn_blocking` — a real, correct,
         worth-keeping fix (documented in its own doc comment in
         `src-tauri/src/lib.rs`), but it didn't resolve the symptom,
         proving the real block was elsewhere. Root-caused properly
         after attaching Safari's Web Inspector directly to the real
         device (Develop menu → triton → the live page — the actual
         fix for the "no console output" problem, not a better guess):
         console showed "IPC custom protocol failed, Tauri will now use
         the postMessage interface instead — TypeError: Load failed" the
         moment Open was tapped. Confirmed in the vendored `tauri` crate
         source (`ipc/protocol.rs`) that Tauri's IPC transport fetches
         `ipc://localhost/{command}` — a scheme this app's own strict
         CSP (`connect-src 'self' mdviewer-local:`, a deliberate security
         invariant) never allowed. Added `ipc:` to `connect-src` in both
         `app.html`'s CSP meta tag and `tauri.conf.json`'s `security.csp`
         — confirmed fixed the same way it was found, live in the Web
         Inspector console: `get_remote_content_policy` round-tripped
         cleanly (`POLICY_SUCCESS — "ask"`), and `open_document_command`
         genuinely showed the real document picker on-screen.
         `renderer.html` has the identical gap but was deliberately left
         unfixed — porting-brief.md names it explicitly as a file that
         "moves across unchanged," an instruction this finding doesn't
         override on its own; flagged here for a decision rather than
         silently edited.
      2. **Dark mode never applied on first launch.** A fresh install on
         a system-dark-mode device still opened on GitHub Light.
         `renderViewModel.ts`'s `applySystemAppearance(isDark:)` already
         existed and was already correct (ported from
         `MarkdownRenderView`'s `.onChange(of: colorScheme)|.onAppear`)
         — it was simply never called from anywhere in this port. Now
         called once at toolbar-wiring time (`main.ts`) via
         `window.matchMedia("(prefers-color-scheme: dark)")`, plus a live
         `change` listener for the same reactivity Swift's environment
         value has. Only swaps between the two GitHub themes specifically
         (matches Swift's own narrow behavior) — doesn't silently
         override a user's Dracula/Nord/etc. pick.
      3. **The sidebar ate more than half an iPhone's width.** Reported
         directly by the user after seeing it live via screen mirroring
         (QuickTime Player, `idevicescreenshot` doesn't support modern
         iOS's disk-image-less Developer Mode). The always-visible
         240px-fixed in-flow column (matching Swift's `NavigationSplitView`
         default) is a reasonable amount of space on desktop/tablet, not
         on a ~430pt-wide phone. Per the user's own design ("a top menu
         where we can popup a transparent sidebar that has a selector for
         the chapters and moves away when selected"), rebuilt as a
         translucent slide-in drawer below a 768px breakpoint:
         `position: fixed` + `transform: translateX()` (not `display`,
         so the slide can animate), `backdrop-filter: blur()` +
         `color-mix()` for a theme-aware translucent background (plain
         `rgba()` fallback first for engines predating `color-mix()`
         support), a tap-outside-to-close scrim (`#sidebar-backdrop`),
         opened via a new toolbar hamburger button
         (`toolbar.ts`/`sidebar.ts`'s `openSidebar`/`closeSidebar`/
         `toggleSidebar`), and closed automatically on chapter selection
         — the user's own "moves away when selected." Hidden entirely
         above the breakpoint (`.sidebar-toggle-btn`'s own media query) —
         redundant there, the sidebar's already permanently visible.
         Verified via the Web Inspector console, not just a screenshot:
         `getBoundingClientRect()`/`getComputedStyle().transform` showed
         `x: -280` (fully off-screen, closed) and `x: 0` after the
         toggle button's real click handler fired (open) — a `.click()`
         dispatch through the exact same delegated listener a real tap
         uses, not a bypass, though no literal physical-touch simulation
         tool was available to test the finger-tap gesture itself.

      No new Rust tests this pass — `open_document_command`'s only change was
      its `async`/`spawn_blocking` signature, not new testable surface
      (74/74 `cargo test` still passing; unused-code warnings for
      `save_document`/`save_document_as`/`save_as_to`/`write_document`/
      `grant_folder_access` are this iOS build specifically flagging them
      as dead code, since mobile has no folder-picker or menu-triggered
      save path yet — expected, not a regression). 5 new `web/` tests
      (168/168, up from 163: `toggleSidebar`/`openSidebar`/
      `closeSidebar` in `sidebar.test.ts`, the sidebar-toggle button in
      `toolbar.test.ts`), `tsc --noEmit` clean, production bundle
      rebuilds clean (33.3kb). Not yet re-verified on Android or desktop
      after these four fixes — the CSP change in particular reaches
      every platform (same `app.html`/`tauri.conf.json`), so it's a real,
      not-yet-closed follow-up, not an oversight.

  - **Continuing the visual pass on emulators (2026-09-10, same day)** —
    the user's own framing after the four real-device fixes above: "it
    seems to work quite well... now we need to make it look beautiful,"
    explicitly moving verification off the physical device (`triton`) and
    onto the Android emulator (`mdviewer_test` AVD) and iOS Simulator, so
    iteration doesn't depend on a cabled phone. Found and fixed one more
    real regression from the toolbar/drawer redesign, this time on the
    emulator rather than real hardware:
    - **The mobile sidebar drawer's TOC heading rendered directly under
      the status bar clock/icons, unreadable** — caught on an Android
      emulator screenshot right after adding `viewport-fit=cover` +
      `env(safe-area-inset-*)` to give the drawer notch/status-bar
      clearance. First diagnosis ("cover mode breaks Android's inset
      compensation") was wrong and had to be corrected the same day:
      reverting `viewport-fit=cover` alone did **not** fix it — a fresh
      emulator screenshot after the revert showed the exact same overlap.
      Measured directly via Chrome DevTools Protocol against the
      emulator's WebView (`adb forward` to its `webview_devtools_remote_*`
      socket, confirmed reachable since Tauri Android debug builds are
      inspectable) rather than guessing further:
      `document.body.getBoundingClientRect()` and `#toolbar`'s both
      report `top: 0`. This WebView draws genuinely edge-to-edge for
      **all** in-flow content on this Android setup, not just
      `position: fixed` elements escaping some inset that in-flow content
      gets — the toolbar only ever looked fine by accident, because its
      own 40px icon buttons plus padding happen to almost clear a
      ~24-30dp status bar on their own, while the drawer's heading (the
      first thing in it, nothing above to absorb the overlap) didn't.
      `env(safe-area-inset-top)` can't help either way — it resolves to
      `0` on this WebView regardless of `viewport-fit`, confirmed the
      same way. No reliable in-page JS API reports the real inset without
      a native (Kotlin) bridge, out of scope for this pass. Fixed with a
      fixed, generous `padding-top: 36px` on both `#toolbar` and
      `#sidebar` at the mobile breakpoint (app.css) — checked empirically
      against this emulator rather than derived from any environment
      value, the same "good enough, checked visually" standard the user
      set for this whole pass. Applied identically on iOS rather than
      forking the CSS per platform, even though iOS's WKWebView never had
      this bug (it already insets in-flow content correctly); confirmed
      harmless there via an iOS Simulator screenshot of the drawer forced
      open — just a little extra breathing room, not a regression.
      `viewport-fit=cover` stays reverted (still genuinely inert on this
      Android WebView, cover or not, so no reason to re-add it);
      `app.html`'s viewport comment rewritten to reflect the corrected
      diagnosis rather than leave the first, wrong theory in place.
      Verified via CDP on a real rebuilt Android APK (not just a live JS
      patch) and via a forced-open iOS Simulator rebuild — both installs
      screenshotted with the drawer open and closed, no overlap either
      way. `tsc --noEmit` clean, 168/168 `web/` tests, production bundle
      34.4kb.

  - **Mobile UX review pass (2026-09-11)** — the user's request: "we still
    need a proper mobile UX design skill... the basics work but the
    design has improvement potential." No dedicated design skill exists
    in this project, so this was a manual review instead, screenshotting
    every screen at phone width on the Android emulator (CDP again, same
    `webview_devtools_remote_*` approach as the drawer fix above, used
    this time to force each state — welcome, search, preferences — since
    none of them are reachable through the demo doc's normal golden
    path) and judging against ordinary mobile-HIG expectations rather
    than Swift parity (none of this has a Swift source to diverge from —
    it's new chrome this port added, not a port of anything). Found one
    functional break and two real polish gaps:
    - **Find silently rendered the search bar entirely behind the
      toolbar** — not a visual nitpick, a full functional break: `hidden:
      false`, focusable, un-clickable, invisible. `#search` is `position:
      absolute; top: 8px` inside `#main`, and `#main` starts at the exact
      same y-coordinate as `#toolbar`'s own top (toolbar is `#main`'s
      first flow child) — `top: 8px` only ever cleared the toolbar by
      accident, back when the toolbar was one short row. The mobile
      status-bar padding added earlier in the 2026-09-10 pass made the
      toolbar taller and pushed `#search` completely underneath it.
      Fixed with a `--toolbar-h` custom property (main.ts's
      `wireToolbar`, measured via `getBoundingClientRect()` and kept in
      sync on resize/breakpoint changes) and `#search { top:
      calc(var(--toolbar-h, 56px) + 8px) }` instead of a bare constant —
      tracks the toolbar's real height at any breakpoint instead of
      guessing a number that only happens to work at one width. Verified
      on the Android emulator: `--toolbar-h` read back as `87.6px`,
      `#search`'s rendered `top` as `95.6px`, and a screenshot with Find
      open shows the bar cleanly below the toolbar.
    - **The empty/welcome state was a single centered gray sentence** —
      no icon, no button, nothing that reads as a designed screen; the
      only way to act on it was spotting the toolbar's small Open icon
      elsewhere on screen. Not a Swift-parity concern (`WelcomeView.swift`
      has real icon/button chrome this first TypeScript pass never
      carried over — flagged, not silently left). Redesigned (app.html/
      app.css): a muted inline-SVG document icon, a "No document open"
      heading, the original sentence demoted to a subtitle, and a real
      primary "Open File…" button wired in main.ts's
      `wireWelcomeContentToggle()` to the same `open_document_command`
      toolbar.ts's own Open button calls. Verified on both platforms via
      the emulator/simulator (forced visible via CDP on Android, via a
      temporary inline-style override rebuilt on iOS) — same design
      renders correctly on both, button dispatches the real command.
    - **Preferences' close button was a 24×24 tap target** — well under
      the ~44pt/48dp minimum comfortable touch target both Apple's HIG
      and Material land around. Bumped to a flush-corner 44×44
      `display:flex`-centered button (app.css's `.prefs-close`); the
      panel's own `overflow: hidden` + `border-radius` clips the button's
      outer corner for free, so it still reads as rounded despite being
      flush to the corner rather than inset.

    All three fixed in the same files already touched by the prior
    pass — no new modules. `tsc --noEmit` clean, 168/168 `web/` tests
    (no new tests added this pass — these are markup/CSS/positioning
    fixes with no new pure-function surface; the existing
    `appShell.test.ts` coverage of `#welcome`/`#content` toggling is
    against a synthetic DOM, unaffected by app.html's real markup
    content), production bundle 34.8kb. Not yet re-verified on desktop
    (macOS/Windows/Linux) or iOS on real hardware — emulator/simulator
    only, matching the user's explicit request to move iteration off the
    cabled phone for this kind of work.

  - **Fixed, auto-fading toolbar + font-size buttons dropped on phones
    (2026-09-11, same day)** — the user's own spec, close to verbatim:
    "the zoom buttons do not work very well here... these should perhaps
    be removed, since we have pinch to do zooming... top bar should also
    be fixed at the top, with an option to fade... come back when the
    content is zoomed or moved but stay at the top, then fade away to
    give more viewing space." Three changes, all mobile-breakpoint-only
    (`max-width: 768px`) — desktop's toolbar is untouched, A-/A+
    included, no pinch gesture there and no width pressure to justify
    losing them:
    - `.toolbar-group` (the A-/16/A+ font-size controls) hidden outright
      on phones — pinch-to-zoom covers scale adjustment there per the
      user's own call, freeing real width in a toolbar that was already
      tight (confirmed after the fix: the search/theme-toggle icons that
      were being pushed into the horizontal-scroll overflow at phone
      width now fit on screen without scrolling).
    - `#toolbar` changed from in-flow to `position: fixed` — a real,
      previously-unnoticed side effect of it sharing `#main`'s own
      `overflow-y: auto` scroll box: scrolling down to read a document
      scrolled the toolbar away with it, taking Open/Find/the sidebar
      toggle with it. `#main` gained a `padding-top: var(--toolbar-h)`
      (mobile only) to reserve the space the toolbar no longer occupies
      in-flow, reusing the same `--toolbar-h` custom property the
      2026-09-10 search-bar-position fix already introduced.
    - Auto-fade: new `toolbarAutoHide.ts` (`showToolbar`/`fadeToolbar`/
      `wireToolbarAutoHide`), wired from `main.ts`'s `wireToolbar` to
      `#main`'s `scroll` event plus `window.visualViewport`'s `resize`/
      `scroll` (the two events that actually fire for pinch-zoom and
      panning while zoomed — plain `window`/`document` scroll/resize see
      neither gesture). Starts visible, fades to `opacity: 0.06` with
      `pointer-events: none` after 2.5s of no activity, instantly
      reappears the moment any source fires — matches the user's
      "come back... then fade away" wording directly rather than a
      binary show/hide, and `pointer-events: none` while faded means a
      tap in that screen region reaches the content underneath instead
      of a barely-visible toolbar button.
    - **A real cascade-order bug caught live on the emulator, not just
      written and trusted**: the `.toolbar-group { display: none }`
      mobile override was first placed *before* the base (unconditional)
      `.toolbar-group { display: flex }` rule further down the file — a
      `@media` condition doesn't add specificity, so the later,
      always-applicable rule won regardless of viewport width, and the
      buttons silently stayed on screen at every breakpoint despite the
      override being textually present and served correctly (checked via
      `fetch("app.css")` from the running app itself, to rule out a stale
      asset before suspecting the cascade). Fixed by moving the override
      to after the base rule; re-verified via `getComputedStyle(...)
      .display` reading `"none"` at phone width.
    - **`adb exec-out screencap` itself proved unreliable mid-verification** —
      multiple screenshots came back several seconds stale (a fully
      blank splash-screen capture minutes after the app had actually
      finished loading and rendering real content, confirmed by querying
      the live DOM over the same CDP connection at the same moment).
      Not a repeat of the app-level "the archive isn't done yet" flake
      from the ad-hoc export step — this is the emulator's screenshot
      pipeline lagging behind its own compositor under repeated
      install/relaunch load. Resolved by treating CDP `Runtime.evaluate`
      reads (`document.readyState`, `getComputedStyle(...)`,
      `classList` before/after a dispatched event) as the source of
      truth for verifying behavior, using screenshots only for the
      visual/aesthetic confirmation once the DOM state was already
      independently confirmed correct — the fade-then-wake-on-scroll
      cycle in particular was proven this way (`toolbar.className` read
      `"toolbar-faded"` immediately before a synthetic `scroll` dispatch
      on `#main` and `""` immediately after, in the same synchronous
      call) after a screenshot taken a few seconds later than intended
      misleadingly showed the toolbar already faded again.

    8 new `web/` tests (`toolbarAutoHide.test.ts` — fade-after-delay,
    wake-and-reset-countdown, multiple independent sources, the
    non-mobile no-op case, and both directions of crossing the
    breakpoint — all via `vi.useFakeTimers()` and a trivial
    `MediaQueryLike` fake rather than a real `matchMedia`/real elapsed
    time), 176/176 total, `tsc --noEmit` clean, production bundle 36.0kb.
    Verified end-to-end on a real rebuilt Android APK (not just a live
    CDP patch) and a real iOS Simulator rebuild. Not yet re-verified on
    real iOS/Android hardware, or on desktop — emulator/simulator only,
    same standing gap as the rest of this mobile UX work.

  - **Search unusable on a real iOS device (2026-09-11, reported after
    the OTA build above reached triton)** — the user's report, verbatim
    enough to be the whole diagnosis: "loses focus when typing, marks
    all typed text then next character typed replaces all content, and
    done/enter does not search." A second, real-device bug layered on
    top of the desktop-verified debounce fix in search.ts's own header
    (that fix stops `window.find()` racing with fast keystrokes; it says
    nothing about the input's own selection state after refocusing).
    Root cause, reasoned from the symptom rather than reproduced directly
    (no cabled device this session — see plan.md's own running note on
    emulator-only verification for this whole mobile UX arc): `find()`
    moves the document's selection away from the input, and on iOS
    WKWebView a bare `input.focus()` afterward is enough to leave the
    input's *own* text fully selected — the standard "type over a
    selection replaces it" behavior explains the "next character
    replaces all content" symptom exactly, and once the query itself is
    corrupted that way, of course Enter/Done never finds anything
    meaningful. Fixed with a new `refocusInput()` helper (search.ts)
    used at all three refocus sites (the debounced input handler, Enter,
    Clear) that calls `input.setSelectionRange(end, end)` right after
    `.focus()` to explicitly collapse the caret, rather than trusting a
    bare `.focus()` to leave the previous selection alone. 2 new tests
    simulate the all-selected state directly (`input.setSelectionRange(0,
    5)` before dispatching the input/Enter event) and assert the
    collapse — jsdom's own `.focus()` doesn't reproduce the select-all
    quirk itself, so these can't catch a regression back to a bare
    `.focus()` by testing focus alone, only that the explicit collapse
    call actually runs on every refocus path. 178/178 `web/` tests,
    `tsc --noEmit` clean. Shipped straight to a fresh OTA build (ad-hoc
    archive/export, same workaround as every prior OTA build this
    project) rather than verified on-device first — the underlying
    WebKit quirk doesn't reproduce in the Simulator, so there was no way
    to confirm the fix before getting it back onto the real phone; the
    build report/install page both say so explicitly and ask for a
    specific retest (type a query, confirm no character loss, confirm
    Enter/Done actually jump to a match).

  - **File-association registration (2026-09-11, same day)** — the
    user's own request, after confirming search worked: "get a file
    extension registered so a .md file will show/open in mdviewer." A
    real, previously-flagged gap, not a new discovery — the test-only
    `MDVIEWER_TEST_DOCUMENT_PATH` hook's own doc comment already said as
    much ("confirmed 2026-09-08 that neither AndroidManifest.xml nor the
    iOS Info.plist Tauri generates declares any document-opening intent-
    filter/document-type... there is currently no way at all to get a
    document into the app on iOS/Android without this"). Two halves:

    1. **Registration** — telling each OS the extension exists and this
       app handles it. Tried by hand first (a `CFBundleDocumentTypes`/
       `UTImportedTypeDeclarations` block in `gen/apple/mdviewer_iOS/
       Info.plist` mirroring `MDViewer/Info.plist`'s own macOS
       declaration for `net.daringfireball.markdown`, and a pair of
       Android `<intent-filter>`s in `gen/android/.../AndroidManifest.xml`)
       — then **discovered mid-implementation, by reading
       `tauri-utils`' vendored source, that this is unnecessary**: Tauri
       2 has a real `bundle.fileAssociations` config field
       (`tauri.conf.json`) whose doc comments explicitly claim it maps to
       `CFBundleDocumentTypes`/`UTExportedTypeDeclarations` on iOS *and*
       `<intent-filter>` `<data>` elements on Android *and* desktop's own
       bundler — confirmed empirically, not just from the doc comment: a
       plain `npm run tauri ios build`/`android build` regenerated
       exactly those entries into each generated project's own config
       file, unprompted, the moment `bundle.fileAssociations` existed.
       The hand-written blocks were removed once this was confirmed,
       leaving `tauri.conf.json` as the single source of truth for all
       three platforms rather than three hand-maintained declarations
       that could silently drift from it — each generated file's own
       comment documents this discovery process rather than presenting
       the config-driven approach as though it were obvious from the
       start (it wasn't; the tauri-utils source had to be read to find
       it, and the hand-written version really was tried and shipped-
       then-replaced, not merely considered). Android's own auto-
       generated filter turned out to also cover `ACTION_SEND`/
       `SEND_MULTIPLE` (share-sheet delivery), which the hand-written
       version hadn't — a real improvement over the manual approach even
       for platform behavior, not just maintenance burden.
    2. **Receiving** — actually loading the file once the OS hands it
       over. New `PendingOpenedDocument`/`INITIAL_LOAD_COMPLETE`
       (src-tauri/src/lib.rs) plus a `RunEvent::Opened` handler in a new
       `.build(context)?.run(|app, event| ...)` closure (replacing the
       old bare `.run(context)` shorthand, which silently discards every
       run event) — `RunEvent::Opened` is a real, cross-platform Tauri
       event (confirmed in the vendored `tauri` crate: `cfg`-gated to
       exactly macOS/iOS/Android, not invented per-platform here) firing
       for both a cold launch (app not running when the file was tapped)
       and a warm one (already running). Slots into the existing
       `on_page_load` priority chain Swift's own `ContentView.onAppear`
       already documents (test-hook, then this, then
       `restoreLastOpened()`) for the cold case, since no window/JS
       runtime exists yet to render into; renders directly, off the
       calling thread via `tauri::async_runtime::spawn` (same on_page_load
       UI-thread-deadlock precaution documented right above it in the
       same file), for the warm case, since the window's already known
       ready. `render_file`'s own `url::Url::to_file_path()` conversion
       (already used by `classify_link` for in-document links) is reused
       unchanged.

    **Verified genuinely end-to-end on the Android emulator, both cold
    and warm** — not just built and trusted. Cold: force-stopped the app,
    dispatched `adb shell am start -a android.intent.action.VIEW -d
    file://... -t text/markdown`, confirmed via live CDP DOM inspection
    that the tapped file's content actually rendered (not the debug-only
    `MDVIEWER_TEST_DOCUMENT_PATH` fixture, which had to be moved aside
    first — it's the highest-priority step in the same chain and was
    silently masking whether the real path worked at all on the first
    attempt). Warm: dispatched a second `VIEW` intent while already
    running, confirmed `onNewIntent`/`Rust.onNewIntent` (the generated
    Kotlin's existing wiring, not something added here) delivered it and
    the new document replaced the old one live. A real permission
    footgun surfaced and was corrected for during this verification, not
    a claim about production behavior: dispatching a raw `file://` URI at
    another app's *private* storage from `adb shell` fails with
    `Permission denied` (scoped storage) — an artifact of that manual
    test technique, not a real "Open with" flow, which always carries an
    OS-granted URI permission; worked around by placing the test file
    somewhere the target app's own uid can read, to isolate testing the
    actual event-handling code path from an unrelated storage-permission
    question.

    **Real, deliberately-scoped-out gap, flagged rather than silently
    left**: `RunEvent::Opened`'s URL is only handled when it converts via
    `to_file_path()` — a genuine `file://` URI. Most real Android "Open
    with"/share-sheet flows instead deliver a `content://` URI (a
    `DocumentsProvider`/`FileProvider` handle, not a real filesystem
    path) — Android's own auto-generated intent-filter's `SEND`/
    `SEND_MULTIPLE` actions in particular are share-sheet-only and
    essentially guarantee one. That currently falls through silently:
    no crash, just nothing renders. `tauri-plugin-fs`'s Android-specific
    `Fs::open`/`resolve_content_uri` (read directly, not assumed) already
    solves exactly this via a real Kotlin `ContentResolver` call behind a
    file-descriptor JNI bridge — not added this pass, since it also needs
    a real design decision for what `content://` documents mean for
    `CurrentDocumentState`'s PathBuf-keyed model (no real filesystem path
    exists for them, so watching-for-external-changes and any future
    relative-image resolution can't apply the same way) rather than being
    a drop-in. iOS has no equivalent gap — document delivery there always
    copies into the app's own sandboxed Inbox as a real, directly-
    readable `file://` path (confirmed via `LSSupportsOpeningDocumentsInPlace:
    false`, deliberately set rather than left to Xcode's implicit
    default — see that key's own Info.plist comment), so the exact same
    `to_file_path()` path Swift-parity code already uses just works
    there with no Android-style follow-up needed.

    Also added, low-cost and free of the above gap since it only affects
    desktop packaging: `tauri.conf.json`'s `bundle.fileAssociations` now
    also covers what a `tauri build` actually produces for macOS/Windows/
    Linux — not independently verified with a real desktop build this
    pass (this whole session has been mobile-only per the user's own
    redirect), but low-risk since it's pure additive config consumed only
    by the bundler, not app runtime code.

    74/74 `cargo test`, 178/178 `web/` tests (untouched by this pass —
    no new pure-function surface, this is host-glue plus generated-config
    changes), `tsc --noEmit` clean. Shipped to a fresh OTA build — iOS
    document-type/Share-sheet resolution isn't something the Simulator
    can stand in for credibly, so this is genuinely first-tested-on-the-
    real-device territory, flagged as such in the build report.

  - **File association didn't actually work on the real device (2026-09-11,
    reported after the build above)** — "It did not work," plus, after a
    full delete-and-reinstall specifically to rule out a stale document-
    type cache (still nothing): MDViewer never appeared at all in the
    Files app's own long-press menu for a `.md` file. Two compounding
    causes, not one:
    1. `gen/apple/mdviewer_iOS/Info.plist`'s `LSSupportsOpeningDocumentsInPlace`
       had been hand-set to `false` in the *previous* pass, reasoned (wrongly)
       from "this port has no editor, so it never writes back to a
       document." That reasoning doesn't apply to this key at all — it's
       not about editing, it's about whether the app can be handed a
       *live* reference to a document still sitting in Files/iCloud
       Drive versus only ever a disposable copy. Files' own long-press
       "Open"-type surface (distinct from the classic
       `UIActivityViewController` share sheet, which the earlier
       `CFBundleDocumentTypes`/`LSItemContentTypes` declaration alone is
       enough for) appears to specifically require in-place support
       before listing an app there at all. Flipped to `true`.
    2. Flipping that flag alone would not have been sufficient even if it
       had been caught immediately — confirmed by reading `tao` 0.35.3's
       actual iOS bridge (`platform_impl/ios/scene.rs`'s
       `scene:openURLContexts:`), not assumed: it converts the incoming
       `NSURL` straight to a plain Rust `url::Url` **string**, with no
       `startAccessingSecurityScopedResource` call anywhere in that path.
       A live Files/iCloud Drive document delivered this way needs that
       call before it's readable at all — nothing upstream in Tauri/tao
       does it automatically, a genuine, structural (if narrow) gap in
       the framework itself, not something this port did wrong
       elsewhere. Fixed by adding `scoped_bookmarks::access_url` (new
       function, same module the folder-access bookmark work already
       uses) — reconstructs a *fresh* `NSURL` from the URL's **string**
       form via `NSURL::URLWithString` (not `fileURLWithPath`, which
       `Bookmark::create` already uses for a different, already-
       accessible-path case) and calls
       `startAccessingSecurityScopedResource` on that. Confirmed this is
       a real, working pattern and not a guess: `tauri-plugin-fs`'s own
       iOS implementation (`ios.rs`, read directly — not a dependency of
       this project) hits the identical problem for its own `open()`
       command and fixes it exactly the same way, independently
       confirming the approach rather than this being a novel technique
       invented here. `render_opened_document` (new, replacing the
       inline `render_file` calls at both `RunEvent::Opened` call sites)
       brackets the read with this guard, dropped immediately after —
       `PendingOpenedDocument` had to change from storing an already-
       converted `PathBuf` to the URL's raw string, since the string
       form (not the path) is what `access_url` actually needs; the
       `PathBuf` conversion now happens inside `render_opened_document`
       itself, after the scope is already live.

    **Real, deliberately-scoped-out gap, flagged rather than silently
    left**: the scope guard is dropped right after the initial read, not
    held for the document's whole lifetime — `render_file` also starts a
    debounced file-watcher for external changes, and re-reading after an
    external edit would need the same scope to *still* be live at that
    later, unpredictable time. Solving that needs somewhere to persist a
    live `ScopedAccess` per current document (the same shape
    `GrantedFolderAccess` already does for granted folders), which is
    more than this particular fix needed to land — not built this pass.
    A locally-dialog-picked or in-app-linked document was never affected
    by any of this (those paths never went through `RunEvent::Opened` at
    all), and Android has no analogous gap here — `access_url` is
    `cfg`-gated to macOS/iOS only and nothing on Android calls it; that
    platform's own equivalent problem (a `content://` URI's file
    descriptor, a completely different mechanism from an iOS security-
    scoped file URL) stays tracked separately, in
    `AndroidManifest.xml`'s own comment on this same feature.

    74/74 `cargo test` (`cargo check --target aarch64-apple-ios` also run
    directly, not just assumed from the macOS build, since this pass's
    entire bug was an iOS-specific Cocoa-API behavior a desktop-only
    build could never have caught), `tsc --noEmit`/178 `web/` tests
    untouched (no web-layer change this pass). Shipped to a fresh OTA
    build; still not independently confirmed working on the real device
    by this session — the build report asks for the exact same retest
    (long-press a `.md` file in Files, confirm MDViewer is offered,
    confirm tapping it actually loads the content and not just that the
    app opens).

  - **Confirmed working (2026-09-12), two smaller follow-ups reported** —
    "It worked!" File-association opening is genuinely closed out as of
    this confirmation, not just shipped-and-hoped. Two remaining reports,
    handled differently since only one is actually fixable from this
    side:
    - **Another already-installed app kept winning as the default .md
      handler.** `tauri.conf.json`'s `bundle.fileAssociations` entry had
      never set `rank` at all, defaulting to `LSHandlerRank: Default` —
      a real, fixable gap, not a platform limitation: MDViewer is also
      the app *exporting* `net.daringfireball.markdown` on this device
      (`exportedType` in that same config entry), which is exactly the
      case Apple's own `LSHandlerRank.Owner` ("this app is the primary
      creator/authoritative source of files of this type") describes —
      confirmed via `tauri-utils`' `HandlerRank` enum doc comments, not
      guessed. Set `"rank": "Owner"`; confirmed present in the exported
      IPA's `Info.plist` (`LSHandlerRank: Owner`) before shipping. Not
      yet confirmed this actually wins the resolution against the other
      app on the real device — iOS's exact tie-breaking behavior when
      multiple apps claim a UTI isn't something this session can verify
      without the retest.
    - **No "Always open with MDViewer" setting in Files.** Explained,
      not chased as a bug: iOS has no general per-file-type default-app
      setting the way Android's file managers do — Apple's own Default
      Apps settings (Settings app) cover a small fixed set of categories
      (browser, mail, messaging, similar), not arbitrary third-party
      document types/UTIs. The manual "Open In" chooser already working
      is the actual extent of what iOS gives a third-party app for a
      file type like this; there is no Info.plist key or Tauri config
      that changes this, so no code change was attempted for it.

    74/74 `cargo test`, config-only change (no Rust logic touched this
    pass — `tauri.conf.json` plus the regenerated `gen/apple` Info.plist
    only). Shipped to a fresh OTA build; the `Owner`-rank fix specifically
    still awaits its own real-device confirmation.

  - **Mobile file browser + toolbar reorganization — planned 2026-09-12** —
    the user's own request: file browsing should become the most prominent
    action (left of the toolbar), with Search/Index/Settings consolidated on
    the right and theme/font controls finally moved into Preferences'
    long-stubbed Appearance tab. Explicitly requested as "a big change" with
    its own phased plan and a verification step per phase — full plan saved
    at `/Users/rene/.claude/plans/staged-fluttering-octopus.md` (Claude Code's
    plan-mode file, not part of this repo). Summary of the approach and the
    real risk driving its ordering:
    - Reuses `sidebar.ts`'s drawer primitives (`openSidebar`/`closeSidebar`/
      `toggleSidebar` — already fully generic, zero TOC-specific logic) and
      `resolve_local_path`'s existing `folder_covers`/`DocumentBaseDir`/
      `GrantedFolders` access-control model as-is for the new directory-listing
      command — no new grant mechanism invented for mobile. Confirmed via
      code reading (not assumed) that `request_folder_access` is genuinely
      `#[cfg(desktop)]`-only with an explicit `#[cfg(mobile)]` branch that
      always returns `false` — there is no folder-picker on mobile at all, so
      "Browse" there can only ever mean "browse within the current document's
      own folder," never an arbitrary one. That's treated as an honest
      reflection of the platform, not a limitation of this feature.
    - **The plan front-loads a real-device risk spike (Phase 0) before any
      caching/UI work**, because it's genuinely unverified whether
      `std::fs::read_dir` on a document's folder will even work on iOS when
      that document arrived via the `RunEvent::Opened`/`access_url` file-
      association path (2026-09-11's work) — that security scope is (a)
      dropped immediately after the file read today, a known, already-
      documented gap in `render_opened_document`'s own comment, and (b) not
      proven to extend from a single file's URL to its parent directory's
      listing at all. This exact shape of surprise (a reasonable Apple-API
      assumption, wrong on first real-device attempt) has already cost
      several round-trips this session — `LSSupportsOpeningDocumentsInPlace`,
      the CSP `ipc:` gap, `access_url`'s own URL-string-vs-path-based
      construction. Caching/UI work explicitly waits on this answer rather
      than being built on an unverified assumption.
    - Caching: one new localStorage key (`mdviewer.folderCache`, matching the
      existing `mdviewer.<camelCaseName>` convention), a versioned JSON map
      keyed by the *canonical* path Rust returns, capped to ~20 most-recently-
      used folders, evicted oldest-first — the first structured-JSON value
      this app has ever stored (every existing stored value is a plain string/
      number), flagged as needing its own explicit corrupt-JSON-degrades-
      gracefully test rather than assuming the existing try/catch convention
      generalizes correctly by inspection alone.
    - Live refresh: poll-on-drawer-reopen ships first; a real `notify`-based
      directory watcher plus the frontend's first-ever use of Tauri's
      `event.listen` (only `invoke` has ever been used from this frontend)
      is deliberately deferred to its own later, optional phase, so two
      pieces of genuinely untested plumbing don't land in the same phase.
    - Toolbar: three separate, visually-grouped icon buttons on the right
      (Find/TOC-index/Settings) rather than a new consolidated popover/
      action-sheet component — confirmed with the user directly (a popover
      would be real new UI-pattern surface this codebase has zero precedent
      for; the Preferences modal's existing full-screen-overlay pattern is
      reused instead for "settings," not a new anchored popover).

    **Phase 0 (spike) shipped as an OTA build this same day** — a debug-only
    `spike_read_dir_variants` command plus an automatic `[spike-a]` console
    log inside `render_opened_document` itself, testing three variants: (a)
    listing the parent directory while the file's own `access_url` guard is
    still held (checked automatically on the next file-association open),
    (b) a bare `read_dir` with no fresh scope at all (tests whether access
    persists once the original scope is long gone), (c) `read_dir` after
    reconstructing the *directory's own* URL string and calling `access_url`
    on that directly (tests whether a scope constructed fresh for the
    directory itself works, independent of the file's own scope). 74/74
    `cargo test`, `cargo check --target aarch64-apple-ios` clean. Real-device
    results not yet in — Phase 1 (the `list_directory` Rust command itself,
    desktop-verifiable, independent of this spike's outcome per the plan's
    own phase-ordering) proceeds in parallel while the retest happens.

    **Phase 1 — `list_directory` command, done and verified on desktop.**
    New `#[tauri::command] list_directory(app, path: Option<String>)`, thin-
    wrapper-plus-pure-inner-function split (`list_directory_at`), same shape
    as every other command in this file. Real refactor alongside it, not
    just new code: `resolve_local_path`'s own `within_base || within_granted`
    check was extracted into a new shared `path_is_accessible(base_dir,
    granted_folders, target)` predicate, so the file-browser's access rules
    and the existing image/resource-URL access rules can never quietly
    drift apart into two different definitions of "accessible" — confirmed
    the refactor was behavior-preserving by running `resolve_local_path`'s
    own 7 existing tests unchanged before writing a single line of new
    code, not just assumed from reading the diff. `list_directory_at`
    filters to subdirectories and the same four extensions
    (`md`/`markdown`/`mdown`/`mkd`) the 2026-09-11 file-association work
    already declared to the OS — deliberately not reusing `classify_link`'s
    narrower two-extension check, a different, already-documented scope.
    Returns the *canonical* listed path (not whatever path string was
    asked for) specifically for the frontend's planned cache key. Errors
    are plain `Result<T, String>` (matching every other command here, not
    a new enum-shaped convention) but with a stable `kind:` prefix
    (`not_found:`/`access_denied:`/`permission_denied:`) a caller can match
    on without parsing the full message.

    9 new Rust tests (83/83 total): base-dir listing, folders-before-files-
    then-alphabetical sorting, empty folder, nested subdirectory within the
    base dir, the same outside-base-dir access-denied/granted-folder
    boundary `resolve_local_path`'s own tests already cover (must behave
    identically now that both share `path_is_accessible`), a file (not a
    directory) treated as not-found, and a real `chmod 000` permission-
    denied case on Unix — skips itself (rather than asserting a brittle
    root-detection check) if the environment doesn't actually enforce the
    permission bit (e.g. running as root), checking the real outcome
    instead of pre-guessing whether the check would be meaningful.
    `cargo check --target aarch64-apple-ios` clean throughout.

    **Phase 2 — drawer primitive generalized, done and verified.** New
    `web/src/drawer.ts`: `openDrawer`/`closeDrawer`/`toggleDrawer`, moved
    verbatim out of `sidebar.ts` (they never had any TOC-specific logic —
    just an `.open` class toggle on whatever elements are passed in) and
    renamed for the generic concept. `app.css`'s mobile drawer treatment
    (`position: fixed`/`transform`/frosted-glass background/backdrop-
    filter) generalized from literal `#sidebar`/`#sidebar-backdrop`
    selectors to shared `.drawer`/`.drawer-backdrop` classes, applied via
    `class="drawer"`/`class="drawer-backdrop"` in `app.html` alongside the
    existing IDs (IDs stay for lookup, classes for styling) — ready for the
    in-app file browser's own drawer (Phase 3/4) to reuse without
    duplicating the whole block. `sidebar.ts`/`toolbar.ts`/
    `toolbarAutoHide.ts`'s own comments referencing the old names updated
    to point at the new module rather than left stale.

    Verified as a genuinely behavior-preserving refactor, not just assumed:
    the CSS specificity trick `#sidebar-backdrop.open` relied on (beating
    the browser's own `[hidden]{display:none}`) was ID+class specificity
    before; the generalized `.drawer-backdrop.open` relies on two-class
    specificity instead — checked this is still numerically higher
    (0,2,0 vs. the attribute selector's 0,1,0), not just carried over by
    assumption. 179/179 `web/` tests (net +1: the 4 drawer tests moved out
    of `sidebar.test.ts` into a new `drawer.test.ts`, plus one new test
    proving two independent drawer instances open/close without shared
    state — relevant now that a second real drawer is coming), `tsc
    --noEmit` clean, production bundle unchanged at 36.2kb (a pure move,
    no new logic). Rebuilt the Android debug APK and confirmed via live
    CDP inspection — `.drawer`/`.drawer-backdrop` classes present,
    `toggleDrawer` still correctly slides the TOC drawer in
    (`transform: matrix(1,0,0,1,0,0)`, i.e. `translateX(0)`) — and a fresh
    emulator screenshot showing the drawer visually identical to before
    the refactor (frosted glass, blur, scrim, status-bar clearance all
    intact). One real gotcha hit and resolved during this check: the first
    `getComputedStyle().transform` read landed mid-CSS-transition
    (`matrix(1,0,0,1,-280,0)`, still closed) purely from reading it in the
    same tick as the click — re-read a moment later showed the correct
    open state; not a bug, just a reminder that a transitioned property
    needs to be read after the transition, not immediately after the
    triggering event.

    **Phase 3 — `fileBrowser.ts` module, done and verified (no wiring yet,
    as planned).** New module following the exact `render*()`/
    `attach*Handlers(container, callbacks)` split every other feature
    module here uses, with zero `invoke` calls inside it — matches the
    established untested-boundary convention (`invoke` only ever appears
    in main.ts's `wire*` glue across this whole codebase). Grepped
    `AppDelegate.swift` directly before writing a line of this — confirmed
    the Swift reference app has no folder-browsing UI at all, only a flat
    "Open Recent" MRU menu (`NSDocumentController.recentDocumentURLs`), a
    genuinely different, much simpler mechanism — so this is new UX with
    no parity target, not a port, flagged as such rather than silently
    presented as one.

    Covers: a disabled "Open a document to browse its folder" state for
    the first-run-bootstrap case (no `DocumentBaseDir` exists yet, and
    mobile has no fallback picker); loading/error/empty states, each still
    showing the up-navigation row so a failed refresh or an empty folder
    never strands the user unable to go back up; folders-then-files
    rendering with `data-action="navigate"`/`"open"`/`"up"`. Deliberately
    does no path-separator arithmetic anywhere in this module (no joining
    a folder path with an entry name, no computing "the parent path") —
    callbacks only ever hand back a bare `name`, and the caller (main.ts's
    wiring, Phase 4) is the one place that already knows the current path
    and does the joining, rather than duplicating cross-platform path
    logic in a module that's supposed to just be rendering plus cache
    reads/writes.

    Cache implementation matches the plan's design exactly: one
    `mdviewer.folderCache` localStorage key (matching every other stored
    value's `mdviewer.<camelCaseName>` convention), a versioned JSON
    object (`{v, folders: {...}}`) so a future schema change can detect
    and discard old-shaped data instead of `JSON.parse` succeeding into
    the wrong shape silently, capped at the 20 most-recently-used folders
    with oldest-`cachedAt` eviction, keyed by whatever canonical path the
    caller supplies (Phase 4 will supply `list_directory`'s own returned
    `DirListing.path`, not a client-guessed one).

    21 new `web/` tests (200/200 total): every render state including the
    up-row-present/absent boundary, all three click actions plus the
    "click landed on nothing relevant" and "delegation survives a
    wholesale re-render" cases already established for the TOC/toolbar's
    own tests, cache round-trip/independence/overwrite, and — flagged in
    the plan as needing its own explicit coverage rather than assumed —
    three dedicated malformed-cache tests (invalid JSON, a mismatched
    version tag, and a value that parses fine but isn't the right shape at
    all), plus one eviction test. One real, if minor, test-authoring bug
    caught and fixed during this pass, not shipped: an "escapes entry
    names" test asserted `container.innerHTML` never contains the raw
    `<script>` substring — a false negative, since jsdom's own `innerHTML`
    *getter* re-serializes attribute values without escaping `<`/`>`
    (only `&`/the matching quote need escaping there), so a correctly-
    escaped `data-name="&lt;script&gt;.md"` parses safely and then re-
    serializes back to a literal `<script>.md` on read — not an XSS bug,
    a serialization-format detail unrelated to correctness. Fixed by
    asserting the actual security property instead (`querySelector
    ('script')` is `null`), matching how `sidebar.test.ts`'s own
    equivalent test already sidesteps this exact non-issue by never
    putting that literal substring in an attribute position. `tsc
    --noEmit` clean; production bundle unchanged at 36.2kb, correctly
    reflecting that nothing imports this module into main.ts yet — that's
    Phase 4's job.

  - **Plan revised mid-implementation (2026-09-12), at the user's
    direction** — "the security-scope handling should be a question to the
    user and handled before the filebrowser is invoked. Preferably with a
    question that covers all the security questions at once." Two follow-up
    decisions confirmed with them directly rather than assumed: the
    consolidated prompt shows **at first launch** (not lazily on first
    Browse), and iOS gets a **real native folder picker** (not the cheaper
    "scope the browser to whatever folder a document came from"). Recorded
    honestly at decision time, since it constrains what the prompt can
    actually promise: an in-app consent dialog *cannot itself* grant iOS
    filesystem access — only the OS picker can hand over a security-scoped
    URL — so the dialog is a consent/explanation layer that triggers each
    platform's real grant mechanism, never a substitute for one.

    **`permissions.ts` — the consolidated prompt.** One dialog asking both
    security questions together (folder access, and the existing
    remote-content Ask/Always/Never policy), following the same
    `render*()`/`attach*Handlers(container, callbacks)` split and
    zero-`invoke`-inside-the-module rule as every other feature module.
    Includes a `mdviewer.permissionsPromptSeen` flag on the usual
    localStorage convention — deliberately *not* stored alongside the real
    grants on the Rust side, and deliberately failing *open* (a garbage or
    missing value means "not yet seen", so the prompt simply shows again):
    it's a pure UI fact, and anything actually security-relevant must be
    read from the real grants (`GrantedFolders`/the bookmark store), never
    from a value any page could clear. 16 new tests.

    **Native iOS folder picker (`ios_folder_picker.rs`).** The deep piece.
    Confirmed necessary by reading `tauri-plugin-dialog`'s own
    `ios/Sources/DialogPlugin.swift` rather than assuming: it *does* call
    `UIDocumentPickerViewController(forOpeningContentTypes:asCopy:)` with
    `asCopy: false` — real security-scoped access to the original, not a
    sandbox copy — but its Rust-facing API builds its allowed-types list
    only from file extensions and MIME types (`parseFiltersOption`), and a
    folder has neither, so `UTType.folder` is unreachable through it.
    Built on `objc2-ui-kit` (already in the dependency tree; pinned to the
    same 0.3.2 generation as `objc2-foundation`, feature-gated down to the
    five classes actually used) with a `define_class!`-declared
    `UIDocumentPickerDelegate`. Uses the *deprecated*
    `initWithDocumentTypes:inMode:` initializer with `"public.folder"` +
    `UIDocumentPickerMode::Open` — a deliberate trade, flagged rather than
    hidden: the modern initializer would mean adding
    `objc2-uniform-type-identifiers` purely to name one constant, and
    `tauri-plugin-dialog`'s own `showFilePickerLegacy` still uses this same
    initializer today, so it's a live path rather than a fossil.

    Three details that are load-bearing rather than incidental, each
    written down where the next reader will hit them: the picked URL is
    handed back as a **string**, not a `PathBuf`, because the security
    scope belongs to that specific `NSURL` instance — the caller
    re-acquires it via `scoped_bookmarks::access_url` (built the day before
    for exactly this on the file-open path) *before* canonicalizing or
    bookmarking, since doing it the other way round is precisely the bug
    that cost a real-device round-trip on 2026-09-11. The delegate is
    deliberately `mem::forget`-leaked, because UIKit holds its delegate
    weakly and nothing else owns it once presentation returns — dropping it
    would crash on the first callback. And `request_folder_access` became
    `async` + `spawn_blocking`: a non-async Tauri command runs inline on
    the calling thread (the same `tauri-macros` reading that fixed
    `open_document_command`), which on iOS is the main thread — and the
    delegate callback the picker blocks on can only fire *on* the main
    thread, so a sync version would deadlock the app outright. Guarded
    rather than merely documented: `pick_folder_blocking` returns an error
    if it ever finds itself on the main thread, which is a far easier
    failure to diagnose than a freeze.

    Compiles clean on all three targets (`aarch64-apple-ios`,
    host/macOS, `aarch64-linux-android` — Android keeps an explicit
    unsupported branch, since its own access model is a Storage Access
    Framework `content://` URI, a different mechanism entirely, tracked
    with the rest of the Android content-URI gap). 83/83 `cargo test`,
    216/216 `web/` tests. **Not yet run on a real device** — the picker has
    never actually been presented; that is the next verification step, and
    nothing about "it compiles" should be read as "it works," least of all
    for UIKit delegate plumbing. (Superseded in part 2026-10-07: the
    picker was first actually presented that day — on the simulator, see
    the entry below; the real-device gap stands.)

  - **Grant-above-document / grant-before-document fixed and verified
    end-to-end on the iOS Simulator (2026-10-07, committed `6f14d51`)** —
    the real-device report from 2026-09-17 ("granting a folder above the
    current document's folder... from here it cannot navigate to any
    other folder", plus its first-launch variant: a grant made before any
    document was open produced no folder view at all) had two genuine
    bugs behind it, both in the TS port rather than in the iOS
    access-control layer:

    1. `list_directory` returned `not_found: no document open yet` *before*
       it ever consulted `GrantedFolders` — a grant with no document open
       was simply unreachable, which is the common case for the
       first-launch prompt itself. It now falls back to the most recently
       granted folder as the browse root; `DocumentBaseDir` still wins
       unchanged once a document is open, so every other caller behaves
       exactly as before.
    2. `wirePermissions` never handed a successful grant to the file
       browser — Done only refreshed the modal's own folder list.
       `wireFileBrowser()` now also returns `openTo(path)` (`show` +
       `openDrawer`, deliberately never toggling the drawer shut), and
       `wirePermissions` calls it with the path just granted (the last
       entry of the re-read, authoritative `list_granted_folders` —
       `grant_folder_access` always appends).

    The ancestor shape itself was never an access-control bug: the pure
    `list_directory_at` logic already resolved grants above `base_dir`
    correctly, now pinned by 2 new ancestor tests alongside 4 new
    fallback/preference tests (6 new total; 89 Rust, 215 web, `tsc`
    clean, `mdviewer.js` rebuilt from `web/src`).

    Verified by running it, on the device-matched simulator (iPhone 16
    Pro Max, iOS 18.5) rather than the desktop, since every leg of this
    is mobile-only — driven by Maestro (`JAVA_HOME=$(brew --prefix
    openjdk@17)`; `--device <udid>` is a *global* flag before the
    subcommand): fresh install → first-launch prompt → "Choose a
    folder…" → the native picker (`ios_folder_picker.rs` — §2c's
    never-run-once module got its first-ever presentation this way) →
    granted → Done → *the file browser opened by itself* with the grant
    listed, subfolders first, non-markdown filtered. The persistence leg
    too: a real 3490-byte security-scoped bookmark written to
    `Library/Application Support/<bundle-id>/`, restored alive on
    relaunch, Browse listing the restored grant (tapped within the first
    2.5s — see the toolbar entry below), a real seeded
    `last_opened_document` path rendering at startup, and both
    corrupt-store shapes (valid JSON wrapping garbage bookmark bytes;
    malformed JSON outright) surviving startup with no crash reports.

    Two measurement gotchas from the verification itself, each of which
    cost time believing the wrong evidence:
    - `app_config_dir()` on iOS is `Library/Application Support/
      <bundle-id>/` — files seeded at the `Application Support/` top
      level are read by *nothing*, so the first "corrupt store survives
      relaunch" test proved exactly nothing (the app never saw the
      file).
    - `xcrun simctl io <udid> screenshot` returns **stale frames** once
      the simulator's display sleeps — screenshots came back with status
      bar clocks running *backwards* (the same lesson `adb exec-out
      screencap` taught further up, one platform over). The a11y
      hierarchy (`maestro hierarchy`) is live DOM-level truth; trust it
      over pixels whenever they disagree.

  - **New bug found while verifying, flagged not fixed: the auto-fading
    toolbar is permanently untappable whenever nothing scrolls
    (2026-10-07)** — repeated `tapOn: "Browse files"` steps "completed"
    (an XCUITest tap is just coordinates) without ever opening the
    drawer, while the exact same tap immediately after launch worked and
    showed the listing. The mechanism is in the 2026-09-11 toolbar
    spec's own code: 2.5s of idle applies
    `#toolbar.toolbar-faded { opacity: 0.06; pointer-events: none }`, a
    faded toolbar is transparent to hit-testing so taps fall through to
    the content underneath and no button handler ever fires, and the
    only wake sources are `#main`'s `scroll` and `visualViewport`'s
    resize/scroll. **With no document open — or any document short enough
    not to overflow — nothing ever scrolls**, so the toolbar never comes
    back: the entire toolbar (Open, Find, Preferences, Browse files) is
    dead while looking nearly invisible. Recovery needs pinch-zoom or
    rotating past the 768px breakpoint. This matters directly for the
    bug fixed above: on a phone, restored grant + no scrollable document
    + drawer closed means the button that reopens the folder view does
    nothing — the reported symptom *looks* unfixed even with the fix
    landed. Flagged rather than silently fixed, per the working
    agreement: one concern per change, and the fix is a design decision
    (wake on any tap/pointerdown vs. skip fading when `#main` isn't
    scrollable) that deserves its own call. Evidence is black-box —
    time-since-launch A/B on identical taps plus the CSS rule; nobody
    has read the computed style back off a live iOS webview, since that
    needs the Safari GUI.

  - **Toolbar-fade dead-tap bug fixed (2026-10-17, `14bff30`)** — the
    2026-10-07 entry above flagged it with two fix options; the user
    chose both. `wireToolbarAutoHide` gained a `canFade` predicate
    (main.ts passes `#main.scrollHeight > #main.clientHeight`), so with
    nothing to scroll the toolbar simply never fades; and `.toolbar-faded`
    lost its `pointer-events: none`, with a capture-phase click listener
    on the toolbar that wakes it and swallows the tap while faded (the
    first tap only reveals, so a 6%-opacity button can't fire blind).
    4 new tests, 219 total. **Verified on the iPhone 16 Pro Max / iOS
    18.5 simulator via Maestro**: no document open, Browse files opened
    the drawer minutes after launch (a11y-tree diff showed the listing
    appear); with the long `test-all-elements.md` opened and scrolled,
    clock-checked screenshots showed tap 1 bringing the toolbar back
    with the drawer still closed, and tap 2 opening the drawer.
    Deliberate trade-off: a touch that starts on the faded strip no
    longer reaches content underneath. **Also noticed, pre-existing, not
    fixed**: the drawer offers `.. (up one level)` at a grant's root,
    and following it lands on `access_denied: outside the document's
    folder and no folder has been granted` — a dead end the UI invites.

  - **iOS release/OTA tooling, 2026-10-07 (debug IPA only; release
    blocked, decision open)** — accumulated while chasing the same
    device report:
    - **Release builds cannot link** on Tauri 2.11.5 + swift-rs 1.0.8
      under Xcode 27 / Swift 6.1: swift-rs emits its Rust symbols as
      local (`t`) rather than global and the archive's link step fails
      on them. Debug builds are unaffected — which is what every OTA
      build to date has shipped — so **the release IPA path remains
      unproven**. The options (upgrade Tauri/swift-rs, patch swift-rs,
      capture crash data from Xcode instead, or defer iOS release) are
      laid out, not chosen.
    - `xcodebuild -exportArchive` crashed with `errSecInternalComponent`
      on this machine's ad-hoc export, so the shipped IPA is assembled
      by zipping the `.xcarchive`'s `Payload` directly instead
      (signature intact — audited byte-level before serving).
    - Xcode 27 also refuses `IPHONEOS_DEPLOYMENT_TARGET = 14.0`, which
      a fresh `tauri ios init` still scaffolds into all three of
      `project.yml`/`project.pbxproj`/`Podfile`. The 14.0 → 15.0 bump
      was hand-applied during this session and is now scripted as
      `configure-ios-project.sh` section 4 (`4f4f811`), so the next
      scaffold doesn't silently lose it.
    - The report's "starts and immediately crashes" claim on the real
      device is **still undiagnosed**: every startup path that could be
      exercised was exercised on the device-matched simulator (real
      bookmark restore, both corrupt-store shapes, last-opened restore)
      and all survive, and the OTA transport was ruled out by md5 — the
      served IPA is byte-identical to the local one. No crash log has
      ever been captured (iOS keeps them on-device: USB + unlock for
      `idevicecrashreport`, or Settings → Privacy & Security →
      Analytics on the phone itself); the phone was unreachable all
      session (`idevice_id -l` → none).

  - **iOS release builds unblocked (2026-10-17, `5998aa9`)** — the
    user chose "try upgrading" from the options above. Root cause was
    narrower than "swift-rs emits local symbols": swift-rs's *Swift*
    side (fetched by SwiftPM from git, not from the crate) declared its
    `@_cdecl` exports (`retain_object`, `release_object`,
    `string_from_bytes`, …) as **internal** functions up to its 1.0.7
    tag, and Xcode 27's optimized whole-module build gives internal
    symbols local linkage (`nm`: `t` in release `libTauri.a`, `T` in
    debug — why debug always linked). Upstream made them `public` in
    the 1.0.8/1.0.9 tags, but **tauri 2.11.5 ships a `Package.resolved`
    pinning SwiftPM to 1.0.7**, and the swift-rs *crate* 1.0.9 is
    byte-identical to 1.0.8 apart from its version — so no crate-only
    bump could fix it. tauri 2.12.4 drops that `Package.resolved` and
    requires `from: "1.0.9"`. Applied as a targeted
    `cargo update -p tauri --precise 2.12.4` (tauri/tao/wry family +
    transitive deps; plugins untouched — tauri-plugin-opener 2.5.5 still
    ships a stale 1.0.6 pin, harmless since it resolves through Tauri's
    API package). `@tauri-apps/cli` stays 2.11.4; the CLI's own
    version-mismatch check raised nothing. **Verified**: 89 Rust tests
    green; the release *device* archive builds (Apple Distribution +
    ad-hoc profile, same signing as the debug OTA builds); a release
    *simulator* build launched on the device-matched sim, restored the
    last-opened document at startup (security-scoped bookmark → read →
    render), and screenshots confirmed Shiki, KaTeX (inline + block),
    Mermaid (sequence + class), tables, and the file browser and toolbar
    fade behaving as on debug. **Still open**: `tauri ios build`'s export
    step fails with `exportArchive "MDViewer.app" requires a
    provisioning profile` (the generated `ExportOptions.plist` is
    `method: debugging` with no profile mapping) — the established
    zip-the-`Payload` workaround applies unchanged. No release IPA has
    been served over OTA yet; that's an outward-facing step left for
    the user.
  - **Out-of-band debug log for OTA-only debugging (2026-10-17,
    `4bd5f18` + `93acd6b`)** — the user confirmed USB debugging isn't
    available, so crash/console logs need another route. iOS-only
    `debug_log.rs` writes `Documents/mdviewer-debug.log`: UTC-timestamped
    startup breadcrumbs fsync'd per line (the last line shows how far a
    crashing launch got), a panic hook with location + backtrace, and
    previously discarded startup errors; `errorForwarding.ts` forwards
    uncaught JS errors/rejections into the same file via a new
    `log_frontend_error` command. `UIFileSharingEnabled`
    (configure-ios-project.sh section 5) puts the folder in Files → On My
    iPhone → MDViewer, so the log is AirDroppable off the phone.
    **Verified on the simulator** by running it: full startup trace
    written; folder and file visible in the Files app; a temporary
    env-triggered Rust panic and a temporary JS error + rejection (built,
    run, removed from source before committing) all landed in the log.
    Shipped over OTA the same day (debug archive at `93acd6b`,
    md5-verified through the tunnel) with "install over, don't delete"
    instructions so any crash-triggering state survives. The native
    crash itself still needs iOS's own `.ips` (Settings → Privacy &
    Security → Analytics & Improvements → Analytics Data → Share) — the
    log complements it. Decide before any App Store build whether the
    log stays (it writes file paths into a user-visible folder).
  - **First iOS App Store submission prepared (2026-10-17)** — the user
    asked to submit the iPhone version; their calls: same bundle ID /
    one App Store record as the Mac app (universal purchase), debug log
    in debug builds only, iPhone only, version 1.0.0. Done:
    `5886bd5` debug log + `spike_read_dir_variants` compiled into debug
    builds only; `b81409e` third-party notices in-app (Preferences →
    About, MDViewerApp.swift's AboutPanel text verbatim, versions pinned
    by test) — every OTA build before this shipped the vendored
    libraries with no notices at all; `1144489` 1.0.0 (build 1),
    `ITSAppUsesNonExemptEncryption` via a tracked `src-tauri/Info.ios.plist`,
    a privacy manifest declaring only what the *release* binary imports
    (file timestamps — `stat` family from std::fs; the objc2 bindings
    in debug binaries are dead-stripped), iPhone-only, applied by a new
    configure-ios-project.sh section 0 that regenerates the project with
    xcodegen (Externals/ moved aside, or built libapp.a files become
    duplicate resources); `6cf9648` closed drawer's shadow bled a grey
    strip into every screen; `3cd9dd1` the `..` dead end fixed —
    `list_directory` now returns `parent` only when it's browsable;
    `4e3b634` `build-appstore-ios.sh`, iPhone listing draft
    (`docs/appstore/listing-ios.md`), four 6.9" screenshots, privacy
    policy wording for iPhone. **Blocked on the user**: no Apple ID in
    Xcode and no ASC API key on this machine, so the App Store export
    stops at "No Accounts"; App Store Connect record/metadata and the
    final submit are theirs. **Update, same day:** the user signed into
    Xcode; `./build-appstore-ios.sh --upload` uploaded 1.0.0 (1) —
    "Upload succeeded", no warnings returned, Xcode auto-created the App
    Store profile. Submitting for review remains the user's step. **Flagged, not fixed**: (1) *(fixed 2026-10-19 — see
    "Parity deviations" below)* remote images
    never load in the port — Swift serves a dynamic CSP that allows
    `https:` images unless the policy is Never, the port's static
    `tauri.conf.json` CSP never does, so "Always load" does nothing
    (privacy-safe, but a parity gap; fixing it relaxes a security
    invariant); (2) `origin/main` is 49 commits behind and GitHub Pages
    serves `main:/docs`, so the next push 404s the live
    `/privacy.html` URL and the About text's `THIRD_PARTY_NOTICES.md`
    link (both moved in the local docs restructure); (3) Mermaid's stock
    build bundles its own DOMPurify 3.4.12 — the advisory needs
    `IN_PLACE` mode, which Mermaid never uses (`sanitize(string)` only),
    so not exploitable as shipped.
  - **Contrast & visibility pass (2026-10-17, after the user's
    TestFlight feedback that parts of the UI were hard to see on the
    phone)** — the user asked for tests that check what's visible per
    stylesheet, plus research on colour/contrast guidance. `f8dacb6`
    adds `npm run test:visual`: Playwright WebKit drives every theme ×
    phone/desktop × UI state and measures each text run/icon against the
    real rendered background (WCAG 2.2 AA), control reachability and JS
    errors. First run: 40/108 states failing. Root causes fixed in
    `85742fc`: no shared theme token contract (Dracula's interface was
    white-on-white, `--muted-color` defined nowhere), Solarized ×2 and
    Nord stylesheets missing (404 — also in Swift v1.2.1), no element
    carrying `markdown-body` (all of dracula.css's content rules dead —
    also in Swift), dark detection by theme *name*, Mermaid/Shiki
    palette pairs under 4.5:1, a `position: relative` overriding the
    desktop toolbar's sticky. Now 108/108, 7,488 elements measured; real
    iOS WKWebView spot-checked on the simulator (GitHub Dark via system
    dark mode, Dracula via the native picker). Research write-up with
    sources: `docs/development/color-and-contrast.md`. Same session,
    `cda4b6b`: DOMPurify 3.4.17 / KaTeX 0.18.11 for new advisories that
    `npm audit` surfaced (build 1, already uploaded, contains the old
    versions). Build number bumped to 2; not uploaded yet.
  - **iOS 1.0.0 submitted for review (2026-10-17).** Builds 2–5 were
    uploaded with the App Store Connect API key that
    `build-appstore-ios.sh` now reads from `~/.appstoreconnect/asc.env`.
    Build 5 is attached. The listing, screenshots and review notes were
    filled in through the API, and the user submitted it; it releases
    automatically after approval. Status: `docs/appstore/listing-ios.md`.
    Flagged item (2) above is resolved: `011210d` moved the published
    site and `THIRD_PARTY_NOTICES.md` back to their live paths before the
    push.
  - **iOS 1.0.0 rejected, guideline 2.1(a) (2026-10-19).** "Information
    Needed": App Review, on an iPad Air 11-inch (M3), had no Markdown file
    to open and asked for a demo account or demo mode. The user chose a
    built-in sample document over a reply-only answer (2026-10-20).
    **Deliberate parity deviation, a new feature:** the welcome screen's
    "Open Sample Document" invokes `open_sample_document`
    (`src-tauri/src/lib.rs`), which writes `src-tauri/sample/Welcome.md`
    and the icon it shows (both compiled into the binary) to
    `app_cache_dir()/sample/` and opens it through `render_file` like any
    file. Verified: Rust test for the write, WebKit run of the real
    `app.html` at iPad and iPhone size (button → invoke; KaTeX, both
    Mermaid diagrams, Shiki, task list, table rendered; no sideways
    overflow), visual audit 144/144. **Not verified:** the iOS simulator
    (the 27.1 Simulator SDK isn't installed) and the sample's local image
    through `mdviewer-local://` on a device — check both on build 7
    before resubmitting. Review notes updated in `listing-ios.md`.
  - **Google Play release on hold (2026-10-18, the user's decision).**
    Android stays a port target and keeps building, but it won't be
    published yet. Reasons:
    - the Mac app has about 36 downloads, with little growth;
    - a new personal Play account needs a closed test with 12 testers
      for 14 days before it can publish;
    - testing needs a physical Android phone;
    - a phone-based developer workflow (e.g. a cmux integration) would
      mean hardening the homelab and VPN first.

    Revisit once it's clear how the iPhone version is adopted. Still
    needed for a release:
    - Storage Access Framework file opening: `content://` URIs,
      "Open with…" for `.md`, and the folder picker;
    - an AAB release build with an upload keystore (`release` has no
      `signingConfig` yet; see the Android packaging note above);
    - a `versionCode` and Play's current target-SDK minimum;
    - a Play Developer API service account (the counterpart of the ASC
      key);
    - the store listing, feature graphic and Data safety form.
  - **Open Dependabot alert, Linux only (2026-10-20, left for later at
    the user's request).** GHSA-wrw7-89jp-8q8g (moderate): unsound
    `Iterator`/`DoubleEndedIterator` impls for `glib::VariantStrIter`,
    fixed in glib 0.20.0. `src-tauri/Cargo.lock` has glib 0.18.5, pulled in
    by gtk 0.18 through Tauri itself (`muda`, `tao`, `wry` — Tauri 2.12.4
    is the current release), so it can't be bumped from this crate alone:
    it needs Tauri to move to gtk-rs 0.20. glib only links into the Linux
    build; the macOS, iOS, Android and Windows builds don't contain it.
    Check `cargo tree -i glib` before any Linux release.
- [ ] Manual smoke test of the golden path and edge cases on each of the 5
      platforms before calling it done, per the working agreement
- [ ] Re-verify all security invariants per platform (custom scheme, CSP,
      sanitization, link restriction, remote-image gating, per-folder local
      image access) — pay particular attention to whether mobile sandboxing
      changes any of these guarantees

## Phase 2 — deferred improvements (do not start before Milestone F ships)

Per the phased-improvement agreement: parity now, improvements once the TS
port works everywhere.

- **The Mac App Store app moves to the TypeScript build** (the user's
  decision, 2026-10-19). The shipped Mac app is still the Swift one; at
  some stage it is replaced by the Tauri/TypeScript build rather than
  repaired. Until then its bugs are recorded here, not fixed — the Swift
  source stays untouched.
  - **Not before iOS 1.0.0 is approved** (the user's call, 2026-10-21).
    The Mac app moves to the same architecture as the iPhone app, but only
    once iOS 1.0.0 (build 8, resubmitted 2026-10-21 after the 4.3(a) icon
    rejection) has passed review — no Mac changes while that submission
    is in flight. Both platforms share one App Store Connect record.
  - **Known bug, v1.2.2: remote images never load.** Under Ask the app
    asks "Load remote content?", but Load and Always Allow show nothing,
    and Always shows nothing either. `LocalSchemeHandler.allowsRemoteContent`
    is set from the policy but never read, so `renderer.html`'s static CSP
    blocks every remote image. No privacy leak. Verified 2026-10-19 against
    the installed app's own `renderer.html`/`mdviewer.js` with
    `test-remote-images.md`. Fixed in the TypeScript build (iOS 1.0.0
    build 6), not in Swift.
  - **`main` can't build a working Swift app any more.** Since the
    2026-09-09 flip (Milestone D), `MDViewer/Resources/Web/mdviewer.js` is
    the compiled TypeScript, which has no `webkit.messageHandlers` bridge
    — only Tauri calls. A Swift build from `main` would lose the TOC, link
    clicks, the remote-content prompt and scroll tracking. A Swift
    hotfix release would have to restore the last hand-written
    `mdviewer.js`, at `fd39e73` (2026-09-04) — not the v1.2.2 tag's, which
    predates the emoji support the shipped build has. The installed
    1.2.2 (12) matches no commit exactly: it's slightly older than
    `fd39e73` (no URL check in `loadRemoteResources`, a looser TOC-title
    tag strip).
- Candidates from comparing against https://mdviewer.org — add specifics
  here as they're identified; nothing itemized yet.
- **Single-window, multi-document tabs** (observed 2026-09-06: opening 3
  documents in the current Swift app opens 3 separate windows, which
  clutters the screen). The goal is for opening a new document to add a tab
  to an existing app window instead of spawning a new one. This is distinct
  from macOS "native window tabs" (the OS-level window-manager feature,
  already out of scope per `porting-brief.md` — that merges separate
  `NSWindow`s into a tab strip via the system, macOS-only). What's wanted
  here is an app-managed tab bar within a single window, which is a
  cross-platform UI decision affecting Milestone E, not an OS passthrough.
  Not designed yet — revisit when Phase 2 starts.
- Parity deviations already introduced during porting, kept deliberately —
  formalize as intentional improvements rather than leaving them as
  undocumented drift:
  - `slugify` (`web/src/dom.ts`) no longer leaves stray leading/trailing
    hyphens in anchors; the Swift/JS original can.
  - `resolveEmoji` (`web/src/emoji.ts`) accepts shortcodes starting with
    `+`/`-` (e.g. `:+1:`); the original's regex silently drops them.
  - `setTheme` (`web/src/mdviewerApi.ts`) redraws Mermaid diagrams already
    on screen (2026-10-17). The Swift app and the original `mdviewer.js`
    only re-initialize Mermaid, so after switching from a dark theme to a
    light one the diagrams kept white labels on light boxes, unreadable.
    Found on the iOS Simulator after a TestFlight report; covered by
    `mdviewerApi.test.ts` and the visual audit's `theme-switch` state.
  - Mermaid's dark theme gets contrast overrides (`DARK_THEME_VARIABLES`
    in `web/src/mermaid.ts`) and the themes share a token contract — see
    `docs/development/color-and-contrast.md`.
  - Remote images (2026-10-19, the user's "fix both"): fetched by Rust
    (`fetch_remote_image`) and shown as `data:` URLs instead of loaded by
    the webview, so the CSP's `img-src` stays local-only. Swift *intends*
    a dynamic CSP that allows `https:` images unless the policy is Never,
    which under Ask would let CSS `url()`, `<video poster>`, SVG `<image>`,
    `<table background>` and `<input type=image>` load before the user
    answers. In fact `LocalSchemeHandler.allowsRemoteContent` is set and
    never read, so the shipped Mac app (v1.2.2) keeps `renderer.html`'s
    static CSP and **no remote image ever loads there**: it asks, but Load,
    Always Allow and Always do nothing (verified 2026-10-19 against the
    app's own `renderer.html`/`mdviewer.js` in WebKit — no leak, no
    images). Swift source not touched. Consequence here: only `<img>` images
    load, even under Always. The "Load remote content?" prompt is an
    in-page dialog (`remotePrompt.ts`) with Swift's wording and buttons,
    not an NSAlert. Like Swift it asks again on every render under Ask,
    live reloads included. Covered by `web/e2e/remoteImages.e2e.ts`.
- Swift test coverage (`MDViewerTests`) is known to be thin. Likely moot if
  the Swift app is retired once the Tauri port ships everywhere — revisit
  scope when Phase 2 starts rather than backfilling now.

## Out of scope

Per `porting-brief.md` — not part of either phase:

- The Quick Look extension (no Tauri equivalent; stays Swift or is dropped)
- Native window tabs, `NSDocumentController` recent files
- New features beyond the improvements backlog above, until Phase 2 begins
