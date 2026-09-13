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
// the sidebar TOC (sidebar.ts) — both since `setContent`'s already the
// one thing with a real reason to fire, and `headings` was the other
// still-unconsumed piece of its return value. Guarded on the relevant
// `app.html`-only elements actually existing — `renderer.html` stays the
// minimal content-only page it always was (no `#welcome`, no `#sidebar`),
// even after Milestone D's flip made this bundle the real `mdviewer.js`
// for both pages, so this wiring is a safe no-op there rather than
// assuming which page is loaded.
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
import { renderTOC, attachTOCClickHandler } from "./sidebar.js";
import { closeDrawer, toggleDrawer } from "./drawer.js";
import { renderToolbar, attachToolbarHandlers, updateToolbarFontSize, updateToolbarTheme } from "./toolbar.js";
import { wireToolbarAutoHide, type AutoHideSource } from "./toolbarAutoHide.js";
import {
    renderPreferences,
    showPreferences,
    hidePreferences,
    updatePreferencesPolicy,
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

/**
 * Ported from `SidebarView`/`TableOfContentsView` — see sidebar.ts. Wraps
 * `setContent` the same way `wireWelcomeContentToggle` does (composes
 * fine: each wrap's "raw" is whatever the previous one already wrapped),
 * since `headings` is only available once `setContent` actually runs.
 * Renders the empty state immediately too, matching Swift's sidebar
 * being part of the layout before any document is open, not appearing
 * only once one is.
 *
 * Returns a `toggle()` handle for the toolbar's sidebar-toggle button
 * (wireToolbar below) — mobile-drawer behavior added 2026-09-10, see
 * sidebar.ts's own header and app.css's 768px-breakpoint note for the
 * full story. The actual open/close/toggle primitives live in drawer.ts
 * (generalized 2026-09-12 once the file browser needed the same
 * mechanism); `#sidebar-backdrop` not existing is not a guard-and-bail
 * condition the way `#sidebar` itself is: the backdrop is optional
 * (`closeDrawer`/`toggleDrawer` both accept `undefined`), so a page with a
 * sidebar but no backdrop element still gets a working drawer, just
 * without tap-outside-to-close.
 */
function wireSidebar(): { toggle: () => void; close: () => void } | undefined {
    const sidebarEl = document.getElementById("sidebar");
    if (!sidebarEl) return undefined;
    const backdropEl = document.getElementById("sidebar-backdrop");

    renderTOC(sidebarEl, []);
    attachTOCClickHandler(sidebarEl, (anchor) => {
        window.MDViewer.scrollToAnchor(anchor);
        // "Moves away when selected" (the user's own words) — a no-op
        // above app.css's drawer breakpoint, where .open does nothing.
        closeDrawer(sidebarEl, backdropEl);
    });
    backdropEl?.addEventListener("click", () => {
        closeDrawer(sidebarEl, backdropEl);
    });
    const rawSetContent = window.MDViewer.setContent.bind(window.MDViewer);
    window.MDViewer.setContent = async (markdown) => {
        const result = await rawSetContent(markdown);
        renderTOC(sidebarEl, result.headings);
        return result;
    };

    return {
        toggle: () => {
            toggleDrawer(sidebarEl, backdropEl);
        },
        // For drawer mutual exclusivity (wireUIShell) — both drawers slide
        // in from the left, so opening one must close the other.
        close: () => {
            closeDrawer(sidebarEl, backdropEl);
        },
    };
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
 * Ported from `PreferencesView`/`GeneralPrefsView`/`AppearancePrefsView`
 * (see preferences.ts's own header for the full scoping story — Privacy
 * is the only real tab this pass). Renders once at startup, same "render
 * once, update in place" pattern as sidebar/toolbar — `open()` doesn't
 * re-render, it just fetches the current policy (Rust owns that state,
 * unlike theme/font-size which live in this page's own `localStorage`)
 * and reveals the already-built panel.
 *
 * Returns `undefined` on `renderer.html` (no `#preferences` element
 * there), same guard-and-no-op pattern every other `wire*` function uses.
 */
function wirePreferences(): { open: () => void } | undefined {
    const prefsEl = document.getElementById("preferences");
    if (!prefsEl) return undefined;

    renderPreferences(prefsEl, "ask"); // placeholder default — open() below fetches the real value before showing
    attachPreferencesHandlers(prefsEl, {
        onClose: () => hidePreferences(prefsEl),
        onPolicyChange: (policy) => {
            void window.__TAURI__.core.invoke("set_remote_content_policy", { policy });
        },
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
 * comment for what's deliberately not here yet (Editor toggle, Save,
 * Export).
 *
 * First real caller of `renderViewModel.ts`'s `RenderViewModel` in this
 * port. Its `renderMarkdown()`/`getRemoteContentPolicy` are unused by this
 * call site on purpose, not an oversight: in this architecture, Rust's
 * `render_file` (src-tauri/src/lib.rs) already calls
 * `window.MDViewer.setContent` and pushes the remote-content policy
 * directly via `eval`, bypassing `RenderViewModel.renderMarkdown()`
 * entirely — unlike Swift, where `RenderViewModel` is the *only* path to
 * the WebView. Only `setTheme`/`setFontSize` (via `applyCurrentThemeAndFontSize`,
 * `increaseFontSize`/`decreaseFontSize`/`resetFontSize`) are actually
 * exercised here. `getRemoteContentPolicy` is still required by
 * `RenderViewModelDeps`'s type, so it's supplied as a real function that's
 * simply never called from this path, rather than an `as` cast to paper
 * over the mismatch.
 */
function wireToolbar(
    preferences: { open: () => void } | undefined,
    search: { open: () => void } | undefined,
    sidebar: { toggle: () => void } | undefined,
    fileBrowser: { toggle: () => void } | undefined,
): void {
    const toolbarEl = document.getElementById("toolbar");
    if (!toolbarEl) return;

    const renderVM = new RenderViewModel({
        renderer: window.MDViewer,
        getRemoteContentPolicy: () => "ask",
        loadStoredThemeId,
        storeThemeId,
        loadStoredFontSize,
        storeFontSize,
    });
    renderVM.applyCurrentThemeAndFontSize(); // matches MarkdownRenderView's onAppear, before any document loads

    // Ported from MarkdownRenderView's `.onChange(of: colorScheme)` calling
    // `renderVM.applySystemAppearance(isDark:)` — a real gap found live on
    // triton's first-ever launch (fresh install, no stored theme yet):
    // without this, a system-dark-mode device still opened on GitHub Light,
    // since RenderViewModel's constructor only ever reads a *stored* theme
    // id and otherwise defaults to githubLight, with nothing to consult the
    // system's actual appearance. `applySystemAppearance` itself already
    // existed (renderViewModel.ts) and is untouched — it was simply never
    // called from anywhere in this port until now. Only swaps between the
    // two GitHub themes specifically (matches Swift's own narrow behavior,
    // see `applySystemAppearance`'s doc comment) — a user who's picked
    // Dracula/Nord/etc. isn't silently overridden.
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    renderVM.applySystemAppearance(darkModeQuery.matches);

    renderToolbar(toolbarEl, renderVM.fontSize, renderVM.theme.id);
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
        wireToolbarAutoHide(toolbarEl, autoHideSources, window.matchMedia("(max-width: 768px)"));
    }

    // Live updates too, matching Swift's reactive `colorScheme` environment
    // value — not just the one-time check above.
    darkModeQuery.addEventListener("change", (e) => {
        renderVM.applySystemAppearance(e.matches);
        updateToolbarTheme(toolbarEl, renderVM.theme.id);
    });
    attachToolbarHandlers(toolbarEl, {
        onOpen: () => {
            void window.__TAURI__.core.invoke("open_document_command");
        },
        onFontDecrease: () => {
            renderVM.decreaseFontSize();
            updateToolbarFontSize(toolbarEl, renderVM.fontSize);
        },
        onFontReset: () => {
            renderVM.resetFontSize();
            updateToolbarFontSize(toolbarEl, renderVM.fontSize);
        },
        onFontIncrease: () => {
            renderVM.increaseFontSize();
            updateToolbarFontSize(toolbarEl, renderVM.fontSize);
        },
        onThemeChange: (theme) => {
            renderVM.setTheme(theme);
        },
        onPreferences: () => {
            preferences?.open();
        },
        onFind: () => {
            search?.open();
        },
        onToggleSidebar: () => {
            sidebar?.toggle();
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
 * The in-app file browser (fileBrowser.ts), 2026-09-12. This is where the
 * `invoke` calls live — the module itself stays invoke-free so it can be
 * unit-tested without mocking Tauri, the same tested/untested boundary
 * every other `wire*` function here draws.
 *
 * Cache-then-refresh on every open: a cached listing renders immediately
 * (so revisiting a folder is instant, the user's own ask), and the live
 * `list_directory` call replaces it when it lands. That also covers
 * refresh-on-reopen for free — every open re-fetches, so a folder whose
 * contents changed on disk updates the next time it's looked at.
 *
 * Returns a `toggle()` handle for the toolbar button, matching wireSidebar.
 */
function wireFileBrowser(closeOtherDrawers: () => void): { toggle: () => void; close: () => void } | undefined {
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
        renderFileBrowser(browserEl!, {
            kind: cached ? "loaded" : "loading",
            path: path ?? "",
            parentPath: path === null ? null : parentPath(path),
            ...(cached ? { entries: cached } : {}),
        } as Parameters<typeof renderFileBrowser>[1]);

        try {
            const listing = (await window.__TAURI__.core.invoke("list_directory", { path })) as DirListing;
            const entries = toEntries(listing);
            currentPath = listing.path;
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
            if (cached === undefined || diffFolderEntries(cached, entries)) {
                renderFileBrowser(browserEl!, {
                    kind: "loaded",
                    path: listing.path,
                    parentPath: parentPath(listing.path),
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
                renderFileBrowser(browserEl!, {
                    kind: "error",
                    path,
                    parentPath: parentPath(path),
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
            // "Moves away when selected", matching the TOC drawer's own
            // behaviour — a document is now open, so the browser has served
            // its purpose for this interaction.
            closeDrawer(browserEl, backdropEl);
        },
        onNavigate: (name) => {
            if (!currentPath) return;
            void show(joinPath(currentPath, name));
        },
        onUp: () => {
            if (!currentPath) return;
            const parent = parentPath(currentPath);
            if (parent) void show(parent);
        },
    });

    backdropEl?.addEventListener("click", () => {
        closeDrawer(browserEl, backdropEl);
    });

    return {
        close: () => {
            closeDrawer(browserEl, backdropEl);
        },
        toggle: () => {
            const opening = !browserEl.classList.contains("open");
            if (opening) {
                closeOtherDrawers();
                // Re-fetch on every open, not just the first — this is what
                // picks up files added or removed on disk since last time.
                void show(currentPath ?? null);
            }
            toggleDrawer(browserEl, backdropEl);
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
 */
function wirePermissions(): void {
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
    const sidebar = wireSidebar();
    const preferences = wirePreferences();
    const search = wireSearch();
    wireGlobalShortcuts(search);
    // Drawer mutual exclusivity is policy, so it lives here rather than in
    // either drawer's own module: both slide in from the left edge and
    // would overlap if both opened. Each drawer's toggle closes the other
    // first — wired in both directions, not just one.
    const fileBrowser = wireFileBrowser(() => sidebar?.close());
    wirePermissions();
    wireToolbar(
        preferences,
        search,
        sidebar && {
            toggle: () => {
                fileBrowser?.close();
                sidebar.toggle();
            },
        },
        fileBrowser,
    );
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
