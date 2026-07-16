import SwiftUI
import WebKit

extension Notification.Name {
    static let openLocalDocument = Notification.Name("MDViewer.openLocalDocument")
    static let localResourceAccessDenied = Notification.Name("MDViewer.localResourceAccessDenied")
}

struct WebRendererView: NSViewRepresentable {
    @ObservedObject var renderVM: RenderViewModel
    @ObservedObject var sidebarVM: SidebarViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(renderVM: renderVM, sidebarVM: sidebarVM)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Register JS message handlers
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "headingsExtracted")
        contentController.add(context.coordinator, name: "renderComplete")
        contentController.add(context.coordinator, name: "scrollPositionChanged")
        contentController.add(context.coordinator, name: "linkHovered")
        contentController.add(context.coordinator, name: "linkClicked")
        contentController.add(context.coordinator, name: "remoteContentBlocked")
        config.userContentController = contentController

        // Register the custom scheme for the renderer, its vendored assets, and
        // the document's local images. Serving everything through this scheme
        // gives the WebView a non-file origin where renderer.html's CSP is enforced.
        config.setURLSchemeHandler(context.coordinator.schemeHandler, forURLScheme: "mdviewer-local")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsLinkPreview = false
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        context.coordinator.webView = webView
        renderVM.webView = webView
        renderVM.schemeHandler = context.coordinator.schemeHandler

        // Point the scheme handler at the bundle's Web resources so it can serve
        // renderer.html + vendored JS/CSS through mdviewer-local://bundle/.
        context.coordinator.schemeHandler.bundleResourceDirectory = HTMLBuilder.webResourcesDirectory()
        // The CSP served to the WebView permits remote images unless the policy is
        // "never" (hard block). The JS layer still gates "ask" until consent.
        context.coordinator.schemeHandler.allowsRemoteContent = RemoteContentPolicy.current.cspAllowsRemote
        // When a document-local resource can't be read under the sandbox, surface
        // it so the UI can offer on-demand folder access.
        context.coordinator.schemeHandler.onAccessDenied = { dir in
            NotificationCenter.default.post(name: .localResourceAccessDenied, object: dir)
        }
        loadRenderer(webView: webView)

        return webView
    }

    func updateNSView(_: WKWebView, context _: Context) {
        // Content updates are driven by RenderViewModel, not SwiftUI updates
    }

    private func loadRenderer(webView: WKWebView) {
        // Load through the custom scheme (NOT loadFileURL) so the origin is
        // mdviewer-local://bundle and the renderer's CSP is enforced.
        guard let rendererURL = URL(string: "mdviewer-local://bundle/renderer.html") else { return }
        webView.load(URLRequest(url: rendererURL))
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        let renderVM: RenderViewModel
        let sidebarVM: SidebarViewModel
        let schemeHandler = LocalSchemeHandler()
        weak var webView: WKWebView?

        init(renderVM: RenderViewModel, sidebarVM: SidebarViewModel) {
            self.renderVM = renderVM
            self.sidebarVM = sidebarVM
        }

        /// Called when the renderer HTML finishes loading — push initial content
        func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "headingsExtracted":
                handleHeadingsExtracted(message.body)
            case "renderComplete":
                handleRenderComplete()
            case "scrollPositionChanged":
                break
            case "linkHovered":
                let url = message.body as? String ?? ""
                Task { @MainActor in self.renderVM.hoveredURL = url }
            case "linkClicked":
                guard let urlString = message.body as? String,
                      let url = URL(string: urlString) else { break }
                Task { @MainActor in
                    if url.scheme == "file",
                       ["md", "markdown"].contains(url.pathExtension.lowercased())
                    {
                        NotificationCenter.default.post(name: .openLocalDocument, object: url)
                    } else if let scheme = url.scheme?.lowercased(),
                              ["http", "https", "mailto"].contains(scheme)
                    {
                        NSWorkspace.shared.open(url)
                    }
                    // SECURITY: ignore any other scheme (file:// to non-Markdown,
                    // custom schemes, etc.). A malicious document must not be able
                    // to make the app open/launch arbitrary handlers.
                }
            case "remoteContentBlocked":
                let count = (message.body as? [String: Any])?["count"] as? Int ?? 0
                Task { @MainActor in self.promptRemoteContent(count: count) }
            default:
                break
            }
        }

        /// Ask the user whether to load the remote content a document references.
        @MainActor
        private func promptRemoteContent(count: Int) {
            guard let window = webView?.window else { return }
            let alert = NSAlert()
            alert.messageText = "Load remote content?"
            let noun = count == 1 ? "image" : "images"
            alert.informativeText = "This document references \(count) \(noun) hosted on the internet. "
                + "Loading them reveals your IP address to those servers."
            alert.addButton(withTitle: "Load")           // .alertFirstButtonReturn
            alert.addButton(withTitle: "Don’t Load")      // .alertSecondButtonReturn
            alert.addButton(withTitle: "Always Allow")    // .alertThirdButtonReturn
            alert.beginSheetModal(for: window) { [weak self] response in
                switch response {
                case .alertFirstButtonReturn:
                    self?.webView?.evaluateJavaScript("MDViewer.loadRemoteResources()", completionHandler: nil)
                case .alertThirdButtonReturn:
                    UserDefaults.standard.set(RemoteContentPolicy.always.rawValue,
                                              forKey: RemoteContentPolicy.defaultsKey)
                    self?.webView?.evaluateJavaScript("MDViewer.loadRemoteResources()", completionHandler: nil)
                default:
                    break // Don’t Load
                }
            }
        }

        private func handleHeadingsExtracted(_ body: Any) {
            guard let array = body as? [[String: Any]] else { return }
            var items: [TOCItem] = []
            for dict in array {
                guard
                    let level = dict["level"] as? Int,
                    let title = dict["title"] as? String,
                    let anchor = dict["anchor"] as? String
                else { continue }
                items.append(TOCItem(level: level, title: title, anchor: anchor))
            }
            Task { @MainActor in
                self.sidebarVM.tocItems = items
            }
        }

        private func handleRenderComplete() {}

        // MARK: - WKUIDelegate

        func webView(
            _: WKWebView,
            createWebViewWith _: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures _: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            Task { @MainActor in
                if url.scheme == "file", ["md", "markdown"].contains(url.pathExtension.lowercased()) {
                    NotificationCenter.default.post(name: .openLocalDocument, object: url)
                } else if let scheme = url.scheme, ["http", "https", "mailto"].contains(scheme) {
                    NSWorkspace.shared.open(url)
                }
            }
            return nil
        }

        // MARK: - WKNavigationDelegate

        func webView(_: WKWebView, didFinish _: WKNavigation!) {
            Task { @MainActor in
                self.renderVM.rendererDidLoad()
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url
            else {
                decisionHandler(.allow)
                return
            }

            // Fragment-only navigation stays in-page
            if url.fragment != nil,
               url.scheme == webView.url?.scheme,
               url.host == webView.url?.host
            {
                decisionHandler(.allow)
                return
            }

            // Local Markdown file → open in MDViewer
            if url.scheme == "file",
               ["md", "markdown"].contains(url.pathExtension.lowercased())
            {
                NotificationCenter.default.post(name: .openLocalDocument, object: url)
                decisionHandler(.cancel)
                return
            }

            // http / https / mailto → open in default app
            if let scheme = url.scheme,
               ["http", "https", "mailto"].contains(scheme)
            {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}
