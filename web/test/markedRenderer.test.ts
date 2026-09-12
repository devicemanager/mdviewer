import { describe, it, expect, vi } from "vitest";
import { marked } from "marked";
import type { Tokens } from "marked";
import { renderHeading, renderCode } from "../src/markedRenderer.js";

function headingToken(markdown: string): Tokens.Heading {
    return marked.lexer(markdown).find((t) => t.type === "heading") as Tokens.Heading;
}

function codeToken(markdown: string): Tokens.Code {
    return marked.lexer(markdown).find((t) => t.type === "code") as Tokens.Code;
}

describe("renderHeading", () => {
    it("renders a plain heading with a slugified id", () => {
        const parseInline = vi.fn(() => "Hello World");
        const { html, heading } = renderHeading(headingToken("## Hello World"), parseInline);
        expect(html).toBe('<h2 id="hello-world">Hello World</h2>\n');
        expect(heading).toEqual({ level: 2, title: "Hello World", anchor: "hello-world" });
    });

    it("slugifies the raw token text, not the inline-rendered HTML", () => {
        // parseInline renders the formatted HTML for display; the anchor must
        // still come from the plain token text, so the TOC (mdviewerApi.ts's
        // setContent, which accumulates these same ExtractedHeading values)
        // and the rendered id always agree.
        const parseInline = () => "Hello <strong>World</strong>";
        const { heading } = renderHeading(headingToken("## Hello **World**"), parseInline);
        expect(heading.anchor).toBe("hello-world");
        expect(heading.title).toBe("Hello **World**");
    });

    it("passes the heading's inline tokens to parseInline", () => {
        const token = headingToken("# Title");
        const parseInline = vi.fn(() => "Title");
        renderHeading(token, parseInline);
        expect(parseInline).toHaveBeenCalledWith(token.tokens);
    });
});

describe("renderCode", () => {
    it("wraps a mermaid code block instead of highlighting it", () => {
        const highlightCode = vi.fn();
        const html = renderCode(codeToken("```mermaid\ngraph TD;\n```"), highlightCode);
        expect(html).toBe('<div class="mermaid">graph TD;</div>');
        expect(highlightCode).not.toHaveBeenCalled();
    });

    it("delegates non-mermaid code to the injected highlighter with the parsed language", () => {
        const highlightCode = vi.fn(() => "<pre>highlighted</pre>");
        const html = renderCode(codeToken("```js\nconsole.log(1)\n```"), highlightCode);
        expect(highlightCode).toHaveBeenCalledWith("console.log(1)", "js");
        expect(html).toBe("<pre>highlighted</pre>");
    });

    it("passes an empty language when the fence has none", () => {
        const highlightCode = vi.fn(() => "");
        renderCode(codeToken("```\nplain\n```"), highlightCode);
        expect(highlightCode).toHaveBeenCalledWith("plain", "");
    });

    it("escapes mermaid source so it can't break out of the wrapping div", () => {
        const html = renderCode(codeToken("```mermaid\n<script>\n```"), vi.fn());
        expect(html).toBe('<div class="mermaid">&lt;script&gt;</div>');
    });
});
