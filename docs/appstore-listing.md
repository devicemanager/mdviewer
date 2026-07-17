# MDViewer — App Store listing (draft)

Working draft of the App Store Connect metadata for **MDViewer** (macOS).
Bundle ID: `org.devicemanager.mdviewer` · Team: `64G8P2LG44` · Price: **Free**

> Field character limits are noted in parentheses. Trim to fit before submitting.

---

## Name (≤30)
`MDViewer`

> Check availability in App Store Connect — if "MDViewer" is taken, fallbacks:
> `MDViewer – Markdown Reader` (25) · `MDViewer: Markdown Viewer` (25)

## Subtitle (≤30)
`Markdown viewer & Quick Look` (28)

> Alternatives: `Read Markdown with Quick Look` (29) · `Markdown, math & diagrams` (25)

## Category
- **Primary:** Productivity
- **Secondary:** Developer Tools

## Promotional Text (≤170)
`Fast, native Markdown viewer with a Quick Look extension, syntax highlighting, KaTeX math, Mermaid diagrams, and a built-in editor. Fully private and sandboxed.`

## Keywords (≤100, comma-separated, no spaces)
`markdown,md,viewer,reader,preview,quicklook,syntax,highlight,katex,math,mermaid,diagram,readme,editor,latex`

## Description (≤4000)
```
MDViewer is a fast, native macOS app for reading and editing Markdown files —
with a Quick Look extension so you can preview .md files right in Finder.

RENDERING
• Syntax highlighting for 40 languages (Shiki)
• LaTeX math, inline and block, via KaTeX
• Mermaid diagrams — flowcharts, sequence, Gantt, and more
• Auto-generated table-of-contents sidebar with smooth scrolling
• GitHub Light / Dark themes that follow your macOS appearance

QUICK LOOK
• Press Space on any .md file in Finder for a full, rendered preview —
  no need to open the app.

EDITOR
• Toggle a split-view editor (⌘E): edit on the left, live preview on the right
• Save with ⌘S; watches the file and live-reloads external changes

EXPORT
• Export to PDF or HTML, preserving styles

PRIVATE BY DESIGN
• Runs in the macOS App Sandbox
• Collects no data — no accounts, analytics, tracking, or ads
• Remote images never load unless you allow them (Ask / Always / Never)

MDViewer is open source (MIT). It is a fork of the original MDViewer by
Masanori Sakai, extended with the Quick Look extension and security hardening.
```

## What's New (≤4000) — first submission
```
First App Store release.
• Native Markdown rendering with syntax highlighting, KaTeX math, and Mermaid diagrams
• Quick Look preview extension for Finder
• Split-view editor with live preview
• PDF / HTML export
• Runs sandboxed; remote images are off unless you allow them
```

## URLs
- **Support URL:** https://github.com/devicemanager/mdviewer
- **Marketing URL:** https://devicemanager.github.io/mdviewer/
- **Privacy Policy URL:** https://devicemanager.github.io/mdviewer/privacy.html

## Age rating
`4+` (no objectionable content)

## App Privacy (App Store Connect questionnaire)
- **Data collection:** *No* — "Data Not Collected."
- No tracking, no third-party SDKs, no analytics. (The app only fetches remote
  images you explicitly allow, directly from their host servers; MDViewer stores
  and receives nothing.)

## Export compliance
- Uses only exempt encryption (standard HTTPS). `ITSAppUsesNonExemptEncryption`
  is set to `false` in Info.plist, so no per-upload compliance prompt.

## App Review notes (paste into "Notes")
```
MDViewer is a Markdown viewer/editor. No account or login is required —
all features are available immediately on launch. To review:
1. Open any .md file (File → Open), or press Space on a .md in Finder for the
   Quick Look preview.
2. ⌘E toggles the split-view editor; Export is under the Export menu.

This app is open source under the MIT License. It is a fork of the original
"MDViewer" by Masanori Sakai (github.com/Masakai), extended by the submitter
with a Quick Look extension and App Sandbox / security hardening. Distribution
rights come from the MIT license; third-party and original-author notices are
shown in the app's About panel (App menu → About MDViewer → Credits) and in
THIRD_PARTY_NOTICES.md.
```

## Screenshots (required — at least 1)
Accepted macOS sizes: 1280×800, 1440×900, **2560×1600**, or 2880×1800.
Capture at 2560×1600 (Retina 13"). Suggested set:
1. A rich document rendered — heading + KaTeX math + a highlighted code block + TOC sidebar
2. Finder Quick Look preview of a .md file (Space bar)
3. Split-view editor (⌘E) with live preview
4. Dark theme (same doc)
5. The remote-content Privacy prompt (Ask policy)

---

## Build & upload
1. `./build-appstore.sh` → produces `build/appstore/export/MDViewer.pkg`
   (needs the App IDs registered + you signed into Xcode with the account).
2. Upload via Xcode Organizer → Distribute App, or Transporter, or `xcrun altool`.
3. In App Store Connect: create the app record for `org.devicemanager.mdviewer`,
   fill in the fields above, attach screenshots, set price = Free, answer App
   Privacy = "Data Not Collected," and submit for review.
