import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    renderPreferences,
    showPreferences,
    hidePreferences,
    updatePreferencesPolicy,
    attachPreferencesHandlers,
} from "../src/preferences.js";

let root: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<div id="preferences" hidden></div>';
    root = document.getElementById("preferences")!;
});

describe("renderPreferences", () => {
    it("renders all three tabs, in Swift's order", () => {
        renderPreferences(root, "ask");
        const tabs = root.querySelectorAll<HTMLElement>(".prefs-tab");
        expect(Array.from(tabs).map((t) => t.dataset.tab)).toEqual(["general", "appearance", "privacy"]);
    });

    it("defaults to the General tab active, matching Swift's default", () => {
        renderPreferences(root, "ask");
        expect(root.querySelector('.prefs-tab[data-tab="general"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="general"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(false);
    });

    it("honors an explicit initial tab", () => {
        renderPreferences(root, "ask", "privacy");
        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="privacy"]')!.classList.contains("active")).toBe(true);
    });

    it("lists all three remote content policy options with the current one selected", () => {
        renderPreferences(root, "never");
        const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!;
        const options = select.querySelectorAll("option");
        expect(options).toHaveLength(3);
        expect(select.value).toBe("never");
    });

    it("shows placeholder text for General and Appearance, no interactive controls", () => {
        renderPreferences(root, "ask");
        const general = root.querySelector('.prefs-pane[data-pane="general"]')!;
        const appearance = root.querySelector('.prefs-pane[data-pane="appearance"]')!;
        expect(general.querySelector("button, select, input")).toBeNull();
        expect(appearance.querySelector("button, select, input")).toBeNull();
    });
});

describe("showPreferences / hidePreferences", () => {
    it("toggles the hidden attribute", () => {
        renderPreferences(root, "ask");
        showPreferences(root);
        expect(root.hidden).toBe(false);
        hidePreferences(root);
        expect(root.hidden).toBe(true);
    });
});

describe("updatePreferencesPolicy", () => {
    it("updates the select's value", () => {
        renderPreferences(root, "ask");
        updatePreferencesPolicy(root, "always");
        expect(root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!.value).toBe("always");
    });
});

describe("attachPreferencesHandlers", () => {
    it("switches the active tab and pane on a tab click", () => {
        renderPreferences(root, "ask");
        attachPreferencesHandlers(root, { onPolicyChange: vi.fn(), onClose: vi.fn() });

        root.querySelector<HTMLElement>('.prefs-tab[data-tab="privacy"]')!.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
        );

        expect(root.querySelector('.prefs-tab[data-tab="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-tab[data-tab="general"]')!.classList.contains("active")).toBe(false);
        expect(root.querySelector('.prefs-pane[data-pane="privacy"]')!.classList.contains("active")).toBe(true);
        expect(root.querySelector('.prefs-pane[data-pane="general"]')!.classList.contains("active")).toBe(false);
    });

    it("calls onClose when the close button is clicked", () => {
        renderPreferences(root, "ask");
        const onClose = vi.fn();
        attachPreferencesHandlers(root, { onPolicyChange: vi.fn(), onClose });

        root.querySelector<HTMLElement>(".prefs-close")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the overlay backdrop is clicked", () => {
        renderPreferences(root, "ask");
        const onClose = vi.fn();
        attachPreferencesHandlers(root, { onPolicyChange: vi.fn(), onClose });

        root.querySelector<HTMLElement>(".prefs-overlay")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onClose when the panel itself is clicked", () => {
        renderPreferences(root, "ask");
        const onClose = vi.fn();
        attachPreferencesHandlers(root, { onPolicyChange: vi.fn(), onClose });

        root.querySelector<HTMLElement>(".prefs-panel")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it("calls onPolicyChange with the selected policy on change", () => {
        renderPreferences(root, "ask", "privacy");
        const onPolicyChange = vi.fn();
        attachPreferencesHandlers(root, { onPolicyChange, onClose: vi.fn() });

        const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!;
        select.value = "always";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onPolicyChange).toHaveBeenCalledWith("always");
    });
});
