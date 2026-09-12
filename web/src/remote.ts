// Remote (http/https) image gating ported 1:1 from mdviewer.js.
//
// We operate on the HTML STRING *before* insertion so remote images never start
// loading (setting innerHTML fetches images immediately, so stripping src after
// is too late). On 'ask'/'never' a remote <img>'s src is renamed to
// data-mdv-remote (restorable via loadRemoteResources); on 'always' the string
// is returned unchanged.

export type RemoteContentPolicy = "ask" | "always" | "never";

export interface GateResult {
    html: string;
    blockedCount: number;
}

export function gateRemoteResourcesInHTML(
    htmlString: string,
    policy: RemoteContentPolicy,
): GateResult {
    if (policy === "always") {
        return { html: htmlString, blockedCount: 0 };
    }
    let blockedCount = 0;
    const html = htmlString.replace(
        /(<img\b[^>]*?)\ssrc=(["'])(https?:\/\/[^"']*)\2/gi,
        function (_m, pre: string, q: string, url: string) {
            blockedCount++;
            return pre + " data-mdv-remote=" + q + url + q;
        },
    );
    return { html, blockedCount };
}

/**
 * Restore the src of images previously gated by gateRemoteResourcesInHTML.
 * Only http/https URLs are restored.
 */
export function loadRemoteResources(root: ParentNode, baseURI: string): void {
    root.querySelectorAll("img[data-mdv-remote]").forEach(function (img) {
        const remoteSrc = img.getAttribute("data-mdv-remote");
        if (remoteSrc) {
            try {
                const parsed = new URL(remoteSrc, baseURI);
                if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                    img.setAttribute("src", parsed.href);
                }
            } catch {
                // Ignore invalid URLs.
            }
        }
        img.removeAttribute("data-mdv-remote");
    });
}
