import { describe, it, expect, vi } from "vitest";
import { initializeMermaid, runMermaidDiagrams, DARK_THEME_VARIABLES, type MermaidLike } from "../src/mermaid.js";

function mockMermaid(overrides: Partial<MermaidLike> = {}): MermaidLike {
    return {
        initialize: vi.fn(),
        run: vi.fn(() => Promise.resolve()),
        ...overrides,
    };
}

describe("initializeMermaid", () => {
    it("initializes with the 'default' theme when not dark", () => {
        const mermaid = mockMermaid();
        initializeMermaid(mermaid, false);
        expect(mermaid.initialize).toHaveBeenCalledWith({
            startOnLoad: false,
            theme: "default",
            securityLevel: "loose",
        });
    });

    it("initializes with the 'dark' theme, plus the contrast overrides, when dark", () => {
        const mermaid = mockMermaid();
        initializeMermaid(mermaid, true);
        expect(mermaid.initialize).toHaveBeenCalledWith({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "loose",
            themeVariables: DARK_THEME_VARIABLES,
        });
    });
});

describe("runMermaidDiagrams", () => {
    it("runs against the .mermaid selector", () => {
        const mermaid = mockMermaid();
        runMermaidDiagrams(mermaid);
        expect(mermaid.run).toHaveBeenCalledWith({ querySelector: ".mermaid" });
    });

    it("catches a synchronous throw from run() and warns instead of propagating", () => {
        const mermaid = mockMermaid({
            run: vi.fn(() => {
                throw new Error("boom");
            }),
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => runMermaidDiagrams(mermaid)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith("Mermaid render error:", expect.any(Error));

        warnSpy.mockRestore();
    });

    it("does NOT catch an async rejection from run() — preserved mdviewer.js gap, not fixed here", async () => {
        const rejection = new Error("diagram parse error");
        const mermaid = mockMermaid({
            run: vi.fn(() => {
                const promise = Promise.reject(rejection);
                // The mock itself acknowledges the rejection so this test
                // doesn't leave a real unhandled rejection behind — the
                // assertion below, not this line, is what actually proves
                // runMermaidDiagrams never reacts to it.
                promise.catch(() => {});
                return promise;
            }),
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => runMermaidDiagrams(mermaid)).not.toThrow();
        // Flush the microtask queue so the rejection has had every chance
        // to be observed before asserting nothing reacted to it.
        await Promise.resolve();
        await Promise.resolve();
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });
});
