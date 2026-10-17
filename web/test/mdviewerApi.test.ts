import { describe, it, expect, beforeEach, vi } from "vitest";
import { marked } from "marked";
import createDOMPurify from "dompurify";
import katex from "katex";
import { createMDViewerApi, type MDViewerDependencies } from "../src/mdviewerApi.js";
import type { MermaidLike } from "../src/mermaid.js";

const DOMPurify = createDOMPurify(window as any);

function mockMermaid(): MermaidLike {
    return {
        initialize: vi.fn(),
        run: vi.fn(() => Promise.resolve()),
    };
}

function deps(overrides: Partial<MDViewerDependencies> = {}): MDViewerDependencies {
    return {
        marked,
        domPurify: DOMPurify,
        katex,
        mermaid: mockMermaid(),
        ...overrides,
    };
}

beforeEach(() => {
    document.body.innerHTML = '<div id="content"></div><link id="theme-css" href="themes/github-light.css">';
});

describe("createMDViewerApi().setContent", () => {
    it("renders markdown into #content", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent("# Hello **World**");
        expect(document.getElementById("content")!.innerHTML).toContain("<h1");
        expect(document.getElementById("content")!.innerHTML).toContain("Hello <strong>World</strong>");
    });

    it("returns extracted headings with slugified anchors", async () => {
        const api = createMDViewerApi(deps());
        const result = await api.setContent("# Title One\n\n## Title Two");
        expect(result.headings).toEqual([
            { level: 1, title: "Title One", anchor: "title-one" },
            { level: 2, title: "Title Two", anchor: "title-two" },
        ]);
    });

    it("renders block and inline math via KaTeX", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent("Inline $x^2$ and:\n\n$$y = mx + b$$");
        const html = document.getElementById("content")!.innerHTML;
        expect(html).toContain("katex");
        expect(html).not.toContain("MATHBLOCK");
        expect(html).not.toContain("MATHINLINE");
    });

    it("strips a raw <script> tag via DOMPurify", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent('# Title\n\n<script>alert(1)</script>');
        expect(document.getElementById("content")!.innerHTML).not.toContain("<script>");
    });

    it("resolves emoji shortcodes", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent("Ship it :rocket:");
        expect(document.getElementById("content")!.innerHTML).toContain("🚀");
    });

    it("wraps a ```mermaid fence in a .mermaid div and runs the injected mermaid", async () => {
        const mermaid = mockMermaid();
        const api = createMDViewerApi(deps({ mermaid }));
        await api.setContent("```mermaid\ngraph TD;\n```");
        expect(document.getElementById("content")!.innerHTML).toContain('class="mermaid"');
        expect(mermaid.run).toHaveBeenCalledWith({ querySelector: ".mermaid" });
    });

    it("gates remote images per the 'ask' policy by default and reports the blocked count", async () => {
        const api = createMDViewerApi(deps());
        const result = await api.setContent("![alt](https://example.com/pic.png)");
        const html = document.getElementById("content")!.innerHTML;
        expect(html).toContain("data-mdv-remote");
        expect(html).not.toMatch(/<img[^>]*\ssrc="https:\/\/example\.com/);
        expect(result.blockedRemoteCount).toBe(1);
    });

    it("does not gate remote images once the policy is 'always'", async () => {
        const api = createMDViewerApi(deps());
        api.setRemoteContentPolicy("always");
        const result = await api.setContent("![alt](https://example.com/pic.png)");
        const html = document.getElementById("content")!.innerHTML;
        expect(html).toContain('src="https://example.com/pic.png"');
        expect(result.blockedRemoteCount).toBe(0);
    });

    it("rewrites relative image paths against a base URL set before setContent", async () => {
        const api = createMDViewerApi(deps());
        api.setBaseURL("mdviewer-local://localhost/");
        const result = await api.setContent("![alt](assets/pic.png)");
        void result;
        const html = document.getElementById("content")!.innerHTML;
        expect(html).toContain('src="mdviewer-local://localhost/assets/pic.png"');
    });

    it("falls back to an unhighlighted code block when Shiki never resolves", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent("```js\nconsole.log(1);\n```");
        const html = document.getElementById("content")!.innerHTML;
        expect(html).toContain("code-block-wrapper");
        expect(html).toContain("console.log(1);");
    });

    it("awaits shikiReady (bounded by the 8s race) before highlighting the first render", async () => {
        vi.useFakeTimers();
        const highlighter = {
            getLoadedLanguages: () => ["javascript"],
            codeToHtml: () => '<pre class="shiki"><code>hi</code></pre>',
        };
        const api = createMDViewerApi(deps({ shikiReady: Promise.resolve(highlighter) }));
        const pending = api.setContent("```js\nconsole.log(1);\n```");
        await vi.runAllTimersAsync();
        const result = await pending;
        void result;
        expect(document.getElementById("content")!.innerHTML).toContain('class="shiki"');
        vi.useRealTimers();
    });
});

describe("createMDViewerApi().setTheme", () => {
    it("swaps the theme stylesheet href", () => {
        const api = createMDViewerApi(deps());
        api.setTheme("github-dark");
        expect((document.getElementById("theme-css") as HTMLLinkElement).href).toContain("themes/github-dark.css");
    });

    it("toggles the dark-theme body class based on the theme name", () => {
        const api = createMDViewerApi(deps());
        api.setTheme("github-dark");
        expect(document.body.classList.contains("dark-theme")).toBe(true);
        api.setTheme("github-light");
        expect(document.body.classList.contains("dark-theme")).toBe(false);
    });

    it("treats every dark theme as dark, not only names containing 'dark'", () => {
        const api = createMDViewerApi(deps());
        for (const name of ["dracula", "nord", "solarized-dark"]) {
            api.setTheme(name);
            expect(document.body.classList.contains("dark-theme"), name).toBe(true);
        }
        api.setTheme("solarized-light");
        expect(document.body.classList.contains("dark-theme")).toBe(false);
    });

    it("re-initializes mermaid with the matching theme", () => {
        const mermaid = mockMermaid();
        const api = createMDViewerApi(deps({ mermaid }));
        api.setTheme("github-dark");
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ startOnLoad: false, theme: "dark", securityLevel: "loose" }),
        );
    });
});

describe("createMDViewerApi().setFontSize", () => {
    it("sets the --font-size CSS variable in px", () => {
        const api = createMDViewerApi(deps());
        api.setFontSize(20);
        expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("20px");
    });
});

describe("createMDViewerApi().loadRemoteResources", () => {
    it("restores a previously-gated remote image's src", async () => {
        const api = createMDViewerApi(deps());
        await api.setContent("![alt](https://example.com/pic.png)");
        expect(document.getElementById("content")!.innerHTML).toContain("data-mdv-remote");

        api.loadRemoteResources();

        const img = document.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("https://example.com/pic.png");
        expect(img.hasAttribute("data-mdv-remote")).toBe(false);
    });
});
