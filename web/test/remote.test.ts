import { describe, it, expect } from "vitest";
import { gateRemoteResourcesInHTML, loadRemoteResources } from "../src/remote.js";

describe("gateRemoteResourcesInHTML", () => {
    it("passes HTML through untouched under the 'always' policy", () => {
        const html = `<img src="https://example.com/a.png">`;
        expect(gateRemoteResourcesInHTML(html, "always")).toEqual({
            html,
            blockedCount: 0,
        });
    });

    it("gates remote images under 'ask'", () => {
        const result = gateRemoteResourcesInHTML(
            `<img src="https://example.com/a.png">`,
            "ask",
        );
        expect(result.blockedCount).toBe(1);
        expect(result.html).toContain(`data-mdv-remote="https://example.com/a.png"`);
        expect(result.html).not.toContain("src=");
    });

    it("gates remote images under 'never' too", () => {
        const result = gateRemoteResourcesInHTML(
            `<img src='http://example.com/a.png'>`,
            "never",
        );
        expect(result.blockedCount).toBe(1);
    });

    it("leaves data: and relative sources alone", () => {
        const html = `<img src="data:image/png;base64,AAAA"><img src="local/a.png">`;
        const result = gateRemoteResourcesInHTML(html, "ask");
        expect(result).toEqual({ html, blockedCount: 0 });
    });

    it("counts multiple remote images", () => {
        const html =
            `<img src="https://a/1.png"><p>x</p><img src="https://b/2.png">`;
        expect(gateRemoteResourcesInHTML(html, "ask").blockedCount).toBe(2);
    });
});

describe("loadRemoteResources", () => {
    it("restores gated http/https sources and removes the marker", () => {
        const root = document.createElement("div");
        root.innerHTML = `<img data-mdv-remote="https://example.com/a.png">`;
        loadRemoteResources(root, "https://example.com/");
        const img = root.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("https://example.com/a.png");
        expect(img.hasAttribute("data-mdv-remote")).toBe(false);
    });

    it("does not restore non-http(s) schemes", () => {
        const root = document.createElement("div");
        root.innerHTML = `<img data-mdv-remote="javascript:alert(1)">`;
        loadRemoteResources(root, "https://example.com/");
        const img = root.querySelector("img")!;
        expect(img.hasAttribute("src")).toBe(false);
        expect(img.hasAttribute("data-mdv-remote")).toBe(false);
    });
});
