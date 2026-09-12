// Relative-image resolution ported 1:1 from mdviewer.js. Relative <img> sources
// are rewritten to the mdviewer-local:// base so the Swift scheme handler can
// serve them. Absolute URLs (any scheme, protocol-relative, or fragments) are
// left untouched.

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
}
