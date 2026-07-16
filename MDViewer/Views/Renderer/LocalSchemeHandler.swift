import WebKit

/// Handles `mdviewer-local://` scheme requests to serve local files
/// to WKWebView while enforcing path security.
///
/// Two hosts are recognised:
/// - `localhost` – serves files relative to the Markdown document's directory
///   (images and other assets referenced by the document).
/// - `bundle` – serves files relative to the app/extension bundle's Web
///   resource directory. This is used by the Quick Look extension so
///   WKWebView can load renderer.html and its vendor scripts without
///   relying on `loadFileURL`, which fails in sandboxed app extensions.
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    /// The directory that contains the currently opened Markdown file.
    var baseDirectory: URL?

    /// The bundle's Web resources directory (renderer.html, vendor JS/CSS).
    /// Set this when running inside an app extension so resources can be
    /// served through the custom scheme instead of `loadFileURL`.
    var bundleResourceDirectory: URL?

    /// Whether the served CSP permits remote (http/https) images. Left `false`
    /// to hard-block remote content at the WebKit level (Quick Look, and the
    /// "never" policy). Set `true` for the "ask"/"always" policies — the JS
    /// layer still gates "ask" until the user consents.
    var allowsRemoteContent = false

    /// Called (on the main thread) with the document's base directory when a
    /// document-local resource (e.g. a relative image) cannot be read — under the
    /// App Sandbox this means we lack access to the folder. The app uses this to
    /// offer on-demand folder access.
    var onAccessDenied: ((URL) -> Void)?

    func webView(_: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let host = url.host ?? "localhost"
        let base: URL?

        switch host {
        case "bundle":
            base = bundleResourceDirectory
        default:
            base = baseDirectory
        }

        guard let resolvedBase = base else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        // URL form: mdviewer-local://<host>/<relative-path>
        // The relative path lives in url.path; strip the leading slash and
        // percent-decode it before resolving against the base directory.
        let rawPath = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let relativePath = rawPath.removingPercentEncoding ?? rawPath
        guard !relativePath.isEmpty else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let fileURL = resolvedBase.appendingPathComponent(relativePath).standardized

        // Security: ensure the resolved path stays within the base directory.
        // Append a trailing slash to the base so a sibling directory whose name
        // shares a prefix (e.g. /a/b vs /a/bc) cannot pass the check.
        let basePath = resolvedBase.standardized.path
        let baseBoundary = basePath.hasSuffix("/") ? basePath : basePath + "/"
        guard fileURL.path == basePath || fileURL.path.hasPrefix(baseBoundary) else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let mimeType = mimeType(for: fileURL.pathExtension)
            var headers = [
                "Content-Type": mimeType,
                "Content-Length": String(data.count),
            ]
            // Enforce a strict Content-Security-Policy on the rendered document via
            // a response header. WKWebView does not reliably enforce a <meta> CSP,
            // but it honors the header from a scheme-handled response. Local-only:
            // no remote scripts/images/styles/connections. 'wasm-unsafe-eval' is
            // required by Shiki's oniguruma WASM engine.
            if mimeType == "text/html" {
                // Remote images are permitted only when the policy allows it;
                // otherwise they are hard-blocked here at the WebKit level.
                let imgSrc = allowsRemoteContent
                    ? "img-src 'self' mdviewer-local: data: https: http:; "
                    : "img-src 'self' mdviewer-local: data:; "
                headers["Content-Security-Policy"] =
                    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
                    + "style-src 'self' 'unsafe-inline'; " + imgSrc
                    + "font-src 'self' mdviewer-local: data:; connect-src 'self' mdviewer-local:; "
                    + "base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"
            }
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            // A document-local read failed. Under the App Sandbox this is almost
            // always missing folder access rather than a missing file — surface it
            // so the app can offer to grant access to the document's directory.
            if host != "bundle" {
                let baseDir = resolvedBase
                DispatchQueue.main.async { [weak self] in self?.onAccessDenied?(baseDir) }
            }
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_: WKWebView, stop _: any WKURLSchemeTask) {
        // No-op: tasks complete synchronously
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": "text/html"
        case "css": "text/css"
        case "js": "application/javascript"
        case "json": "application/json"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "svg": "image/svg+xml"
        case "webp": "image/webp"
        case "woff": "font/woff"
        case "woff2": "font/woff2"
        case "ttf": "font/ttf"
        case "wasm": "application/wasm"
        default: "application/octet-stream"
        }
    }
}
