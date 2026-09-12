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
// Scoped down like every other Milestone E slice: General and Appearance
// tabs are present (matching Swift's tab order and default selection —
// `@State private var selectedTab: Tab = .general`) but show a plain,
// honest placeholder instead of real controls, not fake ones that would
// silently do nothing. Reasons, not oversights:
//   - General: `restoreLastFile`/`autoReload` have no corresponding
//     "disable" hook on the Rust side yet — `restore_last_opened_document`
//     and `watch_file` (src-tauri/src/lib.rs) run unconditionally, so a
//     toggle here would have nothing to control. PDF page size *is*
//     already implemented (`renderViewModel.ts`'s `setPDFPageSize`) but
//     wiring one more control into this pass was scoped out to keep this
//     change to Privacy, the one tab with a real, ready-to-use backing
//     command pair.
//   - Appearance: Theme and Font Size already live in the toolbar
//     (toolbar.ts) — Swift really does duplicate both there isn't a
//     reason to duplicate the *implementation* here too; a future pass
//     can point this tab's controls at the same shared `RenderViewModel`
//     instance rather than reimplementing. Code Font
//     (`@AppStorage("codeFont")`) is a genuine dead control in the
//     shipped Swift app, not something to preserve "in spirit" — grepped
//     the whole Swift tree and `codeFont` is read nowhere outside
//     `AppearancePrefsView.swift` itself; `mdviewer-base.css`'s
//     `--code-font` is a fixed fallback stack
//     (`Menlo, "SF Mono", "JetBrains Mono", monospace`), never a CSS
//     variable any Swift code sets from this preference. Flagged per the
//     working agreement ("if the Swift does something that looks wrong,
//     say so") rather than silently ported as if it worked, and not
//     silently fixed into working either — that would be a real feature
//     add, out of scope here.
//
// Privacy is the one tab that's genuinely ready: `RemoteContentPolicy`
// (Ask/Always/Never) already has real Rust-side persistence
// (`remote_content_policy.txt` in the app config dir) from the earlier
// `set_remote_content_policy_always` command — this adds the general
// 3-way `get_remote_content_policy`/`set_remote_content_policy` pair this
// picker actually needs (that older command only ever wrote "always",
// for a different not-yet-built caller — the remote-content prompt's
// "Always Allow" button).

import type { RemoteContentPolicy } from "./remote.js";
import { escapeHtml } from "./dom.js";

export type PrefsTab = "general" | "appearance" | "privacy";

const TABS: { id: PrefsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "privacy", label: "Privacy" },
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

function tabsHTML(activeTab: PrefsTab): string {
    return TABS.map((t) => {
        const active = t.id === activeTab ? " active" : "";
        return `<button type="button" class="prefs-tab${active}" data-tab="${t.id}">${t.label}</button>`;
    }).join("");
}

/** Renders the modal's full structure once — tab switching afterward only
 * toggles CSS classes (attachPreferencesHandlers), it doesn't re-render. */
export function renderPreferences(root: HTMLElement, initialPolicy: RemoteContentPolicy, activeTab: PrefsTab = "general"): void {
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
                        <p class="prefs-placeholder">Not available yet — use the toolbar's font size and theme controls.</p>
                    </div>
                    <div class="prefs-pane${activeTab === "privacy" ? " active" : ""}" data-pane="privacy">
                        <label class="prefs-field">
                            <span>Internet images &amp; resources</span>
                            <select data-action="policy">${policyOptionsHTML(initialPolicy)}</select>
                        </label>
                        <p class="prefs-explanation">${PRIVACY_EXPLANATION}</p>
                    </div>
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

export interface PreferencesCallbacks {
    onPolicyChange: (policy: RemoteContentPolicy) => void;
    onClose: () => void;
}

/** Event delegation on `root`, same reasoning as sidebar.ts/toolbar.ts.
 * Handles tab switching (toggling `.active` on the clicked tab/pane pair),
 * the close button, and clicking the overlay backdrop itself (but not the
 * panel — a click that starts and ends on the panel shouldn't close it). */
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
        }
    });

    root.addEventListener("change", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "policy") return;
        callbacks.onPolicyChange(target.value as RemoteContentPolicy);
    });
}
