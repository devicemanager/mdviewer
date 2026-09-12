// Ported from SidebarView.swift + TableOfContentsView.swift — combined
// into one module since SidebarView is a thin wrapper with nothing else
// worth its own file: `TableOfContentsView(sidebarVM) { anchor in
// renderVM.scrollToAnchor(anchor) }`.
//
// Renders into app.html's `#sidebar` (an empty `<nav>`, hidden until this
// item). Uses `ExtractedHeading` (markedRenderer.ts) — the type
// `mdviewerApi.ts`'s `setContent` actually returns — not the deleted
// `toc.ts`'s `TOCItem`: same shape, but `TOCItem` came from a redundant,
// unused second `marked.lexer()` parse that `mdviewerApi.ts`'s
// single-parse design (accumulating headings during `marked.parse()`
// itself) made unnecessary. Removed in the same change this file was
// added, rather than left as confusing, silently-dead duplication.
//
// **Mobile drawer (2026-09-10)**: real screen-space problem found live on
// triton — a permanently in-flow 240px sidebar (matching Swift's
// `NavigationSplitView` default, see app.css's own note) eats more than
// half an iPhone's width. Below app.css's 768px breakpoint, `#sidebar`
// becomes a `position: fixed` slide-in drawer instead of an in-flow
// column — CSS alone handles the positioning/transform/backdrop-blur.
// The actual open/close primitives (`openDrawer`/`closeDrawer`/
// `toggleDrawer`) moved to drawer.ts 2026-09-12 (file-browser plan's
// Phase 2) once a second drawer (the in-app file browser) needed the same
// mechanism — they never had any TOC-specific logic to begin with.
// `attachTOCClickHandler`'s `onSelect` closing the drawer after a
// selection ("moves away when selected", the user's own words) is wired
// in main.ts, not here — this module only owns the TOC-specific
// rendering, not drawer policy.

import type { ExtractedHeading } from "./markedRenderer.js";
import { escapeHtml } from "./dom.js";

/** Ported from `TableOfContentsView.fontForLevel` — CSS classes, not SwiftUI `Font`s; app.css maps these to sizes. */
function classForLevel(level: number): string {
    if (level === 1) return "toc-level-1";
    if (level === 2) return "toc-level-2";
    return "toc-level-3-plus";
}

/**
 * Ported from `TableOfContentsView`'s body: the empty state ("No headings
 * found") when `headings` is empty, otherwise a flat list indented by
 * level — matches Swift's `(item.level - 1) * 12` points exactly, and
 * its `id: \.id` list (here, each item's own `anchor`, already unique
 * within a document since `dom.ts`'s `slugify` de-duplicates).
 */
export function renderTOC(sidebar: HTMLElement, headings: ExtractedHeading[]): void {
    if (headings.length === 0) {
        sidebar.innerHTML = '<div class="toc-empty"><p>No headings found</p></div>';
        return;
    }

    const items = headings
        .map((h) => {
            const indent = (h.level - 1) * 12;
            return (
                `<li><button type="button" class="toc-item ${classForLevel(h.level)}" ` +
                `style="padding-left:${indent}px" data-anchor="${escapeHtml(h.anchor)}">` +
                `${escapeHtml(h.title)}</button></li>`
            );
        })
        .join("");
    sidebar.innerHTML = `<ul class="toc-list">${items}</ul>`;
}

/**
 * Ported from `SidebarView`'s `onSelect` closure calling
 * `renderVM.scrollToAnchor(anchor)`. Event delegation on `sidebar`
 * itself rather than per-item listeners: `renderTOC` replaces the list
 * wholesale on every call (a fresh document, or headings changing), so
 * per-item listeners would silently leak and re-attach every time;
 * delegating to the stable container attaches exactly once.
 */
export function attachTOCClickHandler(sidebar: HTMLElement, onSelect: (anchor: string) => void): void {
    sidebar.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLElement>("button[data-anchor]");
        if (button?.dataset.anchor) {
            onSelect(button.dataset.anchor);
        }
    });
}
