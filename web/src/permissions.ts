// New 2026-09-12 — the consolidated, first-launch permissions prompt. The
// user's own direction, redirecting the file-browser plan mid-
// implementation: "the security-scope handling should be a question to the
// user and handled before the filebrowser is invoked. Preferably with a
// question that covers all the security questions at once."
//
// No Swift source to port: the reference app asks nothing at launch and has
// no consolidated consent surface at all — its one privacy control
// (`RemoteContentPolicy`) lives buried in a Settings tab, and its folder
// access (`FolderAccessManager`) is granted implicitly by whatever
// `NSOpenPanel` the user happened to drive. Both of those are reasonable on
// a desktop app that can lean on a visible file dialog for consent; neither
// works on a phone, where the file browser this gates has no OS-level
// picker of its own to imply consent through (see `request_folder_access`'s
// own doc comment in src-tauri/src/lib.rs).
//
// **Important limitation this UI cannot paper over** (recorded here so a
// future reader doesn't mistake this dialog for the actual grant): an
// in-app consent dialog does not, by itself, grant filesystem access on
// iOS. Only the OS's own picker can hand the app a security-scoped URL. So
// this is a consent-and-explanation layer that *triggers* each platform's
// real grant mechanism (desktop: the already-working native folder picker
// behind `request_folder_access`; iOS: the native folder picker being built
// separately) — it is not a substitute for one, and "the user tapped Allow
// here" must never be treated as "the app now has access."
//
// Same module shape as every other feature here (toolbar.ts, preferences.ts,
// fileBrowser.ts): pure `render*()` plus `attach*Handlers(container,
// callbacks)`, zero `invoke` calls inside this file — those stay in main.ts's
// `wire*` glue, the untested-boundary line this codebase already draws
// everywhere else.

import type { RemoteContentPolicy } from "./remote.js";
import { escapeHtml } from "./dom.js";

const POLICY_OPTIONS: { id: RemoteContentPolicy; label: string }[] = [
    { id: "ask", label: "Ask each time" },
    { id: "always", label: "Always load" },
    { id: "never", label: "Never (block)" },
];

/** Shown as the dialog's own explanation of what a granted folder is for —
 * deliberately concrete about the *consequence* ("everything inside it"),
 * not just the capability, since a folder grant is recursive
 * (`folder_covers` is a `starts_with` subtree check on the Rust side) and
 * that is not obvious from the word "folder" alone. */
const FOLDER_EXPLANATION =
    "To browse and open documents, MDViewer needs access to a folder. Granting one lets it " +
    "read that folder and everything inside it — including images your documents reference. " +
    "Nothing outside a folder you grant is ever read.";

const REMOTE_EXPLANATION =
    "Markdown files can reference images hosted online. Loading one reveals your IP address " +
    "(and that you opened the document) to that server.";

export interface GrantedFolder {
    path: string;
}

export interface PermissionsState {
    policy: RemoteContentPolicy;
    folders: GrantedFolder[];
}

function policyOptionsHTML(selected: RemoteContentPolicy): string {
    return POLICY_OPTIONS.map(
        (option) =>
            `<option value="${option.id}"${option.id === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    ).join("");
}

function foldersHTML(folders: GrantedFolder[]): string {
    if (folders.length === 0) {
        return '<p class="permissions-no-folders">No folder granted yet.</p>';
    }
    const items = folders
        .map((folder) => `<li class="permissions-folder">${escapeHtml(folder.path)}</li>`)
        .join("");
    return `<ul class="permissions-folder-list">${items}</ul>`;
}

/**
 * One dialog, both questions — the user's "covers all the security
 * questions at once". Rendered fresh on each state change (folder granted,
 * policy changed) rather than surgically patched: this is a once-per-install
 * screen, so a wholesale re-render costs nothing and keeps the markup a
 * single source of truth, the same call `renderFileBrowser` already makes.
 */
export function renderPermissions(root: HTMLElement, state: PermissionsState): void {
    root.innerHTML = `
        <div class="permissions-overlay">
            <div class="permissions-panel" role="dialog" aria-label="Permissions">
                <h2 class="permissions-title">Before you start</h2>
                <p class="permissions-intro">MDViewer asks for everything it needs up front, once. You can change any of this later in Settings.</p>

                <section class="permissions-section">
                    <h3>Folder access</h3>
                    <p class="permissions-explanation">${escapeHtml(FOLDER_EXPLANATION)}</p>
                    ${foldersHTML(state.folders)}
                    <button type="button" class="permissions-grant-btn" data-action="grant-folder">Choose a folder…</button>
                </section>

                <section class="permissions-section">
                    <h3>Internet images &amp; resources</h3>
                    <p class="permissions-explanation">${escapeHtml(REMOTE_EXPLANATION)}</p>
                    <label class="permissions-field">
                        <span>When a document references one</span>
                        <select data-action="policy">${policyOptionsHTML(state.policy)}</select>
                    </label>
                </section>

                <button type="button" class="permissions-done-btn" data-action="done">Done</button>
            </div>
        </div>
    `;
}

export interface PermissionsCallbacks {
    /** "Choose a folder…" — triggers the platform's real grant mechanism
     * (main.ts's wiring decides which; this module never invokes anything
     * itself). */
    onGrantFolder: () => void;
    onPolicyChange: (policy: RemoteContentPolicy) => void;
    /** "Done" — dismisses and marks the prompt as seen. */
    onDone: () => void;
}

export function attachPermissionsHandlers(root: HTMLElement, callbacks: PermissionsCallbacks): void {
    root.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLElement>("button[data-action]");
        if (!button) return;
        if (button.dataset.action === "grant-folder") {
            callbacks.onGrantFolder();
        } else if (button.dataset.action === "done") {
            callbacks.onDone();
        }
    });

    root.addEventListener("change", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "policy") return;
        const policy = POLICY_OPTIONS.find((option) => option.id === target.value);
        if (policy) callbacks.onPolicyChange(policy.id);
    });
}

export function showPermissions(root: HTMLElement): void {
    root.hidden = false;
}

export function hidePermissions(root: HTMLElement): void {
    root.hidden = true;
}

// ---- "Already asked" flag ----
//
// Same `mdviewer.<camelCaseName>` localStorage convention and try/catch
// discipline as every other stored value (main.ts's theme/font-size pairs,
// fileBrowser.ts's folder cache). Deliberately *not* stored on the Rust
// side alongside the real grants: this is a pure UI fact ("has this person
// seen the dialog"), not a security decision — treating a missing flag as
// "not yet seen" simply shows the prompt again, which is harmless, whereas
// anything security-relevant must be read from the actual grants
// (`GrantedFolders`/the bookmark store), never from a localStorage value a
// page could clear.

const PERMISSIONS_SEEN_KEY = "mdviewer.permissionsPromptSeen";

export function hasSeenPermissionsPrompt(): boolean {
    try {
        return localStorage.getItem(PERMISSIONS_SEEN_KEY) === "true";
    } catch {
        return false;
    }
}

export function markPermissionsPromptSeen(): void {
    try {
        localStorage.setItem(PERMISSIONS_SEEN_KEY, "true");
    } catch {
        /* ignore — same as every other store* in this app */
    }
}
