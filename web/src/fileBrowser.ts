// New 2026-09-12 (file-browser plan's Phase 3) — no Swift source to port
// (the reference app has no folder-browsing UI at all, only a native
// "Open Recent" menu via `NSDocumentController.recentDocumentURLs`, a flat
// MRU list, not a directory browser — grepped `AppDelegate.swift` directly
// before writing this, not assumed). Built specifically because mobile has
// no native folder-picker at all (`request_folder_access`'s own doc
// comment in src-tauri/src/lib.rs), so an in-app browser is the only way
// to see more than one file at a time there.
//
// Same split every other feature module here follows (toolbar.ts,
// sidebar.ts, preferences.ts, search.ts): pure `render*()` + a callback-
// based `attach*Handlers(container, callbacks)`, no `invoke` calls inside
// this file at all — those stay in main.ts's `wire*` glue (Phase 4), the
// established untested-boundary line this whole test suite already draws.
// Reuses drawer.ts's `openDrawer`/`closeDrawer`/`toggleDrawer` (generalized
// out of sidebar.ts, Phase 2) for the actual slide-in mechanism — this
// module only owns what's *inside* the drawer, not the drawer itself.
//
// Deliberately does NOT do any path-separator arithmetic (joining a
// folder's path with an entry's name, or computing "up one level"): this
// module only ever sees `name`s (`FileBrowserEntry`) and a `parentPath`
// the caller supplies outright — cross-platform path-joining is main.ts's
// wiring's job (Phase 4), which already knows the current path from
// `DirListing.path`, not something to duplicate/guess at in here.

import { escapeHtml } from "./dom.js";

export interface FileBrowserEntry {
    name: string;
    isDir: boolean;
}

/** Every state that has a real folder to show shares this — even
 * "loading"/"error" still need `parentPath` so the up-navigation row stays
 * available and a failed refresh doesn't strand the user unable to go
 * back up. `parentPath: null` means "this is the top of the current
 * browsing session" (`DocumentBaseDir` itself) — there is no "up" from
 * there; mobile in particular never has anywhere further up to go at all,
 * since there's no folder-picker to grant one (see this file's own header). */
interface FileBrowserLocation {
    path: string;
    parentPath: string | null;
}

/**
 * `"no-document"` is the first-run bootstrap case: no document has ever
 * been opened, so there is no `DocumentBaseDir` yet and — on mobile —
 * nothing else to fall back to (desktop's own fallback, offering the
 * native folder-picker instead, is main.ts wiring's decision in Phase 4,
 * not this module's).
 */
export type FileBrowserState =
    | { kind: "no-document" }
    | ({ kind: "loading" } & FileBrowserLocation)
    | ({ kind: "loaded"; entries: FileBrowserEntry[] } & FileBrowserLocation)
    | ({ kind: "error"; message: string } & FileBrowserLocation);

function upRowHTML(parentPath: string | null): string {
    if (parentPath === null) return "";
    return '<li><button type="button" class="file-browser-item file-browser-up" data-action="up">.. (up one level)</button></li>';
}

export function renderFileBrowser(container: HTMLElement, state: FileBrowserState): void {
    if (state.kind === "no-document") {
        container.innerHTML = '<div class="file-browser-empty"><p>Open a document to browse its folder.</p></div>';
        return;
    }

    const up = upRowHTML(state.parentPath);

    if (state.kind === "loading") {
        container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-loading">Loading…</div>`;
        return;
    }

    if (state.kind === "error") {
        container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-error">${escapeHtml(state.message)}</div>`;
        return;
    }

    if (state.entries.length === 0) {
        container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-empty"><p>No documents in this folder.</p></div>`;
        return;
    }

    const items = state.entries
        .map((entry) => {
            const cls = entry.isDir ? "file-browser-folder" : "file-browser-file";
            const action = entry.isDir ? "navigate" : "open";
            return (
                `<li><button type="button" class="file-browser-item ${cls}" data-action="${action}" ` +
                `data-name="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</button></li>`
            );
        })
        .join("");
    container.innerHTML = `<ul class="file-browser-list">${up}${items}</ul>`;
}

export interface FileBrowserCallbacks {
    /** A markdown file was tapped — `name` only, see this file's own
     * header on why path-joining isn't done here. */
    onOpenFile: (name: string) => void;
    /** A subfolder was tapped. */
    onNavigate: (name: string) => void;
    /** The "up one level" row was tapped. */
    onUp: () => void;
}

/** Event delegation on `container`, same reasoning as every other
 * `attach*Handlers` in this port — safe even though `renderFileBrowser`
 * replaces the markup wholesale on every call, not incrementally. */
export function attachFileBrowserHandlers(container: HTMLElement, callbacks: FileBrowserCallbacks): void {
    container.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLElement>("button[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
            case "up":
                callbacks.onUp();
                break;
            case "navigate":
                if (button.dataset.name) callbacks.onNavigate(button.dataset.name);
                break;
            case "open":
                if (button.dataset.name) callbacks.onOpenFile(button.dataset.name);
                break;
        }
    });
}

// ---- Folder listing cache (localStorage) ----
//
// `mdviewer.folderCache` — matches the `mdviewer.<camelCaseName>`
// convention every other stored value in this app already uses
// (main.ts's `THEME_STORAGE_KEY`/`FONT_SIZE_STORAGE_KEY`), same try/catch-
// degrades-to-empty discipline. The first structured-JSON value this app
// has ever stored, though (every existing one is a plain string/number) —
// a version tag (`v`) is included from day one specifically so a future
// shape change can detect and discard old-shaped data instead of a
// `JSON.parse` that succeeds but hands back the wrong shape silently.
//
// Keyed by the *canonical* path `list_directory`'s Rust side returns
// (`DirListing.path`), not whatever path string was asked for — two
// different-but-equivalent requests (a symlink, a trailing slash) collapse
// to one cache entry this way rather than silently duplicating it.
//
// Capped to the most-recently-used folders, oldest `cachedAt` evicted
// first once the cap is exceeded — matches the "best-effort, no error UI"
// philosophy `granted_folder_bookmarks.json` already uses on the Rust
// side (a missing/corrupt read degrades to empty, never fatal).

const FOLDER_CACHE_KEY = "mdviewer.folderCache";
const FOLDER_CACHE_VERSION = 1;
const FOLDER_CACHE_MAX_FOLDERS = 20;

interface CachedFolder {
    entries: FileBrowserEntry[];
    cachedAt: number;
}

interface FolderCacheData {
    v: number;
    folders: Record<string, CachedFolder>;
}

function emptyFolderCache(): FolderCacheData {
    return { v: FOLDER_CACHE_VERSION, folders: {} };
}

/** Wrapped in try/catch same as every `loadStored*` in main.ts — a
 * private-browsing-style context throwing on access, or a value from a
 * future/older schema version, both degrade to "cache miss" rather than
 * throwing and breaking the browser drawer. */
function loadFolderCacheData(): FolderCacheData {
    try {
        const raw = localStorage.getItem(FOLDER_CACHE_KEY);
        if (raw === null) return emptyFolderCache();
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            (parsed as { v?: unknown }).v !== FOLDER_CACHE_VERSION ||
            typeof (parsed as { folders?: unknown }).folders !== "object" ||
            (parsed as { folders?: unknown }).folders === null
        ) {
            return emptyFolderCache();
        }
        return parsed as FolderCacheData;
    } catch {
        return emptyFolderCache();
    }
}

function storeFolderCacheData(data: FolderCacheData): void {
    try {
        localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(data));
    } catch {
        /* ignore — same as every other store* in this app */
    }
}

/** `undefined` on a cache miss (never cached, corrupt data, or evicted) —
 * the caller (main.ts, Phase 4) falls back to showing the "loading" state
 * and calling `list_directory` when this comes back empty. */
export function loadCachedFolder(canonicalPath: string): FileBrowserEntry[] | undefined {
    return loadFolderCacheData().folders[canonicalPath]?.entries;
}

export function storeCachedFolder(canonicalPath: string, entries: FileBrowserEntry[]): void {
    const data = loadFolderCacheData();
    data.folders[canonicalPath] = { entries, cachedAt: Date.now() };

    const keys = Object.keys(data.folders);
    if (keys.length > FOLDER_CACHE_MAX_FOLDERS) {
        const oldestFirst = keys.sort((a, b) => data.folders[a].cachedAt - data.folders[b].cachedAt);
        for (const key of oldestFirst.slice(0, keys.length - FOLDER_CACHE_MAX_FOLDERS)) {
            delete data.folders[key];
        }
    }

    storeFolderCacheData(data);
}
