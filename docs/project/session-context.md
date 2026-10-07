# Session context — for picking this up cold

**Written 2026-10-07**, replacing the 2026-09-13 version (that one's arc is
fully absorbed into `plan.md`/`file-browser-plan.md` already — nothing
durable was lost with it). This file exists so the *next* session — on
whatever model or account picks it up — doesn't re-derive any of this from
scratch. It complements, not replaces, two other files:

- **`docs/project/file-browser-plan.md`** — the technical plan: what's
  built, what's tested, what's left, phase by phase. Read this first for
  "what do I work on next." Its section 5 carries the build/verification
  gotchas this session confirmed or added.
- **The OTA distribution server's own README** — how it runs and why; it
  lives outside this repo (moved there 2026-09-13, together with scrubbing
  this machine's LAN IP/tunnel hostname out of git history — that scrub is
  done, just don't re-leak them).

This file is the narrative glue: what actually happened this session, in
what order, and why it matters for whoever continues.

## Where things stand right now

`HEAD` is `4f4f811` (two commits: the grant fix `6f14d51` + the
deployment-target script absorb), this doc update landing right after.
Working tree clean. **89 Rust tests, 215 web tests, `tsc --noEmit` clean**,
all green as of the end of session.

1. **The real-device bug is fixed and verified end-to-end** — committed as
   `6f14d51`, full writeup in `plan.md`'s 2026-10-07 entries. The report
   (2026-09-17: granting a folder above the current document, or granting
   from the first-launch prompt before any document was open, produced no
   usable folder view) had two real bugs: `list_directory` returned
   `not_found: no document open yet` before consulting the grants, and
   `wirePermissions` never handed a successful grant to the file browser.
   Both fixed (grant fallback to the most recent grant as browse root;
   new `openTo(path)` handoff), 6 new tests pinning the shapes that were
   already sound.

   **Verified by running it**, on the device-matched simulator (iPhone 16
   Pro Max, iOS 18.5) driven by Maestro: first-launch prompt → native
   folder picker (first-ever presentation of `ios_folder_picker.rs`) →
   grant → Done → the browser opened by itself at the grant; a real
   3490-byte security-scoped bookmark persisted and restored alive on
   relaunch; Browse listed the restored grant; a seeded
   `last_opened_document` rendered at startup; both corrupt-store shapes
   (garbage bookmark bytes, malformed JSON) survived startup. Details and
   method in `file-browser-plan.md` §1/§2c/§5.

2. **A new bug was found and flagged, not fixed**: the auto-fading
   toolbar (`opacity: 0.06; pointer-events: none` after 2.5s idle) never
   comes back when nothing on screen scrolls — with no document open, the
   *entire* toolbar (Open/Find/Preferences/Browse files) is dead and
   nearly invisible until a pinch-zoom or rotation. It makes the very bug
   fixed in point 1 *look* unfixed on a phone ("tap Browse, nothing
   happens"). Fix design (wake on tap vs. don't fade when unscrollable)
   needs a decision — see `plan.md` + `file-browser-plan.md` §4.

3. **The device crash report is still undiagnosed** ("starts and
   immediately crashes" on the real iPhone). Every startup path that
   could be exercised was exercised on the device-matched simulator —
   real bookmark restore, both corrupt stores, last-opened restore — and
   all survive; the OTA transport was ruled out by md5 (served IPA is
   byte-identical to local). What's missing is a crash log: iOS keeps
   those on-device (USB + unlock → `idevicecrashreport`/`idevicesyslog`,
   both installed and working, or on the phone: Settings → Privacy &
   Security → Analytics → Analytics Data → MDViewer). The phone was
   unreachable all session (`idevice_id -l` → none).

4. **Cleanup done**: the temporary `debug_grant_folder` command and the
   temporary Maestro flow are gone (they never landed in a commit).
   `spike_read_dir_variants` was deliberately **kept** — §2b's device
   spike is still unanswered and its procedure references it. Note the
   IPA currently served over OTA was built *before* that cleanup, so it
   still contains the debug command; rebuild before the next OTA update.

5. **Build/tooling state**: the OTA `.ipa` currently live is a **debug**
   archive zipped directly from the `.xcarchive` (`xcodebuild
   -exportArchive` crashes with `errSecInternalComponent` here), audited
   and byte-verified through the tunnel. **Release builds don't link at
   all** (Tauri 2.11.5 / swift-rs 1.0.8 local symbols vs. Xcode 27 /
   Swift 6.1) — decision open (upgrade/patch swift-rs, capture crash
   data from Xcode instead, or defer). Xcode 27 also refuses the
   scaffolded iOS 14.0 deployment target; that 15.0 bump is now scripted
   in `configure-ios-project.sh` section 4 instead of being a hand-edit.

## The session's arc, briefly

1. Root-caused the 2026-09-17 device report from code + the file-browser
   plan's own test evidence: two real bugs (above), ancestor access
   control already sound (hence only tests for it).
2. Fixed both, rebuilt the web bundle deterministically, all suites green,
   committed `6f14d51`.
3. Rebuilt and served a debug OTA IPA; md5-verified tunnel delivery
   end-to-end (that's what ruled transport out for the crash report).
4. Drove the full grant flow on the simulator with Maestro for the first
   time this project — which both verified the fix and retired "never
   run once" on the native picker.
5. Spent the bulk of the mid-session debugging what looked like the fix
   not working after relaunch — turned out to be the toolbar auto-fade
   (point 2) plus **stale simulator screenshots** (the display had
   slept; images came back with clocks running backwards) — a trap that
   cost real time twice before switching to the a11y hierarchy as the
   source of truth.
6. Exercised the device-only startup paths properly: correctly-located
   state files (an earlier test had seeded the wrong directory —
   `app_config_dir()` appends the bundle id, top-level files are read by
   nothing), corrupt stores, last-opened restore — all survive.
7. Release-build/tooling investigation (point 5 above), then cleanup,
   docs, commits.

## What's next

- **Get the device crash log** — the only true blocker on the reported
  crash. USB + unlock, or the user reading MDViewer entries in on-device
  Analytics. Then retest OTA with the app **deleted first** (version is
  still `0.1.0`, so an upgrade install won't re-show the one-time
  first-launch prompt).
- **Real-device pass of the grant flow** — picker on device, security
  scope restored from device-created bytes, scenario (a) (grant above an
  open document) through the UI, plus §2b's `read_dir` spike (code kept
  for it).
- **Two open decisions**: the release-build block, and the toolbar-fade
  fix design (both written up; neither chosen).
- If the phone stays unreachable: `file-browser-plan.md` §3/§4 for what's
  emulator/verifiable instead, and the standing desktop-test gap.

## Patterns worth repeating

Every real bug this project finds is found by *running the thing* — CDP
against a live emulator, Maestro against a live simulator, `curl` against a
live server — never by reading code and trusting it. This session adds the
corollary: **screenshots are the first evidence to go stale.** Twice now
(`adb exec-out screencap` on Android, `xcrun simctl io screenshot` on iOS)
they showed confidently wrong frames while the live DOM/a11y tree was
right. When a screenshot and a live read disagree, believe the live read —
and check the screenshot's own timestamp/status-bar clock before believing
the screenshot at all.
