// Ported from MDViewer/Views/Toolbar/MainToolbar.swift. Search
// (SearchBarView.swift) is a separate concern/file — not this module.
//
// Scoped down to what's actually buildable right now, same call
// sidebar.ts already made: Open, font size (decrease/reset/increase), and
// the theme picker are real, working, and wired to renderViewModel.ts's
// already-complete, already-tested methods. Deliberately NOT built here,
// each blocked on something else rather than an oversight:
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
// original plain-text-only buttons for Open/Find/Preferences/sidebar-
// toggle: icon-only, not icon+label, the same "no visible text, just an
// accessible label" pattern Safari's own toolbar buttons use — the
// biggest single lever for the "toolbar content gets cut off at phone
// width" problem screenshotted live on both Android and iOS (a bare word
// like "Preferences…" is wide; a 20px glyph isn't). No CSP/network
// concern either way — inline SVG is markup, not an image resource load,
// so img-src's restrictions don't apply.
//
// Font-size controls (A−/number/A+) and the theme `<select>` stay as
// they were — already compact, and a native `<select>` has no icon
// equivalent that wouldn't lose the currently-selected theme's name.
//
// The Preferences and Find buttons (`onPreferences`/`onFind`) aren't
// `MainToolbar.swift` controls at all — Swift opens Preferences via its
// Settings scene (Cmd+,) and Search via a "Find…" menu command (Cmd+F),
// both app-menu/keyboard only, no toolbar button for either. They're here
// because mobile has no menu bar or keyboard shortcuts to open either
// with — a toolbar button is the one trigger that works identically on
// every platform this port targets, same reasoning for both.
//
// The sidebar-toggle button (`onToggleSidebar`) is the same story again,
// added 2026-09-10: below app.css's 768px breakpoint `#sidebar` becomes a
// slide-in drawer (drawer.ts's `openDrawer`/`closeDrawer`/`toggleDrawer`,
// generalized 2026-09-12 out of sidebar.ts once a second drawer needed the
// same mechanism) instead of the always-visible in-flow column it is
// above it — this button is how you open that drawer on a phone. It's
// rendered unconditionally like every other button here, but app.css
// hides it above the same 768px breakpoint (`.sidebar-toggle-btn`'s own
// media query) — redundant, possibly confusing to show a toggle for a
// sidebar that's already always visible on tablet/desktop.

import { themes, type MarkdownTheme } from "./markdownTheme.js";

export interface ToolbarCallbacks {
    onOpen: () => void;
    onFontDecrease: () => void;
    onFontReset: () => void;
    onFontIncrease: () => void;
    onThemeChange: (theme: MarkdownTheme) => void;
    onPreferences: () => void;
    onFind: () => void;
    onToggleSidebar: () => void;
}

/** 20x20 viewBox, `currentColor` stroke, no fill — a shared, minimal
 * outline-icon style across every button below so they read as one
 * cohesive set rather than mismatched glyphs from different sources. */
const ICON_SIDEBAR = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="5.5" x2="17" y2="5.5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="14.5" x2="17" y2="14.5"/></svg>`;
const ICON_OPEN = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2H16.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9.5Z"/></svg>`;
const ICON_FIND = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="16.5" y1="16.5" x2="12.6" y2="12.6"/></svg>`;
const ICON_PREFERENCES = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"/></svg>`;

function themeOptionsHTML(selectedThemeId: string): string {
    return themes
        .map((theme) => {
            const selected = theme.id === selectedThemeId ? " selected" : "";
            return `<option value="${theme.id}"${selected}>${theme.displayName}</option>`;
        })
        .join("");
}

/** Renders the toolbar's static structure once. Font size/theme selection
 * are updated in place afterward (updateToolbarFontSize/updateToolbarTheme)
 * rather than re-rendering wholesale — unlike sidebar.ts's TOC, nothing
 * here needs to change shape after the initial render. */
export function renderToolbar(toolbar: HTMLElement, initialFontSize: number, initialThemeId: string): void {
    toolbar.innerHTML = `
        <button type="button" data-action="sidebar-toggle" class="sidebar-toggle-btn icon-btn" aria-label="Table of contents">${ICON_SIDEBAR}</button>
        <button type="button" data-action="open" class="icon-btn" aria-label="Open…">${ICON_OPEN}</button>
        <span class="toolbar-group">
            <button type="button" data-action="font-decrease" aria-label="Decrease font size">A−</button>
            <button type="button" data-action="font-reset" aria-label="Reset font size" data-font-size>${initialFontSize}</button>
            <button type="button" data-action="font-increase" aria-label="Increase font size">A+</button>
        </span>
        <select data-action="theme" aria-label="Theme">${themeOptionsHTML(initialThemeId)}</select>
        <span class="toolbar-spacer"></span>
        <button type="button" data-action="find" class="icon-btn" aria-label="Find">${ICON_FIND}</button>
        <button type="button" data-action="preferences" class="icon-btn" aria-label="Preferences">${ICON_PREFERENCES}</button>
    `;
}

export function updateToolbarFontSize(toolbar: HTMLElement, fontSize: number): void {
    const el = toolbar.querySelector<HTMLElement>("[data-font-size]");
    if (el) el.textContent = String(fontSize);
}

export function updateToolbarTheme(toolbar: HTMLElement, themeId: string): void {
    const select = toolbar.querySelector<HTMLSelectElement>('select[data-action="theme"]');
    if (select) select.value = themeId;
}

/** Event delegation on `toolbar` itself, same reasoning as
 * sidebar.ts's attachTOCClickHandler — safe even though renderToolbar
 * here only ever replaces the markup once, not on every render. */
export function attachToolbarHandlers(toolbar: HTMLElement, callbacks: ToolbarCallbacks): void {
    toolbar.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLElement>("button[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
            case "sidebar-toggle":
                callbacks.onToggleSidebar();
                break;
            case "open":
                callbacks.onOpen();
                break;
            case "font-decrease":
                callbacks.onFontDecrease();
                break;
            case "font-reset":
                callbacks.onFontReset();
                break;
            case "font-increase":
                callbacks.onFontIncrease();
                break;
            case "preferences":
                callbacks.onPreferences();
                break;
            case "find":
                callbacks.onFind();
                break;
        }
    });

    toolbar.addEventListener("change", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "theme") return;
        const theme = themes.find((t) => t.id === target.value);
        if (theme) callbacks.onThemeChange(theme);
    });
}
