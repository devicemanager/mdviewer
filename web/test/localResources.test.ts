import { describe, it, expect } from "vitest";
import { rewriteLocalResources } from "../src/localResources.js";

const BASE = "mdviewer-local://localhost/";

function imgSrc(html: string, base: string | null): string | null {
    const root = document.createElement("div");
    root.innerHTML = html;
    rewriteLocalResources(root, base);
    return root.querySelector("img")!.getAttribute("src");
}

describe("rewriteLocalResources", () => {
    it("rewrites a relative source against the base", () => {
        expect(imgSrc(`<img src="images/a.png">`, BASE)).toBe(
            `${BASE}images/a.png`,
        );
    });

    it("strips a leading slash before appending to the base", () => {
        expect(imgSrc(`<img src="/images/a.png">`, BASE)).toBe(
            `${BASE}images/a.png`,
        );
    });

    it("percent-encodes path segments but preserves slashes", () => {
        expect(imgSrc(`<img src="my folder/a b.png">`, BASE)).toBe(
            `${BASE}my%20folder/a%20b.png`,
        );
    });

    it("leaves absolute http(s) URLs untouched", () => {
        const url = "https://example.com/a.png";
        expect(imgSrc(`<img src="${url}">`, BASE)).toBe(url);
    });

    it("leaves data:, protocol-relative and fragment sources untouched", () => {
        expect(imgSrc(`<img src="data:image/png;base64,AA">`, BASE)).toBe(
            "data:image/png;base64,AA",
        );
        expect(imgSrc(`<img src="//cdn/a.png">`, BASE)).toBe("//cdn/a.png");
    });

    it("is a no-op when no base is set", () => {
        expect(imgSrc(`<img src="images/a.png">`, null)).toBe("images/a.png");
    });
});
