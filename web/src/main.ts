// The real entry point once bundled: wires createMDViewerApi and
// attachInteractionListeners to the actual vendor globals renderer.html
// loads (marked, DOMPurify, katex, mermaid, window.__shikiReady) and
// assigns the result to window.MDViewer — matching what mdviewer.js's own
// IIFE does implicitly, being the vendor-globals-having page's own script.
//
// Not used by any test — tests exercise the individual modules directly,
// with real pinned packages or mocks as appropriate (see each module's own
// test file). index.ts stays the library-style barrel export for that;
// this file is esbuild's actual bundle entry point (see package.json's
// `build` script) specifically so index.ts can stay side-effect-free.
//
// `onLinkClicked` calls the real `handle_link_click` Tauri command (see
// plan.md's Milestone A "Command/event bridge" item) via the global
// `window.__TAURI__.core.invoke` — `tauri.conf.json` already has
// `app.withGlobalTauri: true`, so this needs no `@tauri-apps/api` npm
// dependency, consistent with this port's "vendor libraries stay pinned
// globals" convention for marked/Shiki/KaTeX/Mermaid/DOMPurify.
//
// `onScroll`/`onLinkHovered` and `setContent`'s returned `blockedRemoteCount`
// stay unconsumed here — not an oversight, there's nothing to hand them to
// yet: no status bar for hover text or scroll position, and no
// remote-content prompt UI to trigger `set_remote_content_policy_always`
// from. Toolbar itself is the same story (Milestone E, not built).
//
// What *is* wired here: `#welcome`/`#content` toggling (appShell.ts) and
// the in-app file browser (fileBrowser.ts) — the latter replaced a TOC
// sidebar this same module used to wire (sidebar.ts, deleted 2026-09-14/15
// per the user's own call: file browsing is this app's one drawer now,
// not a second feature alongside it). Guarded on the relevant
// `app.html`-only elements actually existing — `renderer.html` stays the
// minimal content-only page it always was (no `#welcome`, no
// `#file-browser`), even after Milestone D's flip made this bundle the
// real `mdviewer.js` for both pages, so this wiring is a safe no-op there
// rather than assuming which page is loaded.
//
// That lookup runs on DOMContentLoaded, not at top level — this script
// is a plain `<script src="mdviewer.js">` in `<head>` (same as
// renderer.html's), which executes synchronously during head-parsing,
// before `<body>` (and so `#welcome`/`#content`) exists at all. A real
// bug caught by actually looking at the running app, not by its own unit
// tests or a clean unified-log read: `document.getElementById` returning
// `null` there isn't an error, so nothing flagged it — the welcome
// screen just silently never went away once a document loaded, on
// *either* page, since the lookup always failed regardless of which one
// was open.

import { createMDViewerApi, type MarkedLike } from "./mdviewerApi.js";
import { attachInteractionListeners } from "./interactionListeners.js";
import { showContent, showWelcome } from "./appShell.js";
import { wireErrorForwarding } from "./errorForwarding.js";
import { updateAboutVersion } from "./aboutPanel.js";
import { closeDrawer, openDrawer, toggleDrawer } from "./drawer.js";
import { renderToolbar, attachToolbarHandlers } from "./toolbar.js";
import { wireToolbarAutoHide, type AutoHideSource } from "./toolbarAutoHide.js";
import {
    renderPreferences,
    showPreferences,
    hidePreferences,
    updatePreferencesPolicy,
    updatePreferencesTheme,
    updatePreferencesFontSize,
    attachPreferencesHandlers,
} from "./preferences.js";
import {
    searchFromStart,
    searchNext,
    renderSearchBar,
    showSearchBar,
    hideSearchBar,
    attachSearchBarHandlers,
} from "./search.js";
import {
    renderFileBrowser,
    attachFileBrowserHandlers,
    loadCachedFolder,
    storeCachedFolder,
    diffFolderEntries,
    type FileBrowserEntry,
} from "./fileBrowser.js";
import {
    renderPermissions,
    attachPermissionsHandlers,
    showPermissions,
    hidePermissions,
    hasSeenPermissionsPrompt,
    markPermissionsPromptSeen,
    type GrantedFolder,
} from "./permissions.js";
import { RenderViewModel } from "./renderViewModel.js";
import type { DOMPurifyLike } from "./sanitize.js";
import type { KatexLike } from "./math.js";
import type { MermaidLike } from "./mermaid.js";
import type { ShikiHighlighterLike } from "./highlightCode.js";
import type { RemoteContentPolicy } from "./remote.js";

declare global {
    interface Window {
        marked: MarkedLike;
        DOMPurify: DOMPurifyLike;
        katex: KatexLike;
        mermaid: MermaidLike;
        __shikiReady?: Promise<ShikiHighlighterLike>;
        MDViewer: ReturnType<typeof createMDViewerApi>;
        __TAURI__: {
            core: {
                invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
            };
            app: {
                getVersion(): Promise<string>;
            };
        };
        /** Non-standard, deprecated, not in `lib.dom.d.ts` — see search.ts's
         * header for why this port still uses it. */
        find(
            searchString: string,
            caseSensitive?: boolean,
            backwards?: boolean,
            wrapAround?: boolean,
            wholeWord?: boolean,
            searchInFrames?: boolean,
            showDialog?: boolean,
        ): boolean;
    }
}

// First thing, so an error anywhere below still reaches the native debug
// log (see errorForwarding.ts). Errors thrown while the vendor <script>s
// ahead of this one load can't be caught here — they ran before this
// file did — and catching them would need an earlier inline script,
// which the CSP rightly forbids.
wireErrorForwarding(window, (message) => window.__TAURI__.core.invoke("log_frontend_error", { message }));

window.MDViewer = createMDViewerApi({
    marked: window.marked,
    domPurify: window.DOMPurify,
    katex: window.katex,
    mermaid: window.mermaid,
    shikiReady: window.__shikiReady,
});

function wireWelcomeContentToggle(): void {
    const welcomeEl = document.getElementById("welcome");
    const contentEl = document.getElementById("content");
    if (!welcomeEl || !contentEl) return;

    const elements = { welcome: welcomeEl, content: contentEl };
    showWelcome(elements); // initial state — matches app.html's static hidden attributes
    const rawSetContent = window.MDViewer.setContent.bind(window.MDViewer);
    window.MDViewer.setContent = async (markdown) => {
        const result = await rawSetContent(markdown);
        showContent(elements);
        return result;
    };

    // The welcome screen's own Open button (app.html, 2026-09-10 mobile
    // UX pass) — same command toolbar.ts's Open button invokes. Wired
    // here rather than in wireToolbar() since #welcome is independent of
    // the toolbar existing at all (this function runs first in
    // wireUIShell(), matching #welcome's own always-present markup).
    welcomeEl.querySelector('[data-action="open"]')?.addEventListener("click", () => {
        void window.__TAURI__.core.invoke("open_document_command");
    });
}


const THEME_STORAGE_KEY = "mdviewer.themeId";
const FONT_SIZE_STORAGE_KEY = "mdviewer.fontSize";

// localStorage, not a Tauri command/store plugin: this is per-webview UI
// preference state, the same category `@AppStorage` is on Swift's side
// (renderViewModel.ts's own header comment names it as the thing being
// injected here). Wrapped in try/catch since a private-browsing-style
// context throwing on access is a real browser behavior worth surviving,
// even though none of desktop/mobile's webviews are known to do that here.
function loadStoredThemeId(): string | undefined {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}
function storeThemeId(id: string): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
        /* ignore */
    }
}
function loadStoredFontSize(): number | undefined {
    try {
        const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
        return raw === null ? undefined : Number(raw);
    } catch {
        return undefined;
    }
}
function storeFontSize(size: number): void {
    try {
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
    } catch {
        /* ignore */
    }
}

/**
 * Constructs the one `RenderViewModel` instance this app uses, applying the
 * stored (or system-derived) theme/font-size before any document loads —
 * matches `MarkdownRenderView`'s `onAppear` calling
 * `applyCurrentThemeAndFontSize` and its `.onChange(of: colorScheme)`
 * calling `applySystemAppearance`.
 *
 * Extracted out of `wireToolbar` 2026-09-14/15 (file-browser plan's
 * Phase 6): once font-size/theme controls moved out of the toolbar and
 * into Preferences' Appearance tab, `wireToolbar` was no longer the only
 * consumer of this instance — `wirePreferences` needed it too, so
 * construction moved up to `wireUIShell`, called once, and handed to both.
 */
function createRenderViewModel(): RenderViewModel {
    const renderVM = new RenderViewModel({
        renderer: window.MDViewer,
        getRemoteContentPolicy: () => "ask",
        loadStoredThemeId,
        storeThemeId,
        loadStoredFontSize,
        storeFontSize,
    });
    renderVM.applyCurrentThemeAndFontSize();

    // Ported from MarkdownRenderView's `.onChange(of: colorScheme)` calling
    // `renderVM.applySystemAppearance(isDark:)` — a real gap found live on
    // triton's first-ever launch (fresh install, no stored theme yet):
    // without this, a system-dark-mode device still opened on GitHub Light,
    // since RenderViewModel's constructor only ever reads a *stored* theme
    // id and otherwise defaults to githubLight, with nothing to consult the
    // system's actual appearance. Only swaps between the two GitHub themes
    // specifically (matches Swift's own narrow behavior, see
    // `applySystemAppearance`'s doc comment) — a user who's picked
    // Dracula/Nord/etc. isn't silently overridden.
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    renderVM.applySystemAppearance(darkModeQuery.matches);
    // Live updates too, matching Swift's reactive `colorScheme` environment
    // value — not just the one-time check above. This only updates
    // `renderVM` itself; whichever UI displays the theme (wirePreferences'
    // Appearance tab, since the toolbar no longer does) keeps its own
    // display in sync with a separate listener of its own.
    darkModeQuery.addEventListener("change", (e) => {
        renderVM.applySystemAppearance(e.matches);
    });

    return renderVM;
}

/**
 * Ported from `PreferencesView`/`GeneralPrefsView`/`AppearancePrefsView`
 * (see preferences.ts's own header for the full scoping story). Renders
 * once at startup, same "render once, update in place" pattern as
 * toolbar/fileBrowser — `open()` doesn't re-render, it just fetches the
 * current policy (Rust owns that state, unlike theme/font-size which live
 * in this page's own `localStorage` via `renderVM`) and reveals the
 * already-built panel.
 *
 * `renderVM` is the one instance `createRenderViewModel` builds
 * (`wireUIShell`) — Appearance tab wiring moved here 2026-09-14/15
 * (file-browser plan's Phase 6) from `wireToolbar`, which used to own
 * both the instance and its toolbar-row UI.
 *
 * Returns `undefined` on `renderer.html` (no `#preferences` element
 * there), same guard-and-no-op pattern every other `wire*` function uses.
 */
function wirePreferences(renderVM: RenderViewModel): { open: () => void } | undefined {
    const prefsEl = document.getElementById("preferences");
    if (!prefsEl) return undefined;

    // "ask" is a placeholder default — open() below fetches the real
    // policy before showing; renderVM's theme/font-size are real from
    // the start, since that state already lives in localStorage.
    renderPreferences(prefsEl, "ask", renderVM.theme.id, renderVM.fontSize);
    void window.__TAURI__.app.getVersion().then((version) => updateAboutVersion(prefsEl, version));
    attachPreferencesHandlers(prefsEl, {
        onClose: () => hidePreferences(prefsEl),
        onPolicyChange: (policy) => {
            void window.__TAURI__.core.invoke("set_remote_content_policy", { policy });
        },
        onThemeChange: (theme) => {
            renderVM.setTheme(theme);
        },
        onFontDecrease: () => {
            renderVM.decreaseFontSize();
            updatePreferencesFontSize(prefsEl, renderVM.fontSize);
        },
        onFontReset: () => {
            renderVM.resetFontSize();
            updatePreferencesFontSize(prefsEl, renderVM.fontSize);
        },
        onFontIncrease: () => {
            renderVM.increaseFontSize();
            updatePreferencesFontSize(prefsEl, renderVM.fontSize);
        },
    });

    // Keeps the displayed theme in sync with system dark-mode changes made
    // while this panel may not be open — createRenderViewModel's own
    // listener already updates renderVM itself; this one only updates
    // what's on screen here.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        updatePreferencesTheme(prefsEl, renderVM.theme.id);
    });

    return {
        open: () => {
            void window.__TAURI__.core.invoke("get_remote_content_policy").then((policy) => {
                updatePreferencesPolicy(prefsEl, policy as RemoteContentPolicy);
            });
            showPreferences(prefsEl);
        },
    };
}

/**
 * Ported from `SearchBarView.swift` — see search.ts's own header for the
 * find-in-page deviation this rests on. `window` satisfies
 * `FindInPageWindow` structurally (the `find` augmentation above,
 * `getSelection` from `lib.dom.d.ts`) without a cast.
 *
 * Returns `undefined` on `renderer.html`, same guard-and-no-op pattern
 * every other `wire*` function uses.
 */
function wireSearch(): { open: () => void } | undefined {
    const searchEl = document.getElementById("search");
    if (!searchEl) return undefined;

    renderSearchBar(searchEl);
    attachSearchBarHandlers(searchEl, {
        onQueryChange: (query) => {
            searchFromStart(window, query);
        },
        onSubmit: (query) => {
            searchNext(window, query);
        },
        onClose: () => {
            hideSearchBar(searchEl);
        },
    });

    return {
        open: () => {
            showSearchBar(searchEl);
        },
    };
}

/**
 * Ported from `MDViewerApp.swift`'s `CommandGroup` — Cmd+F (Ctrl+F on
 * Windows/Linux) posts `.showSearchBar` there; this is the same shortcut,
 * done at the page level since this port has no native menu equivalent
 * to attach it to that would also reach mobile (see toolbar.ts's header
 * for why the Find *button* exists at all — this is purely a desktop
 * nicety alongside it, not required for the feature to work).
 */
function wireGlobalShortcuts(search: { open: () => void } | undefined): void {
    document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            search?.open();
        }
    });
}

/**
 * Ported from `MainToolbar.swift`, scoped down — see toolbar.ts's header
 * comment for what's deliberately not here (Editor toggle, Save, Export,
 * and — since 2026-09-14/15's Phase 6 — theme/font-size, moved to
 * Preferences' Appearance tab, and the TOC sidebar toggle, gone along
 * with the feature it opened).
 */
function wireToolbar(
    preferences: { open: () => void } | undefined,
    search: { open: () => void } | undefined,
    fileBrowser: { toggle: () => void } | undefined,
): void {
    const toolbarEl = document.getElementById("toolbar");
    if (!toolbarEl) return;

    renderToolbar(toolbarEl);
    toolbarEl.hidden = false;

    // Real bug, found in the 2026-09-10 mobile UX pass, not a Swift-parity
    // concern (SearchBarView.swift has no equivalent layout at all — see
    // search.ts's header): app.css's `#search` floats via `position:
    // absolute; top: 8px` inside `#main`, which starts at the exact same
    // y-coordinate as `#toolbar`'s own top (toolbar is `#main`'s first
    // flow child). `top: 8px` only ever cleared the toolbar by accident,
    // back when the toolbar was one short row — the mobile status-bar
    // clearance padding added earlier this same pass made the toolbar
    // taller, and the search bar started rendering entirely underneath
    // it: still `hidden: false`, still focusable, completely invisible
    // and untappable. `--toolbar-h` mirrors the toolbar's real measured
    // height (it already varies by breakpoint — mobile's extra
    // padding-top, `overflow-x: auto` never changes it) so `#search`'s
    // CSS can sit reliably just below it instead of guessing a fixed
    // number that only happens to work at one width. Re-measured on
    // resize since crossing the 768px breakpoint (or just rotating a
    // phone) changes the toolbar's own height.
    const syncToolbarHeightVar = () => {
        document.documentElement.style.setProperty("--toolbar-h", `${toolbarEl.getBoundingClientRect().height}px`);
    };
    syncToolbarHeightVar();
    window.addEventListener("resize", syncToolbarHeightVar);

    // Fixed + auto-fading toolbar, phone widths only (2026-09-11 mobile
    // UX pass, the user's own spec) — see app.css's own `.toolbar-faded`
    // comment for why the toolbar needs this at all once it's
    // `position: fixed`. `#main`'s own scroll covers ordinary reading;
    // `window.visualViewport`'s `resize`/`scroll` are what actually fire
    // for pinch-zoom and panning while zoomed — plain `window`/`document`
    // scroll/resize don't see those gestures at all. `visualViewport` can
    // be absent in a minimal WebView, hence the guard — ordinary scroll
    // still wakes the toolbar either way.
    const mainEl = document.getElementById("main");
    if (mainEl) {
        const autoHideSources: AutoHideSource[] = [{ target: mainEl, type: "scroll" }];
        if (window.visualViewport) {
            autoHideSources.push({ target: window.visualViewport, type: "resize" }, { target: window.visualViewport, type: "scroll" });
        }
        wireToolbarAutoHide(
            toolbarEl,
            autoHideSources,
            window.matchMedia("(max-width: 768px)"),
            undefined,
            () => mainEl.scrollHeight > mainEl.clientHeight,
        );
    }

    attachToolbarHandlers(toolbarEl, {
        onOpen: () => {
            void window.__TAURI__.core.invoke("open_document_command");
        },
        onPreferences: () => {
            preferences?.open();
        },
        onFind: () => {
            search?.open();
        },
        onToggleFileBrowser: () => {
            fileBrowser?.toggle();
        },
    });
}

/** What `list_directory` (src-tauri/src/lib.rs) returns. `path` is the
 * *canonical* form of whatever was listed, which is what the folder cache
 * keys off — never the path the frontend asked with, so a symlink or a
 * trailing slash can't produce a second cache entry for one real folder. */
interface DirListing {
    path: string;
    /** The parent folder, only when it's browsable too — `null` at the top
     * of a grant or of an ungranted document's folder, which hides the
     * "up one level" row instead of offering a dead end (2026-10-17). */
    parent: string | null;
    entries: { name: string; is_dir: boolean }[];
}

/** Rust returns `is_dir` (snake_case, serde's default); the frontend's own
 * type is `isDir`. Converting here, at the boundary, keeps the wire format
 * out of every module downstream. */
function toEntries(listing: DirListing): FileBrowserEntry[] {
    return listing.entries.map((e) => ({ name: e.name, isDir: e.is_dir }));
}

/** Joins a directory path with a child's name. Lives here rather than in
 * fileBrowser.ts deliberately — that module never does path arithmetic (see
 * its own header); this is the one place that knows a real path at all.
 * Separator is inferred from the path itself rather than assumed: Windows
 * paths come back with backslashes, and hardcoding "/" would silently
 * produce broken paths there. */
function joinPath(dir: string, name: string): string {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** The parent of `path`, or `null` at a root (no separator left to cut, or
 * only the leading one). `null` is what tells fileBrowser.ts to omit its
 * up-navigation row. */
function parentPath(path: string): string | null {
    const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
    const idx = path.lastIndexOf(sep);
    if (idx <= 0) return null;
    return path.slice(0, idx);
}

/**
 * The in-app file browser (fileBrowser.ts), 2026-09-12 — this app's one
 * drawer since 2026-09-14/15, when the TOC sidebar it used to share
 * mutual-exclusivity with was dropped entirely (the user's own call: file
 * browsing replaces it, not a second feature alongside it). This is
 * where the `invoke` calls live — the module itself stays invoke-free so
 * it can be unit-tested without mocking Tauri, the same tested/untested
 * boundary every other `wire*` function here draws.
 *
 * Cache-then-refresh on every open: a cached listing renders immediately
 * (so revisiting a folder is instant, the user's own ask), and the live
 * `list_directory` call replaces it when it lands. That also covers
 * refresh-on-reopen for free — every open re-fetches, so a folder whose
 * contents changed on disk updates the next time it's looked at
 * (file-browser plan's Phase 5 adds a diff so an unchanged reopen skips
 * the redundant re-render).
 *
 * Returns a `toggle()` handle for the toolbar button.
 */
function wireFileBrowser(): { toggle: () => void; openTo: (path: string | null) => void } | undefined {
    const browserEl = document.getElementById("file-browser");
    if (!browserEl) return undefined;
    const backdropEl = document.getElementById("file-browser-backdrop");

    // The element ships `hidden` so it can't flash before this wiring runs,
    // but from here its visibility is the `.open` class's job alone (the
    // drawer slides in via transform; `hidden` would override that with
    // `display: none` and make it permanently invisible). Caught on the
    // emulator: the drawer reported `open: true, hidden: true` — open by
    // class, undisplayable in fact.
    browserEl.hidden = false;

    // The folder currently being shown. `undefined` before the first
    // successful listing — which is also the "no document open yet, and no
    // folder granted" "case, since there is nothing to browse from.
    let currentPath: string | undefined;
    // Where the "up one level" row currently on screen leads — set at every
    // render that shows one, so tapping it always does what it displays.
    // `null` when no row is shown (see DirListing.parent).
    let upTarget: string | null = null;

    async function show(path: string | null): Promise<void> {
        // A cached hit renders first so the drawer is never blank while the
        // real call is in flight; on a miss we show the loading state
        // instead. Either way the live listing below replaces it.
        //
        // `path === null` (the default "current document's folder", whose
        // real path only Rust knows) has no cache key to look up, but it
        // still needs *something* on screen — an earlier version skipped
        // rendering entirely in that case, which left the drawer visibly
        // blank on its very first open, the one open guaranteed to take
        // this branch. Caught on the emulator: correct data, nothing drawn.
        const cached = path === null ? undefined : loadCachedFolder(path);
        // Only a guess until Rust answers (string arithmetic can't know
        // whether the parent is browsable) — compared below so a wrong
        // guess gets corrected even when the entries are unchanged.
        const guessedParent = path === null ? null : parentPath(path);
        upTarget = guessedParent;
        renderFileBrowser(browserEl!, {
            kind: cached ? "loaded" : "loading",
            path: path ?? "",
            parentPath: guessedParent,
            ...(cached ? { entries: cached } : {}),
        } as Parameters<typeof renderFileBrowser>[1]);

        try {
            const listing = (await window.__TAURI__.core.invoke("list_directory", { path })) as DirListing;
            const entries = toEntries(listing);
            currentPath = listing.path;
            upTarget = listing.parent;
            storeCachedFolder(listing.path, entries);
            // Phase 5: `cached` (captured above, before this call) is what
            // was already on screen — either from a cache hit, or nothing
            // (a "loading" state) on a miss. Skip the re-render when it's
            // unchanged: the cached render already shows these exact
            // entries, so redrawing would only flicker the list on every
            // single reopen for no visible difference. `cached === undefined`
            // still forces a render — either this is the very first listing
            // ever shown, or the pre-fetch state was "loading"/an error, and
            // either way there's nothing already-correct on screen to leave
            // alone.
            if (cached === undefined || diffFolderEntries(cached, entries) || guessedParent !== listing.parent) {
                renderFileBrowser(browserEl!, {
                    kind: "loaded",
                    path: listing.path,
                    parentPath: listing.parent,
                    entries,
                });
            }
        } catch (e) {
            // Rust's errors carry a stable `kind:` prefix
            // (not_found:/access_denied:/permission_denied:) — surfaced as-is
            // rather than flattened to "something went wrong", since which
            // one it is genuinely changes what the user should do next.
            const message = String(e);
            if (path === null) {
                // Only `not_found:` actually means "there is nothing to
                // browse yet" — that is what Rust returns when
                // DocumentBaseDir is unset. A permission or access error on
                // the default path is a real failure and must say so;
                // reporting it as "open a document first" sends the user to
                // do something that will not help. Caught on the emulator,
                // where /data/local/tmp is readable by the shell but not by
                // the app, and the resulting permission_denied was being
                // shown as the first-run message.
                upTarget = null;
                if (message.includes("not_found:")) {
                    renderFileBrowser(browserEl!, { kind: "no-document" });
                } else {
                    renderFileBrowser(browserEl!, {
                        kind: "error",
                        path: "",
                        parentPath: null,
                        message,
                    });
                }
            } else {
                // Usually the folder this was navigated from — browsable,
                // since its listing is how the user got here.
                upTarget = parentPath(path);
                renderFileBrowser(browserEl!, {
                    kind: "error",
                    path,
                    parentPath: upTarget,
                    message,
                });
            }
        }
    }

    attachFileBrowserHandlers(browserEl, {
        onOpenFile: (name) => {
            if (!currentPath) return;
            void window.__TAURI__.core.invoke("handle_link_click", {
                href: `file://${joinPath(currentPath, name)}`,
            });
            // "Moves away when selected" (the user's own words, from when
            // this rule was first written for the TOC drawer) — a document
            // is now open, so the browser has served its purpose for this
            // interaction.
            closeDrawer(browserEl, backdropEl);
        },
        onNavigate: (name) => {
            if (!currentPath) return;
            void show(joinPath(currentPath, name));
        },
        onUp: () => {
            if (upTarget) void show(upTarget);
        },
    });

    backdropEl?.addEventListener("click", () => {
        closeDrawer(browserEl, backdropEl);
    });

    return {
        toggle: () => {
            const opening = !browserEl.classList.contains("open");
            if (opening) {
                // Re-fetch on every open, not just the first — this is what
                // picks up files added or removed on disk since last time.
                void show(currentPath ?? null);
            }
            toggleDrawer(browserEl, backdropEl);
        },
        // Unconditional open-and-show, as opposed to `toggle`: used right
        // after granting a folder (wirePermissions, below) for immediate
        // feedback, where the caller always wants the drawer visible and
        // pointed at a specific path, never toggled shut if it happened to
        // already be open.
        openTo: (path) => {
            void show(path);
            openDrawer(browserEl, backdropEl);
        },
    };
}

/**
 * The consolidated first-launch permissions prompt (permissions.ts),
 * 2026-09-12 — the user's own "a question that covers all the security
 * questions at once", shown once at first launch rather than interrupting
 * later, per their choice.
 *
 * Worth being precise about what this does: tapping "Choose a folder…"
 * calls `request_folder_access`, which presents the *OS* picker. This
 * dialog never grants anything itself — only the OS can — so a granted
 * folder appearing in the list is the result of the real grant having
 * succeeded, not of the user having agreed to something here.
 *
 * **Opens the file browser to the grant, 2026-10-03** — a real report:
 * granting a folder (e.g. one level above Downloads) produced no folder
 * view at all, since nothing here ever showed one — this modal only ever
 * updated its own "folders you've granted" list. Takes the file-browser
 * handle so a successful grant can hand straight off to it, pointed at the
 * exact path just granted (the last entry in the re-read, authoritative
 * `list_granted_folders` result — `grant_folder_access` always appends, so
 * that's the one that was just added, not a guess) rather than `null`'s
 * "current document" default, which would show the wrong folder, or
 * nothing at all, whenever this runs before any document is open — the
 * common case, since this prompt itself normally shows at first launch.
 */
function wirePermissions(fileBrowser: { toggle: () => void; openTo: (path: string | null) => void } | undefined): void {
    const permsEl = document.getElementById("permissions");
    if (!permsEl) return;

    let folders: GrantedFolder[] = [];
    let policy: RemoteContentPolicy = "ask";

    const rerender = () => renderPermissions(permsEl, { policy, folders });
    rerender();

    attachPermissionsHandlers(permsEl, {
        onGrantFolder: () => {
            void window.__TAURI__.core.invoke("request_folder_access").then((granted) => {
                if (!granted) return; // Cancelled, or the picker failed.
                // The command returns only success/failure, not the path, so
                // re-read the authoritative list rather than guessing at what
                // was added.
                void window.__TAURI__.core.invoke("list_granted_folders").then((paths) => {
                    folders = (paths as string[]).map((path) => ({ path }));
                    rerender();
                    const justGranted = folders[folders.length - 1]?.path;
                    if (justGranted) fileBrowser?.openTo(justGranted);
                });
            });
        },
        onPolicyChange: (next) => {
            policy = next;
            void window.__TAURI__.core.invoke("set_remote_content_policy", { policy: next });
        },
        onDone: () => {
            markPermissionsPromptSeen();
            hidePermissions(permsEl);
        },
    });

    if (!hasSeenPermissionsPrompt()) {
        // Seed from the real current state before showing, so a reinstall
        // that kept its grants doesn't claim to have none.
        void window.__TAURI__.core.invoke("get_remote_content_policy").then((current) => {
            policy = current as RemoteContentPolicy;
            rerender();
        });
        void window.__TAURI__.core.invoke("list_granted_folders").then((paths) => {
            folders = (paths as string[]).map((path) => ({ path }));
            rerender();
        });
        showPermissions(permsEl);
    }
}

function wireUIShell(): void {
    wireWelcomeContentToggle();
    const renderVM = createRenderViewModel();
    const preferences = wirePreferences(renderVM);
    const search = wireSearch();
    wireGlobalShortcuts(search);
    const fileBrowser = wireFileBrowser();
    wirePermissions(fileBrowser);
    wireToolbar(preferences, search, fileBrowser);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUIShell);
} else {
    // Defensive: only reachable if this script is ever loaded after body
    // parsing (e.g. moved out of <head> later) — wire immediately rather
    // than waiting for an event that already fired.
    wireUIShell();
}

attachInteractionListeners({
    onLinkClicked: (href) => {
        void window.__TAURI__.core.invoke("handle_link_click", { href });
    },
});
