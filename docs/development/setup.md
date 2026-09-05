# MDViewer Development Setup Guide

This guide walks through setting up your development environment to contribute to MDViewer.

## Prerequisites

- **macOS 13+** (Ventura or later)
- **Xcode 15+** (latest from App Store)
- **Apple Silicon** (M1 or later)
- Git

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/devicemanager/mdviewer.git
cd mdviewer
```

### 2. Open in Xcode

```bash
open MDViewer.xcodeproj
```

### 3. Build and Run

Press **⌘R** in Xcode or use:

```bash
xcodebuild -scheme MDViewer -configuration Debug build
```

The app should launch immediately.

## Project Structure

```
MDViewer/
├── MDViewer.xcodeproj/        ← Xcode project file
├── MDViewer/
│   ├── App/                   ← Application entry point
│   ├── Models/                ← Data models
│   ├── ViewModels/            ← View logic
│   ├── Views/                 ← SwiftUI views
│   ├── Utilities/             ← Helper functions
│   └── Resources/
│       └── Web/               ← JS, CSS, HTML for rendering
├── MDViewerTests/             ← Unit tests
├── docs/                      ← Documentation (this folder)
├── web/                       ← Web testing (cross-platform)
└── build/                     ← Build artifacts
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| UI Framework | SwiftUI + AppKit |
| Rendering Engine | WKWebView |
| Markdown Parser | [marked](https://github.com/markedjs/marked) v18 |
| Syntax Highlighting | [Shiki](https://github.com/shikijs/shiki) v4 |
| Math Rendering | [KaTeX](https://github.com/KaTeX/KaTeX) v0.17 |
| Diagrams | [Mermaid.js](https://github.com/mermaid-js/mermaid) v11 |

## Key Dependencies

All JavaScript libraries are bundled locally in `MDViewer/Resources/Web/vendor/`:

- **marked.js** — Markdown → HTML conversion
- **Shiki** — Syntax highlighting
- **KaTeX** — LaTeX math rendering
- **Mermaid.js** — Flowcharts and diagrams

No external package managers (SPM, CocoaPods) are required for these.

## Building for Distribution

### Developer ID (Notarized Distribution)

For direct distribution outside the App Store:

```bash
export APPLE_ID="your-email@example.com"
export TEAM_ID="ABC123DEF"
./build-notarize.sh
```

This produces `build/MDViewer.zip` (ready for GitHub Releases).

**Prerequisites:**
- Apple Developer account
- Developer ID certificate installed locally
- Notarization credentials stored in Keychain:
  ```bash
  xcrun notarytool store-credentials "notarytool" \
    --apple-id "$APPLE_ID" --team-id "$TEAM_ID"
  ```

### Mac App Store

```bash
./build-appstore.sh
```

Requires:
- Bundle ID registration in Apple Developer account
- App record in App Store Connect
- Xcode login configured

## Testing

### Unit Tests

```bash
xcodebuild -scheme MDViewer -configuration Debug test
```

Or press **⌘U** in Xcode.

### Manual Testing

1. Open a `.md` file
2. Verify rendering with various features (math, diagrams, code highlighting)
3. Test editor mode with live preview
4. Try exporting to PDF/HTML
5. Test all keyboard shortcuts

## Common Development Tasks

### Add a New Theme

1. Create `MDViewer/Resources/Web/themes/my-theme.css`
2. Update `MarkdownTheme.swift` to include the new theme
3. Reference the CSS file in the HTML template

### Modify the Markdown Renderer

The renderer logic is in:
- `MDViewer/Resources/Web/mdviewer.js` — JavaScript bridge
- `MDViewer/Resources/Web/mdviewer-base.css` — Layout CSS

Changes to JavaScript require refreshing the WebView in Xcode.

### Add Keyboard Shortcuts

Edit `Views/ContentView.swift` and add `.keyboardShortcut()` modifiers.

## Debugging

### Enable WebView Debugging

In Xcode: Product → Scheme → Edit Scheme → Run (Debug) → Arguments
- Add environment variable: `WEB_INSPECTOR_ENABLED = 1`

### View Console Output

- **Swift logs**: Xcode Console (⌘Shift+C)
- **JavaScript logs**: Safari Web Inspector (when debugging is enabled)

### Common Issues

**Build fails with Swift Markdown error**
- Run `xcodebuild -resolvePackageDependencies`

**WKWebView not rendering**
- Check that bundle resources are included in `Copy Bundle Resources` build phase

**Keyboard shortcuts not working**
- Verify `.keyboardShortcut()` modifiers are correctly attached to Views

## Code Style

- Follow Apple's Swift API Design Guidelines
- Use meaningful variable names
- Add comments for complex logic
- Prefer SwiftUI over AppKit when possible

## Contributing

See [Contributing Guide](contributing.md) for:
- How to submit pull requests
- Code review process
- Feature request guidelines
- Bug report templates

## Resources

- [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui/)
- [WKWebView Guide](https://developer.apple.com/documentation/webkit/wkwebview)
- [marked.js Docs](https://marked.js.org/)
- [Shiki Docs](https://shiki.style/)
- [KaTeX Docs](https://katex.org/)
- [Mermaid Docs](https://mermaid.js.org/)

## Support

For questions or issues:
- Check [existing GitHub issues](https://github.com/devicemanager/mdviewer/issues)
- Read the [Design Plan](design-plan.md)
- Ask in GitHub Discussions

---

**Happy coding!** 🚀
