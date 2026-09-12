// Pure string/DOM helpers ported 1:1 from MDViewer/Resources/Web/mdviewer.js.

/** Convert heading text into a URL-safe anchor slug. */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        // Strip any leading/trailing hyphens left by surrounding punctuation or
        // whitespace so anchors match GitHub-style slugs (and the TOC).
        .replace(/^-+|-+$/g, "");
}

/** Escape the HTML-significant characters in a string. */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
