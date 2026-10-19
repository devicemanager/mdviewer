import { describe, it, expect, vi } from "vitest";
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

    it("restores through a fetcher when one is given", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<img data-mdv-remote="https://example.com/a.png"><img data-mdv-remote="https://example.com/b.png">`;
        const fetchImage = vi.fn(async (url: string) => `data:image/png;base64,${url.endsWith("a.png") ? "QQ==" : "Qg=="}`);
        await loadRemoteResources(root, "https://example.com/", fetchImage);
        const [a, b] = root.querySelectorAll("img");
        expect(a.getAttribute("src")).toBe("data:image/png;base64,QQ==");
        expect(b.getAttribute("src")).toBe("data:image/png;base64,Qg==");
        expect(root.querySelector("[data-mdv-remote]")).toBeNull();
    });

    it("leaves an image unloaded when the fetcher fails", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<img data-mdv-remote="https://example.com/a.png">`;
        await loadRemoteResources(root, "https://example.com/", async () => {
            throw new Error("not an image");
        });
        const img = root.querySelector("img")!;
        expect(img.hasAttribute("src")).toBe(false);
        expect(img.hasAttribute("data-mdv-remote")).toBe(false);
    });

    it("never hands a non-http(s) URL to the fetcher", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<img data-mdv-remote="javascript:alert(1)"><img data-mdv-remote="file:///etc/passwd">`;
        const fetchImage = vi.fn(async () => "data:,");
        await loadRemoteResources(root, "https://example.com/", fetchImage);
        expect(fetchImage).not.toHaveBeenCalled();
    });
});
