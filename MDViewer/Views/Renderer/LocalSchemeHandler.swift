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
            let response = URLResponse(
                url: url,
                mimeType: mimeType,
                expectedContentLength: data.count,
                textEncodingName: nil
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
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
        default: "application/octet-stream"
        }
    }
}
