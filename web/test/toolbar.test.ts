import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToolbar, attachToolbarHandlers, type ToolbarCallbacks } from "../src/toolbar.js";

let toolbar: HTMLElement;

function callbacks(overrides: Partial<ToolbarCallbacks> = {}): ToolbarCallbacks {
    return {
        onOpen: vi.fn(),
        onPreferences: vi.fn(),
        onFind: vi.fn(),
        onToggleFileBrowser: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    document.body.innerHTML = '<header id="toolbar"></header>';
    toolbar = document.getElementById("toolbar")!;
});

describe("renderToolbar", () => {
    it("renders the file-browser and open buttons on the left, find and preferences on the right", () => {
        renderToolbar(toolbar);
        expect(toolbar.querySelector('button[data-action="file-browser-toggle"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="open"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="find"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="preferences"]')).not.toBeNull();
    });

    it("has no font-size or theme controls — those moved to Preferences' Appearance tab", () => {
        renderToolbar(toolbar);
        expect(toolbar.querySelector('[data-action="font-decrease"]')).toBeNull();
        expect(toolbar.querySelector('[data-action="font-increase"]')).toBeNull();
        expect(toolbar.querySelector("select")).toBeNull();
    });

    it("has no sidebar-toggle button — the TOC feature it opened was dropped", () => {
        renderToolbar(toolbar);
        expect(toolbar.querySelector('[data-action="sidebar-toggle"]')).toBeNull();
    });

    it("groups file-browser-toggle and open together, separately from find and preferences", () => {
        renderToolbar(toolbar);
        const groups = toolbar.querySelectorAll(".toolbar-icon-group");
        expect(groups).toHaveLength(2);
        expect(groups[0].querySelector('[data-action="file-browser-toggle"]')).not.toBeNull();
        expect(groups[0].querySelector('[data-action="open"]')).not.toBeNull();
        expect(groups[1].querySelector('[data-action="find"]')).not.toBeNull();
        expect(groups[1].querySelector('[data-action="preferences"]')).not.toBeNull();
    });
});

describe("attachToolbarHandlers", () => {
    it("calls onOpen when the Open button is clicked", () => {
        renderToolbar(toolbar);
        const onOpen = vi.fn();
        attachToolbarHandlers(toolbar, callbacks({ onOpen }));

        toolbar.querySelector('button[data-action="open"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpen).toHaveBeenCalledOnce();
    });

    it("calls onPreferences when the Preferences button is clicked", () => {
        renderToolbar(toolbar);
        const onPreferences = vi.fn();
        attachToolbarHandlers(toolbar, callbacks({ onPreferences }));

        toolbar.querySelector('button[data-action="preferences"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onPreferences).toHaveBeenCalledOnce();
    });

    it("calls onFind when the Find button is clicked", () => {
        renderToolbar(toolbar);
        const onFind = vi.fn();
        attachToolbarHandlers(toolbar, callbacks({ onFind }));

        toolbar.querySelector('button[data-action="find"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onFind).toHaveBeenCalledOnce();
    });

    it("calls onToggleFileBrowser when the file-browser-toggle button is clicked", () => {
        renderToolbar(toolbar);
        const onToggleFileBrowser = vi.fn();
        attachToolbarHandlers(toolbar, callbacks({ onToggleFileBrowser }));

        toolbar
            .querySelector('button[data-action="file-browser-toggle"]')!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onToggleFileBrowser).toHaveBeenCalledOnce();
    });

    it("does nothing when the click isn't on a toolbar control", () => {
        renderToolbar(toolbar);
        const onOpen = vi.fn();
        attachToolbarHandlers(toolbar, callbacks({ onOpen }));

        toolbar.querySelector(".toolbar-spacer")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpen).not.toHaveBeenCalled();
    });
});
