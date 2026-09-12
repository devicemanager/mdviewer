import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    searchFromStart,
    searchNext,
    renderSearchBar,
    showSearchBar,
    hideSearchBar,
    updateSearchClearVisibility,
    attachSearchBarHandlers,
    type FindInPageWindow,
} from "../src/search.js";

function mockWindow(findResult = true): FindInPageWindow & { find: ReturnType<typeof vi.fn>; getSelection: ReturnType<typeof vi.fn> } {
    const removeAllRanges = vi.fn();
    return {
        find: vi.fn().mockReturnValue(findResult),
        getSelection: vi.fn().mockReturnValue({ removeAllRanges }),
    };
}

describe("searchFromStart", () => {
    it("clears the selection before finding, matching WKFindConfiguration's defaults", () => {
        const win = mockWindow();
        searchFromStart(win, "hello");

        expect(win.getSelection).toHaveBeenCalled();
        expect(win.find).toHaveBeenCalledWith("hello", false, false, true, false, false, false);
    });

    it("does nothing for an empty query", () => {
        const win = mockWindow();
        const result = searchFromStart(win, "");

        expect(result).toBe(false);
        expect(win.find).not.toHaveBeenCalled();
        expect(win.getSelection).not.toHaveBeenCalled();
    });

    it("returns find's result", () => {
        expect(searchFromStart(mockWindow(true), "x")).toBe(true);
        expect(searchFromStart(mockWindow(false), "x")).toBe(false);
    });
});

describe("searchNext", () => {
    it("finds without touching the selection", () => {
        const win = mockWindow();
        searchNext(win, "hello");

        expect(win.getSelection).not.toHaveBeenCalled();
        expect(win.find).toHaveBeenCalledWith("hello", false, false, true, false, false, false);
    });

    it("does nothing for an empty query", () => {
        const win = mockWindow();
        const result = searchNext(win, "");

        expect(result).toBe(false);
        expect(win.find).not.toHaveBeenCalled();
    });
});

let container: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<div id="search" hidden></div>';
    container = document.getElementById("search")!;
});

describe("renderSearchBar", () => {
    it("renders the input, a hidden clear button, and a Done button", () => {
        renderSearchBar(container);
        expect(container.querySelector(".search-input")).not.toBeNull();
        expect(container.querySelector<HTMLElement>(".search-clear")!.hidden).toBe(true);
        expect(container.querySelector(".search-done")).not.toBeNull();
    });
});

describe("showSearchBar / hideSearchBar", () => {
    it("toggles hidden and focuses the input on show", () => {
        renderSearchBar(container);
        showSearchBar(container);
        expect(container.hidden).toBe(false);
        expect(document.activeElement).toBe(container.querySelector(".search-input"));

        hideSearchBar(container);
        expect(container.hidden).toBe(true);
    });
});

describe("updateSearchClearVisibility", () => {
    it("shows the clear button only when there's text", () => {
        renderSearchBar(container);
        updateSearchClearVisibility(container, "abc");
        expect(container.querySelector<HTMLElement>(".search-clear")!.hidden).toBe(false);

        updateSearchClearVisibility(container, "");
        expect(container.querySelector<HTMLElement>(".search-clear")!.hidden).toBe(true);
    });
});

describe("attachSearchBarHandlers", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the clear button immediately, but debounces onQueryChange", () => {
        renderSearchBar(container);
        const onQueryChange = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange, onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.value = "hello";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        // Clear-button visibility isn't debounced — only the find() trigger is.
        expect(container.querySelector<HTMLElement>(".search-clear")!.hidden).toBe(false);
        expect(onQueryChange).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        expect(onQueryChange).toHaveBeenCalledWith("hello");
    });

    it("coalesces a rapid burst of keystrokes into a single onQueryChange call with the final value", () => {
        // Reproduces the real bug this debounce fixes: window.find() called
        // synchronously on every keystroke stole focus mid-typing and
        // dropped characters on the live desktop app (confirmed via the OS
        // accessibility API — typing "blockquote" landed as a single
        // leftover character). Debouncing means find() only ever runs once
        // per pause in typing, not once per character.
        renderSearchBar(container);
        const onQueryChange = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange, onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        for (const partial of ["b", "bl", "blo", "bloc", "block"]) {
            input.value = partial;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            vi.advanceTimersByTime(50); // well under the 200ms debounce
        }

        expect(onQueryChange).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(onQueryChange).toHaveBeenCalledOnce();
        expect(onQueryChange).toHaveBeenCalledWith("block");
    });

    it("keeps focus on the input once the debounced find() call fires", () => {
        renderSearchBar(container);
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.focus();
        input.blur(); // simulates what a real window.find() call does to focus
        expect(document.activeElement).not.toBe(input);

        input.value = "b";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(document.activeElement).not.toBe(input); // not yet — still debouncing

        vi.advanceTimersByTime(200);
        expect(document.activeElement).toBe(input);
    });

    it("restores focus to the input after Enter triggers the next find() call", () => {
        renderSearchBar(container);
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.focus();
        input.blur(); // a prior find() call already stole focus, same setup as the input-event test
        input.value = "hello";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(document.activeElement).toBe(input);
    });

    // Real bug, found live on a phone (triton), not caught by the two
    // focus tests above: on iOS, a bare `.focus()` after `find()` has
    // moved the document's selection elsewhere leaves the *input's own*
    // text fully selected, not just refocused — reported directly as
    // "marks all typed text then next character typed replaces all
    // content." jsdom's own `.focus()` doesn't reproduce that select-all
    // side effect (there's nothing here to catch a regression back to a
    // real select-all), but it does let these two tests confirm the
    // actual fix — an explicit `setSelectionRange` collapsing the caret
    // to the end of the value — really runs on every refocus, which is
    // what prevents it regardless of what any particular WebView does on
    // a bare `.focus()` by itself.
    it("collapses the selection to the end of the value once the debounced find() call fires", () => {
        renderSearchBar(container);
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.value = "hello";
        input.setSelectionRange(0, 5); // simulates the all-selected state this is meant to fix
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(input.selectionStart).toBe(5);
        expect(input.selectionEnd).toBe(5);
    });

    it("collapses the selection to the end of the value after Enter", () => {
        renderSearchBar(container);
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.value = "hello";
        input.setSelectionRange(0, 5);
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(input.selectionStart).toBe(5);
        expect(input.selectionEnd).toBe(5);
    });

    it("calls onSubmit with the current value on Enter", () => {
        renderSearchBar(container);
        const onSubmit = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit, onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.value = "hello";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(onSubmit).toHaveBeenCalledWith("hello");
    });

    it("calls onClose on Escape", () => {
        renderSearchBar(container);
        const onClose = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose });

        container.querySelector<HTMLInputElement>(".search-input")!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when Done is clicked", () => {
        renderSearchBar(container);
        const onClose = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange: vi.fn(), onSubmit: vi.fn(), onClose });

        container.querySelector<HTMLElement>(".search-done")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("clears the input, hides the clear button, and calls onQueryChange('') when Clear is clicked", () => {
        renderSearchBar(container);
        const onQueryChange = vi.fn();
        attachSearchBarHandlers(container, { onQueryChange, onSubmit: vi.fn(), onClose: vi.fn() });

        const input = container.querySelector<HTMLInputElement>(".search-input")!;
        input.value = "hello";
        updateSearchClearVisibility(container, "hello");

        container.querySelector<HTMLElement>(".search-clear")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(input.value).toBe("");
        expect(container.querySelector<HTMLElement>(".search-clear")!.hidden).toBe(true);
        expect(onQueryChange).toHaveBeenCalledWith("");
    });
});
