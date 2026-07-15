import Cocoa
import Quartz
import WebKit

/// Quick Look preview that renders Markdown using the same bundled
/// renderer.html + marked.js / KaTeX / Mermaid pipeline as the main app.
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

        // Only need render-completion notifications for the preview.
        let contentController = WKUserContentController()
        contentController.add(WeakMessageProxy(self), name: "renderComplete")
        config.userContentController = contentController

        // Serve local images (relative paths in the Markdown) if the sandbox
        // grants access to the document's directory.
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "mdviewer-local")

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

        // Read the document. Fall back to a lenient decoding before giving up.
        if let text = try? String(contentsOf: url, encoding: .utf8) {
            markdown = text
        } else if let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) {
            markdown = text
        } else {
            finish(with: CocoaError(.fileReadUnknown))
            return
        }

        schemeHandler.baseDirectory = url.deletingLastPathComponent().standardizedFileURL

        guard let rendererURL = Self.rendererURL(),
              let webDir = Self.webResourcesDirectory()
        else {
            // Renderer resources missing — still show the document as text.
            loadPlainTextFallback(markdown)
            return
        }

        // Safety net so Quick Look never hangs if rendering stalls.
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: 6.0, repeats: false) { [weak self] _ in
            self?.finish(with: nil)
        }

        webView.loadFileURL(rendererURL, allowingReadAccessTo: webDir)
    }

    // MARK: - Bundled renderer resources (Web/ inside the appex)

    private static func rendererURL() -> URL? {
        Bundle.main.url(forResource: "renderer", withExtension: "html", subdirectory: "Web")
    }

    private static func webResourcesDirectory() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("Web")
    }

    // MARK: - Injection

    private func renderContent() {
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
          @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #d4d4d4; } }
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
        // Break the WKUserContentController → handler retain (proxy is weak, but
        // remove the registration so this controller can deallocate promptly).
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
        // Renderer page is loaded; inject theme + content.
        renderContent()
    }

    func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError _: Error) {
        // Renderer failed to load at all — degrade to plain text.
        loadPlainTextFallback(markdown)
    }

    func webView(_: WKWebView, didFail _: WKNavigation!, withError _: Error) {
        // Don't leave Quick Look hanging on a mid-load failure.
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
