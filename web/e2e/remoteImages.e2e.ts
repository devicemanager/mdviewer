// Remote-image privacy settings, end to end — 2026-10-19, the user's request
// after a review found that each piece of the Ask / Always / Never chain is
// unit-tested but nothing checked what the app actually does with them.
//
// Runs the real app page (MDViewer/Resources/Web/app.html, the real
// mdviewer.js bundle, the real vendored libraries) in Playwright's WebKit,
// with the CSP from src-tauri/tauri.conf.json applied as a response header
// the way Tauri applies it. The policy reaches the page exactly the way
// render_file does it in src-tauri/src/lib.rs:
// `window.MDViewer.setRemoteContentPolicy('<policy>')`, then `setContent`.
//
// The images are the project's own, on GitHub
// (github.com/devicemanager/mdviewer, its raw files and its Pages site), so
// the documents look like the ones people will actually open. Nothing
// reaches GitHub during the run, though: every request the page makes to
// another origin is answered inside the browser (context.route) and
// recorded, and so is every image the host is asked to fetch. "Contacted"
// below means either — any way a server would learn you opened the file.
//
// The host side is emulated: `fetch_remote_image` (src-tauri/src/
// remote_image.rs, which has its own tests, including one against the real
// GitHub) is stood in for by `hostFetch` below, which records the URL,
// refuses under Never like the Rust does, and returns a 1×1 PNG.
//
// Expected behaviour, Swift v1.2.1's (WebRendererView.swift) except where
// noted:
// - Never: nothing contacted, no prompt.
// - Ask: nothing contacted until you agree; "Load remote content?" —
//   Load / Don't Load / Always Allow.
// - Always: images load, no prompt.
// - Deviation, all policies: only `<img>` images ever load. CSS url(),
//   video posters, SVG <image> etc. stay blocked by the CSP even under
//   Always — Swift's CSP let those through under Ask *before* consent
//   (see remote_image.rs).
//
// Not part of `npm test` (it launches a browser): `npm run test:e2e`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { webkit, type Browser, type Page } from "playwright";

const WEB_ROOT = resolve(process.cwd(), "../MDViewer/Resources/Web");
const TAURI_CONF = resolve(process.cwd(), "../src-tauri/tauri.conf.json");

type Policy = "ask" | "always" | "never";

const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".json": "application/json",
    ".wasm": "application/wasm",
};

// A 1×1 PNG.
const PIXEL_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==";
const PIXEL = Buffer.from(PIXEL_BASE64, "base64");

const RAW = "https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs";
const REPO_RAW = "https://github.com/devicemanager/mdviewer/raw/main/docs"; // redirects to RAW
const PAGES = "https://devicemanager.github.io/mdviewer";

/** One remote image, the simplest document there is. */
const SIMPLE = `# Remote image\n\n![MDViewer icon](${RAW}/icon.png)\n`;

/**
 * A README the way GitHub projects write them: Markdown images, a
 * github.com/…/raw/… link, raw <img> tags, and <picture>/srcset for
 * light/dark variants.
 */
const README = `# MDViewer

![Icon](${RAW}/icon.png)

![Screenshot](${REPO_RAW}/screenshot.png)

<img src="${PAGES}/icon.png" width="64" alt="site icon">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/icon.png?variant=dark">
  <img alt="logo" src="${RAW}/screenshot.png?variant=light">
</picture>

<img alt="hero" srcset="${RAW}/icon.png?variant=srcset 2x">
`;
/** The `<img src>`s above — the only things that should ever load. */
const README_IMAGES = [`${RAW}/icon.png`, `${REPO_RAW}/screenshot.png`, `${PAGES}/icon.png`, `${RAW}/screenshot.png?variant=light`];

/**
 * Every other way a document can make a webview request an image, found
 * 2026-10-19: none goes through the `<img src>` gate, so only the CSP keeps
 * them from loading. Each has its own `via=` so a leak names itself.
 */
const VECTORS = [
    `<p style="background:url(${RAW}/icon.png?via=style-attr)">a</p>`,
    `<style>#content{background:url(${RAW}/icon.png?via=style-tag)}</style>`,
    `<video poster="${RAW}/icon.png?via=video-poster" src="${RAW}/icon.png?via=video-src"></video>`,
    `<audio src="${RAW}/icon.png?via=audio-src" autoplay></audio>`,
    `<video><source src="${RAW}/icon.png?via=source-src"></video>`,
    `<input type="image" src="${RAW}/icon.png?via=input-image">`,
    `<svg><image href="${RAW}/icon.png?via=svg-image" width="10" height="10"/></svg>`,
    `<svg><image xlink:href="${RAW}/icon.png?via=svg-xlink" width="10" height="10"/></svg>`,
    `<table background="${RAW}/icon.png?via=table-bg"><tr><td>x</td></tr></table>`,
].join("\n\n");

let appServer: Server;
let appUrl: string;
let browser: Browser;
let csp: string;

beforeAll(async () => {
    csp = JSON.parse(await readFile(TAURI_CONF, "utf8")).app.security.csp;
    appServer = createServer(async (req, res) => {
        const path = resolve(WEB_ROOT, "." + decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
        if (!path.startsWith(WEB_ROOT)) {
            res.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(path);
            const headers: Record<string, string> = { "content-type": MIME[extname(path)] ?? "application/octet-stream" };
            if (extname(path) === ".html") headers["content-security-policy"] = csp;
            res.writeHead(200, headers).end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise<void>((done) => appServer.listen(0, "127.0.0.1", done));
    const address = appServer.address();
    appUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    browser = await webkit.launch();
});

afterAll(async () => {
    await browser?.close();
    await new Promise<void>((done) => appServer?.close(() => done()));
});

interface App {
    page: Page;
    /** Every remote URL contacted so far, by the page or through the host. */
    contacted: string[];
    /** The policy as the (stubbed) Rust side has it stored right now. */
    storedPolicy: () => Promise<Policy>;
    close: () => Promise<void>;
}

async function openApp(policy: Policy, options: { bypassCSP?: boolean } = {}): Promise<App> {
    const context = await browser.newContext({ bypassCSP: options.bypassCSP ?? false });
    const contacted: string[] = [];
    await context.route(
        (url) => url.origin !== appUrl,
        (route) => {
            contacted.push(route.request().url());
            return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
        },
    );
    await context.exposeFunction("__hostFetch", (url: string, stored: Policy) => {
        if (stored === "never") throw new Error("remote content is set to Never");
        if (!/^https?:\/\//.test(url)) throw new Error("refusing a non-http(s) URL");
        contacted.push(url);
        return `data:image/png;base64,${PIXEL_BASE64}`;
    });
    await context.addInitScript((initial: Policy) => {
        // The first-launch dialog explains remote content too; it's not
        // what's under test here, and its text would look like a prompt.
        localStorage.setItem("mdviewer.permissionsPromptSeen", "true");
        let stored = initial;
        const w = window as unknown as Record<string, unknown>;
        w.__storedPolicy = () => stored;
        w.__TAURI__ = {
            core: {
                invoke: async (cmd: string, args?: Record<string, unknown>) => {
                    switch (cmd) {
                        case "get_remote_content_policy":
                            return stored;
                        case "set_remote_content_policy":
                            stored = args!.policy as typeof stored;
                            return null;
                        case "set_remote_content_policy_always":
                            stored = "always";
                            return null;
                        case "fetch_remote_image":
                            return (w.__hostFetch as (u: string, p: string) => Promise<string>)(args!.url as string, stored);
                        case "list_granted_folders":
                            return [];
                        default:
                            return null;
                    }
                },
            },
            app: { getVersion: async () => "1.0.0" },
        };
    }, policy);
    const page = await context.newPage();
    await page.goto(`${appUrl}/app.html`);
    await page.waitForFunction(() => !!(window as unknown as { MDViewer?: unknown }).MDViewer);
    return {
        page,
        contacted,
        storedPolicy: () => page.evaluate(() => (window as unknown as { __storedPolicy: () => Policy }).__storedPolicy()),
        close: () => context.close(),
    };
}

/** What render_file does: push the stored policy, then the document. */
async function render(app: App, markdown: string): Promise<void> {
    const policy = await app.storedPolicy();
    await app.page.evaluate(
        async ({ p, md }) => {
            const viewer = (window as unknown as {
                MDViewer: { setRemoteContentPolicy(p: string): void; setContent(md: string): Promise<unknown> };
            }).MDViewer;
            viewer.setRemoteContentPolicy(p);
            await viewer.setContent(md);
        },
        { p: policy, md: markdown },
    );
    await settle(app.page);
}

/** Gives loads (or a prompt) time to happen; a blocked one never will. */
async function settle(page: Page): Promise<void> {
    await page
        .waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("#content img[src]")].some((i) => i.complete && i.naturalWidth > 0), undefined, {
            timeout: 1500,
        })
        .catch(() => {});
    await page.waitForTimeout(300);
}

/** How many `<img>`s in the document are actually showing a picture. */
async function imagesShown(page: Page): Promise<number> {
    return page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>("#content img")].filter((i) => i.complete && i.naturalWidth > 0).length);
}

/** The prompt's text if it's on screen, otherwise undefined. */
async function promptShown(page: Page): Promise<string | undefined> {
    return page.evaluate(() => {
        const el = document.getElementById("remote-prompt");
        return el && !el.hidden && el.checkVisibility() ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : undefined;
    });
}

async function press(page: Page, label: string): Promise<void> {
    await page.locator("#remote-prompt").getByRole("button", { name: label, exact: true }).click();
    await settle(page);
}

/** Path + query of each URL, sorted: what was asked for, independent of order. */
function asked(urls: string[]): string[] {
    return urls.map((u) => new URL(u).href).sort();
}

describe("the test harness itself", () => {
    it("sees the page contact a server when the CSP doesn't stop it", async () => {
        // Same page, CSP switched off: the leak vectors go straight out.
        // Proves the interception sees real browser requests, so "nothing
        // contacted" below means blocked, not unobserved.
        const app = await openApp("always", { bypassCSP: true });
        await render(app, VECTORS);
        expect(app.contacted.length).toBeGreaterThan(0);
        await app.close();
    });
});

describe("Never", () => {
    it("contacts nothing and shows no images", async () => {
        const app = await openApp("never");
        await render(app, README);
        expect(app.contacted).toEqual([]);
        expect(await imagesShown(app.page)).toBe(0);
        await app.close();
    });

    it("doesn't ask", async () => {
        const app = await openApp("never");
        await render(app, README);
        expect(await promptShown(app.page)).toBeUndefined();
        await app.close();
    });

    it("refuses on the host side too, even if the page asks", async () => {
        const app = await openApp("never");
        await render(app, SIMPLE);
        await app.page.evaluate(() => (window as unknown as { MDViewer: { loadRemoteResources(): Promise<void> } }).MDViewer.loadRemoteResources());
        await settle(app.page);
        expect(app.contacted).toEqual([]);
        await app.close();
    });
});

describe("Ask", () => {
    it("contacts nothing before you answer", async () => {
        const app = await openApp("ask");
        await render(app, README);
        expect(app.contacted).toEqual([]);
        expect(await imagesShown(app.page)).toBe(0);
        await app.close();
    });

    it("asks, with Swift's wording and the number of images", async () => {
        const app = await openApp("ask");
        await render(app, README);
        const text = await promptShown(app.page);
        expect(text).toContain("Load remote content?");
        expect(text).toContain("This document references 4 images hosted on the internet.");
        expect(text).toContain("Load");
        expect(text).toContain("Don’t Load");
        expect(text).toContain("Always Allow");
        await app.close();
    });

    it("says “1 image” for one", async () => {
        const app = await openApp("ask");
        await render(app, SIMPLE);
        expect(await promptShown(app.page)).toContain("references 1 image hosted");
        await app.close();
    });

    it("doesn't ask when there's nothing remote", async () => {
        const app = await openApp("ask");
        await render(app, "# Local only\n\nNo images at all.");
        expect(await promptShown(app.page)).toBeUndefined();
        await app.close();
    });

    it("Don’t Load: closes the prompt and contacts nothing", async () => {
        const app = await openApp("ask");
        await render(app, README);
        await press(app.page, "Don’t Load");
        expect(await promptShown(app.page)).toBeUndefined();
        expect(app.contacted).toEqual([]);
        expect(await imagesShown(app.page)).toBe(0);
        expect(await app.storedPolicy()).toBe("ask");
        await app.close();
    });

    it("Load: loads this document's images, and only its <img> images", async () => {
        const app = await openApp("ask");
        await render(app, README + "\n\n" + VECTORS);
        await press(app.page, "Load");
        expect(await promptShown(app.page)).toBeUndefined();
        expect(asked(app.contacted)).toEqual(asked(README_IMAGES));
        expect(await imagesShown(app.page)).toBe(README_IMAGES.length);
        expect(await app.storedPolicy()).toBe("ask");
        await app.close();
    });

    it("Load: asks again for the next document", async () => {
        const app = await openApp("ask");
        await render(app, README);
        await press(app.page, "Load");
        await render(app, SIMPLE);
        expect(await promptShown(app.page)).toContain("references 1 image");
        await app.close();
    });

    it("Always Allow: stores Always, loads, and doesn't ask again", async () => {
        const app = await openApp("ask");
        await render(app, README);
        await press(app.page, "Always Allow");
        expect(await app.storedPolicy()).toBe("always");
        expect(await imagesShown(app.page)).toBe(README_IMAGES.length);

        await render(app, SIMPLE);
        expect(await promptShown(app.page)).toBeUndefined();
        expect(await imagesShown(app.page)).toBe(1);
        await app.close();
    });
});

describe("Always", () => {
    it("loads every <img> image, srcset excepted (the sanitizer removes it)", async () => {
        const app = await openApp("always");
        await render(app, README);
        expect(asked(app.contacted)).toEqual(asked(README_IMAGES));
        expect(await imagesShown(app.page)).toBe(README_IMAGES.length);
        await app.close();
    });

    it("doesn't ask", async () => {
        const app = await openApp("always");
        await render(app, README);
        expect(await promptShown(app.page)).toBeUndefined();
        await app.close();
    });
});

describe("images outside <img>", () => {
    // The CSP is the only barrier for these, and it holds under every
    // policy: the page itself never loads anything remote.
    for (const policy of ["never", "ask", "always"] as const) {
        it(`never load under ${policy}`, async () => {
            const app = await openApp(policy);
            await render(app, VECTORS);
            // No <img> in there, so Ask has nothing to ask about.
            expect(await promptShown(app.page)).toBeUndefined();
            expect(app.contacted).toEqual([]);
            await app.close();
        });
    }
});
