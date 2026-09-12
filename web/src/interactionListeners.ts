// Ported from mdviewer.js's trailing scroll/hover/click listener block —
// the part of setContent's neighborhood that lives outside window.MDViewer
// entirely in the original (attached once, at script-load time, not
// per-render).
//
// Callbacks are injected instead of calling
// `window.webkit.messageHandlers.*.postMessage(...)` directly — same
// reasoning as every other module in this port (see math.ts's KatexLike):
// this is also most of what plan.md's "swap window.webkit.messageHandlers.*
// calls for the Tauri bridge" item turns out to mean for these three
// handlers specifically (scrollPositionChanged, linkHovered, linkClicked)
// — wiring a callback to `invoke`/`emit` is the caller's job, not this
// module's. `remoteContentBlocked`'s "Always Allow" persisted preference
// and `headingsExtracted`/`renderComplete` (already covered by
// mdviewerApi.ts's `setContent` return value) are the only pieces of that
// item this module doesn't touch.

export interface ScrollPosition {
    y: number;
    height: number;
}

export interface InteractionCallbacks {
    onScroll?: (position: ScrollPosition) => void;
    onLinkHovered?: (href: string) => void;
    onLinkClicked?: (href: string) => void;
}

function closestLink(target: EventTarget | null): HTMLAnchorElement | null {
    if (!target || !(target instanceof Element)) {
        return null;
    }
    return target.closest("a[href]");
}

/**
 * Attaches mdviewer.js's scroll/hover/click listeners to `window`/
 * `document`. Fire-and-forget, same as the original — no detach function,
 * since the page is never unmounted in this app's usage.
 */
export function attachInteractionListeners(callbacks: InteractionCallbacks): void {
    // Ported from the scroll listener: 100ms debounce, notifying with the
    // current scroll position and total document height.
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("scroll", () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            callbacks.onScroll?.({ y: window.scrollY, height: document.body.scrollHeight });
        }, 100);
    });

    // Ported from the mouseover/mouseout pair: hovering a link reports its
    // href; leaving it reports an empty string (mdviewer.js's own way of
    // saying "nothing hovered" — matched exactly, not remodeled as
    // `undefined`, since it's what the host's status-bar clearing logic
    // expects).
    document.addEventListener("mouseover", (e) => {
        const link = closestLink(e.target);
        if (link) {
            callbacks.onLinkHovered?.(link.href || "");
        }
    });
    document.addEventListener("mouseout", (e) => {
        const link = closestLink(e.target);
        if (link) {
            callbacks.onLinkHovered?.("");
        }
    });

    // Ported from the click listener: fragment-only links (`#anchor`)
    // are left alone to scroll in-page via the browser's own default
    // behavior; every other link's default navigation is prevented
    // unconditionally (before any callback even exists to react to it —
    // matches mdviewer.js exactly, and is why no Rust-side navigation
    // interceptor is needed to match this, per the note already recorded
    // in plan.md's Milestone A).
    document.addEventListener("click", (e) => {
        const link = closestLink(e.target);
        if (!link) return;

        const href = link.getAttribute("href");
        if (!href) return;
        if (href.startsWith("#")) return;

        e.preventDefault();
        callbacks.onLinkClicked?.(link.href);
    });
}
