import { describe, it, expect } from "vitest";
import createDOMPurify from "dompurify";
import { sanitizeHtml } from "../src/sanitize.js";

// dompurify's Node/CJS build is a factory over a window, unlike the global
// browser build mdviewer.js loads (window.DOMPurify, already bound).
const DOMPurify = createDOMPurify(window as any);

describe("sanitizeHtml", () => {
    it("strips script tags", () => {
        expect(sanitizeHtml("<p>hi</p><script>alert(1)</script>", DOMPurify)).toBe("<p>hi</p>");
    });

    it("strips on* event handler attributes", () => {
        expect(sanitizeHtml('<img src="x" onerror="alert(1)">', DOMPurify)).toBe('<img src="x">');
    });

    it("strips forbidden tags: iframe, object, embed, link, meta, base, form", () => {
        const dirty =
            '<iframe src="x"></iframe><object></object><embed src="x">' +
            '<link rel="x"><meta charset="utf-8"><base href="/"><form></form><p>ok</p>';
        expect(sanitizeHtml(dirty, DOMPurify)).toBe("<p>ok</p>");
    });

    it("strips forbidden attributes: srcset, formaction, ping", () => {
        const html = sanitizeHtml(
            '<img src="x" srcset="y 1x"><a href="#" formaction="/x" ping="/y">link</a>',
            DOMPurify,
        );
        expect(html).not.toContain("srcset");
        expect(html).not.toContain("formaction");
        expect(html).not.toContain("ping");
    });

    it("keeps ordinary HTML content untouched", () => {
        const html = "<h1>Title</h1><p>Some <strong>bold</strong> text.</p>";
        expect(sanitizeHtml(html, DOMPurify)).toBe(html);
    });

    it("allows SVG content (USE_PROFILES.svg)", () => {
        const html = sanitizeHtml('<svg><circle cx="5" cy="5" r="4"></circle></svg>', DOMPurify);
        expect(html).toContain("<circle");
    });
});
