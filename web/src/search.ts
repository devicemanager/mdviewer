// Ported from MDViewer/Views/Toolbar/SearchBarView.swift — a floating
// search bar (magnifying glass icon, text field, clear button, "Done"
// button) over the content area, shown/hidden via a `.showSearchBar`
// notification (Cmd+F / a "Find…" menu command in Swift).
//
// **A real deviation, not a straightforward port — flagged per the
// working agreement rather than assumed away.** Swift's `performSearch`
// does exactly one thing: `webView.find(searchText, configuration:
// WKFindConfiguration())`, entirely delegating the actual search/
// highlight/scroll mechanics to WKWebView's own built-in capability —
// Swift never implements a highlighter itself. That capability is
// WKWebView-specific; Tauri's webview is WebView2 on Windows, WebKitGTK
// on Linux, Android's WebView on Android, and only WKWebView on macOS/
// iOS, and there is no cross-platform "find in page" surface in Tauri
// itself to call instead (checked, not assumed, before starting — see
// plan.md's Milestone E entry for this item).
//
// This module keeps the same spirit — delegate to a platform-provided
// capability rather than reimplement a highlighter, matching what Swift
// actually does architecturally, not just its visible behavior — by
// using `window.find(...)`, the browser's own legacy find-in-page API.
// Non-standard and deprecated (not in `lib.dom.d.ts`, hence the injected
// `FindInPageWindow` interface below rather than reading `window.find`
// directly — also keeps this testable, same DI pattern as every other
// module here), but still implemented by every engine this port's
// webviews are built on (WebKit and Chromium both retain it) — a much
// closer match to "delegate to the platform" than hand-rolling DOM text
// walking, `<mark>` wrapping, and scroll-into-view logic that would also
// have to correctly skip over KaTeX's rendered MathML and Shiki's
// syntax-highlighting spans without corrupting them.
//
// **Inferred, not independently verified, incremental-typing behavior**:
// `WKWebView.find`'s exact continuation semantics between successive
// calls (does retyping restart from the top, or continue from the
// current match?) aren't visible from `SearchBarView.swift` alone — it
// just calls `find` again on every `onChange`/`onSubmit` with no visible
// state management, and there's no way to drive the real macOS app in
// this environment to observe it directly. This port makes an explicit,
// reasonable choice instead: a *changed* query re-searches from the
// document start (`searchFromStart`, via `getSelection()?.removeAllRanges()`
// before calling `find`), while Enter (`searchNext`, matching `onSubmit`)
// continues forward without resetting — ordinary "search as you type,
// Enter for next match" behavior, not confirmed byte-for-byte identical
// to WKWebView's internal behavior.
//
// **A second real deviation, found live and fixed, not just inferred**:
// `attachSearchBarHandlers` debounces the search-as-you-type trigger
// (`SEARCH_DEBOUNCE_MS`), unlike Swift's undebounced `.onChange`. See
// that function's own header comment for the actual bug this fixes —
// `window.find()` stealing keyboard focus mid-keystroke lost characters
// on the real desktop app, confirmed via the OS accessibility API, not
// just inferred from reading the code.

export interface FindInPageWindow {
    find(
        searchString: string,
        caseSensitive?: boolean,
        backwards?: boolean,
        wrapAround?: boolean,
        wholeWord?: boolean,
        searchInFrames?: boolean,
        showDialog?: boolean,
    ): boolean;
    getSelection(): { removeAllRanges(): void } | null;
}

/** Matches `WKFindConfiguration`'s `caseSensitive = false`, `wraps = true`. */
function runFind(win: FindInPageWindow, query: string): boolean {
    return win.find(query, false, false, true, false, false, false);
}

/** A changed query — restarts the search from the top of the document. */
export function searchFromStart(win: FindInPageWindow, query: string): boolean {
    if (!query) return false;
    win.getSelection()?.removeAllRanges();
    return runFind(win, query);
}

/** Enter — continues to the next match without resetting position. */
export function searchNext(win: FindInPageWindow, query: string): boolean {
    if (!query) return false;
    return runFind(win, query);
}

export interface SearchBarCallbacks {
    onQueryChange: (query: string) => void;
    onSubmit: (query: string) => void;
    onClose: () => void;
}

/** Renders the search bar's static structure once — matches
 * `SearchBarView`'s body: icon, text field, a clear button (only shown
 * once there's text to clear, same as Swift's `if !searchText.isEmpty`),
 * and a "Done" button. */
export function renderSearchBar(container: HTMLElement): void {
    container.innerHTML = `
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="text" class="search-input" data-action="query" placeholder="Search" autocomplete="off" spellcheck="false">
        <button type="button" class="search-clear" data-action="clear" aria-label="Clear" hidden>×</button>
        <button type="button" class="search-done" data-action="done">Done</button>
    `;
}

export function showSearchBar(container: HTMLElement): void {
    container.hidden = false;
    container.querySelector<HTMLInputElement>(".search-input")?.focus();
}

export function hideSearchBar(container: HTMLElement): void {
    container.hidden = true;
}

/** Matches Swift's `if !searchText.isEmpty` clear-button visibility. */
export function updateSearchClearVisibility(container: HTMLElement, query: string): void {
    const clearButton = container.querySelector<HTMLElement>(".search-clear");
    if (clearButton) clearButton.hidden = query.length === 0;
}

/**
 * Event delegation on `container`, same reasoning as every other
 * `attach*Handlers` in this port. Matches Swift's three triggers:
 * `.onChange(of: searchText)` (the input event), `.onSubmit` (Enter),
 * and `isVisible = false` (the clear-search-text button here just
 * clears the field — matches Swift's `Button { searchText = "" }`, a
 * separate control from "Done" — and the Done button / Escape key, both
 * calling `onClose`).
 */
/** How long to wait after the last keystroke before actually calling
 * `find()` — see the long comment in `attachSearchBarHandlers` below for
 * why this exists at all; not a stylistic choice. */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * A second, real-iOS-device bug on top of the desktop one described
 * below, found live on a phone (triton) after the debounce fix had
 * already shipped and been verified on desktop: plain `input.focus()`
 * after `find()` has moved the document's selection elsewhere is enough
 * on WKWebView/iOS to leave the *input's own* text fully selected —
 * reported directly ("marks all typed text then next character typed
 * replaces all content", the standard type-over-a-selection symptom).
 * Desktop's WKWebView never showed this because the fix there only
 * needed to stop `find()` racing with fast keystrokes (the debounce);
 * it never needed to say anything explicit about the *input's own*
 * caret position afterward, because refocusing there happens to leave
 * it alone. iOS doesn't make that same guarantee — a bare `.focus()`
 * with no explicit selection is exactly the situation mobile WebKit is
 * known to default to select-all for, and every call site that
 * refocuses after a `find()`-driven callback needs to explicitly
 * collapse the selection back to a caret, not just call `.focus()` and
 * hope the previous caret position survived.
 */
function refocusInput(input: HTMLInputElement): void {
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
}

export function attachSearchBarHandlers(container: HTMLElement, callbacks: SearchBarCallbacks): void {
    const input = container.querySelector<HTMLInputElement>(".search-input");
    if (!input) return;

    // Debounced, unlike Swift's `.onChange(of: searchText)` which calls
    // `performSearch()` on every single character with no visible
    // debounce — a real, deliberate deviation, not an oversight, found
    // and fixed by actually typing into the running app rather than
    // trusting the port's 162 passing tests (jsdom's `find` is the
    // injected mock; it doesn't move real selection/focus the way a
    // browser's actual `window.find()` does, so this class of bug is
    // invisible to any test here). Calling `find()` synchronously on
    // every keystroke — as an *undebounced* version of this did at first
    // — steals keyboard focus to the matched text in the document on
    // every call. Refocusing the input right after (still done below)
    // sounds like it should fix that, but doesn't fully: rapid native
    // keystrokes arriving while focus is mid-bounce between the input and
    // the matched text lose characters to a genuine race, confirmed live
    // on the real desktop app via the OS accessibility API (not just a
    // screenshot) — typing "blockquote" landed as a single, seemingly
    // arbitrary leftover character ("b" one run, "l" another), never the
    // whole word. Debouncing so `find()` only runs after typing actually
    // pauses removes the race entirely, since it no longer runs
    // interleaved with a burst of keystrokes. Whether `WKWebView.find`
    // has the same problem in the real Swift app isn't verifiable in
    // this environment (no way to drive the real macOS app here) — this
    // is a reasonable, but not independently confirmed-necessary-there,
    // divergence.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    input.addEventListener("input", () => {
        updateSearchClearVisibility(container, input.value);
        if (debounceTimer) clearTimeout(debounceTimer);
        const query = input.value;
        debounceTimer = setTimeout(() => {
            callbacks.onQueryChange(query);
            refocusInput(input); // find() moves focus to the match — restore it (and its caret) once the debounce actually fires
        }, SEARCH_DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (debounceTimer) clearTimeout(debounceTimer); // an in-flight debounced search is superseded by this
            callbacks.onSubmit(input.value);
            refocusInput(input); // same find()-steals-focus reason as above
        } else if (e.key === "Escape") {
            callbacks.onClose();
        }
    });

    container.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        if (target.closest('[data-action="clear"]')) {
            if (debounceTimer) clearTimeout(debounceTimer); // don't let a stale pending search fire after clearing
            input.value = "";
            updateSearchClearVisibility(container, "");
            callbacks.onQueryChange("");
            refocusInput(input); // no find() ran (empty query, searchFromStart's own guard), but consistent with every other refocus here
            return;
        }

        if (target.closest('[data-action="done"]')) {
            callbacks.onClose();
        }
    });
}
