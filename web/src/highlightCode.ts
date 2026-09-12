// Ported from mdviewer.js's highlightCode (and the fallback() helper it
// calls internally). The Shiki highlighter is injected rather than read
// from `window.__shikiReady` directly — same reason KaTeX is injected in
// math.ts's restoreMath rather than read from `window.katex`: keeps this
// module pure and testable against the real pinned `shiki` package. The
// actual `window.__shikiReady` wiring — and the async race it exists for,
// since Shiki resolves its WASM engine after page load — belongs to the
// not-yet-built window.MDViewer assembly layer, the same place KatexLike's
// real `window.katex` wiring will happen too.
//
// Resolves plan.md's "Open questions" note on the syntax-highlighting
// engine (Shiki vs. a native Rust highlighter via e.g. syntect): keeping
// Shiki. porting-brief.md's "What does not get ported" section already
// settles this architecturally — "the TypeScript calls marked/shiki/
// katex/mermaid/DOMPurify as globals" names Shiki specifically — and it's
// confirmed to actually be working today, not dead code: read
// `vendor/shiki.bundle.js` directly (2026-09-08) rather than assume, and
// `window.__shikiReady` genuinely is assigned at the very end of that
// custom-built bundle, since nothing in `renderer.html` itself sets it.
// Swapping to syntect would mean a new Rust dependency, an IPC round trip
// per code block, and re-theming to match syntect's different token
// output — a real improvement (drops `wasm-unsafe-eval` from the CSP)
// worth revisiting once Phase 1 parity is done, not now.

import { escapeHtml } from "./dom.js";

/** The subset of Shiki's highlighter API this module needs (injected — see restoreMath's KatexLike for why). */
export interface ShikiHighlighterLike {
    getLoadedLanguages(): string[];
    codeToHtml(code: string, options: { lang: string; themes: { light: string; dark: string } }): string;
}

function fallback(code: string, lang: string): string {
    const label = lang ? `<span class="code-lang-label">${escapeHtml(lang)}</span>` : "";
    return `<div class="code-block-wrapper">${label}<pre><code>${escapeHtml(code)}</code></pre></div>`;
}

/**
 * Ported from mdviewer.js's highlightCode. `highlighter` is `undefined`
 * when Shiki hasn't finished resolving yet (or failed to load) — the same
 * "not ready" state mdviewer.js's module-level `shikiHighlighter` starts
 * in, modeled here as `T | undefined` per this port's Swift-optional
 * convention rather than mdviewer.js's `null`.
 */
export function highlightCode(code: string, lang: string, highlighter: ShikiHighlighterLike | undefined): string {
    if (!highlighter) return fallback(code, lang);

    try {
        const loaded = highlighter.getLoadedLanguages();
        const resolvedLang = loaded.includes(lang) ? lang : "text";
        const html = highlighter.codeToHtml(code, {
            lang: resolvedLang,
            themes: { light: "github-light", dark: "github-dark" },
        });
        if (lang) {
            return html
                .replace("<pre ", `<div class="code-block-wrapper"><span class="code-lang-label">${escapeHtml(lang)}</span><pre `)
                .replace("</pre>", "</pre></div>");
        }
        return html;
    } catch {
        return fallback(code, lang);
    }
}
