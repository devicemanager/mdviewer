import XCTest
@testable import MDViewer

/// Backs App Store Guideline 2.4.5(i): user content must be saved to a
/// user-accessible location chosen via a standard Save dialog, never silently to
/// the hidden sandbox container. These tests exercise the persistence path that
/// `save()` / `saveAs()` use once a destination URL has been chosen, plus the
/// in-place save of an already-open document.
@MainActor
final class DocumentViewModelTests: XCTestCase {
    var sut: DocumentViewModel!
    private var tempFiles: [URL] = []

    override func setUp() async throws {
        try await super.setUp()
        sut = DocumentViewModel()
    }

    override func tearDown() async throws {
        for url in tempFiles { try? FileManager.default.removeItem(at: url) }
        tempFiles.removeAll()
        sut = nil
        try await super.tearDown()
    }

    private func makeTempURL() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("mdv_\(UUID().uuidString).md")
        tempFiles.append(url)
        return url
    }

    // MARK: - writeDocument (the Save As / new-document persistence path)

    func test_writeDocument_writesTextToChosenURL() throws {
        // Arrange
        let url = makeTempURL()
        sut.text = "# Title\n\nBody text."

        // Act
        let ok = sut.writeDocument(to: url, adoptAsCurrent: false)

        // Assert — the content lands, byte-for-byte, at the user-chosen location.
        XCTAssertTrue(ok)
        let onDisk = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(onDisk, "# Title\n\nBody text.")
        XCTAssertFalse(sut.isDirty)
        XCTAssertNil(sut.errorMessage)
    }

    func test_writeDocument_adoptAsCurrent_setsFileURLAndClearsDirty() throws {
        // Arrange — freshly-typed content with no backing file yet.
        let url = makeTempURL()
        sut.updateText("draft content")
        XCTAssertTrue(sut.isDirty)

        // Act
        let ok = sut.writeDocument(to: url, adoptAsCurrent: true)

        // Assert — Save As adopts the chosen file as the working document.
        XCTAssertTrue(ok)
        XCTAssertEqual(sut.fileURL, url)
        XCTAssertFalse(sut.isDirty)
    }

    func test_writeDocument_failure_setsErrorMessageAndReturnsFalse() {
        // Arrange — a path inside a directory that does not exist cannot be written.
        let url = URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/note.md")
        sut.text = "data"

        // Act
        let ok = sut.writeDocument(to: url, adoptAsCurrent: false)

        // Assert — failure is surfaced, not swallowed.
        XCTAssertFalse(ok)
        XCTAssertNotNil(sut.errorMessage)
    }

    // MARK: - save (in-place save of an already-open document)

    func test_save_withExistingFile_persistsEditsAndClearsDirty() throws {
        // Arrange
        let url = makeTempURL()
        sut.fileURL = url
        sut.updateText("edited body")
        XCTAssertTrue(sut.isDirty)

        // Act
        sut.save()

        // Assert
        let onDisk = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(onDisk, "edited body")
        XCTAssertFalse(sut.isDirty)
        XCTAssertNil(sut.errorMessage)
    }
}
