# Development Setup

How to build, run and test both MDViewer implementations: the **Tauri port** (current development, five platforms) and the **Swift app** (shipped macOS reference). [Architecture](architecture.md) explains how they relate.

## Prerequisites

| For | You need |
|---|---|
| Everything | macOS on Apple Silicon, Git, Node 22 or later |
| Tauri port | Rust via **rustup** (Homebrew's `cargo` breaks the mobile builds), the Tauri CLI (installed by `npm install`) |
| iOS builds | Xcode 27 with an Apple Developer team, signed in or with an App Store Connect API key (see below) |
| Android builds | Android command-line tools, OpenJDK 17 |
| Swift app | Xcode (deployment target macOS 14) |
| Visual audit | Playwright's WebKit: `cd web && npx playwright install webkit` (once) |

For mobile builds, put these in your shell:

```bash
export PATH="$HOME/.cargo/bin:$PATH"     # rustup's cargo first
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

## Getting started

```bash
git clone https://github.com/devicemanager/mdviewer.git
cd mdviewer
npm install                 # Tauri CLI
cd web && npm install       # TypeScript, esbuild, vitest, Playwright
npm run build               # web/src → MDViewer/Resources/Web/mdviewer.js
cd ..
```

`npm run build` in `web/` is not run automatically by Tauri. Run it after every change in `web/src`, or the app keeps serving the previous `mdviewer.js`.

## Tauri port

### Desktop

```bash
npm run tauri dev           # opens the app; Rust changes rebuild automatically
npm run tauri build         # release bundle for the current OS
```

The frontend is served directly from `MDViewer/Resources/Web` (`frontendDist` in `src-tauri/tauri.conf.json`). There is no dev server. To start with a document already open, set `MDVIEWER_TEST_DOCUMENT_PATH=/path/to/file.md`.

### iOS

The generated Xcode project in `src-tauri/gen/apple` is not tracked by git. After any `tauri ios init`, run `./configure-ios-project.sh`. It reapplies what Tauri doesn't generate, and is safe to run repeatedly:
- open-in-place support;
- manual signing;
- the deployment target;
- the privacy manifest;
- iPhone-only.

**Development builds (over the air, no cable).**
1. Build a debug archive:
   ```bash
   npm run tauri ios build -- --debug --target aarch64 --archive-only
   ```
2. Zip the archive's `Payload` into an `.ipa`.
3. Put it on the OTA server, a separate `mdviewer-ota` folder linked as `ota/` and not tracked by git.

`docs/project/file-browser-plan.md` §5 has the details.

Debug builds write `Documents/mdviewer-debug.log`. On the phone it's in Files → On My iPhone → MDViewer; for native crashes, look under Settings → Privacy & Security → Analytics Data.

**App Store / TestFlight builds.**
1. Raise `bundle.iOS.bundleVersion` in `src-tauri/tauri.conf.json`. App Store Connect rejects a build number it has seen before.
2. Run:
   ```bash
   ./build-appstore-ios.sh            # archive + checks + export an .ipa
   ./build-appstore-ios.sh --upload   # …and upload to App Store Connect
   ```

Uploading authenticates with an App Store Connect API key if one is set up. Otherwise it uses the Apple ID signed into Xcode, and that sign-in expires after a few idle hours with "Failed to Use Accounts". To set up a key once per machine:
- Put the key file at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`.
- Create `~/.appstoreconnect/asc.env` containing:
  ```
  ASC_KEY_ID=<KEY_ID>
  ASC_ISSUER_ID=<issuer id from App Store Connect → Users and Access → Integrations>
  ```

The script never submits for review; that stays a manual step in App Store Connect. The listing text lives in `docs/appstore/listing-ios.md`.

### Android

```bash
npm run tauri android build -- --debug --apk
```

The app has been verified on the emulator. Choosing a folder doesn't work on Android yet: there's no Storage Access Framework support.

### Windows and Linux

Not built or verified yet; that's Milestone F in `docs/project/plan.md`.

## Swift app

```bash
open MDViewer.xcodeproj     # then ⌘R
xcodebuild -scheme MDViewer -configuration Debug build
```

The Swift tree is the reference implementation and is not changed during the port; see `docs/project/porting-brief.md`. Release scripts:

| Script | Produces |
|---|---|
| `./build-notarize.sh` | Developer ID build, notarized, `build/MDViewer.zip` |
| `./package-dmg.sh` | Notarized DMG |
| `./build-appstore.sh` | Mac App Store package |

Notarization uses a Keychain profile, created once with `xcrun notarytool store-credentials`. See the header of each script.

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Web unit tests | `cd web && npm test` | Renderer, view models, UI modules (vitest + jsdom) |
| Type check | `cd web && npm run typecheck` | `tsc --noEmit`, strict |
| Visual audit | `cd web && npm run test:visual` | Every theme × phone/desktop × UI state in real WebKit: text contrast (WCAG 2.2 AA), controls on screen, nothing running off the screen. About 3 minutes; screenshots land in `web/visual-output/`. |
| Privacy end to end | `cd web && npm run test:e2e` | The remote-image setting (Ask / Always / Never) in real WebKit with the real CSP: whether an image's server is contacted and the image shows, for a plain document and a GitHub-style README. Known gaps are `it.fails` ("expected fail"); one turning red means it's been fixed. About 30 seconds. |
| Rust tests | `cd src-tauri && cargo test --offline` | Commands, path checks, link handling, file watching, state files (headless, via `tauri::test`) |
| iOS UI flows | `maestro --device <udid> test tests/maestro/<flow>.yaml` | Scripted simulator runs (needs `JAVA_HOME` to point at OpenJDK 17) |
| Swift tests | `xcodebuild -scheme MDViewer test` | The reference app's XCTest suite |

Run the visual audit after any change to CSS, a theme, or the Mermaid/Shiki colours. [Colour & contrast](color-and-contrast.md) explains the thresholds.

## Debugging

- **Desktop:** right-click → Inspect in a `tauri dev` window opens the web inspector.
- **iOS Simulator:** Safari → Develop → Simulator → MDViewer.
- **Device:** the debug log described above. Script errors are forwarded there too (`errorForwarding.ts`).
- **Android emulator:** `chrome://inspect` in Chrome. When a screenshot and the page disagree, trust what you read from the page; `adb` screenshots can be stale.

## Common issues

| Symptom | Fix |
|---|---|
| iOS/Android build fails with linker or target errors | `which cargo` must be `~/.cargo/bin/cargo`, not Homebrew's |
| Changes in `web/src` don't show up | Run `npm run build` in `web/` |
| App missing from the Files app's "Open in" menu | Re-run `./configure-ios-project.sh` (`LSSupportsOpeningDocumentsInPlace`) |
| `xcodebuild -exportArchive`: "archive not found" right after archiving | Retry once |
| iOS build: "Directory not empty" | Remove stale `src-tauri/gen/apple/build/**/MDViewer.app` |
| Upload: "Failed to Use Accounts" | Sign in again in Xcode → Settings → Accounts, or set up the API key |
| Visual audit: browser not found | `npx playwright install webkit` |

## Resources

- [Tauri 2](https://v2.tauri.app/) · [marked](https://marked.js.org/) · [Shiki](https://shiki.style/) · [KaTeX](https://katex.org/) · [Mermaid](https://mermaid.js.org/) · [DOMPurify](https://github.com/cure53/DOMPurify)
- [SwiftUI](https://developer.apple.com/documentation/swiftui/) · [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)
