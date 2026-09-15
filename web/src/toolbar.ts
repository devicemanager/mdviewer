// Ported from MDViewer/Views/Toolbar/MainToolbar.swift. Search
// (SearchBarView.swift) is a separate concern/file — not this module.
//
// Scoped down to what's actually buildable right now: Open and the file
// browser are real, working triggers. Deliberately NOT built here, each
// blocked on something else rather than an oversight:
//   - Editor-mode toggle: no editor exists yet (Milestone E, separate item).
//   - Save: disabled in Swift unless `documentVM.isDirty`; the dirty-
//     tracking slice has no consumer without an editor either (see
//     plan.md's Milestone C `DocumentViewModel` entry).
//   - Export (PDF/HTML/Print) menu: `ExportViewModel` isn't ported — the
//     non-Apple-platform PDF approach is still an open question
//     (porting-brief.md's host-glue table, `ExportViewModel` row).
//
// **Visual pass (2026-09-10), first real design work after the four
// real-device-found bugs (CSP/threading/dark-mode/sidebar-space) were
// fixed — the user's own framing: "the major hurdles are gone, now we
// need to make it look beautiful."** No SF Symbols equivalent exists to
// port (native-only), but that doesn't mean no iconography — inline SVG
// (defined once below, `currentColor`-stroked so it tracks the toolbar's
// own text color through every theme automatically) replaces the
// original plain-text-only buttons: icon-only, not icon+label, the same
// "no visible text, just an accessible label" pattern Safari's own
// toolbar buttons use.
//
// The Preferences and Find buttons (`onPreferences`/`onFind`) aren't
// `MainToolbar.swift` controls at all — Swift opens Preferences via its
// Settings scene (Cmd+,) and Search via a "Find…" menu command (Cmd+F),
// both app-menu/keyboard only, no toolbar button for either. They're here
// because mobile has no menu bar or keyboard shortcuts to open either
// with — a toolbar button is the one trigger that works identically on
// every platform this port targets, same reasoning for both.
//
// **Reorganized 2026-09-14/15 (file-browser plan's Phase 6), alongside
// dropping the TOC sidebar entirely** (the user's own call — file
// browsing replaces it as this app's one drawer, not a second one
// alongside it; see main.ts and app.html for the removal). Left group:
// file-browser-toggle (the primary action, per the user's original
// framing — file browsing should be the most prominent toolbar action)
// and Open, grouped together since both are "get me a document" actions.
// Right group: Find and Preferences, visually grouped — the user chose a
// small icon cluster here over a popover menu. `.toolbar-icon-group`
// (app.css) gives each cluster the same segmented-pill look the old
// font-size control used, renamed `.segmented-control` since it's no
// longer toolbar-specific (Preferences' Appearance tab reuses it too).
//
// Font-size controls (A−/number/A+) and the theme `<select>` moved into
// Preferences' Appearance tab this same pass (preferences.ts) — that tab
// was a literal stub anticipating exactly this. They're gone from here
// entirely, not just hidden on mobile: main.ts's `wireToolbar` no longer
// owns `RenderViewModel` theme/font-size state at all, `wirePreferences`
// does.
//
// The sidebar-toggle button (TOC) that used to sit here is gone along
// with the feature it opened — see the note above.

export interface ToolbarCallbacks {
    onOpen: () => void;
    onPreferences: () => void;
    onFind: () => void;
    onToggleFileBrowser: () => void;
}

/** 20x20 viewBox, `currentColor` stroke, no fill — a shared, minimal
 * outline-icon style across every button below so they read as one
 * cohesive set rather than mismatched glyphs from different sources. */
const ICON_BROWSE = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5a1 1 0 0 1 1-1h4l1.5 2h6.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8Z"/><path d="M2.5 9.5h15"/></svg>`;
const ICON_OPEN = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2H16.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9.5Z"/></svg>`;
const ICON_FIND = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="16.5" y1="16.5" x2="12.6" y2="12.6"/></svg>`;
const ICON_PREFERENCES = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"/></svg>`;

/** Renders the toolbar's static structure once — nothing here changes
 * shape after the initial render, unlike sidebar.ts's TOC used to. */
export function renderToolbar(toolbar: HTMLElement): void {
    toolbar.innerHTML = `
        <span class="toolbar-icon-group">
            <button type="button" data-action="file-browser-toggle" class="icon-btn" aria-label="Browse files">${ICON_BROWSE}</button>
            <button type="button" data-action="open" class="icon-btn" aria-label="Open…">${ICON_OPEN}</button>
        </span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-icon-group">
            <button type="button" data-action="find" class="icon-btn" aria-label="Find">${ICON_FIND}</button>
            <button type="button" data-action="preferences" class="icon-btn" aria-label="Preferences">${ICON_PREFERENCES}</button>
        </span>
    `;
}

/** Event delegation on `toolbar` itself, same reasoning as every other
 * `attach*Handlers` in this port — safe even though renderToolbar here
 * only ever replaces the markup once, not on every render. */
export function attachToolbarHandlers(toolbar: HTMLElement, callbacks: ToolbarCallbacks): void {
    toolbar.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLElement>("button[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
            case "file-browser-toggle":
                callbacks.onToggleFileBrowser();
                break;
            case "open":
                callbacks.onOpen();
                break;
            case "preferences":
                callbacks.onPreferences();
                break;
            case "find":
                callbacks.onFind();
                break;
        }
    });
}
