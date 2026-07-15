import Cocoa
import Quartz
import WebKit

/// Quick Look preview that renders Markdown with full fidelity (marked.js +
/// KaTeX + Mermaid + syntax highlighting) using the *same* renderer.html /
/// mdviewer.js pipeline as the main app.
///
/// The renderer and its vendored JS/CSS are served through a custom
/// `mdviewer-local://bundle/` URL scheme instead of `WKWebView.loadFileURL`.
/// `loadFileURL` does not work inside the sandboxed Quick Look extension — the
/// separate WebContent process cannot inherit the file-read grant — whereas a
/// `WKURLSchemeHandler` runs in this (bundle-readable) extension process and can
/// hand WebKit the bytes directly.
///
/// Note: the extension entitlements must include `com.apple.security.network.client`.
/// WKWebView's helper processes (WebContent/Networking) communicate over local
/// connections, which the App Sandbox blocks without that entitlement — leaving
/// the web view inert (no navigation callbacks at all).
final class PreviewViewController: NSViewController, QLPreviewingController {
    private var webView: WKWebView!
    private let schemeHandler = LocalSchemeHandler()

    private var completion: ((Error?) -> Void)?
    private var didComplete = false
    private var markdown = ""
    private var fallbackTimer: Timer?

    // MARK: - View

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))

        let config = WKWebViewConfiguration()

        // Serve the renderer + vendored JS/CSS (host "bundle") and the document's
        // local images (host "localhost") through the custom scheme handler.
        schemeHandler.bundleResourceDirectory = Bundle.main.resourceURL?.appendingPathComponent("Web")
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "mdviewer-local")

        let contentController = WKUserContentController()
        contentController.add(WeakMessageProxy(self), name: "renderComplete")
        config.userContentController = contentController

        let webView = WKWebView(frame: container.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.allowsLinkPreview = false
        container.addSubview(webView)

        self.webView = webView
        view = container
    }

    // MARK: - QLPreviewingController

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        completion = handler

        // Read the document (lenient decoding before giving up).
        if let text = try? String(contentsOf: url, encoding: .utf8) {
            markdown = text
        } else if let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) {
            markdown = text
        } else {
            finish(with: CocoaError(.fileReadUnknown))
            return
        }

        // Local images in the document resolve against its directory.
        schemeHandler.baseDirectory = url.deletingLastPathComponent().standardizedFileURL

        // Verify the bundled renderer is present; otherwise degrade to text.
        guard let webDir = schemeHandler.bundleResourceDirectory,
              FileManager.default.fileExists(atPath: webDir.appendingPathComponent("renderer.html").path)
        else {
            loadPlainTextFallback(markdown)
            return
        }

        // Safety net so Quick Look never hangs if rendering stalls.
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: 12.0, repeats: false) { [weak self] _ in
            self?.finish(with: nil)
        }

        // Load through the custom scheme — NOT loadFileURL. Relative resources
        // in renderer.html resolve to mdviewer-local://bundle/… and are served
        // from the appex's Web directory by the scheme handler.
        guard let rendererURL = URL(string: "mdviewer-local://bundle/renderer.html") else {
            loadPlainTextFallback(markdown)
            return
        }
        webView.load(URLRequest(url: rendererURL))
    }

    // MARK: - Injection

    private func renderContent() {
        guard !didComplete else { return }
        let isDark = view.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let theme = isDark ? "github-dark" : "github-light"
        webView.evaluateJavaScript("MDViewer.setTheme('\(theme)')")
        webView.evaluateJavaScript("MDViewer.setFontSize(15)")
        webView.evaluateJavaScript("MDViewer.setBaseURL('mdviewer-local://localhost/')")
        webView.evaluateJavaScript("MDViewer.setContent('\(escapeForJS(markdown))')")
    }

    private func loadPlainTextFallback(_ text: String) {
        let escaped = text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          body { font: 13px -apple-system, "SF Mono", Menlo, monospace; margin: 16px;
                 white-space: pre-wrap; word-wrap: break-word; }
          @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #c9d1d9; } }
        </style></head><body>\(escaped)</body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        finish(with: nil)
    }

    // MARK: - Completion

    private func finish(with error: Error?) {
        guard !didComplete else { return }
        didComplete = true
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "renderComplete")
        completion?(error)
        completion = nil
    }

    private func escapeForJS(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "</", with: "<\\/")
    }
}

// MARK: - WKNavigationDelegate

extension PreviewViewController: WKNavigationDelegate {
    func webView(_: WKWebView, didFinish _: WKNavigation!) {
        // Renderer page loaded; inject theme + content.
        renderContent()
    }

    func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError _: Error) {
        // Renderer failed to load at all — degrade to plain text.
        loadPlainTextFallback(markdown)
    }

    func webView(_: WKWebView, didFail _: WKNavigation!, withError _: Error) {
        finish(with: nil)
    }
}

// MARK: - WKScriptMessageHandler

extension PreviewViewController: WKScriptMessageHandler {
    func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "renderComplete" {
            finish(with: nil)
        }
    }
}

/// Forwards WKScriptMessage callbacks weakly so the WKUserContentController does
/// not retain the view controller (avoids a per-preview leak).
private final class WeakMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
