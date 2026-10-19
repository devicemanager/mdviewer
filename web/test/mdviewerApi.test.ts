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

    it("with a host fetcher, gates remote images under 'always' too and loads them through it", async () => {
        const fetchRemoteImage = vi.fn(async () => "data:image/png;base64,AA==");
        const api = createMDViewerApi(deps({ fetchRemoteImage }));
        api.setRemoteContentPolicy("always");
        const result = await api.setContent("![alt](https://example.com/pic.png)");
        await vi.waitFor(() => expect(document.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AA=="));
        expect(fetchRemoteImage).toHaveBeenCalledWith("https://example.com/pic.png");
        expect(result.blockedRemoteCount).toBe(0);
    });

    it("with a host fetcher, never fetches under 'ask' or 'never' on its own", async () => {
        const fetchRemoteImage = vi.fn(async () => "data:image/png;base64,AA==");
        const api = createMDViewerApi(deps({ fetchRemoteImage }));
        for (const policy of ["ask", "never"]) {
            api.setRemoteContentPolicy(policy);
            await api.setContent("![alt](https://example.com/pic.png)");
            expect(document.querySelector("img")!.hasAttribute("src")).toBe(false);
        }
        expect(fetchRemoteImage).not.toHaveBeenCalled();
    });

    it("reports blocked remote content under 'ask' only", async () => {
        const onRemoteContentBlocked = vi.fn();
        const api = createMDViewerApi(deps({ onRemoteContentBlocked, fetchRemoteImage: async () => "" }));
        await api.setContent("![a](https://example.com/a.png) ![b](https://example.com/b.png)");
        expect(onRemoteContentBlocked).toHaveBeenCalledWith(2);

        onRemoteContentBlocked.mockClear();
        for (const policy of ["never", "always"]) {
            api.setRemoteContentPolicy(policy);
            await api.setContent("![a](https://example.com/a.png)");
        }
        api.setRemoteContentPolicy("ask");
        await api.setContent("No remote images here.");
        expect(onRemoteContentBlocked).not.toHaveBeenCalled();
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

    it("redraws diagrams already on screen, from their source, in the new theme", async () => {
        // A stand-in for Mermaid: records what each run saw, then replaces
        // the source with a drawing and marks it done, as the real one does.
        const seen: string[] = [];
        const mermaid: MermaidLike = {
            initialize: vi.fn(),
            run: vi.fn(() => {
                for (const el of document.querySelectorAll<HTMLElement>(".mermaid")) {
                    seen.push(el.textContent ?? "");
                    el.innerHTML = "<svg>drawn</svg>";
                    el.setAttribute("data-processed", "true");
                }
                return Promise.resolve();
            }),
        };
        const api = createMDViewerApi(deps({ mermaid }));
        await api.setContent("```mermaid\ngraph LR\n  A --> B\n```");
        expect(seen).toEqual(["graph LR\n  A --> B"]);

        api.setTheme("solarized-light");
        expect(mermaid.run).toHaveBeenCalledTimes(2);
        expect(seen[1]).toBe("graph LR\n  A --> B");
        expect(document.querySelector(".mermaid")!.hasAttribute("data-processed")).toBe(true);
        const last = (f: unknown) => Math.max(...(f as ReturnType<typeof vi.fn>).mock.invocationCallOrder);
        expect(last(mermaid.initialize)).toBeLessThan(last(mermaid.run)); // redrawn with the new settings
    });

    it("doesn't run mermaid on a theme change when there are no diagrams", () => {
        const mermaid = mockMermaid();
        const api = createMDViewerApi(deps({ mermaid }));
        api.setTheme("dracula");
        expect(mermaid.run).not.toHaveBeenCalled();
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

    it("goes through the host fetcher when there is one", async () => {
        const fetchRemoteImage = vi.fn(async () => "data:image/png;base64,AA==");
        const api = createMDViewerApi(deps({ fetchRemoteImage }));
        await api.setContent("![alt](https://example.com/pic.png)");

        await api.loadRemoteResources();

        expect(fetchRemoteImage).toHaveBeenCalledWith("https://example.com/pic.png");
        expect(document.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AA==");
    });
});
