// Ported from mdviewer.js's `window.MDViewer` public API object and the
// setContent() render pipeline it exposes — the assembly layer tying
// together every already-ported concern (math, marked renderer overrides,
// sanitize, highlightCode, mermaid, emoji, remote gating, local-resource
// rewriting) into the one thing the host (Swift's RenderViewModel, now
// src-tauri/src/lib.rs's render_file/reload_current_document) actually
// calls. State (`localBaseURL`, `remoteContentPolicy`, `shikiHighlighter`)
// is held as closure variables over the returned object, the same shape
// mdviewer.js's IIFE closure has.
//
// Two concerns mdviewer.js's setContent also owns are deliberately left
// out of this module, per the "one concern per change" working agreement
// — they're separate remaining plan.md items:
// - Notifying "Swift" (window.webkit.messageHandlers.*) of extracted
//   headings, render completion, and blocked remote content. setContent
//   here returns that information instead (`{ headings,
//   blockedRemoteCount }`) so the *next* change (swapping those calls for
//   the Tauri bridge) can consume it without this module needing to know
//   anything about invoke/emit.
// - Scroll-position tracking and link hover/click listeners — a separate
//   concern in mdviewer.js's own IIFE, outside window.MDViewer entirely,
//   and lands in its own module next.
//
// All vendor libraries (marked, DOMPurify, KaTeX, Shiki, Mermaid) are
// injected — same reasoning as every other module in this port (see
// math.ts's KatexLike): testable against the real pinned packages, with
// the actual `window.*` global wiring left to whatever finally calls
// createMDViewerApi (Milestone D's last item — pointing the app at this
// build).

import type { Tokens, marked as markedSingleton } from "marked";
import { renderHeading, renderCode, type ExtractedHeading } from "./markedRenderer.js";
import { protectMath, restoreMath, type KatexLike } from "./math.js";
import { highlightCode, type ShikiHighlighterLike } from "./highlightCode.js";
import { sanitizeHtml, type DOMPurifyLike } from "./sanitize.js";
import { resolveEmoji } from "./emoji.js";
import { gateRemoteResourcesInHTML, loadRemoteResources as restoreRemoteResources, type RemoteContentPolicy } from "./remote.js";
import { rewriteLocalResources } from "./localResources.js";
import { initializeMermaid, runMermaidDiagrams, type MermaidLike } from "./mermaid.js";

/**
 * The subset of marked's top-level API this module needs, typed against
 * marked's own real types (`Pick<typeof marked, ...>`) rather than a
 * hand-rolled interface like this port's other injected dependencies
 * (KatexLike, DOMPurifyLike, ShikiHighlighterLike, MermaidLike). Those are
 * narrow enough to usefully mirror by hand; marked's `Renderer` isn't —
 * it has 20+ methods with sensible defaults (paragraph, list, link, …)
 * that mdviewer.js's `new marked.Renderer()` relies on unmodified, only
 * overriding `heading`/`code`. Reusing marked's real types keeps that
 * default-methods behavior intact instead of forcing every caller to
 * stub out methods this module never touches.
 */
export type MarkedLike = Pick<typeof markedSingleton, "Renderer" | "parse">;

/** The instance `new deps.marked.Renderer()` produces. */
export type MarkedRendererInstance = InstanceType<MarkedLike["Renderer"]>;

/**
 * A minimal, explicit slice of `MarkedRendererInstance`'s `this` shape —
 * just what `renderer.heading`'s override actually reads
 * (`this.parser.parseInline`). Deliberately not `MarkedRendererInstance`
 * itself: routing that through Pick/InstanceType left `parseInline`'s
 * return type unresolved to `unknown` rather than `string` (marked's
 * `_Parser` class isn't itself exported, only reachable indirectly via
 * `typeof _Renderer`'s generic default, which TypeScript wasn't
 * collapsing through that chain). This structural type sidesteps that —
 * real `MarkedRendererInstance` values satisfy it fine, function `this`
 * parameters are checked contravariantly.
 */
interface RendererThisLike {
    parser: { parseInline(tokens: Tokens.Heading["tokens"]): string };
}

export interface MDViewerDependencies {
    marked: MarkedLike;
    domPurify: DOMPurifyLike;
    katex: KatexLike;
    mermaid: MermaidLike;
    /** Mirrors `window.__shikiReady` — resolves once, same as mdviewer.js's module-level `shikiHighlighter`. */
    shikiReady?: Promise<ShikiHighlighterLike>;
}

export interface SetContentResult {
    headings: ExtractedHeading[];
    /**
     * Matches mdviewer.js's `blockedRemoteCount`. The caller should only
     * treat this as notify-worthy when the current policy is `'ask'` —
     * mdviewer.js applies that condition at the notify call site, not
     * inside the gating function, and this return value preserves that
     * same split rather than baking the condition in here.
     */
    blockedRemoteCount: number;
}

export interface MDViewerApi {
    setContent(markdown: string): Promise<SetContentResult>;
    setTheme(themeName: string): void;
    setFontSize(size: number): void;
    scrollToAnchor(anchorId: string): void;
    findText(text: string): void;
    setBaseURL(url: string): void;
    setRemoteContentPolicy(policy: string): void;
    loadRemoteResources(): void;
}

/** Builds the `window.MDViewer` object. */
export function createMDViewerApi(deps: MDViewerDependencies): MDViewerApi {
    let localBaseURL: string | undefined;
    let remoteContentPolicy: RemoteContentPolicy = "ask";
    let shikiHighlighter: ShikiHighlighterLike | undefined;

    return {
        async setContent(markdown: string): Promise<SetContentResult> {
            if (!shikiHighlighter && deps.shikiReady) {
                shikiHighlighter = await Promise.race([
                    deps.shikiReady,
                    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
                ]);
            }

            const headings: ExtractedHeading[] = [];
            const renderer = new deps.marked.Renderer();

            // Regular `function`, not an arrow function: marked calls
            // `renderer.heading(token)` as a method, so `this` must bind
            // to `renderer` at call time (verified against the real
            // `marked` package, not assumed) for `this.parser` — set by
            // marked itself once parsing starts — to be there.
            renderer.heading = function (this: RendererThisLike, token: Tokens.Heading): string {
                const result = renderHeading(token, (tokens) => this.parser.parseInline(tokens));
                headings.push(result.heading);
                return result.html;
            };
            renderer.code = function (token: Tokens.Code): string {
                return renderCode(token, (code, lang) => highlightCode(code, lang, shikiHighlighter));
            };

            const { processed, blocks } = protectMath(markdown);
            // `async: false` pins marked's overload to a plain `string`
            // return (marked's own default; mdviewer.js relies on this
            // being synchronous too) rather than the `string |
            // Promise<string>` union its most general overload allows.
            let html = deps.marked.parse(processed, { renderer, async: false });
            html = sanitizeHtml(html, deps.domPurify);
            html = restoreMath(html, blocks, deps.katex);
            html = resolveEmoji(html);

            const gated = gateRemoteResourcesInHTML(html, remoteContentPolicy);

            const contentEl = document.getElementById("content");
            if (contentEl) {
                contentEl.innerHTML = gated.html;
                rewriteLocalResources(contentEl, localBaseURL ?? null);
                runMermaidDiagrams(deps.mermaid);
            }

            return { headings, blockedRemoteCount: gated.blockedCount };
        },

        setTheme(themeName: string): void {
            const link = document.getElementById("theme-css") as HTMLLinkElement | null;
            if (link) {
                link.href = `themes/${themeName}.css`;
            }
            const isDark = themeName.includes("dark");
            document.body.classList.toggle("dark-theme", isDark);
            initializeMermaid(deps.mermaid, isDark);
        },

        setFontSize(size: number): void {
            document.documentElement.style.setProperty("--font-size", `${size}px`);
        },

        scrollToAnchor(anchorId: string): void {
            const el = document.getElementById(anchorId);
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("heading-anchor-target");
                setTimeout(() => {
                    el.classList.remove("heading-anchor-target");
                }, 2000);
            }
        },

        findText(text: string): void {
            const win = window as unknown as { find?: (...args: unknown[]) => boolean };
            if (win.find) {
                win.find(text, false, false, true, false, true, false);
            }
        },

        setBaseURL(url: string): void {
            localBaseURL = url;
            const contentEl = document.getElementById("content");
            if (contentEl) {
                rewriteLocalResources(contentEl, localBaseURL);
            }
        },

        setRemoteContentPolicy(policy: string): void {
            remoteContentPolicy = policy === "always" || policy === "never" ? policy : "ask";
        },

        loadRemoteResources(): void {
            restoreRemoteResources(document, document.baseURI);
        },
    };
}
