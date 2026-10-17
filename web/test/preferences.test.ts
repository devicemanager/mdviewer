import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    renderPreferences,
    showPreferences,
    hidePreferences,
    updatePreferencesPolicy,
    updatePreferencesTheme,
    updatePreferencesFontSize,
    attachPreferencesHandlers,
    type PreferencesCallbacks,
} from "../src/preferences.js";
import { themes } from "../src/markdownTheme.js";

let root: HTMLElement;

function callbacks(overrides: Partial<PreferencesCallbacks> = {}): PreferencesCallbacks {
    return {
        onPolicyChange: vi.fn(),
        onThemeChange: vi.fn(),
        onFontDecrease: vi.fn(),
        onFontReset: vi.fn(),
        onFontIncrease: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    document.body.innerHTML = '<div id="preferences" hidden></div>';
    root = document.getElementById("preferences")!;
});

describe("renderPreferences", () => {
    it("renders Swift's three tabs in Swift's order, then About", () => {
        renderPreferences(root, "ask", "github-light", 16);
        const tabs = root.querySelectorAll<HTMLElement>(".prefs-tab");
        expect(Array.from(tabs).map((t) => t.dataset.tab)).toEqual(["general", "appearance", "privacy", "about"]);
    });

    it("defaults to the General tab active, matching Swift's default", () => {
        renderPreferences(root, "ask", "github-light", 16);
        expect(root.querySelector('.prefs-tab[data-tab="general"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="general"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(false);
    });

    it("honors an explicit initial tab", () => {
        renderPreferences(root, "ask", "github-light", 16, "privacy");
        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="privacy"]')!.classList.contains("active")).toBe(true);
    });

    it("lists all three remote content policy options with the current one selected", () => {
        renderPreferences(root, "never", "github-light", 16);
        const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!;
        const options = select.querySelectorAll("option");
        expect(options).toHaveLength(3);
        expect(select.value).toBe("never");
    });

    it("shows a placeholder for General, no interactive controls", () => {
        renderPreferences(root, "ask", "github-light", 16);
        const general = root.querySelector('.prefs-pane[data-pane="general"]')!;
        expect(general.querySelector("button, select, input")).toBeNull();
    });

    it("lists every theme in the Appearance tab, with the initial one selected", () => {
        renderPreferences(root, "ask", "dracula", 16);
        const select = root.querySelector<HTMLSelectElement>('select[data-action="theme"]')!;
        expect(select.querySelectorAll("option")).toHaveLength(themes.length);
        expect(select.value).toBe("dracula");
    });

    it("shows the initial font size on the reset button in the Appearance tab", () => {
        renderPreferences(root, "ask", "github-light", 22);
        expect(root.querySelector("[data-font-size]")!.textContent).toBe("22");
    });
});

describe("renderPreferences — About tab", () => {
    it("renders an About tab and pane holding the third-party notices", () => {
        const root = document.createElement("div");
        renderPreferences(root, "ask", "github-light", 16, "about");
        expect(root.querySelector('.prefs-tab.active[data-tab="about"]')).not.toBeNull();
        const pane = root.querySelector('.prefs-pane.active[data-pane="about"]');
        expect(pane?.textContent).toContain("Third-party libraries");
    });
});

describe("showPreferences / hidePreferences", () => {
    it("toggles the hidden attribute", () => {
        renderPreferences(root, "ask", "github-light", 16);
        showPreferences(root);
        expect(root.hidden).toBe(false);
        hidePreferences(root);
        expect(root.hidden).toBe(true);
    });
});

describe("updatePreferencesPolicy", () => {
    it("updates the select's value", () => {
        renderPreferences(root, "ask", "github-light", 16);
        updatePreferencesPolicy(root, "always");
        expect(root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!.value).toBe("always");
    });
});

describe("updatePreferencesTheme", () => {
    it("updates the theme select's value without touching other panes", () => {
        renderPreferences(root, "ask", "github-light", 16);
        updatePreferencesTheme(root, "nord");
        expect(root.querySelector<HTMLSelectElement>('select[data-action="theme"]')!.value).toBe("nord");
    });
});

describe("updatePreferencesFontSize", () => {
    it("updates the displayed size", () => {
        renderPreferences(root, "ask", "github-light", 16);
        updatePreferencesFontSize(root, 20);
        expect(root.querySelector("[data-font-size]")!.textContent).toBe("20");
    });
});

describe("attachPreferencesHandlers", () => {
    it("switches the active tab and pane on a tab click", () => {
        renderPreferences(root, "ask", "github-light", 16);
        attachPreferencesHandlers(root, callbacks());

        root.querySelector<HTMLElement>('.prefs-tab[data-tab="privacy"]')!.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
        );

        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-tab[data-tab="general"]')!.classList.contains("active")).toBe(false);
        expect(root.querySelector('.prefs-pane[data-pane="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="general"]')!.classList.contains("active")).toBe(false);
    });

    it("calls onClose when the close button is clicked", () => {
        renderPreferences(root, "ask", "github-light", 16);
        const onClose = vi.fn();
        attachPreferencesHandlers(root, callbacks({ onClose }));

        root.querySelector<HTMLElement>(".prefs-close")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the overlay backdrop is clicked", () => {
        renderPreferences(root, "ask", "github-light", 16);
        const onClose = vi.fn();
        attachPreferencesHandlers(root, callbacks({ onClose }));

        root.querySelector<HTMLElement>(".prefs-overlay")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onClose when the panel itself is clicked", () => {
        renderPreferences(root, "ask", "github-light", 16);
        const onClose = vi.fn();
        attachPreferencesHandlers(root, callbacks({ onClose }));

        root.querySelector<HTMLElement>(".prefs-panel")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it("calls onPolicyChange with the selected policy on change", () => {
        renderPreferences(root, "ask", "github-light", 16, "privacy");
        const onPolicyChange = vi.fn();
        attachPreferencesHandlers(root, callbacks({ onPolicyChange }));

        const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!;
        select.value = "always";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onPolicyChange).toHaveBeenCalledWith("always");
    });

    it("calls onThemeChange with the matching MarkdownTheme when the theme select changes", () => {
        renderPreferences(root, "ask", "github-light", 16, "appearance");
        const onThemeChange = vi.fn();
        attachPreferencesHandlers(root, callbacks({ onThemeChange }));

        const select = root.querySelector<HTMLSelectElement>('select[data-action="theme"]')!;
        select.value = "dracula";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onThemeChange).toHaveBeenCalledWith(themes.find((t) => t.id === "dracula"));
    });

    it("calls the matching font-size callback for each button in the Appearance tab", () => {
        renderPreferences(root, "ask", "github-light", 16, "appearance");
        const cbs = callbacks();
        attachPreferencesHandlers(root, cbs);

        root.querySelector('[data-action="font-decrease"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        root.querySelector('[data-action="font-reset"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        root.querySelector('[data-action="font-increase"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(cbs.onFontDecrease).toHaveBeenCalledOnce();
        expect(cbs.onFontReset).toHaveBeenCalledOnce();
        expect(cbs.onFontIncrease).toHaveBeenCalledOnce();
    });
});
