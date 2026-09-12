import XCTest
@testable import MDViewer

final class HTMLBuilderTests: XCTestCase {
    // MARK: - rendererURL

    func test_rendererURL_inTestBundle_returnsNilOrURL() {
        // In a test host context, Bundle.main is the app bundle.
        // This test verifies the method does not crash and returns
        // either nil (if renderer.html is absent) or a valid URL.
        let result = HTMLBuilder.rendererURL()

        if let url = result {
            // If found, the path should contain "renderer.html"
            XCTAssertTrue(url.lastPathComponent == "renderer.html")
        }
        // nil is acceptable when running without the full app bundle resources
    }

    func test_rendererURL_ifPresent_fileExtensionIsHTML() {
        guard let url = HTMLBuilder.rendererURL() else {
            // renderer.html not bundled in test target — skip assertion
            return
        }
        XCTAssertEqual(url.pathExtension, "html")
    }

    func test_rendererURL_ifPresent_isAbsolutePath() {
        guard let url = HTMLBuilder.rendererURL() else { return }
        XCTAssertTrue(url.isFileURL)
    }

    // MARK: - webResourcesDirectory

    func test_webResourcesDirectory_doesNotCrash() {
        // Act — must not crash regardless of bundle content
        _ = HTMLBuilder.webResourcesDirectory()
    }

    func test_webResourcesDirectory_returnsNilOrDirectoryURL() {
        let result = HTMLBuilder.webResourcesDirectory()

        if let url = result {
            // Should end with "Web"
            XCTAssertEqual(url.lastPathComponent, "Web")
        }
        // nil is acceptable when running without full app bundle
    }

    func test_webResourcesDirectory_ifPresent_isFileURL() {
        guard let url = HTMLBuilder.webResourcesDirectory() else { return }
        XCTAssertTrue(url.isFileURL)
    }

    func test_webResourcesDirectory_derivedFromBundleResourceURL() {
        // webResourcesDirectory() appends "Web" to Bundle.main.resourceURL
        guard let resourceURL = Bundle.main.resourceURL else { return }
        let expected = resourceURL.appendingPathComponent("Web")
        let result = HTMLBuilder.webResourcesDirectory()
        XCTAssertEqual(result, expected)
    }

    // MARK: - Actually bundled (regression: Web was missing from the
    // MDViewer app target's Resources build phase — wired only into
    // MDViewerQL's — so the app built and ran, but renderer.html was never
    // copied into it and the Markdown preview pane rendered as a blank
    // white canvas. TEST_HOST is always the built MDViewer.app for this
    // target (see project.pbxproj), so unlike the tests above, "missing" is
    // never an acceptable outcome here.)

    func test_webResourcesDirectory_actuallyExistsOnDisk() throws {
        let directory = try XCTUnwrap(
            HTMLBuilder.webResourcesDirectory(),
            "webResourcesDirectory() returned nil in an app-hosted test."
        )
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory)
        XCTAssertTrue(exists && isDirectory.boolValue, "Web/ was not bundled into the app at \(directory.path).")
    }

    func test_rendererHTML_actuallyExistsOnDisk() throws {
        let url = try XCTUnwrap(
            HTMLBuilder.rendererURL(),
            "rendererURL() returned nil in an app-hosted test."
        )
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: url.path),
            "renderer.html was not bundled into the app at \(url.path) — the Markdown preview pane would render blank."
        )
    }

    func test_vendorAndMdviewerJS_actuallyExistOnDisk() throws {
        let webDir = try XCTUnwrap(HTMLBuilder.webResourcesDirectory())
        for relativePath in ["mdviewer.js", "mdviewer-base.css", "vendor/marked.min.js", "vendor/dompurify.min.js"] {
            let path = webDir.appendingPathComponent(relativePath).path
            XCTAssertTrue(FileManager.default.fileExists(atPath: path), "\(relativePath) was not bundled at \(path).")
        }
    }
}
