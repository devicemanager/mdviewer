import { describe, it, expect, beforeAll } from "vitest";
import { createHighlighter, type Highlighter } from "shiki";
import { highlightCode } from "../src/highlightCode.js";

describe("highlightCode", () => {
    describe("without a highlighter (not ready yet)", () => {
        it("falls back to an escaped, unhighlighted block with a lang label", () => {
            const html = highlightCode("const x = 1;", "typescript", undefined);
            expect(html).toBe(
                '<div class="code-block-wrapper"><span class="code-lang-label">typescript</span><pre><code>const x = 1;</code></pre></div>'
            );
        });

        it("omits the lang label when no language is given", () => {
            const html = highlightCode("plain text", "", undefined);
            expect(html).toBe('<div class="code-block-wrapper"><pre><code>plain text</code></pre></div>');
        });

        it("escapes HTML-significant characters in the fallback", () => {
            const html = highlightCode("<script>", "html", undefined);
            expect(html).toContain("&lt;script&gt;");
            expect(html).not.toContain("<script>");
        });
    });

    describe("with a real Shiki highlighter", () => {
        let highlighter: Highlighter;

        beforeAll(async () => {
            highlighter = await createHighlighter({
                themes: ["github-light", "github-dark"],
                langs: ["typescript", "rust"],
            });
        });

        it("wraps highlighted output in code-block-wrapper with a lang label", () => {
            const html = highlightCode("const x: number = 1;", "typescript", highlighter);
            expect(html).toContain('<div class="code-block-wrapper">');
            expect(html).toContain('<span class="code-lang-label">typescript</span>');
            expect(html).toContain('<pre class="shiki');
            expect(html).toContain("</pre></div>");
        });

        it("falls back to the 'text' grammar for a language Shiki hasn't loaded", () => {
            // Not thrown, not silently the wrong language — matches
            // mdviewer.js's `loaded.includes(lang) ? lang : 'text'`.
            const html = highlightCode("some ruby-ish code", "ruby", highlighter);
            expect(html).toContain('<span class="code-lang-label">ruby</span>');
            expect(html).toContain('<pre class="shiki');
        });

        it("returns raw Shiki output with no wrapper when no language is given", () => {
            const html = highlightCode("const x = 1;", "", highlighter);
            expect(html).not.toContain("code-block-wrapper");
            expect(html.startsWith('<pre class="shiki')).toBe(true);
        });

        it("falls back on a throwing highlighter instead of propagating the error", () => {
            const throwing = {
                getLoadedLanguages: () => {
                    throw new Error("boom");
                },
                codeToHtml: () => "",
            };
            const html = highlightCode("const x = 1;", "typescript", throwing);
            expect(html).toBe(
                '<div class="code-block-wrapper"><span class="code-lang-label">typescript</span><pre><code>const x = 1;</code></pre></div>'
            );
        });
    });
});
