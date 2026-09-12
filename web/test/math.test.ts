import { describe, it, expect, vi } from "vitest";
import katex from "katex";
import { protectMath, restoreMath, blockPlaceholder, inlinePlaceholder } from "../src/math.js";

describe("protectMath", () => {
    it("replaces block math with a placeholder and captures it", () => {
        const { processed, blocks } = protectMath("$$a^2 + b^2$$");
        expect(processed).toBe(blockPlaceholder(0));
        expect(blocks).toEqual([{ type: "block", expr: "a^2 + b^2" }]);
    });

    it("replaces inline math with a placeholder and captures it", () => {
        const { processed, blocks } = protectMath("value $x$ here");
        expect(processed).toBe(`value ${inlinePlaceholder(0)} here`);
        expect(blocks).toEqual([{ type: "inline", expr: "x" }]);
    });

    it("captures block before inline with a shared running index", () => {
        const { processed, blocks } = protectMath("$$a$$ and $b$");
        expect(processed).toBe(`${blockPlaceholder(0)} and ${inlinePlaceholder(1)}`);
        expect(blocks).toEqual([
            { type: "block", expr: "a" },
            { type: "inline", expr: "b" },
        ]);
    });

    it("trims whitespace inside the delimiters", () => {
        expect(protectMath("$$  a  $$").blocks[0]).toEqual({ type: "block", expr: "a" });
        expect(protectMath("$  a  $").blocks[0]).toEqual({ type: "inline", expr: "a" });
    });

    it("handles multi-line block math", () => {
        const { blocks } = protectMath("$$\n\\frac{1}{2}\n$$");
        expect(blocks[0]).toEqual({ type: "block", expr: "\\frac{1}{2}" });
    });

    it("leaves text without math untouched", () => {
        const { processed, blocks } = protectMath("no math here");
        expect(processed).toBe("no math here");
        expect(blocks).toEqual([]);
    });
});

describe("restoreMath", () => {
    it("replaces an inline placeholder with rendered KaTeX", () => {
        const { processed, blocks } = protectMath("value $x^2$ here");
        const html = restoreMath(`<p>${processed}</p>`, blocks, katex);
        expect(html).not.toContain(inlinePlaceholder(0));
        expect(html).toContain('class="katex"');
    });

    it("renders block math in display mode", () => {
        const { processed, blocks } = protectMath("$$x^2$$");
        const html = restoreMath(processed, blocks, katex);
        expect(html).toContain("katex-display");
    });

    it("restores multiple blocks at their own indices", () => {
        const { processed, blocks } = protectMath("$$a$$ and $b$");
        const html = restoreMath(processed, blocks, katex);
        expect(html).not.toContain(blockPlaceholder(0));
        expect(html).not.toContain(inlinePlaceholder(1));
        expect(html.match(/class="katex"/g)).toHaveLength(2);
    });

    it("uses throwOnError: false, so KaTeX renders an inline error rather than throwing", () => {
        // Matches mdviewer.js exactly (see math.ts) — an invalid expression
        // does not reach the catch block at all with the real library.
        const { processed, blocks } = protectMath("$$\\frac{1$$");
        const html = restoreMath(processed, blocks, katex);
        expect(html).toContain("katex-error");
    });

    it("falls back to the escaped source if the injected renderer throws", () => {
        const { processed, blocks } = protectMath("$x < y$");
        const throwingKatex = { renderToString: vi.fn(() => { throw new Error("boom"); }) };
        const html = restoreMath(processed, blocks, throwingKatex);
        expect(html).toBe("x &lt; y");
    });
});
