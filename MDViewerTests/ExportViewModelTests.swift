import XCTest
import AppKit
@testable import MDViewer

@MainActor
final class ExportViewModelTests: XCTestCase {
    var sut: ExportViewModel!

    override func setUp() async throws {
        try await super.setUp()
        sut = ExportViewModel()
    }

    override func tearDown() async throws {
        sut = nil
        try await super.tearDown()
    }

    // MARK: - Initial state

    func test_isExporting_initialValue_isFalse() {
        XCTAssertFalse(sut.isExporting)
    }

    func test_errorMessage_initialValue_isNil() {
        XCTAssertNil(sut.errorMessage)
    }

    // MARK: - baseName(for:)

    func test_baseName_nilURL_returnsDocument() {
        // Arrange
        let url: URL? = nil

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "document")
    }

    func test_baseName_regularFileURL_returnsNameWithoutExtension() {
        // Arrange
        let url = URL(string: "file:///path/to/README.md")

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "README")
    }

    func test_baseName_percentEncodedJapaneseURL_returnsDecodedName() {
        // Arrange — %E3%83%86%E3%82%B9%E3%83%88 is "テスト" percent-encoded
        let url = URL(string: "file:///path/to/%E3%83%86%E3%82%B9%E3%83%88.md")

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "テスト")
    }

    func test_baseName_urlWithNoExtension_returnsLastPathComponent() {
        // Arrange
        let url = URL(string: "file:///path/to/notes")

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "notes")
    }

    func test_baseName_rawJapaneseURL_returnsJapaneseName() {
        // Arrange — URL constructed with percent-encoding disabled
        let url = URL(fileURLWithPath: "/path/to/テスト.md")

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "テスト")
    }

    func test_baseName_percentEncodedSpaceURL_returnsDecodedName() {
        // Arrange — %20 is a space character
        let url = URL(string: "file:///path/to/my%20file.md")

        // Act
        let result = sut.baseName(for: url)

        // Assert
        XCTAssertEqual(result, "my file")
    }

    // MARK: - mutablePrintInfo()
    //
    // These verify the crash-safe seam that replaced the `as!` force-cast on the
    // print/export paths. They deliberately do NOT build an NSPrintOperation from
    // a bare WKWebView: doing so on a content-less, window-less web view produces
    // a degenerate operation that traps when inspected (the earlier test-host
    // crash). Exercising the print-info factory alone is sufficient and safe.

    func test_mutablePrintInfo_returnsAnInstance() {
        // Act
        let info = ExportViewModel.mutablePrintInfo()

        // Assert — a usable NSPrintInfo is returned (never traps, never nil).
        XCTAssertNotNil(info.dictionary())
    }

    func test_mutablePrintInfo_isIndependentOfShared() {
        // Act — the copy must not be the shared singleton, so callers can mutate
        // it (margins, paper size, job disposition) without side effects.
        let info = ExportViewModel.mutablePrintInfo()

        // Assert
        XCTAssertFalse(info === NSPrintInfo.shared)
    }

    func test_mutablePrintInfo_mutationDoesNotAffectShared() {
        // Arrange
        let originalLeftMargin = NSPrintInfo.shared.leftMargin

        // Act — mutate the private copy the way exportToPDF does.
        let info = ExportViewModel.mutablePrintInfo()
        info.leftMargin = originalLeftMargin + 42

        // Assert — the shared instance is untouched.
        XCTAssertEqual(NSPrintInfo.shared.leftMargin, originalLeftMargin)
    }
}
