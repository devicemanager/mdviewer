# Changelog

All notable changes to MDViewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.2.1] — 2026-07-17

### Added
- Third-party open-source license and copyright notices (marked, Shiki, KaTeX, Mermaid, DOMPurify) are now shown in the About panel's Credits area (**App menu → About MDViewer**), along with a copyright line — so the notices ship inside the app, not only in the repository.

---

## [1.2.0] — 2026-07-16

### Added
- **Privacy — remote content policy**: remote (`http`/`https`) images are gated by a policy you control in **Preferences → Privacy** — **Ask** (prompt per document), **Always**, or **Never**.
- **On-demand folder access**: documents that reference local images prompt to grant access to their folder (remembered per folder), so relative images render under the sandbox without exposing your whole disk.

### Security
- The app now runs inside the **macOS App Sandbox** (with the `network.client` entitlement for opt-in remote images and security-scoped bookmarks for file access — the last-opened document reliably reopens across launches).
- Rendered Markdown is sanitized with **DOMPurify** before insertion; a strict **Content-Security-Policy** is enforced via a response header; the renderer is served through a custom local scheme (no `file://` origin); and clicked links are restricted to `http`/`https`/`mailto` and local Markdown.
- Quick Look always blocks remote content.

### Changed
- **Dependency updates**: marked 12 → 18.0.6, KaTeX 0.16.11 → 0.17.0, Mermaid 10.9.5 → 11.16.0; syntax highlighting rebuilt from official Shiki 4.3.1 (27 → 40 languages).
- **Quick Look** previews re-architected to render reliably as a static snapshot.

---

## [1.1.3] — 2026-07-15

### Added
- **Quick Look preview**: press Space on a `.md` file in Finder to see it fully rendered — syntax highlighting, KaTeX math, and Mermaid diagrams — without opening the app. Implemented as a sandboxed Quick Look extension.

### Changed
- Added the MIT `LICENSE` file and credited original author Masanori Sakai (@Masakai).
- Internal documentation and code comments translated to English.

---

## [1.1.2] — 2026-06-14

### Changed
- Internal code formatting only: the entire Swift codebase was reformatted with SwiftFormat to enforce the 4-space indentation convention. No functional or behavioral changes.

---

## [1.1.1] — 2026-06-12

### Fixed
- Local images stored alongside the Markdown file are now rendered correctly. Relative image paths are served through the `mdviewer-local://` scheme handler instead of `file://`, which the WebView sandbox had been blocking (images previously appeared as broken links).

---

## [1.1.0] — 2026-05-22

### Added
- Split-view editor mode: toggle with ⌘E or the toolbar pencil button
- Left editor pane with monospaced text input and live preview on the right
- Save support: ⌘S saves changes to the current file (read-write sandbox entitlement)
- Unsaved-change guard: closing the window with unsaved changes prompts Save / Discard / Cancel

---

## [1.0.3] — 2026-05-05

### Added
- Export: default filename now inherits the source Markdown filename (e.g. `README.pdf` instead of `document.pdf`); percent-encoded characters (Japanese, spaces) are decoded correctly
- Title bar now displays the open filename instead of "MDViewer"

### Removed
- Page thumbnail sidebar removed; TOC sidebar only

---

## [1.0.2] — 2026-05-05

### Changed
- PDF export: replaced `WKWebView.createPDF()` (single-page) with `NSPrintOperation.runModal` to correctly apply print CSS and generate properly paginated multi-page PDFs

### Fixed
- PDF export hang-up resolved by switching to `NSPrintOperation.runModal`
- Sidebar: thumbnail tab temporarily hidden (TOC-only display)

---

## [1.0.1] — 2026-05-05

### Added
- PDF/print layout: `@media print` styles for A4 page size, margins, and page-break control
- Build and notarization script (`build-notarize.sh`)

### Fixed
- Shiki syntax highlighter: added try/catch with fallback and 8-second initialization timeout
- Removed redundant light-theme CSS overrides for Shiki (inline styles take precedence)

---

## [1.0.0] — 2026-05-04

### Added
- Initial release
- Markdown rendering via WKWebView + marked.js v12
- Syntax highlighting for 27 languages via Shiki v1 (github-light / github-dark dual themes)
- LaTeX math rendering via KaTeX v0.16 — inline `$…$` and block `$$…$$`
- Mermaid diagram support — flowcharts, sequence diagrams, Gantt charts
- Auto-generated table of contents sidebar from headings
- Page thumbnail sidebar (generated via PDFKit) — removed in v1.0.3
- Live file reload using `DispatchSource` (kqueue, 0.5 s debounce)
- Local image loading via custom `mdviewer-local://` URL scheme handler
- Theme switching — GitHub Light / GitHub Dark, follows macOS appearance
- Font size control — increase, decrease, reset (⌘+, ⌘−, ⌘0)
- PDF export via `WKWebView.createPDF()`
- HTML export
- Smart link handling — local `.md` links open in-app, external links open in browser
- In-page text search (⌘F)
- Japanese / English localization
- Developer ID signing and Apple notarization
- Landing page (English and Japanese)
