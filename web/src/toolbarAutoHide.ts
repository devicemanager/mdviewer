// New in the 2026-09-11 mobile UX pass — no Swift source to port (the
// Swift app's toolbar is native chrome outside the WebView entirely, so
// it never had a "scrolls away with content" problem to begin with; see
// app.css's own comment on this same rule for the full rationale). The
// user's own spec, close to verbatim: the toolbar should stay fixed at
// the top on a phone, fade away when idle to give the document more
// room, and come back the moment the content is "zoomed or moved."
//
// Kept separate from main.ts (which just wires this up, untested, same
// as every other wire* function there) so the actual show/fade logic is
// independently testable with fake timers and fake event sources rather
// than a real `#toolbar` scrolling in a real browser — the same reason
// drawer.ts's openDrawer/closeDrawer are plain DOM functions instead of
// being inlined into main.ts.

/** Matches the bit of `MediaQueryList` this module actually needs —
 * real `window.matchMedia(...)` results satisfy this directly, and a
 * test can supply a trivial fake instead of constructing a real one. */
export interface MediaQueryLike {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
}

/** One event source to wake the toolbar on — `{ target: mainEl, type:
 * "scroll" }` for ordinary scrolling, `{ target: window.visualViewport,
 * type: "resize" }` / `"scroll"` for pinch-zoom and panning while
 * zoomed (the two `window.visualViewport` events that actually fire for
 * those gestures — plain `window`/`document` scroll/resize don't see
 * pinch-zoom at all). `EventTarget` rather than a narrower type since
 * `#main` and `window.visualViewport` don't otherwise share an
 * interface. */
export interface AutoHideSource {
    target: EventTarget;
    type: string;
}

const DEFAULT_FADE_DELAY_MS = 2500;

export function showToolbar(toolbarEl: HTMLElement): void {
    toolbarEl.classList.remove("toolbar-faded");
}

export function fadeToolbar(toolbarEl: HTMLElement): void {
    toolbarEl.classList.add("toolbar-faded");
}

/**
 * Wires `toolbarEl` to fade after `fadeDelayMs` of no activity from any
 * of `sources`, and to reappear immediately once one fires. A no-op on
 * anything read from `mobileQuery` as not matching — desktop's toolbar
 * is in-flow and always visible (app.css's own `.toolbar-faded` rule is
 * itself scoped to the same mobile breakpoint, so this is a belt-and-
 * braces guard against ever adding the class outside it, not the only
 * thing preventing a visual change there).
 *
 * Starts visible and immediately begins counting down to the first
 * fade — the user's own "should come back... then fade away" implies a
 * default-visible starting point a reader can actually see before
 * anything fades, not starting pre-faded.
 */
export function wireToolbarAutoHide(
    toolbarEl: HTMLElement,
    sources: readonly AutoHideSource[],
    mobileQuery: MediaQueryLike,
    fadeDelayMs: number = DEFAULT_FADE_DELAY_MS,
): void {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    function wake(): void {
        if (!mobileQuery.matches) return;
        showToolbar(toolbarEl);
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => fadeToolbar(toolbarEl), fadeDelayMs);
    }

    for (const { target, type } of sources) {
        target.addEventListener(type, wake, { passive: true } as AddEventListenerOptions);
    }

    // Crossing the breakpoint (resize, or rotating a phone) shouldn't
    // leave a stale `.toolbar-faded` from one layout applied to the
    // other — always reset to visible, then only re-arm the fade
    // countdown if the new width is still mobile.
    mobileQuery.addEventListener("change", () => {
        if (fadeTimer) clearTimeout(fadeTimer);
        showToolbar(toolbarEl);
        wake();
    });

    wake();
}
