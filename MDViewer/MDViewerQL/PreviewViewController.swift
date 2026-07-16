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
        // Layer-back the container: Quick Look hosts this view out-of-process, and
        // without a backing layer WebKit never composites the rendered content to
        // the host — the preview stays blank even though the DOM renders fine.
        container.wantsLayer = true

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

    // MARK: - Snapshot rendering

    private var didSnapshot = false

    /// Wait until web fonts (KaTeX) have loaded, then snapshot the full document.
    private func snapshotDocumentAndFinish(attempt: Int = 0) {
        guard !didComplete, !didSnapshot else { return }
        webView.evaluateJavaScript("(document.fonts && document.fonts.status) || 'loaded'") { [weak self] status, _ in
            guard let self = self, !self.didComplete, !self.didSnapshot else { return }
            if (status as? String) != "loaded", attempt < 20 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.snapshotDocumentAndFinish(attempt: attempt + 1) }
                return
            }
            self.performSnapshot()
        }
    }

    private func performSnapshot() {
        guard !didComplete, !didSnapshot else { return }
        didSnapshot = true
        let width = max(view.bounds.width, 1)
        // Measure the full laid-out document height so the snapshot includes all of it.
        webView.evaluateJavaScript("Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))") { [weak self] result, _ in
            guard let self = self else { return }
            var height = self.view.bounds.height
            if let n = result as? NSNumber { height = CGFloat(truncating: n) }
            height = min(max(height, self.view.bounds.height), 20000) // clamp pathological heights
            // Grow the web view to the full content height so the whole document renders.
            self.webView.frame = NSRect(x: 0, y: 0, width: width, height: height)
            let cfg = WKSnapshotConfiguration()
            cfg.rect = CGRect(x: 0, y: 0, width: width, height: height)
            self.webView.takeSnapshot(with: cfg) { [weak self] image, _ in
                guard let self = self else { return }
                if let image = image {
                    self.displaySnapshot(image, width: width, height: height)
                }
                self.finish(with: nil)
            }
        }
    }

    /// Show the rendered bitmap in a scroll view and hide the live web view.
    private func displaySnapshot(_ image: NSImage, width: CGFloat, height: CGFloat) {
        let scroll = NSScrollView(frame: view.bounds)
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.drawsBackground = false
        scroll.scrollerStyle = .overlay

        let docView = FlippedView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        let imageView = NSImageView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        imageView.imageScaling = .scaleAxesIndependently
        imageView.imageAlignment = .alignTop
        imageView.image = image
        imageView.autoresizingMask = [.width]
        docView.addSubview(imageView)

        scroll.documentView = docView
        webView.isHidden = true
        view.addSubview(scroll)
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
            // Render the document to a static image rather than relying on the live
            // web view: Quick Look hosts this view out-of-process, where WKWebView
            // compositing is unreliable (intermittently blank). A snapshot is
            // deterministic.
            snapshotDocumentAndFinish()
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

/// Top-anchored document view so the snapshot scroll view starts at the top of
/// the document (AppKit's default coordinate origin is bottom-left).
private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
