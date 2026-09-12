import { describe, it, expect, beforeEach } from "vitest";
import { showContent, showWelcome, type AppShellElements } from "../src/appShell.js";

let elements: AppShellElements;

beforeEach(() => {
    document.body.innerHTML = '<div id="welcome"></div><div id="content" hidden></div>';
    elements = {
        welcome: document.getElementById("welcome")!,
        content: document.getElementById("content")!,
    };
});

describe("showContent", () => {
    it("unhides #content and hides #welcome", () => {
        showContent(elements);
        expect(elements.content.hidden).toBe(false);
        expect(elements.welcome.hidden).toBe(true);
    });
});

describe("showWelcome", () => {
    it("unhides #welcome and hides #content", () => {
        showContent(elements); // start from the "document open" state
        showWelcome(elements);
        expect(elements.welcome.hidden).toBe(false);
        expect(elements.content.hidden).toBe(true);
    });

    it("is idempotent when already in the welcome state", () => {
        showWelcome(elements);
        expect(elements.welcome.hidden).toBe(false);
        expect(elements.content.hidden).toBe(true);
    });
});
