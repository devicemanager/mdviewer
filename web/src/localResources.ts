// Relative-image resolution ported 1:1 from mdviewer.js. Relative <img> sources
// are rewritten to the mdviewer-local:// base so the Swift scheme handler can
// serve them. Relative <a href> links are rewritten the same way (not in the
// original mdviewer.js). Absolute URLs (any scheme, protocol-relative, or
// fragments) are left untouched.

function isAbsolute(src: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#");
}

/**
 * Rewrite relative img[src] values under `root` against `localBaseURL`.
 * No-op when localBaseURL is null (base not yet known).
 */
export function rewriteLocalResources(root: ParentNode, localBaseURL: string | null): void {
    if (!localBaseURL) {
        return;
    }
    root.querySelectorAll("img[src]").forEach(function (img) {
        const src = img.getAttribute("src");
        if (!src || isAbsolute(src)) {
            return;
        }
        // Encode each path segment but preserve slashes.
        const encoded = src.split("/").map(encodeURIComponent).join("/");
        const path = encoded.startsWith("/") ? encoded.slice(1) : encoded;
        img.setAttribute("src", localBaseURL + path);
    });
    // Relative document links get the same base, so the native link handler can
    // map them back to a file next to the open document instead of receiving a
    // URL resolved against the renderer page's own origin.
    root.querySelectorAll("a[href]").forEach(function (link) {
        const href = link.getAttribute("href");
        if (!href || isAbsolute(href)) {
            return;
        }
        const suffixIndex = href.search(/[?#]/);
        const pathPart = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
        const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);
        const encoded = pathPart.split("/").map(encodeURIComponent).join("/");
        const path = encoded.startsWith("/") ? encoded.slice(1) : encoded;
        link.setAttribute("href", localBaseURL + path + suffix);
    });
}
