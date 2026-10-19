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
 * Fetches one remote image on the host's side and returns something the
 * page's CSP allows as an `<img src>` (Tauri: a `data:` URL from
 * src-tauri's `fetch_remote_image`, so the CSP never has to allow
 * http:/https: — see src-tauri/src/remote_image.rs for why).
 */
export type RemoteImageFetcher = (url: string) => Promise<string>;

/**
 * Restore the src of images previously gated by gateRemoteResourcesInHTML.
 * Only http/https URLs are restored. Without a `fetchImage`, the URL itself
 * becomes the src (the Swift host's CSP allows remote images); with one,
 * the src is whatever it returns, and an image it fails on stays unloaded.
 */
export async function loadRemoteResources(root: ParentNode, baseURI: string, fetchImage?: RemoteImageFetcher): Promise<void> {
    const pending: Promise<void>[] = [];
    root.querySelectorAll("img[data-mdv-remote]").forEach(function (img) {
        const remoteSrc = img.getAttribute("data-mdv-remote");
        img.removeAttribute("data-mdv-remote");
        if (!remoteSrc) return;
        let href: string;
        try {
            const parsed = new URL(remoteSrc, baseURI);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
            href = parsed.href;
        } catch {
            return; // Ignore invalid URLs.
        }
        if (!fetchImage) {
            img.setAttribute("src", href);
            return;
        }
        pending.push(
            fetchImage(href).then(
                (src) => img.setAttribute("src", src),
                () => {}, // Unreachable or not an image: stays unloaded, like a broken <img>.
            ),
        );
    });
    await Promise.all(pending);
}
