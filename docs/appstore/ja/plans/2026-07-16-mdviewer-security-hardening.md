# MDViewer Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute **one phase at a time**, building + manually verifying the render pipeline before moving on.

**Goal:** Harden MDViewer against the audit findings (unsanitized-HTML XSS, remote-content exfiltration, no sandbox), update all vendored JS libraries to their latest verified versions, and add a user-controlled remote-content policy — all with **zero runtime phone-home**.

**Architecture:** Four independently-shippable phases, in risk order: (1) injection hardening, (2) library updates, (3) remote-content policy, (4) app sandbox. The renderer stays local-only; remote subresources are blocked by default and only loaded on explicit user consent (modal) or an "Always" setting. The Quick Look extension always blocks remote content (no prompt UI).

**Tech Stack:** Swift (AppKit/SwiftUI + WebKit), vendored JS (marked, KaTeX, mermaid, Shiki), DOMPurify, esbuild (dev-only, for the Shiki bundle), `@AppStorage`/UserDefaults.

**Verification note:** There is no XCUITest harness for the WebView. Each phase's "verify" step means: `xcodebuild ... build`, install to `/Applications`, open `MDViewer/Resources/TestDocs` (or `test-all-elements.md`) plus a purpose-built malicious/remote fixture, and confirm behavior by eye + the debug console.

---

## File Structure

- `MDViewer/Resources/Web/vendor/dompurify.min.js` — **new**, vendored sanitizer
- `MDViewer/Resources/Web/vendor/*.min.js` — **updated** marked/katex/mermaid + rebuilt `shiki.bundle.js`
- `MDViewer/Resources/Web/renderer.html` — add CSP `<meta>` + DOMPurify `<script>`
- `MDViewer/Resources/Web/mdviewer.js` — sanitize before `innerHTML`; marked-18 renderer API; remote-resource gating + `setRemoteContentPolicy`/`loadRemoteResources` API
- `MDViewer/Views/Renderer/WebRendererView.swift` — tighten `linkClicked`; remote-content modal + policy injection
- `MDViewer/MDViewerQL/PreviewViewController.swift` — inject "never/always" remote policy (never prompt)
- `MDViewer/Models/RemoteContentPolicy.swift` — **new** enum + shared UserDefaults key
- `MDViewer/Views/Preferences/PrivacyPrefsView.swift` — **new** settings pane (or a section in General)
- `MDViewer/Views/Preferences/PreferencesView.swift` — register the new pane
- `MDViewer/MDViewer.entitlements` — enable `app-sandbox`, add `network.client`
- `tools/shiki-bundle/` — **new** dev-only esbuild project (package.json, entry.mjs, build.sh) that emits `shiki.bundle.js`
- `SUPPLY_CHAIN.md` — **new**, records each vendored lib's version + SHA-256 (dev-time provenance; not shipped in app logic)

---

## Phase 1 — Injection hardening (DOMPurify + CSP + link bridge)

### Task 1.1: Vendor DOMPurify + record provenance

**Files:** Create `MDViewer/Resources/Web/vendor/dompurify.min.js`, `SUPPLY_CHAIN.md`

- [ ] **Step 1:** Download the official release and record its hash.
```bash
V=3.2.4   # verify latest at https://registry.npmjs.org/dompurify/latest first
cd MDViewer/Resources/Web/vendor
/usr/bin/curl -sL "https://cdn.jsdelivr.net/npm/dompurify@$V/dist/purify.min.js" -o dompurify.min.js
shasum -a 256 dompurify.min.js
```
- [ ] **Step 2:** Add the version + SHA-256 to `SUPPLY_CHAIN.md`.
- [ ] **Step 3:** Add `<script src="vendor/dompurify.min.js"></script>` to `renderer.html` **before** `mdviewer.js` (after mermaid).
- [ ] **Step 4:** Commit.

### Task 1.2: Sanitize marked output before innerHTML

**Files:** Modify `MDViewer/Resources/Web/mdviewer.js` (`setContent`, ~line 135-156)

- [ ] **Step 1:** After `let html = marked.parse(...)` and the KaTeX restore, sanitize before assignment. KaTeX emits MathML/SVG and mermaid source lives in `<div class="mermaid">` (raw text, rendered later), so allow SVG/MathML and the `class`/`id`/`style` needed:
```js
const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['id', 'class', 'style', 'aria-hidden', 'data-*'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcset', 'formaction']
    // NOTE: DOMPurify already strips on* event handlers and javascript: URLs by default
});
contentEl.innerHTML = clean;
```
- [ ] **Step 2:** Verify the `<div class="mermaid">…</div>` survives sanitization (mermaid runs after). If DOMPurify strips the raw diagram text, switch mermaid to render from a `data-` attribute set post-sanitize, or add `mermaid` to `ADD_TAGS`/keep as text node.
- [ ] **Step 3 (verify):** Build + open a fixture `~/mdv-xss.md` containing:
  `![x](x "t")` plus a raw `<img src=x onerror="window.webkit.messageHandlers.linkClicked.postMessage('file:///Applications/Calculator.app')">` and `<a href="javascript:alert(1)">j</a>`.
  Expected: no Calculator launch, `onerror`/`javascript:` stripped, normal Markdown + math + mermaid + code still render.
- [ ] **Step 4:** Commit.

### Task 1.3: Tighten the linkClicked native bridge

**Files:** Modify `MDViewer/Views/Renderer/WebRendererView.swift` (`userContentController`, ~line 85-96)

- [ ] **Step 1:** Restrict the programmatic-open path to safe schemes only (match the nav-delegate policy). Replace the `else { NSWorkspace.shared.open(url) }` with:
```swift
case "linkClicked":
    guard let urlString = message.body as? String,
          let url = URL(string: urlString) else { break }
    Task { @MainActor in
        if url.scheme == "file",
           ["md", "markdown"].contains(url.pathExtension.lowercased()) {
            NotificationCenter.default.post(name: .openLocalDocument, object: url)
        } else if let s = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(s) {
            NSWorkspace.shared.open(url)
        }
        // else: ignore (do NOT open file:// non-md, custom schemes, etc.)
    }
```
- [ ] **Step 2 (verify):** In the fixture, a `[x](file:///Applications/Calculator.app)` link click does nothing; `[g](https://example.com)` opens the browser; `[d](./other.md)` opens in-app.
- [ ] **Step 3:** Commit.

### Task 1.4: Content-Security-Policy in renderer.html

**Files:** Modify `MDViewer/Resources/Web/renderer.html` (`<head>`)

- [ ] **Step 1:** Add a CSP meta. Shiki uses a WASM regex engine, so `'wasm-unsafe-eval'` is required; mermaid may need `'unsafe-eval'` (confirm in step 2). Start strict and loosen only as needed:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  font-src 'self' mdviewer-local:;
  img-src mdviewer-local: data:;
  connect-src 'self' mdviewer-local:;
  base-uri 'none'; form-action 'none'; object-src 'none'">
```
- [ ] **Step 2 (verify):** Build + open `test-all-elements.md`. Watch the Web Inspector console for CSP violations. If mermaid/shiki break, add the minimal directive they report (likely `'unsafe-eval'` for mermaid, or `wasm-unsafe-eval` already covers Shiki). Re-test until math + mermaid + highlighted code all render with **no** remote loads permitted.
- [ ] **Step 3:** Confirm the remote-image line is intentionally omitted from `img-src` (remote images are already denied here — Phase 3 adds the opt-in). Note `img-src` currently blocks `https:` — this is the desired default-deny.
- [ ] **Step 4:** Commit. **CHECKPOINT: review with user before Phase 2.**

---

## Phase 2 — Update vendored libraries to latest (verified)

### Task 2.1: Rebuild Shiki 4 as a browser bundle

**Files:** Create `tools/shiki-bundle/{package.json,entry.mjs,build.sh}`; overwrite `vendor/shiki.bundle.js`

- [ ] **Step 1:** Extract the exact language + theme set the current bundle ships (from the audit: themes github-light/github-dark; 27 langs). List them explicitly in `entry.mjs`.
- [ ] **Step 2:** Create `entry.mjs` that reproduces the `window.__shikiReady` contract the renderer depends on (`.then(h => …)`, `h.getLoadedLanguages()`, `h.codeToHtml(code, {lang, themes:{light,dark}})`):
```js
import { createHighlighter } from 'shiki';
window.__shikiReady = createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['javascript','typescript','python', /* …the full 27… */]
});
```
- [ ] **Step 3:** `build.sh`: `npm i` then `npx esbuild entry.mjs --bundle --format=iife --minify --outfile=../../MDViewer/Resources/Web/vendor/shiki.bundle.js`. Run it; record the version (`shiki` from package-lock) + SHA-256 in `SUPPLY_CHAIN.md`.
- [ ] **Step 4 (verify):** Build the app; confirm code blocks highlight in light/dark. If Shiki 4 changed `codeToHtml` options, update `mdviewer.js:highlightCode` accordingly (verify against Shiki 4 docs during this step).
- [ ] **Step 5:** Commit `tools/shiki-bundle/` + the new bundle.

### Task 2.2: Update marked to 18 + adapt the renderer API

**Files:** Overwrite `vendor/marked.min.js`; modify `mdviewer.js` (`setContent` renderer)

- [ ] **Step 1:** Download marked@latest (`marked.min.js`), record hash. Confirm exact latest via npm registry.
- [ ] **Step 2:** marked ≥5 passes a **token object** to renderer methods. Rewrite the `heading`/`code` overrides (verify the exact token shape against the downloaded `marked.min.js`/its d.ts):
```js
renderer.heading = function (token) {                 // {tokens, depth, text, raw}
    const inner = this.parser.parseInline(token.tokens);
    const anchor = slugify(token.text);
    headingsRef.push({ level: token.depth, title: token.text, anchor });
    return `<h${token.depth} id="${anchor}">${inner}</h${token.depth}>\n`;
};
renderer.code = function (token) {                    // {text, lang, escaped}
    if (token.lang === 'mermaid') return `<div class="mermaid">${escapeHtml(token.text)}</div>`;
    return highlightCode(token.text, token.lang);
};
```
- [ ] **Step 3 (verify):** Build; confirm headings/anchors/TOC, fenced code, and mermaid still render. Fix any other marked API drift (e.g., `marked.parse` option shape).
- [ ] **Step 4:** Commit.

### Task 2.3: Update KaTeX 0.17 + mermaid 11

**Files:** Overwrite `vendor/katex.min.js`, `vendor/katex.min.css`, `vendor/fonts/*` (if changed), `vendor/mermaid.min.js`

- [ ] **Step 1:** Download KaTeX 0.17 dist (js+css+fonts) and mermaid 11 `mermaid.min.js`; record hashes. Re-verify each downloaded file's hash equals the CDN's.
- [ ] **Step 2 (verify):** Build; confirm inline+block math and each mermaid diagram type render. mermaid 11 keeps `initialize`/`run`/`securityLevel`; if any config key moved, update `mdviewer.js`.
- [ ] **Step 3:** Update the version numbers in `docs/index.html` (libraries table) + `docs/ja/index.html`.
- [ ] **Step 4:** Commit. **CHECKPOINT: full render regression pass with user before Phase 3.**

---

## Phase 3 — Remote-content policy (block / ask-modal / never)

### Task 3.1: Policy model + settings UI

**Files:** Create `MDViewer/Models/RemoteContentPolicy.swift`, `MDViewer/Views/Preferences/PrivacyPrefsView.swift`; modify `PreferencesView.swift`

- [ ] **Step 1:** Enum + shared key:
```swift
enum RemoteContentPolicy: String, CaseIterable, Identifiable {
    case ask, always, never
    var id: String { rawValue }
    var label: String { ["ask":"Ask each time","always":"Always load","never":"Never (block)"][rawValue]! }
    static let defaultsKey = "remoteContentPolicy"
}
```
- [ ] **Step 2:** `PrivacyPrefsView` with a `Picker` bound to `@AppStorage(RemoteContentPolicy.defaultsKey)` defaulting to `ask`; add the tab to `PreferencesView`.
- [ ] **Step 3:** Commit.

### Task 3.2: Gate remote subresources in the renderer (src-swap, no extra networking)

**Files:** Modify `mdviewer.js`

- [ ] **Step 1:** In `rewriteLocalResources`, for **absolute http(s)** `img[src]` (and `[srcset]`), stash the URL in `data-mdv-remote` and remove `src` unless the active policy is `always`. Track whether any were blocked.
- [ ] **Step 2:** Add API: `MDViewer.setRemoteContentPolicy(p)` (stored in a module var, applied on render) and `MDViewer.loadRemoteResources()` (restore every `data-mdv-remote` → `src`). After render, if blocked-count > 0 and policy==='ask', `postMessage` `remoteContentBlocked` with the count.
- [ ] **Step 3 (verify):** Fixture with `![r](https://httpbingo.org/image/png)` — with policy `never`/`ask` the image does not load (no network); `loadRemoteResources()` makes it load.
- [ ] **Step 4:** Commit.

### Task 3.3: App modal + policy wiring

**Files:** Modify `WebRendererView.swift`, `RenderViewModel.swift`

- [ ] **Step 1:** Register a `remoteContentBlocked` message handler. Inject `MDViewer.setRemoteContentPolicy('<policy>')` before `setContent` on each render.
- [ ] **Step 2:** On `remoteContentBlocked` with policy `ask`: present an `NSAlert` ("This document contains remote content (images from the internet). Load it?", buttons Load / Don't Load / Always Load). Load → `evaluateJavaScript("MDViewer.loadRemoteResources()")`; Always → also set the policy to `always`.
- [ ] **Step 3 (verify):** Open the remote fixture → modal appears once; Load shows the image; Don't Load keeps it blocked; Never (in prefs) suppresses the modal entirely.
- [ ] **Step 4:** Commit.

### Task 3.4: Quick Look always-block

**Files:** Modify `PreviewViewController.swift`

- [ ] **Step 1:** Before `setContent`, inject `setRemoteContentPolicy('always')` **only if** the stored policy is `always`, else `'never'`. Never register a modal (QL has no prompt UI).
- [ ] **Step 2 (verify):** Quick Look the remote fixture → image blocked unless the user's setting is `always`.
- [ ] **Step 3:** Commit. **CHECKPOINT before Phase 4.**

---

## Phase 4 — Enable the app sandbox

### Task 4.1: Flip entitlements

**Files:** Modify `MDViewer/MDViewer.entitlements`

- [ ] **Step 1:** Set `com.apple.security.app-sandbox` = `true`; keep `files.user-selected.read-write`; add `com.apple.security.network.client` (needed so WebKit can fetch remote content when the user allows it). 
- [ ] **Step 2:** Commit.

### Task 4.2: Fix + verify sandbox-affected flows

**Files:** Likely `BookmarkManager.swift`, `FileWatcher.swift`, `DocumentViewModel.swift`, `ExportViewModel.swift`

- [ ] **Step 1 (verify each):** Build + install, then test under sandbox: open via File→Open (security scope granted), drag-drop open, auto-reload on external edit (FileWatcher), Save (⌘S), Export PDF + HTML, recent/restore-last-file (security-scoped bookmark resolve). 
- [ ] **Step 2:** For each broken flow, wrap file access in `url.startAccessingSecurityScopedResource()` / `stopAccessing…` and persist/resolve bookmarks via `BookmarkManager`. (FileWatcher must hold the scoped access for the file's lifetime.)
- [ ] **Step 3 (verify):** Re-run the full flow list; confirm no sandbox denials in Console.app (`sandboxd`). Confirm remote-content loading still works when allowed.
- [ ] **Step 4:** Commit. **CHECKPOINT: final review; then re-run `build-notarize.sh` + `package-dmg.sh` for a hardened release.**

---

## Self-review notes
- Every phase ends buildable + manually verifiable and is independently shippable.
- No runtime version/update checks are introduced anywhere (supply-chain verification is dev-time only, recorded in `SUPPLY_CHAIN.md`).
- Known research spikes flagged inline: exact **marked-18** token shape (Task 2.2), **Shiki-4** `codeToHtml` options (Task 2.1), CSP directives **mermaid/Shiki** actually require (Task 1.4).
