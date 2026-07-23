import SwiftUI
import WebKit

@MainActor
final class ExportViewModel: ObservableObject {
    @Published var isExporting: Bool = false
    @Published var errorMessage: String?

    func baseName(for url: URL?) -> String {
        guard let url else { return "document" }
        let raw = url.deletingPathExtension().lastPathComponent
        return raw.removingPercentEncoding ?? raw
    }

    /// Returns a mutable, independent copy of the shared print info.
    ///
    /// `NSPrintInfo.shared.copy()` is documented to return an `NSPrintInfo`, but
    /// force-casting (`as!`) would trap if the system ever returned an
    /// unexpected type. Falling back to a fresh `NSPrintInfo()` keeps the
    /// print/export paths crash-safe while still yielding a private instance
    /// that callers can mutate without touching the shared one.
    static func mutablePrintInfo() -> NSPrintInfo {
        (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
    }

    func exportToPDF(webView: WKWebView, sourceURL: URL? = nil, pageSize: PDFPageSize = .a4) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "\(baseName(for: sourceURL)).pdf"
        // Default to the document's own folder (nicer than the sandbox container
        // default, which is where exports otherwise "disappear" to).
        if let dir = sourceURL?.deletingLastPathComponent() { panel.directoryURL = dir }

        guard panel.runModal() == .OK, let url = panel.url else { return }

        isExporting = true

        let info = Self.mutablePrintInfo()
        let pt = pageSize.pointSize
        info.paperSize = pt
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.jobDisposition = .save
        info.dictionary().setValue(url, forKey: NSPrintInfo.AttributeKey.jobSavingURL.rawValue)

        let op = webView.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false

        guard let window = webView.window else {
            _ = op.run()
            isExporting = false
            return
        }
        op.runModal(
            for: window,
            delegate: self,
            didRun: #selector(printOperationDidRun(_:success:contextInfo:)),
            contextInfo: UnsafeMutableRawPointer(bitPattern: 0)
        )
    }

    @objc private func printOperationDidRun(
        _: NSPrintOperation,
        success _: Bool,
        contextInfo _: UnsafeMutableRawPointer?
    ) {
        isExporting = false
    }

    func exportToHTML(webView: WKWebView, sourceURL: URL? = nil) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = "\(baseName(for: sourceURL)).html"
        // Default to the document's own folder (see exportToPDF).
        if let dir = sourceURL?.deletingLastPathComponent() { panel.directoryURL = dir }

        guard panel.runModal() == .OK, let url = panel.url else { return }

        isExporting = true
        webView.evaluateJavaScript("document.documentElement.outerHTML") { [weak self] result, error in
            DispatchQueue.main.async {
                self?.isExporting = false
                if let html = result as? String {
                    do {
                        try html.write(to: url, atomically: true, encoding: .utf8)
                    } catch {
                        self?.errorMessage = error.localizedDescription
                    }
                } else if let error {
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func print(webView: WKWebView) {
        let op = makePrintOperation(for: webView)

        // A WKWebView print operation must be run against its hosting window;
        // calling `run()` detached (no window) fails with an error. Run modally
        // for the window when we have one, and only fall back otherwise.
        guard let window = webView.window else {
            _ = op.run()
            return
        }
        op.runModal(
            for: window,
            delegate: self,
            didRun: #selector(printOperationDidRun(_:success:contextInfo:)),
            contextInfo: UnsafeMutableRawPointer(bitPattern: 0)
        )
    }

    /// Builds and configures the print operation for `webView` without running
    /// it. Split out from `print(webView:)` to keep that method small.
    ///
    /// Note: this is deliberately *not* unit-tested by constructing an operation
    /// from a bare `WKWebView`. `WKWebView.printOperation(with:)` on a
    /// content-less, window-less web view produces a degenerate operation that
    /// traps when its print info is inspected — that was the source of an earlier
    /// test-host crash. The crash-safe seam we verify instead is
    /// `mutablePrintInfo()`; the entitlement that makes printing work at all is
    /// verified by `EntitlementsTests`.
    func makePrintOperation(for webView: WKWebView) -> NSPrintOperation {
        let info = Self.mutablePrintInfo()
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        return op
    }
}
