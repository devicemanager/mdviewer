# MDViewer — App Store listing, iPhone (draft)

Companion to `listing.md` (the Mac listing). Same App Store Connect record —
bundle ID `org.devicemanager.mdviewer`, team `64G8P2LG44`, price **Free** —
with iOS added as a second platform (universal purchase; the user's call,
2026-10-17). Version **1.0.0**, build **1** (`tauri.conf.json`'s
`version` / `bundle.iOS.bundleVersion`; bump the build number for every
upload). iPhone only.

> Only claim what the iPhone app does. Unlike the Mac app it has **no**
> editor, **no** PDF/HTML export and **no** Quick Look — App Review checks
> metadata against the app (guideline 2.3).

---

## Shared across platforms (App Information)
Name, subtitle, category and privacy policy URL belong to the app record,
not the platform, so the iPhone listing shows the Mac's values.

- **Name (≤30):** `MDViewer`
- **Subtitle (≤30):** the Mac draft's `Markdown viewer & Quick Look`
  promises Quick Look, which iPhone lacks. Use one that fits both:
  `Markdown, math & diagrams` (25).
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
• No accounts, analytics, tracking or ads — nothing leaves your iPhone
• Only reads the files and folders you choose
• Remote images in documents are not loaded

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
MDViewer is a Markdown viewer. No account or login is required.

To review:
1. On first launch, an optional prompt offers to grant a folder; you can
   skip it ("Not now").
2. Open a .md file: tap "Open…" (second button from the top left), or
   open any .md from the Files app via Share/"Open in" → MDViewer.
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
2. **Privacy policy URL** — live today at
   `https://devicemanager.github.io/mdviewer/privacy.html` (GitHub Pages,
   `main:/docs` on origin). Locally the file moved to
   `docs/appstore/privacy.html`, so the next push turns that URL into a 404
   unless a copy (or redirect) is kept at `docs/privacy.html`. The local
   file is updated for iPhone (2026-10-17); it goes live only on push.
3. **About text link** — the acknowledgements end with
   `.../blob/main/THIRD_PARTY_NOTICES.md` (verbatim from the Swift app).
   That file exists on origin today but not in the local tree
   (`docs/project/third-party-notices.md` now), so it breaks on the same
   push.
