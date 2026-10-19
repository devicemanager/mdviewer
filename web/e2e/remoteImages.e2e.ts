// Remote-image privacy settings, end to end — 2026-10-19, the user's request
// after a review found that each piece of the Ask / Always / Never chain is
// unit-tested but nothing checks what the app actually does with them.
//
// Runs the real app page (MDViewer/Resources/Web/app.html, the real
// mdviewer.js bundle, the real vendored libraries) in Playwright's WebKit,
// with the CSP from src-tauri/tauri.conf.json applied as a response header
// the way Tauri applies it. The policy reaches the page exactly the way
// render_file does it in src-tauri/src/lib.rs:
// `window.MDViewer.setRemoteContentPolicy('<policy>')`, then `setContent`.
//
// "Remote" is a second local HTTP server on another port — a different
// origin, so the CSP treats it like any server on the internet. What's
// measured is what matters for privacy: whether that server receives a
// request (it learns your IP address and that you opened the document),
// and whether the image actually shows.
//
// The expected behaviour is Swift v1.2.1's (WebRendererView.swift):
// - Never: no request, no prompt.
// - Ask: no request until you agree; you're asked ("Load remote
//   content?" — Load / Don't Load / Always Allow); Load calls
//   MDViewer.loadRemoteResources() and the images load.
// - Always: images load, no prompt.
// The CSP there allows remote images unless the policy is Never
// (`cspAllowsRemote`); the port's CSP is static and never does.
//
// Known gaps are `it.fails`: they pass while the gap exists and turn red
// the moment it's fixed — then change them to `it`. As of 2026-10-19:
// - the CSP blocks every remote image, so Always and Ask's Load do nothing;
// - there's no Ask prompt at all (plan.md: "not built yet").
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
const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==",
    "base64",
);

let appServer: Server;
let remoteServer: Server;
let appUrl: string;
let remoteUrl: string;
let browser: Browser;
let csp: string;
/** Paths the "remote" server was asked for, in order. */
let remoteRequests: string[] = [];

function listen(server: Server): Promise<string> {
    return new Promise((done) =>
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            done(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
        }),
    );
}

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
    remoteServer = createServer((req, res) => {
        remoteRequests.push(req.url ?? "");
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(PIXEL);
    });
    appUrl = await listen(appServer);
    remoteUrl = await listen(remoteServer);
    browser = await webkit.launch();
});

afterAll(async () => {
    await browser?.close();
    await new Promise<void>((done) => appServer?.close(() => done()));
    await new Promise<void>((done) => remoteServer?.close(() => done()));
});

interface Opened {
    page: Page;
    /** Every `invoke` the page made, by command name. */
    invokes: () => Promise<string[]>;
}

async function openApp(policy: Policy, options: { bypassCSP?: boolean } = {}): Promise<Opened> {
    remoteRequests = [];
    const context = await browser.newContext({ bypassCSP: options.bypassCSP ?? false });
    await context.addInitScript((stored: Policy) => {
        // The first-launch dialog explains remote content too; it's not
        // what's under test here, and its text would look like a prompt.
        localStorage.setItem("mdviewer.permissionsPromptSeen", "true");
        const calls: string[] = [];
        (window as unknown as { __invokes: string[] }).__invokes = calls;
        (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
            core: {
                invoke: async (cmd: string) => {
                    calls.push(cmd);
                    switch (cmd) {
                        case "get_remote_content_policy":
                            return stored;
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
    return { page, invokes: () => page.evaluate(() => [...(window as unknown as { __invokes: string[] }).__invokes]) };
}

/** What render_file does: push the stored policy, then the document. */
async function showDocument(page: Page, policy: Policy): Promise<void> {
    const markdown = `# Remote image\n\n![remote](${remoteUrl}/pixel.png?doc=1)\n`;
    await page.evaluate(
        async ({ p, md }) => {
            const viewer = (window as unknown as {
                MDViewer: { setRemoteContentPolicy(p: string): void; setContent(md: string): Promise<unknown> };
            }).MDViewer;
            viewer.setRemoteContentPolicy(p);
            await viewer.setContent(md);
        },
        { p: policy, md: markdown },
    );
    await settle(page);
}

/** Gives a load (or a prompt) time to happen; a blocked one never will. */
async function settle(page: Page): Promise<void> {
    await page
        .waitForFunction(() => {
            const img = document.querySelector<HTMLImageElement>("#content img");
            return !!img && img.complete && img.naturalWidth > 0;
        }, undefined, { timeout: 1500 })
        .catch(() => {});
    await page.waitForTimeout(300);
}

async function imageShown(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>("#content img");
        return !!img && img.complete && img.naturalWidth > 0;
    });
}

/**
 * Whether the app asked: a native dialog (any `plugin:dialog|…` invoke, the
 * Tauri counterpart of Swift's NSAlert) or anything visible on the page that
 * asks about remote content. Settings panels are hidden, so their own
 * explanation text doesn't count.
 */
async function wasAsked(opened: Opened): Promise<boolean> {
    if ((await opened.invokes()).some((cmd) => cmd.startsWith("plugin:dialog"))) return true;
    return opened.page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node.parentElement;
            if (!el || el.closest("#content, [hidden], script, style")) continue;
            if (!el.checkVisibility()) continue;
            if (/remote content|load (remote )?images/i.test(node.textContent ?? "")) return true;
        }
        return false;
    });
}

describe("the test harness itself", () => {
    it("sees a remote image load when nothing blocks it", async () => {
        // Same page, CSP switched off: proves the "remote" server is
        // reachable and a load is detected, so the "no request" results
        // below mean blocked, not broken.
        const opened = await openApp("always", { bypassCSP: true });
        await showDocument(opened.page, "always");
        expect(remoteRequests).toHaveLength(1);
        expect(await imageShown(opened.page)).toBe(true);
        await opened.page.context().close();
    });
});

describe("Never", () => {
    it("never contacts the image's server", async () => {
        const opened = await openApp("never");
        await showDocument(opened.page, "never");
        expect(remoteRequests).toEqual([]);
        expect(await imageShown(opened.page)).toBe(false);
        await opened.page.context().close();
    });

    it("doesn't ask", async () => {
        const opened = await openApp("never");
        await showDocument(opened.page, "never");
        expect(await wasAsked(opened)).toBe(false);
        await opened.page.context().close();
    });
});

describe("Ask", () => {
    it("doesn't contact the image's server before you agree", async () => {
        const opened = await openApp("ask");
        await showDocument(opened.page, "ask");
        expect(remoteRequests).toEqual([]);
        expect(await imageShown(opened.page)).toBe(false);
        await opened.page.context().close();
    });

    // Known gap: no prompt exists yet.
    it.fails("asks whether to load the remote images", async () => {
        const opened = await openApp("ask");
        await showDocument(opened.page, "ask");
        expect(await wasAsked(opened)).toBe(true);
        await opened.page.context().close();
    });

    // Known gap: the CSP blocks the load even after you agree. Calls what
    // Swift's "Load" button calls, since there's no button to press yet.
    it.fails("loads the images once you agree", async () => {
        const opened = await openApp("ask");
        await showDocument(opened.page, "ask");
        await opened.page.evaluate(() => (window as unknown as { MDViewer: { loadRemoteResources(): void } }).MDViewer.loadRemoteResources());
        await settle(opened.page);
        try {
            expect(remoteRequests).toHaveLength(1);
            expect(await imageShown(opened.page)).toBe(true);
        } finally {
            await opened.page.context().close();
        }
    });
});

// A README the way GitHub projects write them: https badges, images in the
// repo addressed via raw.githubusercontent.com, uploaded attachments, raw
// <img> tags, and <picture>/srcset for light/dark logos. Requests to these
// hosts are answered inside the browser (context.route), so nothing reaches
// the internet; a route hit means the page tried to contact that server.
const GITHUB_README = `# widget

[![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/widget/actions)
![npm](https://img.shields.io/npm/v/widget.svg)

![Screenshot](https://raw.githubusercontent.com/acme/widget/main/docs/screenshot.png)

<img src="https://github.com/user-attachments/assets/0f1e2d3c" width="400" alt="demo">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/acme/widget/main/logo-dark.png">
  <img alt="logo" src="https://raw.githubusercontent.com/acme/widget/main/logo.png">
</picture>

<img alt="hero" srcset="https://raw.githubusercontent.com/acme/widget/main/hero@2x.png 2x">
`;

async function openReadme(policy: Policy, options: { bypassCSP?: boolean } = {}): Promise<{ opened: Opened; contacted: string[] }> {
    const opened = await openApp(policy, options);
    const contacted: string[] = [];
    await opened.page.context().route(/^https:\/\//, (route) => {
        contacted.push(route.request().url());
        return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
    });
    await opened.page.evaluate(
        async ({ p, md }) => {
            const viewer = (window as unknown as {
                MDViewer: { setRemoteContentPolicy(p: string): void; setContent(md: string): Promise<unknown> };
            }).MDViewer;
            viewer.setRemoteContentPolicy(p);
            await viewer.setContent(md);
        },
        { p: policy, md: GITHUB_README },
    );
    await opened.page.waitForTimeout(1500);
    return { opened, contacted };
}

describe("a GitHub project's README", () => {
    it("can be seen loading when nothing blocks it", async () => {
        // Control, as above: every image in it reaches the (fake) server.
        const { opened, contacted } = await openReadme("always", { bypassCSP: true });
        expect(new Set(contacted.map((u) => new URL(u).host))).toEqual(
            new Set(["github.com", "img.shields.io", "raw.githubusercontent.com"]),
        );
        await opened.page.context().close();
    });

    for (const policy of ["never", "ask"] as const) {
        it(`contacts no server under ${policy === "never" ? "Never" : "Ask"}`, async () => {
            const { opened, contacted } = await openReadme(policy);
            expect(contacted).toEqual([]);
            await opened.page.context().close();
        });

        // The setting itself has to block them, not only the CSP: Swift's
        // CSP allows remote images under Ask, so there the setting is the
        // only thing standing between a document and the network.
        it(`contacts no server under ${policy === "never" ? "Never" : "Ask"} even without the CSP`, async () => {
            const { opened, contacted } = await openReadme(policy, { bypassCSP: true });
            expect(contacted).toEqual([]);
            await opened.page.context().close();
        });
    }
});

describe("Always", () => {
    // Known gap: the CSP's img-src has no http:/https:, so nothing loads.
    it.fails("loads remote images", async () => {
        const opened = await openApp("always");
        await showDocument(opened.page, "always");
        try {
            expect(remoteRequests).toHaveLength(1);
            expect(await imageShown(opened.page)).toBe(true);
        } finally {
            await opened.page.context().close();
        }
    });

    it("doesn't ask", async () => {
        const opened = await openApp("always");
        await showDocument(opened.page, "always");
        expect(await wasAsked(opened)).toBe(false);
        await opened.page.context().close();
    });
});
