import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachInteractionListeners } from "../src/interactionListeners.js";

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("attachInteractionListeners — scroll", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("reports scroll position after a 100ms debounce", () => {
        const onScroll = vi.fn();
        attachInteractionListeners({ onScroll });

        Object.defineProperty(window, "scrollY", { value: 250, configurable: true });
        Object.defineProperty(document.body, "scrollHeight", { value: 3000, configurable: true });
        window.dispatchEvent(new Event("scroll"));

        expect(onScroll).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onScroll).toHaveBeenCalledWith({ y: 250, height: 3000 });
    });

    it("collapses rapid scroll events into a single debounced callback", () => {
        const onScroll = vi.fn();
        attachInteractionListeners({ onScroll });

        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(50);
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(50);
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(100);

        expect(onScroll).toHaveBeenCalledTimes(1);
    });
});

describe("attachInteractionListeners — link hover", () => {
    it("reports a hovered link's href", () => {
        document.body.innerHTML = '<a id="l" href="https://example.com">link</a>';
        const onLinkHovered = vi.fn();
        attachInteractionListeners({ onLinkHovered });

        document.getElementById("l")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        expect(onLinkHovered).toHaveBeenCalledWith("https://example.com/");
    });

    it("reports an empty string on mouseout", () => {
        document.body.innerHTML = '<a id="l" href="https://example.com">link</a>';
        const onLinkHovered = vi.fn();
        attachInteractionListeners({ onLinkHovered });

        document.getElementById("l")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        expect(onLinkHovered).toHaveBeenCalledWith("");
    });

    it("ignores hover events not on a link", () => {
        document.body.innerHTML = '<p id="p">no link here</p>';
        const onLinkHovered = vi.fn();
        attachInteractionListeners({ onLinkHovered });

        document.getElementById("p")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        expect(onLinkHovered).not.toHaveBeenCalled();
    });

    it("finds the link via closest() when hovering a child element", () => {
        document.body.innerHTML = '<a href="https://example.com"><span id="inner">text</span></a>';
        const onLinkHovered = vi.fn();
        attachInteractionListeners({ onLinkHovered });

        document.getElementById("inner")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        expect(onLinkHovered).toHaveBeenCalledWith("https://example.com/");
    });
});

describe("attachInteractionListeners — link click", () => {
    it("prevents default and reports the href for a non-fragment link", () => {
        document.body.innerHTML = '<a id="l" href="https://example.com/doc.md">link</a>';
        const onLinkClicked = vi.fn();
        attachInteractionListeners({ onLinkClicked });

        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, "preventDefault");
        document.getElementById("l")!.dispatchEvent(event);

        expect(preventDefaultSpy).toHaveBeenCalled();
        expect(onLinkClicked).toHaveBeenCalledWith("https://example.com/doc.md");
    });

    it("leaves fragment-only links alone — no preventDefault, no callback", () => {
        document.body.innerHTML = '<a id="l" href="#section">jump</a>';
        const onLinkClicked = vi.fn();
        attachInteractionListeners({ onLinkClicked });

        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, "preventDefault");
        document.getElementById("l")!.dispatchEvent(event);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
        expect(onLinkClicked).not.toHaveBeenCalled();
    });

    it("ignores clicks not on a link", () => {
        document.body.innerHTML = '<p id="p">no link here</p>';
        const onLinkClicked = vi.fn();
        attachInteractionListeners({ onLinkClicked });

        document.getElementById("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onLinkClicked).not.toHaveBeenCalled();
    });

    it("ignores a link with no href attribute", () => {
        document.body.innerHTML = '<a id="l">no href</a>';
        const onLinkClicked = vi.fn();
        attachInteractionListeners({ onLinkClicked });

        document.getElementById("l")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onLinkClicked).not.toHaveBeenCalled();
    });

    it("does not throw when no callbacks are provided at all", () => {
        document.body.innerHTML = '<a id="l" href="https://example.com">link</a>';
        attachInteractionListeners({});

        expect(() => {
            document.getElementById("l")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            document.getElementById("l")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            window.dispatchEvent(new Event("scroll"));
        }).not.toThrow();
    });
});
