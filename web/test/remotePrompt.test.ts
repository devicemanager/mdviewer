import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    remotePromptMessage,
    renderRemotePrompt,
    attachRemotePromptHandlers,
    showRemotePrompt,
    hideRemotePrompt,
} from "../src/remotePrompt.js";

let root: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<div id="remote-prompt" hidden></div>';
    root = document.getElementById("remote-prompt")!;
});

describe("remotePromptMessage", () => {
    it("matches Swift's wording, singular and plural", () => {
        expect(remotePromptMessage(1)).toBe(
            "This document references 1 image hosted on the internet. Loading them reveals your IP address to those servers.",
        );
        expect(remotePromptMessage(3)).toContain("references 3 images hosted");
    });
});

describe("renderRemotePrompt", () => {
    it("asks the question with Swift's three answers, in Swift's order", () => {
        renderRemotePrompt(root, 2);
        expect(root.querySelector("h2")!.textContent).toBe("Load remote content?");
        expect(root.textContent).toContain("references 2 images");
        expect([...root.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Load", "Don’t Load", "Always Allow"]);
    });

    it("replaces a previous render rather than stacking a second dialog", () => {
        renderRemotePrompt(root, 1);
        renderRemotePrompt(root, 4);
        expect(root.querySelectorAll("[role=alertdialog]")).toHaveLength(1);
        expect(root.textContent).toContain("references 4 images");
    });
});

describe("attachRemotePromptHandlers", () => {
    it("calls the callback for each button", () => {
        const callbacks = { onLoad: vi.fn(), onDontLoad: vi.fn(), onAlwaysAllow: vi.fn() };
        attachRemotePromptHandlers(root, callbacks);
        renderRemotePrompt(root, 1);
        const click = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();

        click("load");
        click("dont-load");
        click("always-allow");

        expect(callbacks.onLoad).toHaveBeenCalledTimes(1);
        expect(callbacks.onDontLoad).toHaveBeenCalledTimes(1);
        expect(callbacks.onAlwaysAllow).toHaveBeenCalledTimes(1);
    });

    it("ignores clicks that aren't on a button", () => {
        const callbacks = { onLoad: vi.fn(), onDontLoad: vi.fn(), onAlwaysAllow: vi.fn() };
        attachRemotePromptHandlers(root, callbacks);
        renderRemotePrompt(root, 1);
        root.querySelector<HTMLElement>("h2")!.click();
        expect(callbacks.onLoad).not.toHaveBeenCalled();
        expect(callbacks.onDontLoad).not.toHaveBeenCalled();
        expect(callbacks.onAlwaysAllow).not.toHaveBeenCalled();
    });
});

describe("showRemotePrompt / hideRemotePrompt", () => {
    it("toggles the hidden attribute", () => {
        showRemotePrompt(root);
        expect(root.hidden).toBe(false);
        hideRemotePrompt(root);
        expect(root.hidden).toBe(true);
    });
});
