import XCTest
import AppKit
@testable import MDViewer

/// Guards against Cmd-B silently stopping work for "Toggle Sidebar (TOC)".
///
/// A conflict with SwiftUI's default Format-menu Bold command was the
/// working theory. Investigated as far as automation allows without a
/// dedicated UI-testing target, escalating through three levels of
/// confidence:
/// 1. Static menu inspection with no document loaded — Cmd-B claimed only
///    by "Toggle Sidebar (TOC)", no Bold item anywhere.
/// 2. Same check with a real document loaded, Editor Mode on, and the
///    Markdown source `TextEditor`'s underlying `NSTextView` given real
///    first-responder status via `NSWindow.makeFirstResponder` (see
///    `MDVIEWER_TEST_DOCUMENT_PATH` in `MDViewer.xcscheme` and the matching
///    hook in `ContentView.swift`'s `onAppear`) — same result.
/// 3. An actual synthetic Cmd-B `NSEvent` dispatched via `NSApp.sendEvent`
///    while that editor holds focus — `toggleSidebar` fires correctly and
///    the editor's text is untouched.
///
/// No conflict was reproducible at any level, including the most direct one
/// (3). `CommandGroup(replacing: .textFormatting) {}` stays in
/// `MDViewerApp.swift` as a reasonable, harmless simplification — a
/// plain-text source editor has no use for Bold/Italic/Underline — but
/// there is no evidence it was fixing a live bug. If Cmd-B misbehaves again,
/// this file's tests passing means the cause is something none of the three
/// levels above exercises (e.g. a different focus target, a third-party
/// keyboard remapping tool, or a stale build).
@MainActor
final class KeyboardShortcutTests: XCTestCase {
    // MARK: - Menu structure (levels 1 & 2)

    private func menuItemsClaimingCommand(_ key: String) throws -> [NSMenuItem] {
        let mainMenu = try XCTUnwrap(NSApp.mainMenu, "No main menu found — are Commands materialized?")
        var matches: [NSMenuItem] = []

        func walk(_ menu: NSMenu) {
            for item in menu.items {
                if item.keyEquivalent.lowercased() == key.lowercased(),
                   item.keyEquivalentModifierMask == .command {
                    matches.append(item)
                }
                if let submenu = item.submenu {
                    walk(submenu)
                }
            }
        }
        walk(mainMenu)
        return matches
    }

    /// Recursively finds every `NSTextView` under `view` (SwiftUI's
    /// `TextEditor` bridges to a real one, reachable this way).
    private func findTextViews(_ view: NSView) -> [NSTextView] {
        var found: [NSTextView] = []
        if let textView = view as? NSTextView { found.append(textView) }
        for subview in view.subviews { found += findTextViews(subview) }
        return found
    }

    /// Focuses the Markdown editor's real `NSTextView`. Relies on
    /// `MDVIEWER_TEST_DOCUMENT_PATH` (set by the test scheme) having loaded
    /// a document with Editor Mode on at launch, so the editor exists to
    /// focus in the first place.
    @discardableResult
    private func focusMarkdownEditor() throws -> NSTextView {
        let window = try XCTUnwrap(
            NSApp.windows.first(where: { $0.isVisible }),
            "No visible window — is MDVIEWER_TEST_DOCUMENT_PATH set in the test scheme?"
        )
        let textView = try XCTUnwrap(
            findTextViews(try XCTUnwrap(window.contentView)).first,
            "No NSTextView found — the Markdown editor isn't mounted. Check the " +
                "MDVIEWER_TEST_DOCUMENT_PATH launch hook loaded a document with Editor Mode on."
        )
        XCTAssertTrue(window.makeFirstResponder(textView), "Could not focus the Markdown editor's text view.")
        return textView
    }

    func test_commandB_isClaimedOnlyByToggleSidebar_noDocumentLoaded() throws {
        let matches = try menuItemsClaimingCommand("b")
        XCTAssertEqual(
            matches.map(\.title),
            ["Toggle Sidebar (TOC)"],
            "Exactly one menu item should claim Cmd-B."
        )
    }

    func test_commandB_isClaimedOnlyByToggleSidebar_editorFocused() throws {
        try focusMarkdownEditor()
        let matches = try menuItemsClaimingCommand("b")
        XCTAssertEqual(
            matches.map(\.title),
            ["Toggle Sidebar (TOC)"],
            "Exactly one menu item should claim Cmd-B, even with the Markdown editor focused."
        )
    }

    func test_formatMenuTextFormattingCommands_areRemoved() throws {
        let mainMenu = try XCTUnwrap(NSApp.mainMenu)
        let allTitles: [String] = mainMenu.items.flatMap { item -> [String] in
            guard let submenu = item.submenu else { return [] }
            return submenu.items.map(\.title)
        }
        XCTAssertFalse(allTitles.contains("Bold"), "The default Format > Bold command should stay removed.")
    }

    // MARK: - End-to-end keystroke (level 3)

    func test_commandB_withEditorFocused_togglesSidebarAndDoesNotEditText() throws {
        let textView = try focusMarkdownEditor()
        let textBefore = textView.string

        var toggleSidebarFired = false
        let observer = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("MDViewer.toggleSidebar"), object: nil, queue: nil
        ) { _ in toggleSidebarFired = true }
        defer { NotificationCenter.default.removeObserver(observer) }

        let window = try XCTUnwrap(NSApp.windows.first(where: { $0.isVisible }))
        let commandB = try XCTUnwrap(
            NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
                windowNumber: window.windowNumber, context: nil,
                characters: "b", charactersIgnoringModifiers: "b", isARepeat: false, keyCode: 11
            ),
            "Could not construct a synthetic Cmd-B key event."
        )
        NSApp.sendEvent(commandB)

        // sendEvent is synchronous for key events, but give notification
        // delivery and any SwiftUI state propagation a moment to settle.
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))

        XCTAssertTrue(
            toggleSidebarFired,
            "Cmd-B with the Markdown editor focused should fire the sidebar toggle, not get swallowed."
        )
        XCTAssertEqual(
            textView.string, textBefore,
            "Cmd-B should not modify the editor's text (it has no formatting meaning here)."
        )
    }
}
