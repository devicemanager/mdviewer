// Ported from MDViewer/ViewModels/RenderViewModel.swift.
//
// Simplified per "No evaluateJavaScript-style string building" in
// porting-brief.md: Swift crosses a process boundary to reach the WebView,
// so it builds and escapes JS-source strings (escapeForJS) before calling
// webView.evaluateJavaScript. This port assumes it runs in the same webview
// as mdviewer.js, so it calls window.MDViewer.* directly as plain function
// calls — no string serialization, no escaping, and no isRendererReady
// pending-call queue (there's no cross-process load race when it's one page).
//
// Two host concerns Swift wires through this class aren't built yet (see
// plan.md Milestones A/B), so both are injected rather than assumed:
// persistence (Swift's @AppStorage) and granting the mdviewer-local://
// scheme handler access to a directory (Swift's LocalSchemeHandler.baseDirectory).

import {
    githubLight,
    githubDark,
    findTheme,
    pdfPageSizes,
    type MarkdownTheme,
    type PDFPageSizeId,
} from "./markdownTheme.js";
import type { RemoteContentPolicy } from "./remote.js";

export interface MDViewerBridge {
    setContent(markdown: string): void;
    setTheme(cssFileName: string): void;
    setFontSize(size: number): void;
    setBaseURL(url: string): void;
    setRemoteContentPolicy(policy: RemoteContentPolicy): void;
    scrollToAnchor(anchor: string): void;
}

export interface RenderViewModelDeps {
    renderer: MDViewerBridge;
    getRemoteContentPolicy: () => RemoteContentPolicy;
    /** Grants the mdviewer-local:// scheme handler access to this directory. */
    setLocalBaseDirectory?: (directoryURL: string) => void;
    loadStoredThemeId?: () => string | undefined;
    storeThemeId?: (id: string) => void;
    loadStoredFontSize?: () => number | undefined;
    storeFontSize?: (size: number) => void;
    loadStoredPDFPageSizeId?: () => PDFPageSizeId | undefined;
    storePDFPageSizeId?: (id: PDFPageSizeId) => void;
    /** Document to inject the PDF @page style into (defaults to the global document). */
    document?: Document;
}

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 16;
const LOCAL_BASE_URL = "mdviewer-local://localhost/";
const PDF_PAGE_STYLE_ELEMENT_ID = "mdviewer-page-style";

export class RenderViewModel {
    theme: MarkdownTheme;
    fontSize: number;
    hoveredURL = "";
    pdfPageSizeId: PDFPageSizeId;

    private readonly deps: RenderViewModelDeps;

    constructor(deps: RenderViewModelDeps) {
        this.deps = deps;
        const storedThemeId = deps.loadStoredThemeId?.();
        this.theme = (storedThemeId && findTheme(storedThemeId)) || githubLight;
        this.fontSize = deps.loadStoredFontSize?.() ?? DEFAULT_FONT_SIZE;
        this.pdfPageSizeId = deps.loadStoredPDFPageSizeId?.() ?? "a4";
    }

    setTheme(theme: MarkdownTheme): void {
        this.theme = theme;
        this.deps.storeThemeId?.(theme.id);
        this.deps.renderer.setTheme(theme.cssFileName);
    }

    setFontSize(size: number): void {
        const clamped = Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);
        this.fontSize = clamped;
        this.deps.storeFontSize?.(clamped);
        this.deps.renderer.setFontSize(clamped);
    }

    increaseFontSize(): void {
        this.setFontSize(this.fontSize + 2);
    }

    decreaseFontSize(): void {
        this.setFontSize(this.fontSize - 2);
    }

    resetFontSize(): void {
        this.setFontSize(DEFAULT_FONT_SIZE);
    }

    /** The Markdown file's directory, served via the mdviewer-local:// scheme. */
    setBaseURL(directoryURL: string): void {
        this.deps.setLocalBaseDirectory?.(directoryURL);
        this.deps.renderer.setBaseURL(LOCAL_BASE_URL);
    }

    renderMarkdown(markdown: string): void {
        this.deps.renderer.setRemoteContentPolicy(this.deps.getRemoteContentPolicy());
        this.deps.renderer.setContent(markdown);
    }

    scrollToAnchor(anchor: string): void {
        this.deps.renderer.scrollToAnchor(anchor);
    }

    applyCurrentThemeAndFontSize(): void {
        this.deps.renderer.setTheme(this.theme.cssFileName);
        this.deps.renderer.setFontSize(this.fontSize);
    }

    applySystemAppearance(isDark: boolean): void {
        if (this.theme.id === githubLight.id && isDark) {
            this.setTheme(githubDark);
        } else if (this.theme.id === githubDark.id && !isDark) {
            this.setTheme(githubLight);
        }
    }

    setPDFPageSize(id: PDFPageSizeId): void {
        this.pdfPageSizeId = id;
        this.deps.storePDFPageSizeId?.(id);
        this.applyPDFPageSize();
    }

    /** Injects the @page CSS rule the browser print pipeline reads for PDF export. */
    applyPDFPageSize(): void {
        const doc = this.deps.document ?? document;
        const css = `@page { size: ${pdfPageSizes[this.pdfPageSizeId].cssSize}; margin: 15mm; }`;
        let styleEl = doc.getElementById(PDF_PAGE_STYLE_ELEMENT_ID);
        if (!styleEl) {
            styleEl = doc.createElement("style");
            styleEl.id = PDF_PAGE_STYLE_ELEMENT_ID;
            doc.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    }
}
