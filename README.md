# MDViewer

A lightweight, native macOS Markdown viewer built for developers.

![Screenshot](docs/screenshot.png)

## Overview

MDViewer was created out of a simple need: a fast, minimal way to read `.md` files when working from the terminal with tools like Claude Code or Codex. It renders Markdown beautifully without the overhead of a browser or a full editor.

MDViewer started as a viewer — but we wanted editing too, so it now includes a built-in split-view editor.

## Features

- **Instant rendering** — opens and renders Markdown files immediately
- **Live reload** — watches for file changes and re-renders as you save
- **Table of contents** — auto-generated sidebar from headings with smooth scroll
- **Syntax highlighting** — 40 languages via [Shiki v4](https://github.com/shikijs/shiki)
- **Math equations** — inline and block LaTeX via [KaTeX](https://github.com/KaTeX/KaTeX)
- **Mermaid diagrams** — flowcharts, sequence diagrams, Gantt charts, and more
- **Smart link handling** — local `.md` links open in-app; external links open in the browser
- **Export to PDF** — one-click PDF export preserving all styles
- **Signed & notarized** — Developer ID signing and Apple notarization

### Editor Mode

Toggle the built-in editor with **⌘E** or the pencil button in the toolbar.

- **Split view**: Editor on the left, live preview on the right
- **Save**: ⌘S saves changes to the current file
- Unsaved changes are indicated by the Save button becoming active
- Closing the window with unsaved changes prompts Save / Discard / Cancel

## Requirements

- macOS 14 Sonoma or later
- Apple Silicon (M1 or later)

## Installation

1. Download the latest `MDViewer-x.x.x.zip` from the [Releases page](https://github.com/devicemanager/mdviewer/releases/latest)
2. Unzip and drag `MDViewer.app` to your **Applications** folder
3. Double-click any `.md` file — or drop it onto the MDViewer icon in the Dock

## Building from source

Requires Xcode 15 or later.

```sh
git clone https://github.com/devicemanager/mdviewer.git
cd mdviewer
open MDViewer.xcodeproj
```

Build and run with ⌘R. No Swift Package dependencies — all vendor libraries are bundled in `MDViewer/Resources/Web/vendor/`.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI framework | SwiftUI + AppKit |
| Rendering engine | WKWebView |
| Markdown parser | [marked](https://github.com/markedjs/marked) v18 |
| Syntax highlighting | [Shiki](https://github.com/shikijs/shiki) v4 |
| Math | [KaTeX](https://github.com/KaTeX/KaTeX) v0.17 |
| Diagrams | [Mermaid](https://github.com/mermaid-js/mermaid) v11 |
| File watching | `DispatchSource` (kqueue) |

## Open source libraries

All bundled libraries are permissively licensed (MIT, except DOMPurify which is Apache-2.0 / MPL-2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full license texts.

| Library | Version | License |
|---------|---------|---------|
| marked | 18.0.6 | MIT |
| Shiki | 4.3.1 | MIT |
| KaTeX | 0.17.0 | MIT |
| Mermaid | 11.16.0 | MIT |
| DOMPurify | 3.4.12 | Apache-2.0 / MPL-2.0 |

## Credits

MDViewer was originally created by **Masanori Sakai** ([@Masakai](https://github.com/Masakai)). This repository is a fork maintained by [@devicemanager](https://github.com/devicemanager), which adds a **Quick Look preview extension** — full Markdown rendering (including KaTeX math and Mermaid diagrams) directly in Finder — along with related refinements.

Sincere thanks to Masanori Sakai for creating and open-sourcing MDViewer.

## License

MDViewer is released under the [MIT License](LICENSE).

© 2026 Masanori Sakai
