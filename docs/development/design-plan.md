# MDViewer macOS App — Design Plan

**Created**: 2026-05-04
**Target platform**: macOS 13.0 (Ventura) or later
**Language**: Swift 5.9 / SwiftUI
**Architecture pattern**: MVVM

---

## 1. Design Overview

A native macOS Markdown viewer app. It shows a table of contents (TOC) in the left panel and renders Markdown in the main area on the right. In addition to GFM-compliant rendering, it supports syntax highlighting, math (KaTeX), Mermaid diagrams, and tables.

### Core Design Decisions

| Challenge | Decision | Rationale |
|------|----------|------|
| Markdown rendering engine | WKWebView + marked.js + highlight.js + KaTeX + Mermaid.js | Math, Mermaid, and syntax highlighting all require JavaScript, so a native AttributedString cannot achieve them |
| Left-panel table of contents | Extract headings with swift-markdown (swiftlang) | Gets the heading hierarchy structurally without needing to parse HTML |
| Code signing | Development: ad-hoc / Distribution: Developer ID | ad-hoc is limited to the local machine; Developer ID + Notarization is required when distributing to others |

---

## 2. Technology Stack

### 2.1 Swift Package Dependencies

| Package | Purpose | URL |
|-----------|------|-----|
| `swift-markdown` (swiftlang) | AST parser for TOC extraction | https://github.com/swiftlang/swift-markdown |

Only this one package is managed via SPM. All other JS libraries are bundled as resources.

### 2.2 Bundled Resources (JS/CSS)

| Library | Approx. version | Purpose |
|-----------|-------------|------|
| marked.js | v12+ | GFM Markdown → HTML conversion |
| highlight.js | v11+ | Code-block syntax highlighting |
| KaTeX | v0.16+ | LaTeX math rendering |
| Mermaid.js | v10+ | Flowcharts and sequence diagrams |
| GitHub Markdown CSS | Latest | Base CSS for light/dark themes |

These are placed in the `Resources/Web/` directory, and WKWebView loads local files from within the bundle. It works offline with no network required.

### 2.3 Frameworks (macOS standard)

- **SwiftUI** — main UI
- **WebKit (WKWebView)** — Markdown rendering area
- **AppKit** — NSPasteboard, NSSavePanel, file watching
- **UniformTypeIdentifiers** — drag & drop MIME detection

---

## 3. Feature Specification (full spec)

### 3.1 File Operations

| Feature | Details |
|------|------|
| Open file | Select `.md`, `.markdown`, `.txt` via NSOpenPanel. Implements the `FileDocument` protocol |
| Drag & drop | Accepts `.md`/`.markdown` file drops onto the window. Uses the `dropDestination` modifier |
| Recent files | Uses `NSDocumentController.shared.recentDocumentURLs` (up to 10 items). Menu bar "File > Open Recent" |
| File watching | Watches for changes with `DispatchSourceFileSystemObject` and auto-reloads (0.5s debounce) |
| Multiple tabs | Uses native macOS window tabs (`NSWindowTabbingMode`) rather than SwiftUI `TabView` |

### 3.2 Rendering Features

| Feature | Implementation |
|------|---------|
| GFM compliance | marked.js `gfm: true` option |
| Syntax highlighting | highlight.js auto-detect, code blocks with a language badge |
| LaTeX math | KaTeX. Inline: `$...$`, block: `$$...$$` |
| Mermaid diagrams | Loads Mermaid.js from within the bundle and renders SVG |
| Tables | GFM tables (supported natively by marked.js) |
| Task lists | `- [x]` / `- [ ]` checkboxes (read-only) |
| Images | Local images: out-of-sandbox access via Security-Scoped Bookmark + `WKURLSchemeHandler` |
| Footnotes | marked.js `footnotes` extension |
| Emoji | `:emoji:` notation → Unicode conversion (marked.js plugin) |

### 3.3 Left Panel (Sidebar)

| Feature | Implementation |
|------|------|
| Table of contents (TOC) | Extracts heading nodes with swift-markdown and displays H1–H4 hierarchically in an `OutlineView` (a recursive `List`). Clicking scrolls to the anchor in WKWebView (runs `scrollIntoView` via `WKWebView.evaluateJavaScript`) |
| Sidebar width | User-resizable. The last width is saved via `AppStorage` |

### 3.4 Search

| Feature | Implementation |
|------|------|
| In-page search | Uses `WKWebView`'s `WKFindInteraction` (macOS 13+). Cmd+F shows the search bar |
| Highlighting | The browser-native Find API highlights matches |
| Match count | Gets the count from `WKFindResult` and shows e.g. "3/12" in the status bar |

### 3.5 Themes & Appearance

| Feature | Implementation |
|------|------|
| Auto light/dark following | `@Environment(\.colorScheme)` → change the theme via `postMessage` to WKWebView |
| Theme selection | GitHub Light / GitHub Dark / Solarized Light / Solarized Dark / Dracula / Nord (6 themes total). Each theme is placed as a CSS file in `Resources/Themes/` |
| Font-size adjustment | Change `font-size` via a CSS variable using a slider or Cmd+/Cmd- (10pt–24pt). Saved via `AppStorage` |
| Code font | Choose from Menlo / SF Mono / JetBrains Mono |

### 3.6 Export

| Format | Implementation |
|-----|------|
| PDF export | Uses `WKWebView`'s `createPDF(configuration:)` (macOS 13+). Choose a path via `NSSavePanel` |
| HTML export | Extract the rendered HTML (with inline CSS) as a string and save it |
| Printing | Run `NSPrintOperation` against the WKWebView |

### 3.7 Saving & Restoring Window State

- Window size and position: saved via `@SceneStorage` or `AppStorage`
- Last opened file: the URL is saved to `AppStorage` as Bookmark Data (Security-Scoped Bookmark)
- Automatically restores the previous file when the app restarts (a plain URL is sufficient when not using the sandbox)

### 3.8 Keyboard Shortcuts

| Shortcut | Function |
|-------------|------|
| Cmd+O | Open file |
| Cmd+W | Close window |
| Cmd+F | In-page search |
| Cmd+P | Print |
| Cmd+Shift+E | HTML export |
| Cmd+Shift+P | PDF export |
| Cmd+R | Reload file |
| Cmd++ / Cmd+- | Increase/decrease font size |
| Cmd+0 | Reset font size |
| Cmd+1 | Sidebar: TOC mode |
| Cmd+Shift+S | Toggle sidebar visibility |

---

## 4. Architecture Design

### 4.1 MVVM Component Structure

```
MDViewerApp (App)
├── AppDelegate (NSApplicationDelegate)
│   └── Menu bar setup, file-related event handling
└── DocumentWindow (Scene)
    └── ContentView (View)
        ├── SidebarView (View)
        │   └── TableOfContentsView (View)
        └── MarkdownRenderView (View)
            ├── WebRendererView (NSViewRepresentable → WKWebView)
            └── SearchBarView (View)

ViewModels:
├── DocumentViewModel (ObservableObject)
│   ├── Manages the current file URL and text
│   ├── File watching (DispatchSourceFileSystemObject)
│   └── recentFiles: [URL]
├── SidebarViewModel (ObservableObject)
│   └── tocItems: [TOCItem]
├── RenderViewModel (ObservableObject)
│   ├── htmlContent: String (HTML for rendering)
│   ├── theme: MarkdownTheme
│   └── fontSize: Double
└── ExportViewModel (ObservableObject)
    └── exportToPDF / exportToHTML methods

Models:
├── MarkdownDocument (FileDocument)
├── TOCItem (id, level, title, anchor)
└── MarkdownTheme (name, cssFileName)
```

### 4.2 WKWebView Bridge Design

Communication with WKWebView happens in the following two directions.

**Swift → JS (evaluateJavaScript)**:
- `MDViewer.setContent(markdown: String)` — update the Markdown text
- `MDViewer.setTheme(name: String)` — change the theme
- `MDViewer.setFontSize(size: Int)` — change the font size
- `MDViewer.scrollToAnchor(id: String)` — scroll when a TOC item is clicked

**JS → Swift (WKScriptMessageHandler)**:
- `headingsExtracted` — sends the list of headings after the page loads
- `scrollPositionChanged` — scroll-position change (to sync the active TOC item)
- `renderComplete` — rendering-complete notification

### 4.3 HTML Template Structure

Based on `Resources/Web/renderer.html`.

```
Resources/
├── Web/
│   ├── renderer.html          ← template (master HTML)
│   ├── mdviewer.js            ← Swift bridge + marked.js calls
│   ├── mdviewer-base.css      ← layout and shared styles
│   ├── vendor/
│   │   ├── marked.min.js
│   │   ├── highlight.min.js
│   │   ├── katex.min.js
│   │   ├── katex.min.css
│   │   ├── mermaid.min.js
│   │   └── highlight-default.min.css
│   └── themes/
│       ├── github-light.css
│       ├── github-dark.css
│       ├── solarized-light.css
│       ├── solarized-dark.css
│       ├── dracula.css
│       └── nord.css
```

### 4.4 Local Image Access (sandbox support)

When opening a file, acquire and save a Security-Scoped Bookmark. To display local images in WKWebView, implement a custom URL scheme `mdviewer-local://` and mediate file-system access through a `WKURLSchemeHandler`.

---

## 5. File Layout

```
MDViewer/
├── MDViewer.xcodeproj
│   └── project.pbxproj
├── MDViewer/
│   ├── App/
│   │   ├── MDViewerApp.swift           ← @main, Scene definition
│   │   └── AppDelegate.swift           ← NSApplicationDelegate
│   ├── Models/
│   │   ├── MarkdownDocument.swift      ← FileDocument protocol implementation
│   │   ├── TOCItem.swift
│   │   └── MarkdownTheme.swift
│   ├── ViewModels/
│   │   ├── DocumentViewModel.swift
│   │   ├── SidebarViewModel.swift
│   │   ├── RenderViewModel.swift
│   │   └── ExportViewModel.swift
│   ├── Views/
│   │   ├── ContentView.swift           ← NavigationSplitView root
│   │   ├── Sidebar/
│   │   │   ├── SidebarView.swift
│   │   │   └── TableOfContentsView.swift
│   │   ├── Renderer/
│   │   │   ├── MarkdownRenderView.swift
│   │   │   ├── WebRendererView.swift   ← NSViewRepresentable
│   │   │   └── LocalSchemeHandler.swift ← WKURLSchemeHandler
│   │   ├── Toolbar/
│   │   │   ├── MainToolbar.swift
│   │   │   └── SearchBarView.swift
│   │   └── Preferences/
│   │       ├── PreferencesView.swift
│   │       ├── AppearancePrefsView.swift
│   │       └── GeneralPrefsView.swift
│   ├── Utilities/
│   │   ├── FileWatcher.swift           ← DispatchSourceFileSystemObject
│   │   ├── BookmarkManager.swift       ← Security-Scoped Bookmark management
│   │   └── HTMLBuilder.swift          ← assembles renderer.html + CSS
│   ├── Resources/
│   │   └── Web/                       ← (see §4.3)
│   ├── Assets.xcassets
│   ├── MDViewer.entitlements
│   └── Info.plist
└── documents/
    └── plan.md                        ← this file
```

---

## 6. Code Signing & Distribution

### 6.1 Signing Method Comparison

| Method | Requirements | Scope | Recommended use |
|-----|------|---------|---------|
| **ad-hoc signing** | No Apple Developer Program needed | Only the machine that signed it | Development / personal local use |
| **Developer ID** | Apple Developer Program ($99/year) | All Macs (after Notarization) | Distribution to others / web distribution |
| **App Store** | Apple Developer Program | Mac App Store | Commercial distribution |

### 6.2 Steps to Set Up ad-hoc Signing (no Apple Developer Program needed)

Configure the following in Xcode's Signing & Capabilities tab:

1. **Team**: none (turn off "Automatically manage signing")
2. **Signing Certificate**: Sign to Run Locally (or specify `-`)
3. In the **entitlements file** (`MDViewer.entitlements`), list only the required permissions

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Disabling the sandbox removes file restrictions (recommended for ad-hoc) -->
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <!-- File-system read (only needed when the sandbox is enabled) -->
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
    <!-- Required to use WKWebView -->
    <key>com.apple.security.network.client</key>
    <false/>
</dict>
</plist>
```

To ad-hoc sign from the command line:
```bash
codesign --force --deep --sign - MDViewer.app
```

To launch while skipping the Gatekeeper check (first time only):
```bash
xattr -dr com.apple.quarantine MDViewer.app
```

### 6.3 Developer ID Signing & Notarization Steps (for distribution)

1. Join the Apple Developer Program and issue a Developer ID Application certificate
2. Enable Hardened Runtime in Xcode (`--options runtime`)
3. Set `com.apple.security.app-sandbox: true` in the entitlements
4. `codesign --force --deep --options runtime --entitlements MDViewer.entitlements --sign "Developer ID Application: ..." MDViewer.app`
5. `xcrun notarytool submit MDViewer.zip --apple-id ... --password ... --team-id ...`
6. `xcrun stapler staple MDViewer.app`

### 6.4 Sandbox Entitlements for the App Store (reference)

```xml
<key>com.apple.security.app-sandbox</key>
<true/>
<key>com.apple.security.files.user-selected.read-only</key>
<true/>
<key>com.apple.security.files.bookmarks.app-scope</key>
<true/>
```

---

## 7. Implementation Plan (by phase)

### Phase 1: Core Foundation (MVP) — estimate: 2–3 days

**Goal**: A minimal implementation that can open a file and render Markdown.

#### Task List

| # | Task | Files to change | Details |
|---|------|--------------|------|
| 1.1 | Create the Xcode project | `MDViewer.xcodeproj` | macOS App template. Bundle ID: `com.mdviewer.app`. Deployment Target: macOS 13.0. Add `swift-markdown` via SPM |
| 1.2 | Implement `MarkdownDocument` | `Models/MarkdownDocument.swift` | Implement the `FileDocument` protocol. `readableContentTypes: [.markdown, .plainText]` |
| 1.3 | Implement `DocumentViewModel` | `ViewModels/DocumentViewModel.swift` | `@Published var text: String`, `@Published var fileURL: URL?`, an NSOpenPanel wrapper method |
| 1.4 | Place HTML renderer resources | `Resources/Web/` | Place `renderer.html`, `mdviewer.js`, `mdviewer-base.css`, `marked.min.js`, `highlight.min.js`, `highlight-default.min.css` |
| 1.5 | Implement `WebRendererView` | `Views/Renderer/WebRendererView.swift` | Wrap `WKWebView` with `NSViewRepresentable`. Load bundle resources with `loadFileURL` using `WKWebViewConfiguration` |
| 1.6 | Implement `HTMLBuilder` | `Utilities/HTMLBuilder.swift` | A utility that loads `renderer.html`, dynamically inserts a link to the theme CSS, and returns it |
| 1.7 | Basic `ContentView` implementation | `Views/ContentView.swift` | Skeleton of `NavigationSplitView`. Sidebar empty, detail is `MarkdownRenderView` |
| 1.8 | `MDViewerApp` & `AppDelegate` | `App/MDViewerApp.swift`, `App/AppDelegate.swift` | Set up the `DocumentGroup` scene, wire up the menu bar "File > Open" |
| 1.9 | ad-hoc signing setup | `MDViewer.entitlements`, Xcode Signing | ad-hoc signing with the sandbox disabled. Verify local execution |

**Phase 1 completion criteria**: Opening a `.md` file displays the GFM rendering result in WKWebView.

---

### Phase 2: Left Panel, Themes, Search — estimate: 3–4 days

**Goal**: Implement the TOC sidebar, theme switching, and in-page search.

#### Task List

| # | Task | Files to change | Details |
|---|------|--------------|------|
| 2.1 | `TOCItem` model + TOC extraction | `Models/TOCItem.swift`, `ViewModels/SidebarViewModel.swift` | Parse the document with `swift-markdown`, traverse `Heading` nodes, and build a `TOCItem` array. level (1–4), title, anchor (slugified id) |
| 2.2 | Implement `TableOfContentsView` | `Views/Sidebar/TableOfContentsView.swift` | Hierarchical H1–H4 display with `List` + `DisclosureGroup`. Calls `RenderViewModel.scrollToAnchor(id:)` on selection |
| 2.3 | JS bridge: anchor scrolling | `Views/Renderer/WebRendererView.swift`, `Resources/Web/mdviewer.js` | Receive the `headingsExtracted` message via `WKScriptMessageHandler`. Run `document.getElementById(id).scrollIntoView()` via `evaluateJavaScript` |
| 2.4 | Implement `SidebarView` | `Views/Sidebar/SidebarView.swift` | Wraps `TableOfContentsView`, which displays the TOC |
| 2.5 | Create theme CSS | `Resources/Web/themes/*.css` | Create six files: github-light / github-dark / solarized-light / solarized-dark / dracula / nord |
| 2.6 | `RenderViewModel` theme support | `ViewModels/RenderViewModel.swift` | `@Published var theme: MarkdownTheme`. On change, send `MDViewer.setTheme(name:)` to JS |
| 2.7 | Implement `SearchBarView` | `Views/Toolbar/SearchBarView.swift` | Focus with Cmd+F. Bind `WKFindInteraction` to `WebRendererView`. Show the match count in the status bar |
| 2.8 | `AppStorage` persistence | Each file under `ViewModels/` | Save theme, fontSize, sidebarWidth, lastOpenedURL to AppStorage |
| 2.9 | Implement `FileWatcher` | `Utilities/FileWatcher.swift` | Watch with `DispatchSourceFileSystemObject`. After detecting a change, call `DocumentViewModel.reload()` with a 0.5s debounce |

**Phase 2 completion criteria**: Clicking a TOC item scrolls, theme switching works, and Cmd+F search works.

---

### Phase 3: Export, Advanced Features, Polish — estimate: 2–3 days

**Goal**: PDF/HTML export, math & Mermaid, local image support, and final quality polish.

#### Task List

| # | Task | Files to change | Details |
|---|------|--------------|------|
| 3.1 | Bundle KaTeX & Mermaid.js | `Resources/Web/vendor/` | Add katex.min.js, katex.min.css, mermaid.min.js. Update `renderer.html` and `mdviewer.js` to add initialization |
| 3.2 | Emoji plugin | `Resources/Web/mdviewer.js` | Implement a `:smile:` → emoji conversion table as a custom marked.js extension |
| 3.3 | Implement `LocalSchemeHandler` | `Views/Renderer/LocalSchemeHandler.swift` | Handle the `mdviewer-local://` scheme with `WKURLSchemeHandler`. Read files via `BookmarkManager` and return them as `Data` |
| 3.4 | Implement `BookmarkManager` | `Utilities/BookmarkManager.swift` | Save/restore Security-Scoped Bookmarks and manage startAccessingSecurityScopedResource |
| 3.5 | Implement `ExportViewModel` | `ViewModels/ExportViewModel.swift` | Generate a PDF with `WKWebView.createPDF(configuration:)`. Save after choosing a path via `NSSavePanel` |
| 3.6 | HTML export | `ViewModels/ExportViewModel.swift` | Get `document.documentElement.outerHTML` on the JS side, embed inline CSS, and save |
| 3.7 | Implement `PreferencesView` | Each file under `Views/Preferences/` | Settings screens for General (font & size) and Appearance (theme & code font). Uses the `Settings {}` scene |
| 3.8 | Recent-files menu | `App/AppDelegate.swift` | Reflect `NSDocumentController.shared.recentDocumentURLs` in the "File > Open Recent" submenu |
| 3.9 | Register keyboard shortcuts | `Views/ContentView.swift`, menu commands | Register all shortcuts from §3.8 with the `.keyboardShortcut` modifier |
| 3.10 | Create the app icon | `Assets.xcassets/AppIcon.appiconset` | Provide all sizes from 16x16 to 1024x1024 as PNG |
| 3.11 | Developer ID signing setup (optional) | `MDViewer.entitlements`, Xcode | Enable Hardened Runtime + Sandbox. Verify the Notarization workflow |
| 3.12 | README & usage docs | `documents/README.md` | Installation steps, an explanation of ad-hoc signing, and a feature list |

**Phase 3 completion criteria**: All features work, and an ad-hoc-signed `.app` bundle can run locally.

---

## 8. Notes & Constraints

### Security

- Content loaded into WKWebView is only local files within the bundle. Do not use `loadHTMLString` with external URLs
- When `LocalSchemeHandler` returns a file path, normalize directory traversal (`../`, etc.) with `URL.standardized.path`, then verify it is within an allowed directory
- Restrict access to paths outside user-selected files to within the scope of `BookmarkManager`

### Backward Compatibility

- The Deployment Target is macOS 13.0 (Ventura)
- `WKFindInteraction` is available on macOS 13.0+ (`@available(macOS 13.0, *)`)
- `WKWebView.createPDF` is available on macOS 11.0+

### Performance

- Debounce file watching (0.5s) to limit the reload frequency

### Known Constraints

- An ad-hoc-signed app **will not run on any machine other than the one that signed it**
- If App Sandbox is enabled, the `LocalSchemeHandler` and `BookmarkManager` implementations become more complex (see Phase 3.4)

---

## 9. Documentation Update Plan

Since this file is the first version, the additional documents that need to be updated are as follows:

| File | Content |
|---------|------|
| `documents/README.md` | Created in Phase 3.12. Installation and launch steps, feature list, shortcut list |
| `documents/architecture.md` | Add component and sequence diagrams as needed (after Phase 2 is complete) |

---

*This document is a design plan drawn up by the architect agent. Implementation is handled by the developer agent.*
