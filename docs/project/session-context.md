# Session context — for picking this up cold

**Written 2026-10-17 (end of session)**, replacing the earlier 2026-10-17
version; everything durable from it is in `plan.md`/`file-browser-plan.md`.
Read alongside:

- **`docs/project/file-browser-plan.md`** — what's built/tested/left, and
  §5's build/verification gotchas.
- **`docs/appstore/listing-ios.md`** — the iPhone App Store listing draft and
  its "Before submitting" checklist.
- **The OTA server's README** — sibling `mdviewer-ota` folder, outside this
  repo (don't leak its LAN IP/tunnel hostname into git).

## Where things stand

`HEAD` is `4e3b634` plus this doc commit. Working tree clean.
**96 Rust tests, 235 web tests, `tsc --noEmit` clean.** Nothing pushed:
`origin/main` is 49 commits behind.

The user reports the OTA build no longer crashes and works as planned, and
asked to submit the iPhone version to the App Store. Their decisions: one
App Store record with the Mac app (same bundle ID), debug log in debug
builds only, iPhone only, version 1.0.0.

**Ready:** release build 1.0.0 (build 1) archives with a privacy manifest,
export-compliance key, iPhone-only family and in-app license notices.
`./build-appstore-ios.sh` does configure → archive → bundle checks →
export (or `--upload`). Listing text and four 6.9" screenshots are in
`docs/appstore/`.

**Uploaded (2026-10-17, 09:04 CEST):** after the user signed into Xcode,
`./build-appstore-ios.sh --upload` uploaded 1.0.0 (build 1) to App Store
Connect ("Upload succeeded", no warnings returned). Xcode created an "iOS
Team Store Provisioning Profile" for the bundle ID automatically. Apple
processes the build next and may still email ITMS issues.

**Left for the user:**
1. Wait for processing (the build appears under TestFlight), and watch
   for an Apple email about the build.
2. App Store Connect: add iOS to the `org.devicemanager.mdviewer` record
   (or create it), fill in the metadata from `listing-ios.md`, and submit.
   The submit is theirs.
3. ~~Before pushing: keep `docs/privacy.html` and `THIRD_PARTY_NOTICES.md`
   working.~~ Resolved 2026-10-17: the published site files and the notices
   are back at their live paths, so pushing is safe.

**Contrast pass (later the same day):** after TestFlight feedback that parts
of the UI were hard to see on the phone, `npm run test:visual` (web/) now
audits every theme × phone/desktop × UI state in WebKit against WCAG 2.2 AA;
all failures it found are fixed (108/108), including three theme stylesheets
that never existed. DOMPurify/KaTeX bumped for new advisories. Build number
is now 2 (`tauri.conf.json`); **build 2 is not uploaded yet**. Build 1 in App
Store Connect has the old CSS and libraries. Guidance:
`docs/development/color-and-contrast.md`. Run the visual audit after any CSS
change.

**Flagged, not fixed:** remote images never load in the port (static CSP
vs. Swift's dynamic one), so "Always load" in Preferences → Privacy does
nothing. Privacy-safe but a parity gap; fixing it relaxes the CSP, so it
needs the user's call.

## What's next

- Once credentials exist: `./build-appstore-ios.sh --upload`, then the
  App Store Connect side. Bump `bundle.iOS.bundleVersion` in
  `tauri.conf.json` for every later upload.
- OTA dev builds keep working as before (debug archive + zip Payload; see
  file-browser-plan.md §5). They're now 1.0.0 (1) too.
- Remaining port work: `file-browser-plan.md` §3/§4 (Android `content://`
  gap, security-scope lifetime gap, desktop never verified).

## Patterns worth repeating

- **Derive the privacy manifest from the release binary** (`nm -u` +
  `strings` on the archived executable), not from the debug one or from
  guesses. Debug binaries carry objc2 bindings that release dead-strips.
- **Regenerating the Xcode project is safe only via
  configure-ios-project.sh**: it moves `Externals/` aside for xcodegen and
  then reapplies every hand-edit.
- **Store screenshots expose real bugs.** The drawer-shadow strip had been
  in every screenshot for weeks before anyone looked at one as a
  customer would.
