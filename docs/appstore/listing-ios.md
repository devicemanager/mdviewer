# MDViewer — App Store listing, iPhone (draft)

Companion to `listing.md` (the Mac listing). Same App Store Connect record —
bundle ID `org.devicemanager.mdviewer`, team `64G8P2LG44`, price **Free** —
with iOS added as a second platform (universal purchase; the user's call,
2026-10-17). Version **1.0.0**, build **7** (`tauri.conf.json`'s
`version` / `bundle.iOS.bundleVersion`; bump the build number for every
upload). iPhone only.

**Status (2026-10-20):** the iOS version 1.0.0 exists in App Store Connect,
created through the API. The en-US texts below, the four screenshots (6.9")
and the App Review notes are filled in; release is "automatically after
approval", as for the Mac app. Submitted for review 2026-10-17 with build 5;
**rejected 2026-10-19 under guideline 2.1(a), "Information Needed"**:
reviewed on an iPad Air 11-inch (M3), the reviewer had no Markdown file to
open and asked for a demo account or a demo mode. The app has no accounts,
so build 7 adds a built-in sample document ("Open Sample Document" on the
welcome screen), and the review notes below point to it. **Resubmitted
2026-10-20 with build 7** and the notes below (a new review submission; the
rejected one was cancelled, since App Store Connect keeps a version tied to
it). The subtitle was changed 2026-10-21 (below).

Build 7 was **rejected 2026-10-21 under guideline 4.3(a), "Design"** (spam):
the app icon was identical to other apps'. It was Tauri's default
placeholder logo, which every unbranded Tauri app shares. Build 8 uses
MDViewer's own icon, the same as the Mac app's (commit ccb1344).
**Uploaded 2026-10-21 as build 8**, icon checked in TestFlight.
**Resubmitted 2026-10-22 with build 8** — through the same review
submission this time (its "Resubmit to App Review"), not a new one; it
sat at Unresolved Issues with the version Ready for Review until that
button was pressed. **Approved 2026-10-24** (release: automatically
after approval). **Live on the App Store 2026-10-24.**

> Only claim what the iPhone app does. Unlike the Mac app it has **no**
> editor, **no** PDF/HTML export and **no** Quick Look — App Review checks
> metadata against the app (guideline 2.3).

---

## Shared across platforms (App Information)
Name, subtitle, category and privacy policy URL belong to the app record,
not the platform, so the iPhone listing shows the Mac's values.

- **Name (≤30):** `MDQuickView` in App Store Connect (the home-screen name
  is still `MDViewer`, from `productName` in `tauri.conf.json`)
- **Subtitle (≤30):** `Markdown reader, Mac & iPhone` (29), set 2026-10-21 via
  the API. It replaced `Quick Look for Finder`, which promised Quick Look
  and Finder to iPhone users; takes effect when 1.0.0 is approved.
- **Category:** Productivity (primary), Developer Tools (secondary)
- **Privacy Policy URL:** see "Before submitting" below — the URL moves on
  the next push.

## iOS version page

### Promotional Text (≤170)
`Read Markdown beautifully on iPhone: syntax-highlighted code, KaTeX math, Mermaid diagrams and tables. Private by design — no accounts, no tracking.`

### Keywords (≤100)
`markdown,md,viewer,reader,preview,readme,notes,syntax,highlight,katex,math,latex,mermaid,diagram`

### Description (≤4000)
```
MDViewer is a fast, private Markdown viewer for iPhone. Open any .md file
from the Files app — or browse folders you choose — and read it beautifully
rendered.

RENDERING
• Syntax highlighting for 40 languages (Shiki)
• LaTeX math, inline and block, via KaTeX
• Mermaid diagrams — flowcharts, sequence diagrams and more
• Tables, task lists, blockquotes and everything else Markdown has
• Six themes: GitHub Light / Dark, Solarized Light / Dark, Dracula, Nord
• Adjustable text size, and pinch to zoom

FILES
• Open .md files straight from the Files app, iCloud Drive or other apps
• Grant a folder once and browse its Markdown files in the app
• Remembers your last document and granted folders

READING
• Find in document
• The toolbar fades away while you read and comes back with a tap

PRIVATE BY DESIGN
• No accounts, analytics, tracking or ads — your documents never leave your iPhone
• Only reads the files and folders you choose
• Remote images load only if you allow them (Ask, Always or Never)

MDViewer is open source (MIT). It is a fork of the original MDViewer by
Masanori Sakai.
```

### What's New
```
MDViewer is now on iPhone.
```

### Screenshots — 6.9" iPhone (1320×2868)
In `docs/appstore/ios-screenshots/`, taken on the iPhone 16 Pro Max
simulator from the release build, document `ios-screenshot-demo.md`:
1. `6.9in-1-document.png` — rendered document, table, task list
2. `6.9in-2-code.png` — highlighted Swift/Python and KaTeX math
3. `6.9in-3-diagrams.png` — Mermaid flowchart and sequence diagram
4. `6.9in-4-file-browser.png` — the in-app folder browser

Only the 6.9" set is required; App Store Connect scales it for smaller
iPhones.

## App Privacy questionnaire
**Data Not Collected.** No tracking, no third-party SDKs, no analytics.
Matches `src-tauri/PrivacyInfo.xcprivacy` (no tracking, no collected data
types).

## Age rating
4+.

## Export compliance
Exempt — `ITSAppUsesNonExemptEncryption = false` ships in Info.plist (via
`src-tauri/Info.ios.plist`), so uploads skip the compliance question.

## App Review notes (paste into "Notes")
```
MDViewer is a Markdown viewer. It has no accounts, no login and no
server, so there is no demo account: every feature works without one.

Demo content: on the first screen, tap "Open Sample Document". It opens a
document built into the app that shows every feature — formatted text,
lists and task lists, a table, syntax-highlighted code, math (KaTeX),
diagrams (Mermaid) and a local image.

To review:
1. On first launch, an optional prompt offers to grant a folder; you can
   skip it ("Not now").
2. Tap "Open Sample Document" (see above). To open your own .md file, tap
   "Open File…", or "Open…" (second button from the top left), or open
   any .md from the Files app via Share/"Open in" → MDViewer.
3. The top-left button ("Browse files") opens the in-app browser for a
   folder you granted. Top right: Find, then Preferences — Appearance,
   Privacy and About (About lists the open-source licenses).
The toolbar fades after a few seconds of reading; tap the top of the
screen to bring it back.

This app is open source under the MIT License, a fork of the original
"MDViewer" by Masanori Sakai (github.com/Masakai). Third-party notices
are in the app under Preferences → About.
```

---

## Before submitting
1. **Signing/upload access** — App Store distribution needs either an Apple
   ID signed into Xcode (Settings → Accounts) or an App Store Connect API
   key; see `build-appstore-ios.sh`.
2. **Privacy policy URL** — `https://devicemanager.github.io/mdviewer/privacy.html`
   (GitHub Pages, `main:/docs`). The published site lives at the paths
   GitHub Pages serves: `docs/index.html` (the App Store marketing URL),
   `docs/privacy.html`, `docs/ja/index.html`, `docs/icon.png`,
   `docs/screenshot.png`. Don't move them; the App Store listings link to
   them. Pushing publishes the iPhone wording of the privacy policy.
3. **About text link** — the acknowledgements end with
   `.../blob/main/THIRD_PARTY_NOTICES.md` (verbatim from the Swift app), so
   that file stays at the repository root.
