import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenderViewModel, type MDViewerBridge } from "../src/renderViewModel.js";
import { githubDark, findTheme } from "../src/markdownTheme.js";

function fakeRenderer(): MDViewerBridge {
    return {
        setContent: vi.fn(),
        setTheme: vi.fn(),
        setFontSize: vi.fn(),
        setBaseURL: vi.fn(),
        setRemoteContentPolicy: vi.fn(),
        scrollToAnchor: vi.fn(),
    };
}

describe("RenderViewModel", () => {
    let renderer: MDViewerBridge;
    let vm: RenderViewModel;

    beforeEach(() => {
        renderer = fakeRenderer();
        vm = new RenderViewModel({ renderer, getRemoteContentPolicy: () => "ask" });
    });

    it("defaults to github-light at 16pt", () => {
        expect(vm.theme.id).toBe("github-light");
        expect(vm.fontSize).toBe(16);
    });

    it("restores a stored theme and font size on construction", () => {
        const restored = new RenderViewModel({
            renderer,
            getRemoteContentPolicy: () => "ask",
            loadStoredThemeId: () => "dracula",
            loadStoredFontSize: () => 22,
        });
        expect(restored.theme.id).toBe("dracula");
        expect(restored.fontSize).toBe(22);
    });

    it("falls back to github-light for an unknown stored theme id", () => {
        const restored = new RenderViewModel({
            renderer,
            getRemoteContentPolicy: () => "ask",
            loadStoredThemeId: () => "no-such-theme",
        });
        expect(restored.theme.id).toBe("github-light");
    });

    it("setTheme updates state, persists, and calls the renderer", () => {
        const storeThemeId = vi.fn();
        vm = new RenderViewModel({ renderer, getRemoteContentPolicy: () => "ask", storeThemeId });
        vm.setTheme(githubDark);
        expect(vm.theme.id).toBe("github-dark");
        expect(storeThemeId).toHaveBeenCalledWith("github-dark");
        expect(renderer.setTheme).toHaveBeenCalledWith("github-dark");
    });

    it("clamps font size to [10, 32]", () => {
        vm.setFontSize(4);
        expect(vm.fontSize).toBe(10);
        vm.setFontSize(99);
        expect(vm.fontSize).toBe(32);
    });

    it("increase/decrease/reset font size by 2pt steps off the default", () => {
        vm.increaseFontSize();
        expect(vm.fontSize).toBe(18);
        vm.decreaseFontSize();
        vm.decreaseFontSize();
        expect(vm.fontSize).toBe(14);
        vm.resetFontSize();
        expect(vm.fontSize).toBe(16);
    });

    it("setBaseURL grants the local scheme handler and pushes the fixed origin", () => {
        const setLocalBaseDirectory = vi.fn();
        vm = new RenderViewModel({ renderer, getRemoteContentPolicy: () => "ask", setLocalBaseDirectory });
        vm.setBaseURL("/Users/rene/Documents/notes");
        expect(setLocalBaseDirectory).toHaveBeenCalledWith("/Users/rene/Documents/notes");
        expect(renderer.setBaseURL).toHaveBeenCalledWith("mdviewer-local://localhost/");
    });

    it("renderMarkdown pushes the remote-content policy before the content", () => {
        vm = new RenderViewModel({ renderer, getRemoteContentPolicy: () => "never" });
        vm.renderMarkdown("# hello");
        const policyCallOrder = (renderer.setRemoteContentPolicy as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        const contentCallOrder = (renderer.setContent as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        expect(renderer.setRemoteContentPolicy).toHaveBeenCalledWith("never");
        expect(renderer.setContent).toHaveBeenCalledWith("# hello");
        expect(policyCallOrder).toBeLessThan(contentCallOrder);
    });

    it("scrollToAnchor delegates straight to the renderer", () => {
        vm.scrollToAnchor("introduction");
        expect(renderer.scrollToAnchor).toHaveBeenCalledWith("introduction");
    });

    it("applyCurrentThemeAndFontSize pushes both current values", () => {
        vm.setFontSize(20);
        vm.applyCurrentThemeAndFontSize();
        expect(renderer.setTheme).toHaveBeenLastCalledWith("github-light");
        expect(renderer.setFontSize).toHaveBeenLastCalledWith(20);
    });

    describe("applySystemAppearance", () => {
        it("switches github-light to github-dark when the system goes dark", () => {
            vm.applySystemAppearance(true);
            expect(vm.theme.id).toBe("github-dark");
        });

        it("switches github-dark back to github-light when the system goes light", () => {
            vm.setTheme(githubDark);
            vm.applySystemAppearance(false);
            expect(vm.theme.id).toBe("github-light");
        });

        it("leaves a non-default theme alone", () => {
            vm.setTheme(findTheme("nord")!);
            vm.applySystemAppearance(true);
            expect(vm.theme.id).toBe("nord");
        });
    });

    describe("applyPDFPageSize", () => {
        it("creates the @page style element with the a4 default", () => {
            vm.applyPDFPageSize();
            const el = document.getElementById("mdviewer-page-style");
            expect(el?.textContent).toBe("@page { size: 210mm 297mm; margin: 15mm; }");
        });

        it("setPDFPageSize updates state, persists, and reapplies the style", () => {
            const storePDFPageSizeId = vi.fn();
            vm = new RenderViewModel({ renderer, getRemoteContentPolicy: () => "ask", storePDFPageSizeId });
            vm.setPDFPageSize("letter");
            expect(vm.pdfPageSizeId).toBe("letter");
            expect(storePDFPageSizeId).toHaveBeenCalledWith("letter");
            const el = document.getElementById("mdviewer-page-style");
            expect(el?.textContent).toBe("@page { size: 8.5in 11in; margin: 15mm; }");
        });

        it("reuses the existing style element rather than duplicating it", () => {
            vm.applyPDFPageSize();
            vm.setPDFPageSize("a3");
            expect(document.querySelectorAll("#mdviewer-page-style").length).toBe(1);
        });
    });
});
