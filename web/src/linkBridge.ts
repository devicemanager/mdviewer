// Routes a clicked link to whichever native host loaded the renderer: the
// Tauri `handle_link_click` command, or — when the compiled mdviewer.js runs
// inside the Swift app's WKWebView — the `linkClicked` script message handler
// that WebRendererView registers (what the original mdviewer.js posted to).

export interface LinkBridgeHost {
    __TAURI__?: { core: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } };
    webkit?: { messageHandlers?: { linkClicked?: { postMessage: (body: string) => void } } };
}

export function linkClickHandler(host: LinkBridgeHost): ((href: string) => void) | undefined {
    const tauri = host.__TAURI__;
    if (tauri) {
        return (href) => {
            void tauri.core.invoke("handle_link_click", { href });
        };
    }
    const swift = host.webkit?.messageHandlers?.linkClicked;
    if (swift) {
        return (href) => swift.postMessage(href);
    }
    return undefined;
}
