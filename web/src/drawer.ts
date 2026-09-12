// The mobile slide-in drawer primitive — extracted 2026-09-12 (file-browser
// plan's Phase 2) out of sidebar.ts, where it originated 2026-09-10 as the
// TOC sidebar's own mobile treatment (a permanently in-flow 240px sidebar,
// matching Swift's `NavigationSplitView` default, eats more than half an
// iPhone's width — see app.css's own note on the drawer CSS). These three
// functions never had any TOC-specific logic at all — they just toggle an
// `.open` class on whatever elements are handed to them — so moving them
// here (rather than leaving a second copy in a new file) lets the in-app
// file browser (fileBrowser.ts) reuse the exact same mechanism/CSS
// (app.css's `.drawer`/`.drawer-backdrop` classes, generalized from the
// TOC's own `#sidebar`/`#sidebar-backdrop`-specific rules in this same
// change) instead of a second, parallel implementation.
//
// `backdrop` stays optional on every function — passing it toggles the
// tap-outside-to-close overlay along with the drawer itself; omitting it
// (e.g. a drawer with no backdrop element at all) just skips that part.

export function openDrawer(drawer: HTMLElement, backdrop?: HTMLElement | null): void {
    drawer.classList.add("open");
    backdrop?.classList.add("open");
}

export function closeDrawer(drawer: HTMLElement, backdrop?: HTMLElement | null): void {
    drawer.classList.remove("open");
    backdrop?.classList.remove("open");
}

export function toggleDrawer(drawer: HTMLElement, backdrop?: HTMLElement | null): void {
    if (drawer.classList.contains("open")) {
        closeDrawer(drawer, backdrop);
    } else {
        openDrawer(drawer, backdrop);
    }
}
