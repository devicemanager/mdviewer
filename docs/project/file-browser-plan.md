# Mobile file browser + permissions — remaining work

**Written 2026-09-12** to consolidate open threads so this work can be picked
up cold, without the originating conversation. `docs/project/plan.md` remains
the full historical record (what was built and why); this file is only
*what's left*, plus the context needed to not re-learn it the hard way.

Superseded planning artifact: `~/.claude/plans/staged-fluttering-octopus.md`
(Claude Code plan-mode file, outside the repo — its Phases 0–3 shipped, its
Phase 4+ is restated below with the mid-flight revision folded in).

---

## 1. Status snapshot (verified, not remembered)

**Landed and verified:**

| Piece | State |
|---|---|
| `list_directory` Rust command + `path_is_accessible` refactor | Done, 9 tests |
| `drawer.ts` (drawer primitive generalized out of `sidebar.ts`) | Done, verified on emulator |
| `.drawer`/`.drawer-backdrop` CSS generalization | Done, TOC drawer visually unchanged |
| `fileBrowser.ts` (render + localStorage cache) | Done, 21 tests |
| `permissions.ts` (consolidated first-launch prompt) | Done, 16 tests |
| `ios_folder_picker.rs` (native `UIDocumentPickerViewController`) | **Compiles on all 3 targets, never run** |

Test counts: **83** Rust, **216** web. All green.

**Explicitly NOT done — verified just now, don't assume otherwise:**

- `fileBrowser.ts` and `permissions.ts` are **not imported by `main.ts`**.
  Nothing renders either one. They are dead code from the bundler's view
  (bundle size unchanged at 36.2kb confirms this).
- **No markup**: `#file-browser`, `#file-browser-backdrop`, `#permissions`
  do not exist in `app.html`. The only hits are comments — including one at
  `app.html:87` that forward-references `#file-browser` "further down",
  which is currently untrue and should be fixed when the element lands.
- **No CSS**: no `.file-browser-*` or `.permissions-*` rules in `app.css`.
  Only comment references.
- **Nothing committed this session.** `HEAD` is still `b8b7193`. Every
  change described here and in plan.md is uncommitted working-tree state.

---

## 2. Blocked on the user

### 2a. Phase 0 spike results (outstanding)
A diagnostic build is live at `https://<ota-tunnel-host>/install.html`
(built `2026-09-12T14:41:57Z`). It answers whether `std::fs::read_dir` works
on a document's folder when that document arrived via the file-association
path. Steps:
1. Open a `.md` file through Files (not the Open button).
2. Safari → Develop → iPhone → MDViewer page → console.
3. Look for the `[spike-a]` line that logs automatically on open (OK or ERR).
4. Run `await window.__TAURI__.core.invoke('spike_read_dir_variants')`.

**Why it still matters even though the native picker was chosen:** it decides
whether "open a file from Files, then browse its siblings" works *without* an
explicit folder grant. If it does, the browser is useful immediately after any
file-association open. If it doesn't, a folder grant becomes mandatory before
browsing is possible at all — which changes the first-run UX materially.

### 2b. Native picker has never been presented
`ios_folder_picker.rs` compiles for `aarch64-apple-ios` but has not run once.
UIKit delegate plumbing is exactly the class of code that compiles clean and
misbehaves on device. **Treat as unverified.** Needs an OTA build and a real
tap-through before anything is built on top of it.

---

## 3. Remaining phases

### Phase 4 — Wire it in (frontend + markup + CSS)
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
  unwritten and untested.
- First-launch gate: show `permissions.ts` when `hasSeenPermissionsPrompt()`
  is false.

**Verify:** emulator screenshots of both drawers + the permissions dialog;
cached-then-fresh render on relaunch; then real-device for the iOS path.

### Phase 5 — Poll-on-reopen refresh
Re-run `list_directory` on every drawer open, diff against cache via a pure
`diffFolderEntries(old, new) -> boolean` (split out for testability, same
reasoning as `classify_link`), re-render only on change.
**Verify:** unit-test the diff with fixtures; manually edit a file outside the
app, reopen the drawer, confirm the change appears.

### Phase 6 — Toolbar reorganization
- File-browser button **left**; Find / TOC-index / Settings grouped **right**
  (three icons, visually grouped — user chose this over a popover).
- Move theme `<select>` + font-size controls into Preferences → Appearance,
  wired to the `RenderViewModel` instance `wireToolbar` already builds.
  That tab is currently a literal stub whose own comment anticipates exactly
  this. Hide the theme select on mobile (font-size group already is).
- Update `toolbar.test.ts` for the new layout.

**Verify:** tests; emulator screenshots at phone and desktop widths; every
action still works including the relocated theme picker.

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
- **Commit the work.** Nothing from this session is committed.
- **Desktop unverified.** macOS/Windows/Linux untouched by testing throughout
  this mobile arc. `bundle.fileAssociations` desktop packaging in particular
  was added but never built/verified.
- **Security invariants still not enforced** (pre-existing, from CLAUDE.md):
  no App Sandbox entitlements are configured at all, so file reads work
  because nothing restricts them, not because access is correctly scoped.
- **`renderer.html` CSP** has the same missing `ipc:` in `connect-src` that
  `app.html` needed. Left deliberately unfixed — CLAUDE.md lists
  `renderer.html` as a file that "moves across unchanged". Needs a decision.

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

**Build environment**
```bash
export PATH="$HOME/.cargo/bin:$PATH"          # NOT Homebrew's cargo — iOS/Android builds fail
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home  # gradle needs it
```
- `xcodebuild -exportArchive` often fails on the **first** attempt right after
  a fresh archive ("archive not found"); retrying immediately works.
- iOS build sometimes needs stale `gen/apple/build/**/MDViewer.app` removed
  first ("Directory not empty").
- OTA: Caddy serves `ota/serve/` on `:4000` → `<ota-tunnel-host>`.
  Update `MDViewer.ipa`, `build-report.json`, and `install.html`
  (copy to `index.html`) together.
