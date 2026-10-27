import { describe, it, expect, vi } from "vitest";
import { linkClickHandler } from "../src/linkBridge.js";

describe("linkClickHandler", () => {
    it("sends the click to the Tauri handle_link_click command when Tauri is present", () => {
        const invoke = vi.fn(() => Promise.resolve());
        const handler = linkClickHandler({ __TAURI__: { core: { invoke } } });

        handler?.("mdviewer-local://localhost/other.md");

        expect(invoke).toHaveBeenCalledWith("handle_link_click", { href: "mdviewer-local://localhost/other.md" });
    });

    it("posts the click to the Swift linkClicked message handler when hosted by WKWebView", () => {
        const postMessage = vi.fn();
        const handler = linkClickHandler({ webkit: { messageHandlers: { linkClicked: { postMessage } } } });

        handler?.("mdviewer-local://localhost/other.md");

        expect(postMessage).toHaveBeenCalledWith("mdviewer-local://localhost/other.md");
    });

    it("returns undefined when no native host is available", () => {
        expect(linkClickHandler({})).toBeUndefined();
    });
});
