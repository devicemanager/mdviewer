import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showToolbar, fadeToolbar, wireToolbarAutoHide, type MediaQueryLike, type AutoHideSource } from "../src/toolbarAutoHide.js";

let toolbar: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<header id="toolbar"></header>';
    toolbar = document.getElementById("toolbar")!;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** A trivial fake — real `window.matchMedia(...)` results satisfy the
 * same shape, but a test has no real CSS breakpoint to cross. */
function fakeMediaQuery(matches: boolean): MediaQueryLike & { fireChange: () => void } {
    let listener: (() => void) | undefined;
    return {
        matches,
        addEventListener: (_type, l) => {
            listener = l;
        },
        fireChange: () => listener?.(),
    };
}

describe("showToolbar / fadeToolbar", () => {
    it("fadeToolbar adds the class, showToolbar removes it", () => {
        fadeToolbar(toolbar);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
        showToolbar(toolbar);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
    });
});

describe("wireToolbarAutoHide", () => {
    it("starts visible and fades after the delay with no activity", () => {
        wireToolbarAutoHide(toolbar, [], fakeMediaQuery(true), 1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
    });

    it("re-shows the toolbar when a source fires, and restarts the fade countdown", () => {
        const source = new EventTarget();
        wireToolbarAutoHide(toolbar, [{ target: source, type: "scroll" }], fakeMediaQuery(true), 1000);

        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);

        source.dispatchEvent(new Event("scroll"));
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);

        vi.advanceTimersByTime(999);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
        vi.advanceTimersByTime(1);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
    });

    it("resets the countdown on repeated activity instead of fading on the original schedule", () => {
        const source = new EventTarget();
        wireToolbarAutoHide(toolbar, [{ target: source, type: "scroll" }], fakeMediaQuery(true), 1000);

        vi.advanceTimersByTime(600);
        source.dispatchEvent(new Event("scroll")); // resets the 1000ms countdown
        vi.advanceTimersByTime(600); // 1200ms since wire-up, but only 600ms since the reset
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);

        vi.advanceTimersByTime(400); // now 1000ms since the reset
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
    });

    it("wires every provided source, any of which can wake it", () => {
        const a = new EventTarget();
        const b = new EventTarget();
        const sources: AutoHideSource[] = [
            { target: a, type: "scroll" },
            { target: b, type: "resize" },
        ];
        wireToolbarAutoHide(toolbar, sources, fakeMediaQuery(true), 1000);
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);

        b.dispatchEvent(new Event("resize"));
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
    });

    it("does nothing on a non-mobile media query — never fades, activity is a no-op", () => {
        const source = new EventTarget();
        const query = fakeMediaQuery(false);
        wireToolbarAutoHide(toolbar, [{ target: source, type: "scroll" }], query, 1000);

        vi.advanceTimersByTime(5000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);

        source.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(5000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
    });

    it("resets to visible and re-arms the countdown when the breakpoint is crossed into mobile", () => {
        const query = fakeMediaQuery(false);
        wireToolbarAutoHide(toolbar, [], query, 1000);
        vi.advanceTimersByTime(5000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false); // still desktop, never faded

        (query as { matches: boolean }).matches = true;
        query.fireChange();
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false); // freshly re-shown
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true); // now fades on the new mobile countdown
    });

    it("clears a stale fade class when the breakpoint is crossed out of mobile", () => {
        const query = fakeMediaQuery(true);
        wireToolbarAutoHide(toolbar, [], query, 1000);
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);

        (query as { matches: boolean }).matches = false;
        query.fireChange();
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
    });

    it("skips the fade when canFade says no, and fades once it says yes again", () => {
        let scrollable = false;
        const source = new EventTarget();
        wireToolbarAutoHide(toolbar, [{ target: source, type: "scroll" }], fakeMediaQuery(true), 1000, () => scrollable);

        vi.advanceTimersByTime(5000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false); // nothing to make room for

        scrollable = true;
        source.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
    });

    it("a tap on the faded toolbar wakes it and never reaches a button underneath", () => {
        toolbar.innerHTML = '<button id="open">Open</button>';
        const button = document.getElementById("open")!;
        const onOpen = vi.fn();
        button.addEventListener("click", onOpen);
        wireToolbarAutoHide(toolbar, [], fakeMediaQuery(true), 1000);
        vi.advanceTimersByTime(1000);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);

        button.click();
        expect(onOpen).not.toHaveBeenCalled();
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);

        button.click(); // now visible — a normal tap
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("a tap on the visible toolbar passes through and restarts the countdown", () => {
        toolbar.innerHTML = '<button id="open">Open</button>';
        const button = document.getElementById("open")!;
        const onOpen = vi.fn();
        button.addEventListener("click", onOpen);
        wireToolbarAutoHide(toolbar, [], fakeMediaQuery(true), 1000);

        vi.advanceTimersByTime(600);
        button.click();
        expect(onOpen).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(600); // 1200ms since wire-up, 600ms since the tap
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
        vi.advanceTimersByTime(400);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(true);
    });

    it("a tap on the toolbar is inert on desktop — never swallowed, never fades", () => {
        toolbar.innerHTML = '<button id="open">Open</button>';
        const button = document.getElementById("open")!;
        const onOpen = vi.fn();
        button.addEventListener("click", onOpen);
        wireToolbarAutoHide(toolbar, [], fakeMediaQuery(false), 1000);

        button.click();
        vi.advanceTimersByTime(5000);
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(toolbar.classList.contains("toolbar-faded")).toBe(false);
    });
});
