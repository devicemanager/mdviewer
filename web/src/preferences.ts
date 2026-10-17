// Ported from MDViewer/Views/Preferences/{PreferencesView,GeneralPrefsView,
// AppearancePrefsView}.swift — a Settings-scene window in Swift (macOS
// only; `Settings { PreferencesView() }` in MDViewerApp.swift, opened via
// Cmd+, / the app menu's "Settings…" item), ported here as an in-page
// modal instead. Not a straightforward "put it in a second Tauri window"
// port: mobile has no concept of a second app window at all, and this
// port's single-webview architecture decision (porting-brief.md) already
// treats the whole UI — toolbar, sidebar, content — as one page. A modal
// within that same page is the direct continuation of that decision, not
// a new one; opened from a gear button in the toolbar (toolbar.ts) so the
// trigger works identically on desktop and mobile, unlike Swift's
// keyboard-shortcut-and-app-menu-only entry point.
//
// Scoped down like every other Milestone E slice: General has a plain,
// honest placeholder instead of real controls, not fake ones that would
// silently do nothing — `restoreLastFile`/`autoReload` have no
// corresponding "disable" hook on the Rust side yet
// (`restore_last_opened_document`/`watch_file` in src-tauri/src/lib.rs
// run unconditionally, so a toggle here would have nothing to control).
// PDF page size *is* already implemented (`renderViewModel.ts`'s
// `setPDFPageSize`) but wiring it in was scoped out of this pass too.
//
// Appearance is real as of 2026-09-14/15 (file-browser plan's Phase 6):
// Theme and Font Size moved here from the toolbar (toolbar.ts used to own
// both), pointed at the same shared `RenderViewModel` instance
// `wireToolbar` used to construct — main.ts now builds it once
// (`createRenderViewModel`) and hands it to both `wireToolbar` and
// `wirePreferences`, since neither alone still owns the whole thing.
// Shown at every width, including mobile: the toolbar-space pressure that
// used to justify hiding font-size controls on phones (and, before this
// pass, the theme select alongside it) doesn't apply inside a modal —
// the user's own call, explicitly re-confirmed when this moved rather
// than carried over by default. Code Font (`@AppStorage("codeFont")`) is
// a genuine dead control in the shipped Swift app, not something to
// preserve "in spirit" — grepped the whole Swift tree and `codeFont` is
// read nowhere outside `AppearancePrefsView.swift` itself;
// `mdviewer-base.css`'s `--code-font` is a fixed fallback stack (`Menlo,
// "SF Mono", "JetBrains Mono", monospace`), never a CSS variable any
// Swift code sets from this preference. Flagged per the working
// agreement ("if the Swift does something that looks wrong, say so")
// rather than silently ported as if it worked, and not silently fixed
// into working either — that would be a real feature add, out of scope
// here.
//
// Privacy was the first tab made real (a prior pass): `RemoteContentPolicy`
// (Ask/Always/Never) already has real Rust-side persistence
// (`remote_content_policy.txt` in the app config dir) from the earlier
// `set_remote_content_policy_always` command — this adds the general
// 3-way `get_remote_content_policy`/`set_remote_content_policy` pair this
// picker actually needs (that older command only ever wrote "always",
// for a different not-yet-built caller — the remote-content prompt's
// "Always Allow" button).

import type { RemoteContentPolicy } from "./remote.js";
import { escapeHtml } from "./dom.js";
import { themes, type MarkdownTheme } from "./markdownTheme.js";
import { aboutPaneHTML } from "./aboutPanel.js";

export type PrefsTab = "general" | "appearance" | "privacy" | "about";

const TABS: { id: PrefsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "privacy", label: "Privacy" },
    // 2026-10-17 — the port's home for v1.2.1's About-panel credits; see
    // aboutPanel.ts.
    { id: "about", label: "About" },
];

const POLICY_OPTIONS: { id: RemoteContentPolicy; label: string }[] = [
    { id: "ask", label: "Ask each time" },
    { id: "always", label: "Always load" },
    { id: "never", label: "Never (block)" },
];

const PRIVACY_EXPLANATION =
    "Markdown files can reference images hosted online. Loading one reveals your IP address " +
    "(and that you opened the document) to that server. “Ask” blocks them and prompts " +
    "you per document; “Never” blocks them silently with no prompts.";

function policyOptionsHTML(selected: RemoteContentPolicy): string {
    return POLICY_OPTIONS.map((o) => {
        const sel = o.id === selected ? " selected" : "";
        return `<option value="${o.id}"${sel}>${escapeHtml(o.label)}</option>`;
    }).join("");
}

function themeOptionsHTML(selectedThemeId: string): string {
    return themes
        .map((theme) => {
            const selected = theme.id === selectedThemeId ? " selected" : "";
            return `<option value="${theme.id}"${selected}>${theme.displayName}</option>`;
        })
        .join("");
}

function tabsHTML(activeTab: PrefsTab): string {
    return TABS.map((t) => {
        const active = t.id === activeTab ? " active" : "";
        return `<button type="button" class="prefs-tab${active}" data-tab="${t.id}">${t.label}</button>`;
    }).join("");
}

/** Renders the modal's full structure once — tab switching afterward only
 * toggles CSS classes (attachPreferencesHandlers), it doesn't re-render.
 * `initialThemeId`/`initialFontSize` come from the same `RenderViewModel`
 * instance main.ts's `createRenderViewModel` builds — this module has no
 * theme/font-size state of its own, same as it has none for `initialPolicy`. */
export function renderPreferences(
    root: HTMLElement,
    initialPolicy: RemoteContentPolicy,
    initialThemeId: string,
    initialFontSize: number,
    activeTab: PrefsTab = "general",
): void {
    root.innerHTML = `
        <div class="prefs-overlay">
            <div class="prefs-panel" role="dialog" aria-label="Preferences">
                <button type="button" class="prefs-close" aria-label="Close">×</button>
                <div class="prefs-tabs">${tabsHTML(activeTab)}</div>
                <div class="prefs-content">
                    <div class="prefs-pane${activeTab === "general" ? " active" : ""}" data-pane="general">
                        <p class="prefs-placeholder">Not available yet.</p>
                    </div>
                    <div class="prefs-pane${activeTab === "appearance" ? " active" : ""}" data-pane="appearance">
                        <label class="prefs-field">
                            <span>Theme</span>
                            <select data-action="theme">${themeOptionsHTML(initialThemeId)}</select>
                        </label>
                        <div class="prefs-field">
                            <span>Font size</span>
                            <span class="segmented-control">
                                <button type="button" data-action="font-decrease" aria-label="Decrease font size">A−</button>
                                <button type="button" data-action="font-reset" aria-label="Reset font size" data-font-size>${initialFontSize}</button>
                                <button type="button" data-action="font-increase" aria-label="Increase font size">A+</button>
                            </span>
                        </div>
                    </div>
                    <div class="prefs-pane${activeTab === "privacy" ? " active" : ""}" data-pane="privacy">
                        <label class="prefs-field">
                            <span>Internet images &amp; resources</span>
                            <select data-action="policy">${policyOptionsHTML(initialPolicy)}</select>
                        </label>
                        <p class="prefs-explanation">${PRIVACY_EXPLANATION}</p>
                    </div>
                    <div class="prefs-pane${activeTab === "about" ? " active" : ""}" data-pane="about">${aboutPaneHTML()}</div>
                </div>
            </div>
        </div>
    `;
}

export function showPreferences(root: HTMLElement): void {
    root.hidden = false;
}

export function hidePreferences(root: HTMLElement): void {
    root.hidden = true;
}

export function updatePreferencesPolicy(root: HTMLElement, policy: RemoteContentPolicy): void {
    const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]');
    if (select) select.value = policy;
}

export function updatePreferencesTheme(root: HTMLElement, themeId: string): void {
    const select = root.querySelector<HTMLSelectElement>('select[data-action="theme"]');
    if (select) select.value = themeId;
}

export function updatePreferencesFontSize(root: HTMLElement, fontSize: number): void {
    const el = root.querySelector<HTMLElement>("[data-font-size]");
    if (el) el.textContent = String(fontSize);
}

export interface PreferencesCallbacks {
    onPolicyChange: (policy: RemoteContentPolicy) => void;
    onThemeChange: (theme: MarkdownTheme) => void;
    onFontDecrease: () => void;
    onFontReset: () => void;
    onFontIncrease: () => void;
    onClose: () => void;
}

/** Event delegation on `root`, same reasoning as every other
 * `attach*Handlers` in this port. Handles tab switching (toggling
 * `.active` on the clicked tab/pane pair), the close button, clicking the
 * overlay backdrop itself (but not the panel — a click that starts and
 * ends on the panel shouldn't close it), and — since 2026-09-14/15's
 * Phase 6 move — the Appearance tab's font-size buttons, same
 * data-action dispatch toolbar.ts used to do for these before they moved
 * here. */
export function attachPreferencesHandlers(root: HTMLElement, callbacks: PreferencesCallbacks): void {
    root.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const tabButton = target.closest<HTMLElement>("button[data-tab]");
        if (tabButton?.dataset.tab) {
            const tab = tabButton.dataset.tab;
            root.querySelectorAll<HTMLElement>(".prefs-tab").forEach((el) => {
                el.classList.toggle("active", el.dataset.tab === tab);
            });
            root.querySelectorAll<HTMLElement>(".prefs-pane").forEach((el) => {
                el.classList.toggle("active", el.dataset.pane === tab);
            });
            return;
        }

        if (target.closest(".prefs-close")) {
            callbacks.onClose();
            return;
        }

        if (target.classList.contains("prefs-overlay")) {
            callbacks.onClose();
            return;
        }

        const actionButton = target.closest<HTMLElement>("button[data-action]");
        switch (actionButton?.dataset.action) {
            case "font-decrease":
                callbacks.onFontDecrease();
                break;
            case "font-reset":
                callbacks.onFontReset();
                break;
            case "font-increase":
                callbacks.onFontIncrease();
                break;
        }
    });

    root.addEventListener("change", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (target.dataset.action === "theme") {
            const theme = themes.find((t) => t.id === target.value);
            if (theme) callbacks.onThemeChange(theme);
            return;
        }
        if (target.dataset.action !== "policy") return;
        callbacks.onPolicyChange(target.value as RemoteContentPolicy);
    });
}
