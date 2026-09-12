// Ported 1:1 from the DOMPurify.sanitize call in mdviewer.js's setContent().
// DOMPurify itself stays a pinned global script per porting-brief.md; this
// module just owns the exact config, with DOMPurify injected so it's
// testable without bundling it into this module (see math.ts's KatexLike
// for the same reasoning).

export interface DOMPurifyLike {
    sanitize(html: string, config: Record<string, unknown>): string;
}

export const SANITIZE_CONFIG = {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcset", "formaction", "ping"],
} as const;

export function sanitizeHtml(html: string, domPurify: DOMPurifyLike): string {
    return domPurify.sanitize(html, SANITIZE_CONFIG);
}
