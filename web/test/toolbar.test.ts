import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToolbar, updateToolbarFontSize, updateToolbarTheme, attachToolbarHandlers } from "../src/toolbar.js";
import { themes } from "../src/markdownTheme.js";

let toolbar: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<header id="toolbar"></header>';
    toolbar = document.getElementById("toolbar")!;
});

describe("renderToolbar", () => {
    it("renders an Open button, font-size controls, and a theme select", () => {
        renderToolbar(toolbar, 16, "github-light");
        expect(toolbar.querySelector('button[data-action="open"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="font-decrease"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="font-increase"]')).not.toBeNull();
        expect(toolbar.querySelector("select")).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="preferences"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="find"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="sidebar-toggle"]')).not.toBeNull();
        expect(toolbar.querySelector('button[data-action="file-browser-toggle"]')).not.toBeNull();
    });

    it("shows the initial font size on the reset button", () => {
        renderToolbar(toolbar, 22, "github-light");
        expect(toolbar.querySelector("[data-font-size]")!.textContent).toBe("22");
    });

    it("lists every theme, with the initial one selected", () => {
        renderToolbar(toolbar, 16, "dracula");
        const options = toolbar.querySelectorAll<HTMLOptionElement>("select option");
        expect(options).toHaveLength(themes.length);
        expect(toolbar.querySelector<HTMLSelectElement>("select")!.value).toBe("dracula");
    });
});

describe("updateToolbarFontSize", () => {
    it("updates the displayed size without touching the rest of the toolbar", () => {
        renderToolbar(toolbar, 16, "github-light");
        updateToolbarFontSize(toolbar, 20);
        expect(toolbar.querySelector("[data-font-size]")!.textContent).toBe("20");
        expect(toolbar.querySelector('button[data-action="open"]')).not.toBeNull();
    });
});

describe("updateToolbarTheme", () => {
    it("updates the select's value", () => {
        renderToolbar(toolbar, 16, "github-light");
        updateToolbarTheme(toolbar, "nord");
        expect(toolbar.querySelector<HTMLSelectElement>("select")!.value).toBe("nord");
    });
});

describe("attachToolbarHandlers", () => {
    it("calls onOpen when the Open button is clicked", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onOpen = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen,
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        });

        toolbar.querySelector('button[data-action="open"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpen).toHaveBeenCalledOnce();
    });

    it("calls the matching font-size callback for each button", () => {
        renderToolbar(toolbar, 16, "github-light");
        const callbacks = {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        };
        attachToolbarHandlers(toolbar, callbacks);

        toolbar.querySelector('[data-action="font-decrease"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        toolbar.querySelector('[data-action="font-reset"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        toolbar.querySelector('[data-action="font-increase"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(callbacks.onFontDecrease).toHaveBeenCalledOnce();
        expect(callbacks.onFontReset).toHaveBeenCalledOnce();
        expect(callbacks.onFontIncrease).toHaveBeenCalledOnce();
    });

    it("calls onThemeChange with the matching MarkdownTheme when the select changes", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onThemeChange = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange,
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        });

        const select = toolbar.querySelector<HTMLSelectElement>("select")!;
        select.value = "dracula";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onThemeChange).toHaveBeenCalledWith(themes.find((t) => t.id === "dracula"));
    });

    it("calls onPreferences when the Preferences button is clicked", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onPreferences = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences,
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        });

        toolbar.querySelector('button[data-action="preferences"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onPreferences).toHaveBeenCalledOnce();
    });

    it("calls onFind when the Find button is clicked", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onFind = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind,
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        });

        toolbar.querySelector('button[data-action="find"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onFind).toHaveBeenCalledOnce();
    });

    it("calls onToggleFileBrowser when the file-browser-toggle button is clicked", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onToggleFileBrowser = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser,
        });

        toolbar
            .querySelector('button[data-action="file-browser-toggle"]')!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onToggleFileBrowser).toHaveBeenCalledOnce();
    });

    it("calls onToggleSidebar when the sidebar-toggle button is clicked", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onToggleSidebar = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen: vi.fn(),
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar,
            onToggleFileBrowser: vi.fn(),
        });

        toolbar.querySelector('button[data-action="sidebar-toggle"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onToggleSidebar).toHaveBeenCalledOnce();
    });

    it("does nothing when the click isn't on a toolbar control", () => {
        renderToolbar(toolbar, 16, "github-light");
        const onOpen = vi.fn();
        attachToolbarHandlers(toolbar, {
            onOpen,
            onFontDecrease: vi.fn(),
            onFontReset: vi.fn(),
            onFontIncrease: vi.fn(),
            onThemeChange: vi.fn(),
            onPreferences: vi.fn(),
            onFind: vi.fn(),
            onToggleSidebar: vi.fn(),
            onToggleFileBrowser: vi.fn(),
        });

        toolbar.querySelector(".toolbar-spacer")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpen).not.toHaveBeenCalled();
    });
});
