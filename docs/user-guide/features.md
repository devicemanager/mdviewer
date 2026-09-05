# MDViewer Features

MDViewer is a feature-rich Markdown viewer that combines beautiful rendering with developer-friendly tools.

## Core Viewing Features

### Instant Rendering
- Opens and renders Markdown files immediately
- No delays — see your content instantly
- Support for `.md`, `.markdown`, and `.txt` files

### Live Reload
- Automatically watches the file for changes
- Re-renders instantly when you save
- 0.5-second debounce to handle rapid saves

### Table of Contents (Sidebar)
- Auto-generated from document headings (H1–H4)
- Hierarchical outline view
- Click any item to smoothly scroll to that section
- Resizable sidebar — drag the divider to adjust width

### Full-Text Search
- Press **⌘F** to open the search bar
- Find any text in the document
- Shows match count (e.g., "3 of 12")
- Navigate between matches with arrow buttons

## Markdown Rendering Features

### GitHub Flavored Markdown (GFM)
- Full support for GFM syntax
- Tables, strikethrough, task lists, and more
- Footnotes and other extensions

### Syntax Highlighting
- 40+ programming languages supported
- Uses [Shiki](https://github.com/shikijs/shiki) v4
- Each code block displays a language badge
- Auto-detection when no language is specified

### LaTeX Math Equations
- **Inline math**: Wrap in `$...$` or `` `$...$` ``
- **Block math**: Wrap in `$$...$$` on separate lines
- Powered by [KaTeX](https://github.com/KaTeX/KaTeX)
- Equations render beautifully with proper formatting

### Mermaid Diagrams
- Create flowcharts, sequence diagrams, Gantt charts, and more
- Wrap code blocks in ` ```mermaid` syntax
- Powered by [Mermaid.js](https://mermaid.js.org)
- Renders as interactive SVG

### Tables
- Native GFM table support
- Automatic column alignment
- Header rows with proper styling

### Task Lists
- Display `- [x]` (completed) and `- [ ]` (incomplete) tasks
- Visual checkboxes in the rendered output
- Read-only in viewer mode (editable in editor mode)

### Images
- Local images: reference files in the same directory
- External images: loaded from the web
- Click to zoom in on image details
- Copy image URL to clipboard

### Emoji
- Use `:emoji_name:` syntax for emoji
- Automatic conversion to Unicode characters

## Editor Mode

Toggle the built-in editor with **⌘E** or click the pencil button in the toolbar.

### Split View
- **Left panel**: Full-featured code editor
- **Right panel**: Live preview of your changes
- Drag the divider to adjust the split

### Edit and Save
- Type directly in the editor
- See changes in real-time on the right
- Press **⌘S** to save
- Unsaved changes are indicated by an active Save button

### Syntax Highlighting in Editor
- Code highlighting while you edit
- Proper indentation and formatting

## Appearance & Themes

### Multiple Themes
Choose from 3 built-in themes:
- GitHub Light (default)
- GitHub Dark
- Dracula

### Font Size Adjustment
- Use **⌘+** and **⌘-** to increase/decrease font size
- Range: 10pt to 24pt
- Press **⌘0** to reset to default (14pt)
- Your preference is remembered

### Code Font Selection
Choose from:
- Menlo (default)
- SF Mono
- JetBrains Mono

### Dark Mode Support
- Automatically follows your system appearance setting
- Light theme in light mode, dark theme in dark mode
- Or manually select a theme in preferences

## Export Features

### PDF Export
- Export the rendered Markdown to PDF
- Preserves all styles, syntax highlighting, and formatting
- All fonts and colors included
- Shortcut: **⌘Shift+P**

### HTML Export
- Export as self-contained HTML
- Includes all CSS inline
- Perfect for sharing or further editing
- Shortcut: **⌘Shift+E**

### Print
- Print directly to paper or PDF
- Uses the rendered view, not the raw Markdown
- Shortcut: **⌘P**

## File Management

### Drag & Drop
- Drag any `.md` file onto the MDViewer icon in the Dock
- Drag a file onto an open MDViewer window

### Recent Files
- View recently opened files in **File > Open Recent**
- Quick access to your favorite documents

### Multiple Documents
- Open multiple files using native macOS window tabs
- Press **⌘T** to open a new tab
- Press **⌘W** to close the current tab

## System Integration

### Quick Look Preview (macOS Finder)
- Press **Space** on any `.md` file in Finder
- See a full Markdown preview with syntax highlighting, math, and diagrams
- No need to open the full app

### Drag & Drop Integration
- Drop `.md` files into MDViewer to open them
- Drop `.md` files onto the icon in the Dock

---

## Feature Overview Table

| Feature | Support |
|---------|---------|
| GFM compliance | ✓ Full |
| Syntax highlighting | ✓ 40+ languages |
| LaTeX math | ✓ KaTeX |
| Mermaid diagrams | ✓ All types |
| Tables | ✓ GFM tables |
| Task lists | ✓ Read-only |
| Images | ✓ Local & web |
| Emoji | ✓ `:name:` syntax |
| Search | ✓ Full-text |
| Export to PDF | ✓ |
| Export to HTML | ✓ |
| Live reload | ✓ File watching |
| Dark mode | ✓ Automatic + manual |
| Split editor | ✓ Live preview |

For keyboard shortcuts, see [Keyboard Shortcuts](keyboard-shortcuts.md).
