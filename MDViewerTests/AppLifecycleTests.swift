import XCTest
import AppKit
@testable import MDViewer

/// Backs App Store Guideline 4.0 (Design): closing the main window must not
/// strand the app running with no way to reopen a window. This single-window
/// viewer quits when the last window closes, so the user always relaunches into
/// a fresh window from Finder/Dock.
@MainActor
final class AppLifecycleTests: XCTestCase {
    func test_applicationShouldTerminateAfterLastWindowClosed_isTrue() {
        // Arrange
        let delegate = AppDelegate()

        // Act
        let shouldTerminate = delegate.applicationShouldTerminateAfterLastWindowClosed(.shared)

        // Assert
        XCTAssertTrue(
            shouldTerminate,
            "The app must terminate after the last window closes so it is never left running with no reachable window."
        )
    }
}
