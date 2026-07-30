# MDViewer Cross-Platform Expansion — Design & Phased Plan

- **Status:** Draft — internal, **not for publication**
- **Date:** 2026-07-30
- **Scope:** Bring MDViewer-like functionality to Windows, Linux, Web, iOS/iPadOS, and Android
- **Current shipping product:** native macOS app (Mac App Store), unaffected by this plan

> **Identifiers in this document are symbolic placeholders.** The real Apple Team ID
> and production bundle identifier are intentionally omitted; they live only in the
> private build configuration, not in this doc.
>
> | Purpose | Placeholder used here |
> |---|---|
> | Reverse-DNS base | `com.example.mdviewer` |
> | Apple Team ID | `<TEAM_ID>` |
> | Android applicationId | `com.example.mdviewer` |

---

## 1. Context & current architecture

MDViewer is a native macOS Markdown viewer/editor whose killer feature is being a
**terminal companion**: it watches a local `.md` file (e.g. one Claude Code / Codex is
editing) and live-reloads the rendered view.

Key architectural finding that makes cross-platform cheap:

- **The rendering engine is already portable web tech.** Markdown → HTML rendering runs
  entirely in JavaScript inside a `WKWebView`, from `MDViewer/Resources/Web/`
  (`renderer.html` + `mdviewer.js` + `mdviewer-base.css` + `themes/` + `vendor/`:
  marked, Shiki, KaTeX, Mermaid, DOMPurify) under a strict CSP. `mdviewer.js` already
  implements heading extraction, `setTheme`, `setFontSize`, `scrollToAnchor`,
  `findText`, and link interception.
- **What is native is only the *shell/chrome*.** The TOC sidebar, search box, toolbar,
  and link routing are drawn in SwiftUI from data the JS posts out via
  `webkit.messageHandlers`. File I/O, file-watching, PDF export, and the Quick Look
  extension are native and macOS-specific.
- **The editor is native and trivial.** `MarkdownEditorView.swift` is a SwiftUI
  `TextEditor`. It is *not* part of the web layer.

**Implication:** a port is mostly rebuilding a thin shell around an engine that already
works — not rewriting the hard part.

## 2. Goals & non-goals

**Goals**
- Tiered functionality:
  - **Desktop (Windows, Linux):** full terminal-companion — live reload, export, edit loop.
  - **Web + Mobile (iOS/iPadOS, Android):** polished viewer — open & render from
    Files / cloud / share-sheet, read, optional light edit.

**Non-goals**
- Rewriting the rendering engine (it is reused as-is).
- Folding the existing native macOS app into the cross-platform stack — it keeps
  shipping natively. (Possible future unification is explicitly deferred.)
- Building a rich in-app code editor (see §4).

## 3. Chosen approach — Shared web core + lightweight wrappers

Extract `Resources/Web` into a standalone web app (the **shared core**), then wrap it
per platform with the lightest tool that fits:

- **Web:** the extracted core, hosted as a static site / installable PWA.
- **Desktop (Win/Linux):** **Tauri** (Rust + the OS's built-in webview). Small binaries
  (~3–10 MB); real filesystem access for open / watch / save / export.
- **Mobile (iOS/Android):** **Capacitor** wrapping the same web app as a viewer.
- **macOS:** existing native Swift app, unchanged.

**Rejected alternatives**
- **Electron desktop:** most battle-tested but ~100 MB+ binaries and high RAM — against
  MDViewer's "lightweight" identity.
- **Native per platform (WinUI + GTK + Kotlin):** best native feel, and iOS could reuse
  the macOS Swift code, but 4 shells to build and maintain forever — not justified for a
  small utility.

## 4. Edit philosophy (applies to all phases)

**Do not build a real editor.** Model: *view in MDViewer, edit in your tool of choice,
live-reload on save.*

- **Desktop:** "Open in external editor" — a **configurable command** (VS Code /
  Notepad++ / vi / Notepad / Notes / …). The existing file-watch re-renders on save.
  This is the entire edit story (~1 day).
- **Web / mobile** (no external-editor delegation possible in a sandbox): optional
  minimal `<textarea>` for quick tweaks — or ship view-only first and add it only if
  requested.
- Explicitly **no** CodeMirror / rich code editor unless later chosen. This is the
  "don't overdo it" guardrail, baked in.

## 5. Phased plan

Estimates are **ideal engineering-days for one developer**; wall-clock is longer with
part-time work and app-store review latency. Each phase ends in a **go/no-go gate**.

### Phase 0 — Shared web core / PWA · ~2–3 weeks (8–13 days)
**Goal:** standalone static web app wrapping the existing renderer. *Also ships the Web target.*

| Work item | Est. |
|---|---|
| Scaffold standalone app (Vite build + dev server) | 0.5–1d |
| Input layer: file-open + drag-drop + paste (File System Access API where available) | 1.5–2.5d |
| Web chrome: TOC sidebar, search box, theme/font toggles, toolbar (data already emitted by JS) | 2–4d |
| Local-image handling without the native `mdviewer-local:` scheme | 0.5–1d |
| Link routing: local `.md` navigation + external → new tab | 0.5–1d |
| PWA: manifest + service worker (offline vendor caching, installable) | 0.5–1d |
| Mobile-responsive layout + cross-browser QA (Safari/Chrome/Firefox/Edge) | 1.5–2.5d |
| Parity QA vs native macOS app | 1–2d |

**Deliverable:** hostable static site; installable PWA on any device.
**🚦 Gate 0:** Rendering parity reached? Offline PWA works? Acceptable on mobile
browsers? → publish Web target, proceed. *Decision: view-only enough for web, or add the textarea?*

### Phase 1 — Desktop (Windows + Linux) via Tauri · ~2–3 weeks (10–15 days)
**Goal:** the real terminal companion on Win/Linux.

| Work item | Est. |
|---|---|
| Tauri scaffold + embed web core | 1d |
| Native open/save dialogs | 0.5–1d |
| Filesystem watch → live reload | 1–2d |
| "Open in external editor" (configurable) + optional textarea fallback | 1–1.5d |
| PDF export (webview print-to-PDF) | 1d |
| Packaging: Windows `.msi/.exe` + Linux `.AppImage/.deb` | 2–3d |
| Code signing (Windows cert / Azure Trusted Signing; Linux minimal) | 1–3d + procurement |
| Cross-platform testing (needs Win + Linux env) | 2–3d |

**🚦 Gate 1:** Live-reload/terminal-companion feel matches macOS? Signing + distribution
solved for both OSes? → proceed. *Decision: external-editor sufficient, or ship textarea fallback?*

### Phase 2 — Mobile (iOS/iPadOS + Android) via Capacitor · ~3–4 weeks (13–19 days)
**Goal:** polished viewer; open from Files / cloud / share-sheet.

| Work item | Est. |
|---|---|
| Capacitor scaffold wrapping web core | 1d |
| iOS: document picker / Files / share-extension / iCloud | 2–4d |
| Android: intent filters / document picker / share target | 2–4d |
| Mobile UX polish (touch targets, small screens) | 2–3d |
| iOS App Store submission | 1–2d + review |
| Android Play Store first-time setup + submission | 2–4d + review |

**🚦 Gate 2:** Passes App Store + Play Store review? → GA / iterate.

## 6. Rollup

| Phase | Ideal effort | Ships |
|---|---|---|
| 0 — Web core / PWA | 2–3 wks | Web (all browsers, Chromebook, installable) |
| 1 — Desktop (Tauri) | 2–3 wks | Windows + Linux |
| 2 — Mobile (Capacitor) | 3–4 wks | iOS/iPadOS + Android |
| **Total** | **~7–10 wks** | **all 5 targets** |

## 7. Risks & prerequisites

- **New toolchains:** Node/Vite (Phase 0), Rust/Tauri (Phase 1), Android Studio/JDK
  (Phase 2). Xcode already in hand.
- **Windows code-signing** cert has cost + lead time (or use Azure Trusted Signing).
- **Test environments:** Windows + Linux (VMs are fine).
- **Play Store** is a new console/account (Apple App Store already done).
- **Biggest single risk:** Phase 0 web chrome (TOC/search/toolbar) — but the underlying
  *data* already exists in `mdviewer.js`, so the work is bounded.

## 8. Decision gates (summary)

1. **Gate 0** (after Phase 0): web core parity + offline PWA + mobile-browser OK →
   publish web, start desktop. Decide web edit scope.
2. **Edit decision** (mid Phase 1): external-editor + live-reload sufficient? If yes,
   ship no in-app editor.
3. **Gate 1** (after Phase 1): desktop terminal-companion parity + signing/distribution
   solved → start mobile.
4. **Gate 2** (after Phase 2): passes both app-store reviews → GA.

## 9. Next step

Produce a detailed implementation plan for **Phase 0 only** (shared web core / PWA)
before any further phase work.
