// Ported from the marked.Renderer overrides (heading, code) in
// mdviewer.js's setContent(). Only the token-object dispatch shape is
// implemented. mdviewer.js also handles a "legacy (text, level)" shape,
// believing marked calls renderers differently depending on context — but
// per the "Correction" note under the marked.lexer() TOC item in plan.md,
// marked 18.0.6 always calls renderer.heading(token)/code(token) with a
// single token argument (verified against marked's own parser source).
// That legacy branch is unreachable dead code for this pinned version, not
// a real dispatch mode worth preserving.

import type { Tokens } from "marked";
import { slugify, escapeHtml } from "./dom.js";

export interface ExtractedHeading {
    level: number;
    title: string;
    anchor: string;
}

export type ParseInline = (tokens: Tokens.Heading["tokens"]) => string;

export interface HeadingRenderResult {
    html: string;
    heading: ExtractedHeading;
}

/**
 * Ported from renderer.heading. Returns the extracted heading rather than
 * pushing into a shared array (mdviewer.js's headingsRef) — the caller
 * collects them across a render pass.
 */
export function renderHeading(token: Tokens.Heading, parseInline: ParseInline): HeadingRenderResult {
    const plain = token.text != null ? String(token.text) : "";
    const inner = token.tokens ? parseInline(token.tokens) : plain;
    const anchor = slugify(plain);
    return {
        html: `<h${token.depth} id="${anchor}">${inner}</h${token.depth}>\n`,
        heading: { level: token.depth, title: plain, anchor },
    };
}

export type HighlightCode = (code: string, lang: string) => string;

/**
 * Ported from renderer.code. Syntax highlighting is injected rather than
 * assumed — see the open "syntax highlighting engine" question in plan.md
 * (Shiki vs. a native alternative); this function doesn't take a side.
 */
export function renderCode(token: Tokens.Code, highlightCode: HighlightCode): string {
    const code = token.text != null ? token.text : "";
    const lang = (token.lang || "").trim().split(/\s+/)[0];
    if (lang === "mermaid") {
        return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }
    return highlightCode(code, lang);
}
