import XCTest
@testable import MDViewer

/// Covers two real bugs found while manually testing the render pipeline
/// (2026-09-07): the Markdown preview pane was rendering as a blank white
/// canvas.
///
/// 1. `resolveBundlePath` treated a scheme URL's `.path` (which always
///    starts with "/", e.g. "mdviewer-local://bundle/renderer.html" has path
///    "/renderer.html") as an absolute filesystem path, resolving outside
///    `bundleResourceDirectory` entirely and failing the security check in
///    `webView(_:start:)` — so `renderer.html` never loaded at all.
/// 2. The security checks guarding `bundleResourceDirectory`/`baseDirectory`
///    used `hasPrefix` on unresolved paths. `appendingPathComponent` never
///    collapses ".." segments, so a path like ".../Web/../../../etc/passwd"
///    still string-prefix-matched ".../Web" even though it resolves outside
///    it — directory traversal was not actually blocked, contradicting the
///    "local image access is per-folder and explicit, never whole-disk"
///    security invariant.
final class LocalSchemeHandlerTests: XCTestCase {
    private let bundleDir = URL(fileURLWithPath: "/tmp/mdviewer-test-bundle/Web")
    private let baseDir = URL(fileURLWithPath: "/tmp/mdviewer-test-base/Documents")

    // MARK: - resolveBundlePath (bug 1)

    func test_resolveBundlePath_topLevelFile_resolvesUnderBundleDir() {
        let handler = LocalSchemeHandler()
        handler.bundleResourceDirectory = bundleDir

        let resolved = handler.resolveBundlePath(for: "/renderer.html")

        XCTAssertEqual(resolved?.standardizedFileURL.path, bundleDir.appendingPathComponent("renderer.html").standardizedFileURL.path)
    }

    func test_resolveBundlePath_nestedFile_resolvesUnderBundleDir() {
        let handler = LocalSchemeHandler()
        handler.bundleResourceDirectory = bundleDir

        let resolved = handler.resolveBundlePath(for: "/vendor/marked.min.js")

        XCTAssertEqual(
            resolved?.standardizedFileURL.path,
            bundleDir.appendingPathComponent("vendor/marked.min.js").standardizedFileURL.path
        )
    }

    func test_resolveBundlePath_withoutBundleDirectorySet_returnsNil() {
        let handler = LocalSchemeHandler()
        XCTAssertNil(handler.resolveBundlePath(for: "/renderer.html"))
    }

    // MARK: - resolveRelativePath: base directory (bug 2)

    func test_resolveRelativePath_withBaseDirectory_resolvesRelativeFile() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        let resolved = handler.resolveRelativePath(for: "/image.png")

        XCTAssertEqual(resolved?.standardizedFileURL.path, baseDir.appendingPathComponent("image.png").standardizedFileURL.path)
    }

    func test_resolveRelativePath_withBaseDirectory_resolvesNestedSubdirectoryFile() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        let resolved = handler.resolveRelativePath(for: "/assets/photo.jpg")

        XCTAssertEqual(
            resolved?.standardizedFileURL.path,
            baseDir.appendingPathComponent("assets/photo.jpg").standardizedFileURL.path
        )
    }

    func test_resolveRelativePath_directoryTraversalAboveBase_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        XCTAssertNil(handler.resolveRelativePath(for: "/../../../../etc/passwd"))
    }

    func test_resolveRelativePath_directoryTraversalToSiblingDirectory_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        // "/tmp/mdviewer-test-base/Documents/../SecretSibling" — one level up
        // then into a directory the user never granted access to.
        XCTAssertNil(handler.resolveRelativePath(for: "/../SecretSibling/file.txt"))
    }

    func test_resolveRelativePath_fallsBackToBundleDirectory_whenNoBaseDirectory() {
        let handler = LocalSchemeHandler()
        handler.bundleResourceDirectory = bundleDir

        let resolved = handler.resolveRelativePath(for: "/theme.css")

        XCTAssertEqual(resolved?.standardizedFileURL.path, bundleDir.appendingPathComponent("theme.css").standardizedFileURL.path)
    }

    func test_resolveRelativePath_bundleDirectoryFallback_alsoBlocksTraversal() {
        let handler = LocalSchemeHandler()
        handler.bundleResourceDirectory = bundleDir

        XCTAssertNil(handler.resolveRelativePath(for: "/../../../../etc/passwd"))
    }

    func test_resolveRelativePath_withNeitherDirectorySet_returnsNil() {
        let handler = LocalSchemeHandler()
        XCTAssertNil(handler.resolveRelativePath(for: "/anything.png"))
    }

    // MARK: - isPath(_:within:)

    func test_isPath_exactDirectoryMatch_isWithin() {
        XCTAssertTrue(LocalSchemeHandler.isPath(bundleDir, within: bundleDir))
    }

    func test_isPath_fileInsideDirectory_isWithin() {
        XCTAssertTrue(LocalSchemeHandler.isPath(bundleDir.appendingPathComponent("renderer.html"), within: bundleDir))
    }

    func test_isPath_siblingDirectoryWithMatchingNamePrefix_isNotWithin() {
        // A naive string hasPrefix check would wrongly accept this: "/Web-evil"
        // starts with "/Web" as a string, but it's a different directory.
        let sibling = bundleDir.deletingLastPathComponent().appendingPathComponent("Web-evil")
        XCTAssertFalse(LocalSchemeHandler.isPath(sibling, within: bundleDir))
    }

    func test_isPath_traversalOutsideDirectory_isNotWithin() {
        let traversed = bundleDir.appendingPathComponent("../../../etc/passwd")
        XCTAssertFalse(LocalSchemeHandler.isPath(traversed, within: bundleDir))
    }

    // MARK: - localMarkdownDocumentURL(for:) — relative document links

    func test_localMarkdownDocumentURL_relativeMarkdownLink_resolvesUnderBaseDirectory() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        let resolved = handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://localhost/other.md#section")!)

        XCTAssertEqual(resolved?.standardizedFileURL.path, baseDir.appendingPathComponent("other.md").standardizedFileURL.path)
    }

    func test_localMarkdownDocumentURL_percentEncodedNestedLink_resolvesDecodedPath() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        let resolved = handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://localhost/./my%20docs/Other.MARKDOWN")!)

        XCTAssertEqual(
            resolved?.standardizedFileURL.path,
            baseDir.appendingPathComponent("my docs/Other.MARKDOWN").standardizedFileURL.path
        )
    }

    func test_localMarkdownDocumentURL_absoluteFileMarkdownLink_isReturnedUnchanged() {
        let handler = LocalSchemeHandler()
        let url = URL(fileURLWithPath: "/Users/me/docs/other.md")

        XCTAssertEqual(handler.localMarkdownDocumentURL(for: url), url)
    }

    func test_localMarkdownDocumentURL_traversalOutsideBaseDirectory_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        XCTAssertNil(handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://localhost/../Secret/other.md")!))
    }

    func test_localMarkdownDocumentURL_nonMarkdownRelativeLink_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        XCTAssertNil(handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://localhost/image.png")!))
    }

    func test_localMarkdownDocumentURL_withoutBaseDirectory_doesNotFallBackToBundle() {
        let handler = LocalSchemeHandler()
        handler.bundleResourceDirectory = bundleDir

        XCTAssertNil(handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://localhost/other.md")!))
    }

    func test_localMarkdownDocumentURL_bundleHostLink_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        XCTAssertNil(handler.localMarkdownDocumentURL(for: URL(string: "mdviewer-local://bundle/other.md")!))
    }

    func test_localMarkdownDocumentURL_externalLink_returnsNil() {
        let handler = LocalSchemeHandler()
        handler.baseDirectory = baseDir

        XCTAssertNil(handler.localMarkdownDocumentURL(for: URL(string: "https://example.com/other.md")!))
    }
}
