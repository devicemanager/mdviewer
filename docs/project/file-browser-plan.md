# Mobile file browser + permissions — remaining work

**Written 2026-09-12, last updated 2026-10-07** to consolidate open threads
so this work can be picked up cold, without the originating conversation, and
**regardless of which model or tool is used to continue it** — nothing here
assumes Claude-specific state beyond one pointer noted below.
`docs/project/plan.md` remains the full historical record (what was built and
why); this file is only *what's left*, plus the context needed to not
re-learn it the hard way.

**You are here:** `HEAD` is `4e3b634` (2026-10-17) — App Store submission
prep on top of the toolbar-fade fix, the Tauri 2.12.4 bump and the
out-of-band debug log; see plan.md's 2026-10-17 entries. This doc's update
lands right after. Everything before
`822a617` (2026-09-13) predates a `git filter-repo` history rewrite that
moved the OTA tooling out of this repo — don't compare against hashes
recorded earlier than that note. Working tree is clean —
everything described as "done" below is committed, not just present in a
working tree. Before trusting any "done" claim in this file, it's still worth
a quick `git log --oneline -10` and re-running the test suites (commands in
section 5) rather than taking the file's word for it — this file can go
stale the same way code comments do.

**The OTA tunnel is healthy again** (confirmed 2026-09-13, end of session:
`https://<ota-tunnel-host>/` → 200). Section 2a below is now history,
not a live blocker — kept for the war story (a missing scratch file caused
hours of "is the tunnel down" debugging). **The OTA server tooling itself
moved out of this repo on 2026-09-13** — it lived at `ota/` here until it
turned out to carry this machine's LAN IP and tunnel hostname into project
history, which was scrubbed via a `git filter-repo` rewrite. It now lives
in a separate, untracked local folder outside this repo; see the mdviewer
maintainer's local notes there for how the OTA server runs — this file
still covers the port's own progress. The two items that were blocked on
the tunnel (2b, 2c) are open again.

Superseded planning artifact: `~/.claude/plans/staged-fluttering-octopus.md`
(a Claude Code plan-mode file, outside the repo and outside git — its
Phases 0–3 shipped, its Phase 4+ is restated below with the mid-flight
revision folded in). That file is the one Claude-specific/tool-specific
pointer in this document; nothing else here depends on it.

---

## 1. Status snapshot (verified, not remembered)

**Landed and verified:**

| Piece | State |
|---|---|
| `list_directory` Rust command + `path_is_accessible` refactor | Done, 9 tests |
| `drawer.ts` (drawer primitive, now backs the file browser only) | Done, verified on emulator |
| `.drawer`/`.drawer-backdrop` CSS, unconditional at every width | Done, fixed a real desktop bug — see Phase 6 below |
| `fileBrowser.ts` (render + localStorage cache) | Done, 21 tests |
| `permissions.ts` (consolidated first-launch prompt) | Done, 16 tests |
| `ios_folder_picker.rs` (native `UIDocumentPickerViewController`) | **Ran on the iOS Simulator 2026-10-07 (first ever presentation, via a Maestro-driven grant flow); never on a real device** |
| Phase 4 wiring (markup, CSS, `main.ts` glue) | Done, verified on Android emulator |
| Grant fallback + `openTo` handoff (`6f14d51`) — no-document grants & grants above the open document | Done, verified end-to-end on the iOS Simulator 2026-10-07 (see below) |
| OTA server: supervised LaunchAgent + Pangolin health-check fix | Done, tunnel confirmed 200 |
| Phase 5 (`diffFolderEntries` + skip-render-when-unchanged) | Done, verified on Android emulator |
| Phase 6 (toolbar reorg, TOC sidebar dropped entirely) | Done, verified on Android emulator at phone and desktop widths |

Test counts: **96** Rust, **235** web. All green (re-run 2026-10-17). (Web count dropped from
224 — Phase 6 deleted `sidebar.ts`'s 12 tests along with the feature; no
other regressions. The Rust count rose 83 → 89 with the 6
grant-fallback/ancestor tests that pin the fix below.)

**Phase 4 landed 2026-09-13.** Markup, CSS and `main.ts` wiring are in;
bundle grew 36.2kb → 48.6kb, confirming the modules are actually reachable
now rather than dead code. Verified on the Android emulator end to end:
first-launch prompt appears with both questions, Done persists the seen
flag, the browser lists a real folder (subfolder first, non-markdown
filtered), navigate in/up works, tapping a file opens it and closes the
drawer, and drawer mutual exclusivity holds in both directions.

**Phase 5 landed 2026-09-14.** `diffFolderEntries` (pure, positional
comparison — order matters since `list_directory` is always
folders-first-then-alphabetical) added to `fileBrowser.ts`, wired into
`main.ts`'s `show()` so the post-fetch render is skipped when the fresh
listing matches what the optimistic cache render already put on screen.
Verified on the Android emulator with an `innerHTML`-set counter
instrumented via CDP (not just unit tests): an unchanged reopen renders
**once** (the cache render only); an external file added between opens
still renders **twice** and the new file appears. `/data/local/tmp`'s own
permission bits (`rwxrwx--x` — traversable but not listable by the app)
had to be loosened to `777` for this specific test session, same
workaround a prior session's leftover `browsetest/` fixture already
implied; that's a debug-fixture-location quirk of this test document's
fixed path, not a Phase 5 concern.

**Phase 6 landed 2026-09-14/15, with a scope change made mid-flight, the
user's own call:** the TOC sidebar (`sidebar.ts`, the table-of-contents
drawer this app shipped with) was **dropped entirely** rather than kept
alongside a reorganized toolbar — "the file browser replaces it," not a
second drawer beside it. Concretely:
- `sidebar.ts` and its 12 tests deleted; `#sidebar`/`#sidebar-backdrop`
  removed from `app.html`; all `.toc-*` CSS removed. `#file-browser` is
  this app's only drawer now — no more mutual-exclusivity policy needed
  (there's nothing left to be mutually exclusive with).
- Toolbar regrouped (toolbar.ts): file-browser-toggle + Open on the left
  (primary action, the user's original framing), Find + Preferences
  grouped on the right (`.toolbar-icon-group`) — no more TOC-index icon,
  since there's no TOC.
- Theme `<select>` and font-size controls moved out of the toolbar
  entirely into Preferences' Appearance tab (preferences.ts), which was a
  literal stub until now. Shown at every width, including mobile —
  explicitly re-confirmed with the user rather than carrying over the old
  toolbar's mobile-hide rule by default, since a spacious modal doesn't
  have the toolbar row's space pressure. `main.ts`'s `RenderViewModel`
  construction moved out of `wireToolbar` into its own
  `createRenderViewModel()`, since `wirePreferences` needed the same
  instance too.
- **A real desktop bug found live via CDP while verifying this, not part
  of the original Phase 6 scope but fixed in the same pass**: `.drawer`/
  `.drawer-backdrop`'s actual positioning/background CSS was gated behind
  `@media (max-width: 768px)`, inherited from the old TOC sidebar's
  different desktop behavior (an always-visible in-flow column, only
  becoming a drawer below that breakpoint). `#file-browser`'s own header
  comment already documented it as "drawer-only at every width, no
  in-flow desktop form," but nothing had ever updated the CSS to match —
  opening it at a desktop-width viewport produced an unstyled, transparent
  box pushing `#main` aside instead of the designed overlay. Fixed by
  making `.drawer`/`.drawer-backdrop` unconditional; re-verified at both
  widths afterward (below).

**Verified live via CDP** (Android emulator, both a real phone-width
viewport and a desktop-width one via `Emulation.setDeviceMetricsOverride`):
toolbar grouping and absence of theme/font/TOC controls; Preferences →
Appearance actually changes the live theme (`github-light` → `dracula`,
confirmed via `#theme-css`'s href) and font size (confirmed via computed
style on `#content`), and both persist to `localStorage`; the file browser
opens as a proper frosted-glass fixed overlay with a working backdrop
scrim and correct `#main` sizing at 1200px width, not just at phone width.

**Still NOT done:**

- Phase 7 (background live refresh).
- The permissions prompt's "Choose a folder…" path is **tested on the iOS
  Simulator as of 2026-10-07** (prompt → picker presented → folder granted
  → `openTo` opened the browser at the grant — the full first-launch flow,
  driven by Maestro), but still **never on a real device** — the security-
  scoped bookmark *restore* half was likewise proven only with simulator-
  created bytes, not with a device's own grants. On Android the command
  returns `false` unconditionally (no Storage Access Framework support
  yet), so the button currently does nothing there by design.

---

## 2. Blocked on the user

### 2a. OTA tunnel 503 — RESOLVED 2026-09-13 (kept as a war story)
`https://<ota-tunnel-host>/*` returned **503 in ~0.6s** for most of
this session — an immediate "no healthy backend" rejection, not a timeout.
Extensive local verification (Caddy alive, bound to `0.0.0.0:4000`, LAN IP
unchanged, firewall disabled, serving 200 on every path checked) ruled out
everything on this machine, which pointed at Pangolin's health check itself
rather than the tunnel being disabled.

**Actual cause:** the health check was pointed at `/_probe.txt` — a scratch
file that only ever existed for manual `curl` testing while first getting
Caddy working (2026-09-09), deliberately deleted as cruft before the OTA
tooling's first commit (back when it briefly lived in this repo, at
`ota/`), and never tracked in git. `/_probe.txt` → 404; Pangolin read that
as unhealthy and 503'd every request at the edge, regardless of how healthy
the actual server was. Full writeup lives with the OTA tooling itself (see
the note above — it's no longer part of this repo).

**Fixed** by repointing the Pangolin health check at `/` (always present —
confirmed `https://<ota-tunnel-host>/` → 200 at session end).

**Also fixed 2026-09-13**: Caddy itself was a bare `nohup ... &` from a
Claude Code Bash tool call, with no supervision — a crash or reboot would
have silently taken OTA down. Replaced with a proper LaunchAgent
(install script + plist, now living with the rest of the OTA tooling
outside this repo), `KeepAlive` restart behavior verified live with a
`kill -9`.

Both items below (2b, 2c) are open again now that delivery works.

### 2b. Phase 0 spike results (outstanding — OTA delivery works again, ready to test)
A diagnostic build is live at `https://<ota-tunnel-host>/install.html`
(built `2026-09-12T14:41:57Z`; delivery now works again). It answers whether
`std::fs::read_dir` works on a document's folder when that document arrived via
the file-association path. Steps:
1. Open a `.md` file through Files (not the Open button).
2. Safari → Develop → iPhone → MDViewer page → console.
3. Look for the `[spike-a]` line that logs automatically on open (OK or ERR).
4. Run `await window.__TAURI__.core.invoke('spike_read_dir_variants')`.

**Why it still matters even though the native picker was chosen:** it decides
whether "open a file from Files, then browse its siblings" works *without* an
explicit folder grant. If it does, the browser is useful immediately after any
file-association open. If it doesn't, a folder grant becomes mandatory before
browsing is possible at all — which changes the first-run UX materially.
Still unanswered as of 2026-10-07 (the phone was unreachable that whole
session — `idevice_id -l` → none), which is exactly why the temporary
`spike_read_dir_variants` command was *kept* rather than cleaned up with the
other debug code from that session: section 4's "remove it once answered"
bullet stays open until a device run happens.

### 2c. Native picker — first presented 2026-10-07, but only on the simulator
`ios_folder_picker.rs` compiles for `aarch64-apple-ios`, and on 2026-10-07 it
was **actually presented for the first time ever — on the iPhone 16 Pro Max
simulator**, as part of the Maestro-driven grant flow that verified the
`6f14d51` fix: prompt → "Choose a folder…" → `UIDocumentPickerViewController`
appeared → folder picked → grant persisted → browser opened at it. That
retires "has not run once" and proves the delegate plumbing, threading
(`async` + `spawn_blocking`) and bookmarking work at least in the
simulator's environment. **UIKit delegate behavior on a real device is still
unverified**, though — simulator ≠ device for document-provider and
security-scope semantics, so the real tap-through from Safari's console
(`await window.__TAURI__.core.invoke('request_folder_access')`) remains the
last box to tick.

---

## 3. Remaining phases

### Phase 4 — Wire it in (frontend + markup + CSS) — **DONE 2026-09-13**
- Add `#permissions` and `#file-browser`/`#file-browser-backdrop` to
  `app.html` (both `hidden`; drawer carries `class="drawer"`, backdrop
  `class="drawer-backdrop"` — see `#sidebar`'s existing pair as the model).
- Write `.file-browser-*` and `.permissions-*` CSS. Note `.permissions-*`
  needs an overlay/panel treatment; `preferences.ts`'s `.prefs-overlay`/
  `.prefs-panel` rules are the closest existing precedent to mirror.
- `wireFileBrowser()` and `wirePermissions()` in `main.ts`, added to
  `wireUIShell()`. These are where `invoke` calls live (the module files
  themselves must stay `invoke`-free — that's this codebase's tested/untested
  boundary, see any `wire*` function).
- **Path joining lives here**, not in `fileBrowser.ts`: the module only ever
  emits bare entry `name`s and takes a caller-supplied `parentPath`. `main.ts`
  holds current-path state and does the joining, because it's the only place
  that knows `DirListing.path`.
- Mutual exclusivity: opening the file-browser drawer must close the TOC
  drawer and vice versa (both are left-edge overlays that would collide).
  `drawer.test.ts` proves the primitives don't share state; the *policy* is
  unwritten and untested. (Moot since Phase 6 dropped the TOC drawer
  entirely — noted here only so this checklist stays an accurate record of
  what Phase 4 actually built at the time, not a claim about today's code.)
- First-launch gate: show `permissions.ts` when `hasSeenPermissionsPrompt()`
  is false.

**Verify:** emulator screenshots of both drawers + the permissions dialog;
cached-then-fresh render on relaunch; then real-device for the iOS path.

### Phase 5 — Poll-on-reopen refresh — **DONE 2026-09-14**
Re-run `list_directory` on every drawer open, diff against cache via a pure
`diffFolderEntries(old, new) -> boolean` (split out for testability, same
reasoning as `classify_link`), re-render only on change.
**Verified:** 7 new unit tests on the diff function (added/removed/renamed/
type-changed/reordered entries); Android emulator check via CDP confirmed
an unchanged reopen renders once and a changed one renders twice with the
new entry visible (see status snapshot above for the exact method).

### Phase 6 — Toolbar reorganization — **DONE 2026-09-14/15, scope changed mid-flight**
Landed differently than originally written here, per the user's own
redirect: **the TOC sidebar was dropped entirely** rather than kept
alongside a reorganized toolbar (this section used to say "Find /
TOC-index / Settings grouped right" — there is no more TOC-index, because
there is no more TOC). See the status snapshot above for the full
breakdown: `sidebar.ts` deleted, toolbar regrouped to file-browser-toggle
+ Open (left) and Find + Preferences (right), theme/font-size moved into
Preferences → Appearance (shown at every width, not hidden on mobile —
also re-confirmed with the user rather than assumed), and a real desktop
overlay-positioning bug found and fixed along the way.
**Verified:** `toolbar.test.ts`/`preferences.test.ts` rewritten for the
new shapes; Android emulator via CDP at both a phone-width and a
desktop-width (`Emulation.setDeviceMetricsOverride`) viewport — toolbar
grouping, live theme/font-size changes, localStorage persistence, and the
file browser's overlay positioning all confirmed working at both widths.

### Phase 7 — Background live refresh (deferred, optional)
Only after Phase 5 proves insufficient. Needs a **separate** watcher from
`FileWatcher` (its single `Mutex<Option<Debouncer>>` slot is committed to the
open document; a browsed folder and an open document can differ and need
independent watches), plus the frontend's first-ever use of
`window.__TAURI__.event.listen`. Two untested mechanisms — keep them in
their own phase.

---

## 4. Cross-cutting open issues

- **Remove the Phase 0 spike code once answered.** 5 references in
  `src-tauri/src/lib.rs`: the `spike_read_dir_variants` command, its
  `invoke_handler` registration, and the `[spike-a]` block inside
  `render_opened_document`. Temporary by construction.
- **Android `content://` gap.** `RunEvent::Opened` only handles URLs that
  convert via `to_file_path()` — a real `file://`. Most Android "Open
  with"/share-sheet flows deliver a `content://` URI instead (the
  auto-generated intent filter's `SEND`/`SEND_MULTIPLE` actions essentially
  guarantee one). Currently falls through silently: no crash, nothing renders.
  `tauri-plugin-fs`'s `Fs::open`/`resolve_content_uri` solves exactly this via
  a Kotlin ContentResolver call (read its source; not currently a dependency).
  Also blocks any Android folder grant — `request_folder_access` has an
  explicit unsupported branch there.
- **Security-scope lifetime gap.** `render_opened_document` drops its
  `access_url` guard immediately after the read. The file watcher's later
  re-read of an in-place-opened document will therefore likely fail. Fixing it
  needs somewhere to hold a `ScopedAccess` per current document — the shape
  `GrantedFolderAccess`'s `HashMap<String, ScopedAccess>` already uses.
- **Desktop unverified.** macOS/Windows/Linux untouched by testing throughout
  this mobile arc. `bundle.fileAssociations` desktop packaging in particular
  was added but never built/verified.
- **Security invariants still not enforced** (pre-existing, from CLAUDE.md):
  no App Sandbox entitlements are configured at all, so file reads work
  because nothing restricts them, not because access is correctly scoped.
- **`renderer.html` CSP** has the same missing `ipc:` in `connect-src` that
  `app.html` needed. Left deliberately unfixed — CLAUDE.md lists
  `renderer.html` as a file that "moves across unchanged". Needs a decision.
- ~~**The auto-fading toolbar is permanently untappable whenever nothing
  scrolls**~~ — **fixed 2026-10-17 (`14bff30`)**. Found 2026-10-07: after
  2.5s idle the toolbar got `opacity: 0.06; pointer-events: none` and only
  scroll/zoom woke it, so with no document (or a short one) Open/Find/
  Preferences/Browse files went dead. The user picked both fix options:
  the fade is skipped when `#main` can't scroll, and the faded strip stays
  hit-testable — a tap wakes it, that first tap swallowed so a near-
  invisible button can't fire by accident. Verified on the simulator
  (plan.md's 2026-10-17 entry). Trade-off worth knowing: a touch that
  starts on the faded strip no longer reaches the content underneath
  (the old `pointer-events: none` rationale) — it's one toolbar-height
  band at the top of the screen.

---

## 5. Hard-won context (do not re-derive)

**Threading / Tauri**
- A **non-async** Tauri command runs *inline on the calling thread*
  (`tauri-macros`' `body_blocking` vs `body_async`). On iOS that's the main
  thread. Anything blocking — file dialog, folder picker — must be `async` +
  `spawn_blocking` or it deadlocks. Bit `open_document_command`, then
  `request_folder_access`.
- `on_page_load` fires on **Android's UI thread**; `window.eval()` needs that
  same thread, so calling it inline deadlocks. Always `spawn`.
- Use Tauri's `AppHandle::run_on_main_thread` for main-thread dispatch —
  objc2 0.6 / objc2-foundation 0.3 have no `run_on_main` equivalent.

**iOS security scoping**
- A security scope belongs to the **specific `NSURL` instance**. Reconstruct
  via `NSURL::URLWithString` from the URL **string** — *not*
  `fileURLWithPath` from a path. Losing the string form before re-acquiring
  scope is a real bug that already cost a device round-trip.
- `tao`'s iOS bridge converts the incoming `NSURL` straight to a plain string
  with **no** `startAccessingSecurityScopedResource` call. Nothing upstream
  does this for you.
- UIKit holds its delegate **weakly** — a Rust-owned delegate must be leaked
  (`mem::forget`) or it dies before the first callback.
- `objc2`: `ivars()` requires the `DefinedClass` trait in scope.

**iOS file associations**
- `tauri.conf.json`'s `bundle.fileAssociations` **auto-generates** both the
  iOS `Info.plist` entries and the Android `<intent-filter>`. Do not
  hand-write them — earlier hand-written versions had to be removed as
  duplicates.
- `LSSupportsOpeningDocumentsInPlace` must be **true** or the app never
  appears in Files' long-press menu. It is about live-reference access, not
  editing.
- `LSHandlerRank: Owner` (not `Default`) to win over another installed app
  claiming the same UTI.

**Android**
- This WebView applies **no** status-bar inset to *any* in-flow content, and
  `env(safe-area-inset-*)` resolves to `0` regardless of `viewport-fit`.
  Fixed `padding-top` at the mobile breakpoint is the working fix.
- `adb exec-out screencap` can return **stale frames** under load. Trust CDP
  `Runtime.evaluate` DOM reads over screenshots when they disagree.

**CSS / tests**
- A `@media` query adds **no specificity** — a mobile override must come
  *after* the base rule in source order. This silently broke
  `.toolbar-group { display: none }` once.
- jsdom's `innerHTML` **getter** re-serializes attribute values without
  escaping `<`/`>`. Never assert escaping via raw `innerHTML` substring
  checks; assert `querySelector('script') === null` and the parsed values.
- Read transitioned CSS properties *after* the transition, not in the same
  tick as the triggering click.

**Re-running the test suites** (this is what "section 5" in the "You are
here" note at the top refers to):
```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri && cargo test --offline   # expect 89 passed
cd ../web && npx tsc --noEmit && npx vitest run   # expect 235 passed
```

**Build environment**

`src-tauri/gen/` is gitignored, and four things in there are *not*
reproducible from tracked config — run `./configure-ios-project.sh` after any
`tauri ios init` (or any time the generated project is recreated) to reapply
them. It is idempotent, and verified to take a freshly-scaffolded project all
the way to a correctly-signed ad-hoc IPA:

1. `LSSupportsOpeningDocumentsInPlace` in `Info.plist` — without it the app
   builds and installs fine but silently never appears in the Files app's
   long-press menu.
2. Manual code-signing in `project.pbxproj` — Tauri scaffolds automatic
   signing with an "iPhone Developer" identity; ad-hoc needs manual signing
   against the Apple Distribution cert the profile actually embeds.
3. `ExportOptions-AdHoc.plist` — Tauri generates no ad-hoc export options.
4. Minimum iOS deployment target 14.0 → 15.0 (added 2026-10-07) — Xcode 27
   refuses 14.0 outright with an opaque build error, and a fresh `tauri ios
   init` scaffolds it into `project.yml`/`project.pbxproj`/`Podfile`. The
   script patches all three; override with `IOS_DEPLOYMENT_TARGET` if needed.

Note the file-association entries (`CFBundleDocumentTypes`,
`UTExportedTypeDeclarations`) are deliberately *not* in that script: those
**are** generated, from `tauri.conf.json`'s `bundle.fileAssociations`, and
hand-writing them produces duplicates. Also note XML comments do not survive
in generated plists — Tauri's own build-time injection strips them — which is
why the rationale lives in the script rather than in the plist.

```bash
export PATH="$HOME/.cargo/bin:$PATH"          # NOT Homebrew's cargo — iOS/Android builds fail
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home  # gradle needs it
```
- `xcodebuild -exportArchive` often fails on the **first** attempt right after
  a fresh archive ("archive not found"); retrying immediately works. And as
  of 2026-10-07 the ad-hoc **export** step itself crashes with
  `errSecInternalComponent` on this machine even from a good archive — the
  shipped IPA is instead zipped directly from the `.xcarchive`'s `Payload`
  (signature survives; audit before serving).
- **Release builds link since 2026-10-17** (`5998aa9`, Tauri 2.11.5 →
  2.12.4). The old failure was swift-rs's Swift `@_cdecl` exports being
  `internal` up to its 1.0.7 tag — Xcode 27's optimized build makes those
  local — with tauri 2.11.5's shipped `Package.resolved` pinning that tag.
  If `_retain_object`/`_release_object` undefined ever comes back, check
  which swift-rs tag SwiftPM resolved
  (`target/<triple>/release/build/tauri-*/out/swift-rs/Tauri/workspace-state.json`)
  before touching the crate version — the crate isn't what SwiftPM builds.
  `tauri ios build` (release) still fails at its *export* step
  (`requires a provisioning profile`); zip the archive's `Payload` as
  above.
- **Reading device logs without USB** (2026-10-17): every iOS build writes
  `Documents/mdviewer-debug.log` (see `debug_log.rs`) — on the phone, Files
  → On My iPhone → MDViewer → mdviewer-debug → Share/AirDrop. On the
  simulator: `$(xcrun simctl get_app_container <udid>
  org.devicemanager.mdviewer data)/Documents/mdviewer-debug.log`. Timestamps
  are UTC. Native crashes: the phone's own `.ips` under Settings → Privacy &
  Security → Analytics & Improvements → Analytics Data. To exercise a code
  path that's hard to reach, a temporary env-gated trigger plus
  `SIMCTL_CHILD_<VAR>=1 xcrun simctl launch …` works; remove it before
  committing.
- iOS build sometimes needs stale `gen/apple/build/**/MDViewer.app` removed
  first ("Directory not empty").
- OTA: Caddy (now outside this repo, see the note near the top of this
  file) serves a `serve/` folder on `:4000` → `<ota-tunnel-host>`. Update
  `MDViewer.ipa`, `build-report.json`, and `install.html` (copy to
  `index.html`) there together.

**Driving the iOS Simulator** (the method behind every 2026-10-07
verification claim):

- Maestro needs `JAVA_HOME=$(brew --prefix openjdk@17)`; `--device <udid>` is
  a *global* flag before the subcommand (`maestro --device <udid> test …`).
  The device-matched sim (iPhone 16 Pro Max, iOS 18.5) is
  `234AB132-310F-431C-9327-7351F67B93FF`.
- `maestro hierarchy` (accessibility tree) is the live source of truth for
  UI state. `xcrun simctl io <udid> screenshot` returns **stale frames** once
  the display sleeps — images came back with status-bar clocks running
  backwards; same lesson as `adb exec-out screencap` above.
- A tap on a **faded** toolbar (scrollable document, 2.5s idle) only
  reveals it — the tap is swallowed by design since 2026-10-17 — so a flow
  that means to press a toolbar button on a long document needs two taps
  in the *same* `maestro test` run (separate runs take seconds to start,
  long enough for it to fade again in between). "COMPLETED" from Maestro
  still only means the coordinates were touched, not that a handler ran.
- While a drawer is open it covers the toolbar, so `tapOn: "Browse files"`
  then lands on the drawer's top row (`.. (up one level)`) instead, and the
  a11y tree reports the drawer's rows at the same bounds open or closed —
  judge drawer state from a (clock-checked) screenshot, not from bounds.
- App data root: `xcrun simctl get_app_container <udid>
  org.devicemanager.mdviewer data`; the grant store and state files live
  under `Library/Application Support/org.devicemanager.mdviewer/` —
  `app_config_dir()` appends the bundle id, so files seeded at the
  `Application Support/` top level are read by nothing (a whole "test" can
  silently prove nothing this way).
