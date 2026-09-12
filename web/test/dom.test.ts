import { describe, it, expect } from "vitest";
import { slugify, escapeHtml } from "../src/dom.js";

describe("slugify", () => {
    it("lowercases and hyphenates words", () => {
        expect(slugify("Hello World")).toBe("hello-world");
    });

    it("drops punctuation", () => {
        expect(slugify("What's New, Everyone?")).toBe("whats-new-everyone");
    });

    it("collapses runs of whitespace and hyphens", () => {
        expect(slugify("Already-Hyphen   Spaced")).toBe("already-hyphen-spaced");
    });

    it("does not leave leading/trailing hyphens for padded input", () => {
        expect(slugify("  Introduction  ")).toBe("introduction");
    });
});

describe("escapeHtml", () => {
    it("escapes the HTML-significant characters", () => {
        expect(escapeHtml(`<a href="x">& more</a>`)).toBe(
            "&lt;a href=&quot;x&quot;&gt;&amp; more&lt;/a&gt;",
        );
    });

    it("escapes ampersands before other entities", () => {
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
});
