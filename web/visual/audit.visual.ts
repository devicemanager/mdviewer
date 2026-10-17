// Visual contrast & visibility audit — 2026-10-17, the user's request after a
// real-device report that parts of the UI were hard to see on the phone:
// "create tests that go through each css and look at what is visible and
// what is not." Runs the real app page (MDViewer/Resources/Web/app.html,
// the real mdviewer.js bundle, the real theme stylesheets) in Playwright's
// WebKit — the engine family behind iOS's WKWebView — for every theme, at
// phone and desktop width, through every UI state, and checks:
//
// - every visible text run against the pixels actually behind it, to
//   WCAG 2.2 AA (4.5:1, large text 3:1);
// - every icon against its background, to 3:1 (non-text contrast);
// - every interface control (toolbar, search, Preferences, file browser,
//   dialogs) is on screen and not covered by something else;
// - the document fits the window: nothing runs off the side of the screen;
// - the Mermaid diagrams in docs/ (doc-diagrams state), including the
//   colours they set themselves — web/test/docDiagrams.test.ts checks
//   their outline colours, which pixels can't isolate.
//
// "The pixels actually behind it": each state is screenshotted with all
// text (and button icons) made transparent, and the background colour of
// each text run is read from that image. That's what makes translucent
// drawers, blurred overlays, code blocks and diagram boxes measurable
// without modelling them.
//
// Not part of `npm test` (it launches a browser and takes minutes):
// `npm run test:visual`. Writes screenshots and report.json to
// web/visual-output/ (gitignored) for a human look at the same states.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { webkit, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";
import { themes, type MarkdownTheme } from "../src/markdownTheme.js";
import { parseCssColor, composite, contrastRatio, requiredRatio, dominantColor, toHex, type RGBA, type ElementKind } from "./contrast.js";

const WEB_ROOT = resolve(process.cwd(), "../MDViewer/Resources/Web");
const OUTPUT = resolve(process.cwd(), "visual-output");
const DOCUMENT = resolve(process.cwd(), "../test-all-elements.md");
const DOCS = resolve(process.cwd(), "../docs");

const VIEWPORTS = [
    { name: "phone", width: 440, height: 956 }, // iPhone 16 Pro Max, CSS px
    { name: "desktop", width: 1024, height: 768 },
] as const;

type StateName =
    | "welcome"
    | "first-launch-dialog"
    | "document"
    | "search"
    | "prefs-general"
    | "prefs-appearance"
    | "prefs-privacy"
    | "prefs-about"
    | "file-browser"
    | "doc-diagrams"
    | "theme-switch";

const STATES: StateName[] = [
    "welcome",
    "first-launch-dialog",
    "document",
    "search",
    "prefs-general",
    "prefs-appearance",
    "prefs-privacy",
    "prefs-about",
    "file-browser",
    "doc-diagrams",
    "theme-switch",
];

// ---- Page-side measurement --------------------------------------------------

interface Measured {
    kind: ElementKind;
    label: string;
    color: string;
    opacity: number;
    fontSize: number;
    fontWeight: number;
    rect: { x: number; y: number; w: number; h: number };
}

interface ControlProblem {
    label: string;
    problem: "offscreen" | "covered" | "overflow";
    coveredBy?: string;
}

/** Runs in the page. Self-contained: Playwright serializes it. */
function measure(ownContent: boolean): { items: Measured[]; controls: ControlProblem[] } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    function describeEl(el: Element): string {
        const withId = el.closest("[id]");
        const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        return `${withId ? "#" + withId.id + " " : ""}${el.tagName.toLowerCase()}${cls}`;
    }

    function isHidden(el: Element): boolean {
        if (el.closest("[hidden]")) return true;
        const cs = getComputedStyle(el);
        return cs.visibility === "hidden" || cs.display === "none";
    }

    function effectiveOpacity(el: Element | null): number {
        let o = 1;
        for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o;
    }

    function clip(r: DOMRect): { x: number; y: number; w: number; h: number } | undefined {
        const x = Math.max(0, r.left);
        const y = Math.max(0, r.top);
        const w = Math.min(vw, r.right) - x;
        const h = Math.min(vh, r.bottom) - y;
        return w >= 3 && h >= 3 ? { x, y, w, h } : undefined;
    }

    /** Is `el` what a person actually sees at this point (not covered)? */
    function visibleAt(el: Element, x: number, y: number): boolean {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    }

    const items: Measured[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pictographic = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}️]*$/u;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        if (!text.trim() || pictographic.test(text)) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,noscript,title")) continue;
        if (isHidden(parent) || parent.closest(":disabled")) continue;
        // A colour the document's author chose inline is their content,
        // not the app's styling — not something CSS here should override.
        // Except in our own docs (the doc-diagrams state): those colours
        // are ours, and must work in every theme.
        if (!ownContent && parent.closest('#content [style*="color"]:not(pre, pre *)')) continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = [...range.getClientRects()].map(clip).find((r) => r !== undefined);
        if (!rect || !visibleAt(parent, rect.x + rect.w / 2, rect.y + rect.h / 2)) continue;

        const cs = getComputedStyle(parent);
        const isSvgText = parent instanceof SVGElement;
        const color = isSvgText ? cs.fill : cs.color;
        if (color === "none") continue;
        items.push({
            kind: "text",
            label: `${describeEl(parent)} "${text.trim().slice(0, 40)}"`,
            color,
            opacity: effectiveOpacity(parent),
            fontSize: parseFloat(cs.fontSize),
            fontWeight: parseInt(cs.fontWeight, 10) || 400,
            rect,
        });
    }

    // Icons: SVGs drawn in the UI's own colour (toolbar, welcome screen),
    // not Mermaid diagrams (those carry their own text, measured above).
    for (const svg of document.querySelectorAll("button svg, .icon-btn svg, svg.welcome-icon")) {
        if (isHidden(svg)) continue;
        const rect = clip(svg.getBoundingClientRect());
        if (!rect || !visibleAt(svg, rect.x + rect.w / 2, rect.y + rect.h / 2)) continue;
        const cs = getComputedStyle(svg);
        const stroke = cs.stroke && cs.stroke !== "none" ? cs.stroke : cs.fill;
        items.push({
            kind: "icon",
            label: describeEl(svg.closest("button") ?? svg) + ` [${svg.closest("button")?.getAttribute("aria-label") ?? "icon"}]`,
            color: stroke && stroke !== "none" ? stroke : cs.color,
            opacity: effectiveOpacity(svg),
            fontSize: 0,
            fontWeight: 0,
            rect,
        });
    }

    // Only the topmost open layer's controls must be reachable: while a
    // modal or the drawer is open, covering the toolbar is the point.
    const open = (sel: string) => {
        const el = document.querySelector(sel);
        return el && !el.closest("[hidden]") ? el : null;
    };
    const layer =
        open("#permissions") ?? open("#preferences") ?? (document.querySelector("#file-browser.open") ? "#file-browser" : null);
    const chrome = layer ? `#${typeof layer === "string" ? "file-browser" : layer.id}` : "#toolbar, #search, #welcome";
    const controls: ControlProblem[] = [];
    for (const el of document.querySelectorAll(`:is(${chrome}) :is(button, select, input, a[href])`)) {
        if (isHidden(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const label = `${describeEl(el)} [${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}]`;
        // Scrollable panes (the About text, the file list) legitimately
        // hold controls below the fold; only flag ones outside the screen
        // horizontally, or outside it vertically while not in a scroller.
        const inScroller = !!el.closest(".prefs-content, .file-browser-list, #file-browser");
        if (r.left < -1 || r.right > vw + 1 || (!inScroller && (r.top < -1 || r.bottom > vh + 1))) {
            controls.push({ label, problem: "offscreen" });
            continue;
        }
        const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
        const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
        if (cy >= 0 && cy < vh && !visibleAt(el, cx, cy)) {
            const hit = document.elementFromPoint(cx, cy);
            controls.push({ label, problem: "covered", coveredBy: hit ? describeEl(hit) : "nothing" });
        }
    }
    // Text cut off at the screen edge: the reading column must fit the
    // window, with wide tables and code scrolling inside their own box.
    // Text measurement above clips to the viewport, so it can't see this
    // (TestFlight feedback, 2026-10-17: every line ran off a phone screen).
    const main = document.getElementById("main");
    if (main && main.scrollWidth > main.clientWidth + 1) {
        controls.push({ label: `#main scrolls sideways (${main.scrollWidth}px content in ${main.clientWidth}px)`, problem: "overflow" });
    }
    const content = document.getElementById("content");
    if (content && !isHidden(content)) {
        for (const el of content.children) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.left < -1 || r.right > vw + 1)) {
                controls.push({ label: `${describeEl(el)} spans ${Math.round(r.left)}–${Math.round(r.right)}px of ${vw}px`, problem: "overflow" });
            }
        }
    }
    return { items, controls };
}

// ---- Node side ----------------------------------------------------------------

const HIDE_TEXT_CSS = `
*, *::before, *::after, *::placeholder {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    caret-color: transparent !important;
}
svg text, svg tspan { fill: transparent !important; }
button svg, .icon-btn svg, svg.welcome-icon { visibility: hidden !important; }
`;

interface Failure {
    state: string;
    kind: ElementKind | "control";
    label: string;
    detail: string;
}

function pixelsIn(png: PNG, rect: Measured["rect"]): RGBA[] {
    const out: RGBA[] = [];
    const x0 = Math.floor(rect.x);
    const y0 = Math.floor(rect.y);
    const x1 = Math.min(png.width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(png.height, Math.ceil(rect.y + rect.h));
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * png.width + x) * 4;
            out.push({ r: png.data[i], g: png.data[i + 1], b: png.data[i + 2], a: 1 });
        }
    }
    return out;
}

/** Keeps the auto-fading phone toolbar awake for the measurement — the
 * faded state is deliberately near-invisible and exempt; what matters is
 * the toolbar as people use it. A scroll event is exactly what wakes it in
 * the app. */
async function wakeToolbar(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.getElementById("main")?.dispatchEvent(new Event("scroll"));
        document.getElementById("toolbar")?.classList.remove("toolbar-faded");
    });
}

async function auditView(page: Page, state: string, shotName: string, ownContent = false): Promise<{ failures: Failure[]; advisory: number; measured: number }> {
    await wakeToolbar(page);
    const { items, controls } = await page.evaluate(measure, ownContent);
    await page.screenshot({ path: resolve(OUTPUT, `${shotName}.png`) });
    await wakeToolbar(page);
    const hide = await page.addStyleTag({ content: HIDE_TEXT_CSS });
    const bgShot = PNG.sync.read(await page.screenshot());
    await hide.evaluate((el) => (el as Element).remove());

    const failures: Failure[] = [];
    let advisory = 0;
    for (const item of items) {
        const fg = parseCssColor(item.color);
        const bg = dominantColor(pixelsIn(bgShot, item.rect));
        if (!fg || !bg) {
            failures.push({ state, kind: item.kind, label: item.label, detail: `unmeasurable colour "${item.color}"` });
            continue;
        }
        const effective = composite(fg, bg, item.opacity);
        const ratio = contrastRatio(effective, bg);
        const required = requiredRatio(item.kind, item.fontSize, item.fontWeight);
        if (ratio < required) {
            failures.push({
                state,
                kind: item.kind,
                label: item.label,
                detail: `${ratio.toFixed(2)}:1 < ${required}:1 (${toHex(effective)} on ${toHex(bg)})`,
            });
        } else if (item.kind === "text" && required === 4.5 && ratio < 7) {
            advisory += 1; // below the HIG's 7:1 aim for small text — reported, not failed
        }
    }
    for (const c of controls) {
        failures.push({ state, kind: "control", label: c.label, detail: c.problem + (c.coveredBy ? ` by ${c.coveredBy}` : "") });
    }
    return { failures, advisory, measured: items.length };
}

/** Collapses identical findings (same element type, same colours) so one
 * bad rule shows up once, with a count, instead of once per text run. */
function summarize(failures: Failure[]): string[] {
    const groups = new Map<string, { f: Failure; n: number }>();
    for (const f of failures) {
        const key = `${f.state}|${f.kind}|${f.label.replace(/ ".*"$/, "")}|${f.detail}`;
        const g = groups.get(key);
        if (g) g.n += 1;
        else groups.set(key, { f, n: 1 });
    }
    return [...groups.values()].map(({ f, n }) => `[${f.state}] ${f.kind} ${f.label} — ${f.detail}${n > 1 ? ` (×${n})` : ""}`);
}

const STUB_TAURI = () => {
    const listing = {
        path: "/Users/demo/Notes",
        parent: null,
        entries: [
            { name: "Projects", is_dir: true },
            { name: "Ideas.md", is_dir: false },
            { name: "Release Notes.md", is_dir: false },
        ],
    };
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
        core: {
            invoke: async (cmd: string) => {
                switch (cmd) {
                    case "get_remote_content_policy":
                        return "ask";
                    case "list_granted_folders":
                        return ["/Users/demo/Notes"];
                    case "list_directory":
                        return listing;
                    default:
                        return null;
                }
            },
        },
        app: { getVersion: async () => "1.0.0" },
    };
};

let server: Server;
let baseUrl: string;
let browser: Browser;
let markdown: string;
/** Every Mermaid diagram in docs/, as one document — our own content, so its colours are audited too. */
let docDiagrams: string;
const report: { theme: string; viewport: string; state: string; measured: number; advisory: number; failures: string[] }[] = [];

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

beforeAll(async () => {
    await mkdir(OUTPUT, { recursive: true });
    markdown = await readFile(DOCUMENT, "utf8");
    const docFiles = (await readdir(DOCS, { recursive: true })).filter((f) => f.endsWith(".md")).sort();
    const blocks: string[] = [];
    for (const f of docFiles) blocks.push(...((await readFile(join(DOCS, f), "utf8")).match(/```mermaid\n[\s\S]*?```/g) ?? []));
    docDiagrams = blocks.join("\n\n");
    server = createServer(async (req, res) => {
        const path = resolve(WEB_ROOT, "." + decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
        if (!path.startsWith(WEB_ROOT)) {
            res.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(path);
            res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" }).end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    browser = await webkit.launch();
});

afterAll(async () => {
    await writeFile(resolve(OUTPUT, "report.json"), JSON.stringify(report, null, 2));
    await browser?.close();
    await new Promise<void>((done) => server?.close(() => done()));
});

async function openApp(theme: MarkdownTheme, viewport: (typeof VIEWPORTS)[number], firstLaunch: boolean): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme.isDark ? "dark" : "light",
        deviceScaleFactor: 1,
    });
    await context.addInitScript(STUB_TAURI);
    await context.addInitScript(
        ({ themeId, seen }) => {
            localStorage.setItem("mdviewer.themeId", themeId);
            if (seen) localStorage.setItem("mdviewer.permissionsPromptSeen", "true");
        },
        { themeId: theme.id, seen: !firstLaunch },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
    });
    // The test document links a deliberately missing image; any other
    // failed load (a theme stylesheet, a script, a font) is an app bug.
    page.on("response", (r) => {
        if (r.status() >= 400 && r.request().resourceType() !== "image") errors.push(`HTTP ${r.status()}: ${new URL(r.url()).pathname}`);
    });
    await page.goto(`${baseUrl}/app.html`);
    await page.waitForFunction(() => !!(window as unknown as { MDViewer?: unknown }).MDViewer && !document.getElementById("toolbar")?.hidden);
    return { page, errors };
}

async function showDocument(page: Page, md: string = markdown): Promise<void> {
    await page.evaluate((m) => (window as unknown as { MDViewer: { setContent(m: string): Promise<unknown> } }).MDViewer.setContent(m), md);
    // Mermaid renders asynchronously after setContent resolves.
    await page
        .waitForFunction(
            () => {
                const blocks = document.querySelectorAll("#content .mermaid");
                return blocks.length > 0 && [...blocks].every((b) => b.querySelector("svg"));
            },
            undefined,
            { timeout: 15000 },
        )
        .catch(() => {});
    await page.waitForTimeout(300);
}

/** #main is the scroller; audits the whole document a screen at a time. */
async function walkDocument(page: Page, state: string, shot: string, ownContent = false): Promise<{ failures: Failure[]; advisory: number; measured: number }> {
    const all = { failures: [] as Failure[], advisory: 0, measured: 0 };
    for (let step = 0; step < 40; step++) {
        const r = await auditView(page, state, `${shot}-${String(step).padStart(2, "0")}`, ownContent);
        all.failures.push(...r.failures);
        all.advisory += r.advisory;
        all.measured += r.measured;
        const moved = await page.evaluate(() => {
            const main = document.getElementById("main")!;
            const before = main.scrollTop;
            main.scrollTop = before + main.clientHeight * 0.8;
            return main.scrollTop !== before;
        });
        if (!moved) break;
        await page.waitForTimeout(100);
    }
    return all;
}

async function runState(page: Page, state: StateName, shot: string, theme: MarkdownTheme): Promise<{ failures: Failure[]; advisory: number; measured: number }> {
    const click = (sel: string) => page.locator(sel).first().click();
    switch (state) {
        case "welcome":
        case "first-launch-dialog":
            return auditView(page, state, shot);
        case "document":
            await showDocument(page);
            return walkDocument(page, state, shot);
        case "doc-diagrams":
            await showDocument(page, docDiagrams);
            return walkDocument(page, state, shot, true);
        case "theme-switch": {
            // Draw the diagrams in the opposite kind of theme, then switch
            // to this one, as a person does in Preferences: everything on
            // screen must follow (2026-10-17: diagrams kept the old theme's
            // colours, white labels on light boxes after dark → light).
            const setTheme = (css: string) =>
                page.evaluate((c) => (window as unknown as { MDViewer: { setTheme(t: string): void } }).MDViewer.setTheme(c), css);
            await setTheme(theme.isDark ? "github-light" : "dracula");
            await showDocument(page, docDiagrams);
            await setTheme(theme.cssFileName);
            await page.waitForTimeout(300); // the redraw starts asynchronously
            await page.waitForFunction(() => [...document.querySelectorAll("#content .mermaid")].every((b) => b.querySelector("svg")), undefined, { timeout: 15000 });
            await page.waitForTimeout(300);
            return walkDocument(page, state, shot, true);
        }
        case "search":
            await showDocument(page);
            await click('#toolbar [data-action="find"]');
            await page.locator("#search input").first().fill("Markdown");
            await page.keyboard.press("Enter");
            return auditView(page, state, shot);
        case "prefs-general":
        case "prefs-appearance":
        case "prefs-privacy":
        case "prefs-about":
            await showDocument(page);
            await click('#toolbar [data-action="preferences"]');
            await click(`#preferences [data-tab="${state.slice("prefs-".length)}"]`);
            return auditView(page, state, shot);
        case "file-browser":
            await showDocument(page);
            await click('#toolbar [data-action="file-browser-toggle"]');
            await page.locator("#file-browser .file-browser-item").first().waitFor();
            await page.waitForTimeout(300); // the 0.2s slide-in
            return auditView(page, state, shot);
    }
}

for (const viewport of VIEWPORTS) {
    describe(`${viewport.name} (${viewport.width}×${viewport.height})`, () => {
        for (const theme of themes) {
            describe(theme.displayName, () => {
                it.each(STATES)("%s: all text, icons and controls visible", async (state) => {
                    const { page, errors } = await openApp(theme, viewport, state === "first-launch-dialog");
                    try {
                        const shot = `${viewport.name}-${theme.id}-${state}`;
                        const result = await runState(page, state, shot, theme);
                        const lines = summarize(result.failures);
                        report.push({ theme: theme.id, viewport: viewport.name, state, measured: result.measured, advisory: result.advisory, failures: lines });
                        expect(result.measured, "measured nothing — the state didn't render").toBeGreaterThan(0);
                        expect([...errors, ...lines]).toEqual([]);
                    } finally {
                        await page.context().close();
                    }
                });
            });
        }
    });
}
