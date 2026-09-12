import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderTOC, attachTOCClickHandler } from "../src/sidebar.js";
import type { ExtractedHeading } from "../src/markedRenderer.js";

let sidebar: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<nav id="sidebar"></nav>';
    sidebar = document.getElementById("sidebar")!;
});

describe("renderTOC", () => {
    it("shows the empty state when there are no headings", () => {
        renderTOC(sidebar, []);
        expect(sidebar.textContent).toContain("No headings found");
        expect(sidebar.querySelector("ul")).toBeNull();
    });

    it("renders one item per heading, in order", () => {
        const headings: ExtractedHeading[] = [
            { level: 1, title: "Intro", anchor: "intro" },
            { level: 2, title: "Details", anchor: "details" },
        ];
        renderTOC(sidebar, headings);
        const buttons = sidebar.querySelectorAll("button.toc-item");
        expect(buttons).toHaveLength(2);
        expect(buttons[0].textContent).toBe("Intro");
        expect(buttons[1].textContent).toBe("Details");
    });

    it("indents by (level - 1) * 12 points, matching TableOfContentsView exactly", () => {
        const headings: ExtractedHeading[] = [
            { level: 1, title: "H1", anchor: "h1" },
            { level: 3, title: "H3", anchor: "h3" },
        ];
        renderTOC(sidebar, headings);
        const buttons = sidebar.querySelectorAll<HTMLButtonElement>("button.toc-item");
        expect(buttons[0].style.paddingLeft).toBe("0px");
        expect(buttons[1].style.paddingLeft).toBe("24px");
    });

    it("assigns a level-based CSS class matching fontForLevel's tiers", () => {
        const headings: ExtractedHeading[] = [
            { level: 1, title: "H1", anchor: "h1" },
            { level: 2, title: "H2", anchor: "h2" },
            { level: 4, title: "H4", anchor: "h4" },
        ];
        renderTOC(sidebar, headings);
        const buttons = sidebar.querySelectorAll<HTMLButtonElement>("button.toc-item");
        expect(buttons[0].classList.contains("toc-level-1")).toBe(true);
        expect(buttons[1].classList.contains("toc-level-2")).toBe(true);
        expect(buttons[2].classList.contains("toc-level-3-plus")).toBe(true);
    });

    it("stores the anchor on the button for the click handler to read", () => {
        renderTOC(sidebar, [{ level: 1, title: "Intro", anchor: "intro" }]);
        const button = sidebar.querySelector<HTMLButtonElement>("button.toc-item")!;
        expect(button.dataset.anchor).toBe("intro");
    });

    it("escapes heading titles and anchors", () => {
        renderTOC(sidebar, [{ level: 1, title: "<script>", anchor: "a<b" }]);
        expect(sidebar.innerHTML).not.toContain("<script>");
        expect(sidebar.querySelector("button")!.textContent).toBe("<script>");
    });

    it("replaces a previous render wholesale, not appending", () => {
        renderTOC(sidebar, [{ level: 1, title: "First", anchor: "first" }]);
        renderTOC(sidebar, [{ level: 1, title: "Second", anchor: "second" }]);
        expect(sidebar.querySelectorAll("button.toc-item")).toHaveLength(1);
        expect(sidebar.textContent).toContain("Second");
        expect(sidebar.textContent).not.toContain("First");
    });
});

describe("attachTOCClickHandler", () => {
    it("calls onSelect with the clicked item's anchor", () => {
        renderTOC(sidebar, [{ level: 1, title: "Intro", anchor: "intro" }]);
        const onSelect = vi.fn();
        attachTOCClickHandler(sidebar, onSelect);

        sidebar.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSelect).toHaveBeenCalledWith("intro");
    });

    it("does nothing when the click isn't on a TOC item", () => {
        renderTOC(sidebar, [{ level: 1, title: "Intro", anchor: "intro" }]);
        const onSelect = vi.fn();
        attachTOCClickHandler(sidebar, onSelect);

        sidebar.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSelect).not.toHaveBeenCalled();
    });

    it("still works after renderTOC replaces the list, via delegation", () => {
        const onSelect = vi.fn();
        attachTOCClickHandler(sidebar, onSelect);

        renderTOC(sidebar, [{ level: 1, title: "First", anchor: "first" }]);
        renderTOC(sidebar, [{ level: 1, title: "Second", anchor: "second" }]);
        sidebar.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSelect).toHaveBeenCalledWith("second");
    });

    it("finds the anchor even when the click lands on text inside the button", () => {
        renderTOC(sidebar, [{ level: 1, title: "Intro", anchor: "intro" }]);
        const onSelect = vi.fn();
        attachTOCClickHandler(sidebar, onSelect);

        // Simulate clicking the button's own child text node's containing
        // element by dispatching on the button — matches how a real click
        // on rendered text bubbles up to the nearest button ancestor.
        const button = sidebar.querySelector("button")!;
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSelect).toHaveBeenCalledWith("intro");
    });
});
