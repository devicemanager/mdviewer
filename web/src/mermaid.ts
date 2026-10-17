// Ported from mdviewer.js's Mermaid integration: the initial
// `mermaid.initialize()` call (must run before any `.mermaid` div exists
// in the DOM, per mdviewer.js's own comment), the render pass after
// content insertion, and setTheme's re-initialize-with-a-new-theme step.
// The `renderer.code` routing that wraps ```mermaid fences in
// `<div class="mermaid">` is already ported, in markedRenderer.ts's
// renderCode.
//
// Mermaid is injected rather than read from `window.mermaid` directly —
// same reason KaTeX/Shiki are injected elsewhere in this port (see
// math.ts's KatexLike, highlightCode.ts's ShikiHighlighterLike): keeps
// this testable, leaves the real `window.mermaid` wiring to the
// not-yet-built window.MDViewer assembly layer. Unlike Shiki/KaTeX,
// tested here against a mock, not the real `mermaid` package: real
// diagram rendering is a full SVG/DOM pipeline (~84MB installed) that
// jsdom can't meaningfully exercise — that side is verified by actually
// running the app instead (see plan.md's cross-platform baseline
// screenshots, which include a rendered flowchart). This module only
// owns the option-shape/call-sequence contract, which a mock verifies
// fine.
//
// **Preserved oddity, not a bug fixed silently** (checked against the
// real `mermaid@11.17.2` type declarations, not assumed): `run()` returns
// `Promise<void>` — mdviewer.js's `try { mermaid.run({...}) } catch (e) {
// console.warn(...) }` has no `await` and no `.catch()`, so it only
// catches a synchronous throw (bad arguments, say); an actual per-diagram
// parse/render failure rejects the returned promise *after* the try block
// has already exited, surfacing as an unhandled rejection instead of the
// intended friendly warning. Ported exactly as-is, per the working
// agreement ("do not silently fix it") — flagging it here rather than
// changing behavior mid-port.

export interface MermaidRunOptions {
    querySelector: string;
}

export interface MermaidInitOptions {
    startOnLoad: boolean;
    theme: string;
    securityLevel: string;
    themeVariables?: Record<string, string>;
}

/**
 * Overrides for Mermaid's own "dark" theme (2026-10-17). Its defaults put
 * flowchart labels at #ccc on #585858 (4.4:1) and the first git-graph
 * branch label at #2c2c2c on #797d7d (3.4:1) — under WCAG 2.2 AA's 4.5:1,
 * found by the visual contrast audit. Only the failing pairs change; the
 * rest of Mermaid's dark palette is left as designed. The light "default"
 * theme passes as-is.
 */
export const DARK_THEME_VARIABLES: Record<string, string> = {
    primaryTextColor: "#e6e6e6", // flowchart node and edge labels: 5.7:1 on #585858
    textColor: "#e6e6e6",
    gitBranchLabel0: "#111111", // "main" label on its #797d7d swatch: 4.9:1
    noteTextColor: "#e6e6e6", // sequence-diagram notes: #b8b6b6 on #474949 was 4.49:1, now 7.3:1
};

/** The subset of Mermaid's API this module needs (injected — see restoreMath's KatexLike for why). */
export interface MermaidLike {
    initialize(options: MermaidInitOptions): void;
    run(options: MermaidRunOptions): Promise<void>;
}

/**
 * Ported from mdviewer.js's `mermaid.initialize({...})` calls (both the
 * page-load one and setTheme's — identical shape, only `theme` differs).
 * `isDark` picks the same two Mermaid theme names mdviewer.js does,
 * Mermaid's own 'dark'/'default' — not one of the app's five-or-six CSS
 * theme names, a different concept entirely.
 */
export function initializeMermaid(mermaid: MermaidLike, isDark: boolean): void {
    mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "loose",
        ...(isDark ? { themeVariables: DARK_THEME_VARIABLES } : {}),
    });
}

/**
 * Ported from mdviewer.js's post-insertion `mermaid.run({ querySelector:
 * '.mermaid' })` call, including its try/catch — see the file header for
 * why that catch doesn't actually cover `run()`'s real async failure
 * mode, preserved as-is rather than fixed.
 */
export function runMermaidDiagrams(mermaid: MermaidLike): void {
    try {
        mermaid.run({ querySelector: ".mermaid" });
    } catch (e) {
        console.warn("Mermaid render error:", e);
    }
}
