# Getting Started with MDViewer

MDViewer is a lightweight, native macOS Markdown viewer built for developers. This guide will get you up and running in minutes.

## Requirements

- **macOS 14** (Sonoma) or later
- **Apple Silicon** (M1 or later)

## Installation

### From Releases

1. Visit the [Releases page](https://github.com/devicemanager/mdviewer/releases/latest)
2. Download the latest `MDViewer-x.x.x.zip`
3. Unzip the file
4. Drag `MDViewer.app` to your **Applications** folder

### Opening Files

You can open Markdown files in several ways:

- **Double-click** any `.md` file to open it in MDViewer
- **Drag and drop** a `.md` file onto the MDViewer icon in the Dock
- **Open from Terminal**: `open -a MDViewer filename.md`
- **Use the File menu**: ⌘O to browse and select a file

## First Steps

1. Open a Markdown file
2. MDViewer renders it immediately in the main panel
3. Click any heading in the **left sidebar** (table of contents) to jump to that section
4. Use **⌘F** to search within the document
5. Toggle the editor with **⌘E** to edit the file with a live preview

## Key Features

- **Instant rendering** — opens files immediately
- **Live reload** — automatically re-renders when the file changes
- **Table of contents** — auto-generated sidebar with smooth scrolling
- **Syntax highlighting** — 40+ programming languages
- **Math equations** — LaTeX via KaTeX
- **Mermaid diagrams** — flowcharts, sequence diagrams, and more
- **Export to PDF** — one-click export with styled output
- **Full-text search** — find text anywhere in the document

See [Features](features.md) and [Keyboard Shortcuts](keyboard-shortcuts.md) for more details.

## Building from Source

If you prefer to build from source:

```bash
git clone https://github.com/devicemanager/mdviewer.git
cd mdviewer
open MDViewer.xcodeproj
```

Requires **Xcode 15 or later**. No external package managers needed — all dependencies are bundled.

Press **⌘R** to build and run.

## Next Steps

- Explore all [Features](features.md)
- Learn [Keyboard Shortcuts](keyboard-shortcuts.md)
- Read the [full README](../../README.md)

## Troubleshooting

**"MDViewer" is damaged and can't be opened**
- This may appear on first launch if the app isn't properly notarized
- Solution: `xattr -dr com.apple.quarantine /Applications/MDViewer.app`

**File not reloading on save**
- MDViewer watches for file changes automatically
- If reloading stops, try closing and reopening the file

**Can't see math equations or diagrams**
- These require JavaScript to render
- Try refreshing with ⌘R

For more help, visit the [GitHub Issues page](https://github.com/devicemanager/mdviewer/issues).
