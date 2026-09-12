// Math protection ported 1:1 from mdviewer.js. We replace $…$ / $$…$$ with
// placeholders BEFORE marked runs, so marked doesn't mangle the math, then
// restore rendered KaTeX after sanitization.

import { escapeHtml } from "./dom.js";

export interface MathBlock {
    type: "block" | "inline";
    expr: string;
}

export interface ProtectResult {
    processed: string;
    blocks: MathBlock[];
}

/** Placeholder token for the Nth captured math block. */
export function blockPlaceholder(index: number): string {
    return `MATHBLOCK_${index}_END`;
}

/** Placeholder token for the Nth captured inline math span. */
export function inlinePlaceholder(index: number): string {
    return `MATHINLINE_${index}_END`;
}

/**
 * Replace $$…$$ (block) and $…$ (inline) with placeholder tokens, returning the
 * processed markdown and the captured expressions in discovery order.
 */
export function protectMath(markdown: string): ProtectResult {
    const blocks: MathBlock[] = [];

    let processed = markdown.replace(/\$\$([^$]+?)\$\$/gs, function (_m, expr: string) {
        const placeholder = blockPlaceholder(blocks.length);
        blocks.push({ type: "block", expr: expr.trim() });
        return placeholder;
    });

    processed = processed.replace(/\$([^$\n]+?)\$/g, function (_m, expr: string) {
        const placeholder = inlinePlaceholder(blocks.length);
        blocks.push({ type: "inline", expr: expr.trim() });
        return placeholder;
    });

    return { processed, blocks };
}

/** The subset of KaTeX's API this module needs (injected — see extractTOC's lexer for why). */
export interface KatexLike {
    renderToString(expr: string, options: { displayMode: boolean; throwOnError: boolean }): string;
}

/**
 * Replace the placeholders `protectMath` left behind with their rendered
 * KaTeX HTML (or, if an expression fails to parse, its escaped source —
 * matching mdviewer.js's fallback rather than dropping the content).
 */
export function restoreMath(html: string, blocks: MathBlock[], katex: KatexLike): string {
    let result = html;
    blocks.forEach((block, index) => {
        const blockPattern = new RegExp(blockPlaceholder(index), "g");
        const inlinePattern = new RegExp(inlinePlaceholder(index), "g");
        let rendered: string;
        try {
            rendered = katex.renderToString(block.expr, {
                displayMode: block.type === "block",
                throwOnError: false,
            });
        } catch {
            rendered = escapeHtml(block.expr);
        }
        result = result.replace(blockPattern, rendered).replace(inlinePattern, rendered);
    });
    return result;
}
