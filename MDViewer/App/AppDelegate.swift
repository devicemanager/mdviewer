import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Maximum number of recent files to remember (matches macOS default).
    private static let maxRecentFiles = 10

    func applicationDidFinishLaunching(_: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = true

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleOpenLocalDocument(_:)),
            name: .openLocalDocument,
            object: nil
        )

        // Register a menu handler that builds the "File > Open Recent" submenu
        // from NSDocumentController's managed recent document list. This is
        // wired at runtime because SwiftUI's CommandGroup does not expose
        // NSDocumentController.recentDocumentURLs as sub-items automatically.
        registerRecentFilesMenu()

        // Register for notifications so we can add new URLs to the recents.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didOpenFile(_:)),
            name: .openFile,
            object: nil
        )
    }

    /// Build and attach a File > Open Recent submenu from NSDocumentController.
    private func registerRecentFilesMenu() {
        guard var fileMenu = NSApp.mainMenu?.item(
            withTitle: NSLocalizedString("File", comment: "")
        ) else { return }

        let openRecent = NSMenuItem(title: NSLocalizedString("Open Recent", comment: ""), action: nil, keyEquivalent: "")
        openRecent.submenu = NSMenu()
        fileMenu.submenu?.addItem(openRecent)
        fileMenu.submenu?.addItem(NSMenuItem.separator())

        // "Clear Recents" item (always at the end of Open Recent submenu).
        let clearRecents = NSMenuItem(
            title: NSLocalizedString("Clear Recents", comment: ""),
            action: #selector(clearRecentFiles(_:)),
            keyEquivalent: ""
        )
        fileMenu.submenu?.addItem(clearRecents)

        updateRecentFilesMenu(submenu: openRecent.submenu!)
    }

    /// Refresh the "Open Recent" submenu from NSDocumentController.
    private func updateRecentFilesMenu(submenu: NSMenu) {
        // Remove old dynamic items (everything after the label).
        let items = submenu.items
        while submenu.items.count > 1 {
            submenu.removeItem(at: 1)
        }

        for url in NSDocumentController.shared.recentDocumentURLs.prefix(AppDelegate.maxRecentFiles) {
            let item = NSMenuItem(
                title: url.lastPathComponent,
                action: #selector(openRecentFile(_:)),
                keyEquivalent: ""
            )
            item.representedObject = url.absoluteString
            submenu.addItem(item)
        }

        if NSDocumentController.shared.recentDocumentURLs.isEmpty {
            let empty = NSMenuItem(
                title: NSLocalizedString("(empty)", comment: ""),
                action: nil,
                keyEquivalent: ""
            )
            empty.isEnabled = false
            submenu.addItem(empty)
        }
    }

    @objc private func openRecentFile(_ sender: NSMenuItem) {
        guard let url = URL(string: sender.representedObject as? String ?? "") else { return }
        // Verify this is still a valid recent document.
        for recent in NSDocumentController.shared.recentDocumentURLs where recent == url {
            NotificationCenter.default.post(name: .openLocalDocument, object: url)
            return
        }
    }

    @objc private func didOpenFile(_: Notification) {
        // Rebuild the submenu whenever the user opens a file via the menu bar.
        if let openRecent = NSApp.mainMenu?.item(
            withTitle: NSLocalizedString("File", comment: "")
        )?.submenu?.item(
            withTitle: NSLocalizedString("Open Recent", comment: "")
        ), !openRecent.submenu!.items.isEmpty {
            updateRecentFilesMenu(submenu: openRecent.submenu!)
        }
    }

    @objc private func clearRecentFiles(_: Any) {
        NSDocumentController.shared.clearRecentDocuments(nil)
        if let openRecent = NSApp.mainMenu?.item(
            withTitle: NSLocalizedString("File", comment: "")
        )?.submenu?.item(
            withTitle: NSLocalizedString("Open Recent", comment: "")
        ), !openRecent.submenu!.items.isEmpty {
            updateRecentFilesMenu(submenu: openRecent.submenu!)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
        // Single main-window viewer: when the user closes the last window there is
        // no separate UI to reopen it, so quit rather than leaving the app running
        // headless with no way back (App Store Guideline 4.0 / macOS HIG).
        true
    }

    func application(_: NSApplication, open urls: [URL]) {
        for url in urls {
            NotificationCenter.default.post(name: .openURLFromDelegate, object: url)
        }
    }

    @objc private func handleOpenLocalDocument(_ notification: Notification) {
        guard let url = notification.object as? URL else { return }
        openDocumentInNewTab(url: url)
    }

    private func openDocumentInNewTab(url: URL) {
        let contentView = ContentView(initialURL: url)
        let hosting = NSHostingController(rootView: contentView)
        let window = NSWindow(contentViewController: hosting)
        window.setContentSize(NSSize(width: 960, height: 700))
        window.minSize = NSSize(width: 800, height: 600)
        window.title = url.lastPathComponent
        window.isReleasedWhenClosed = false
        window.toolbarStyle = .unified

        if let keyWindow = NSApp.keyWindow {
            window.tabbingIdentifier = keyWindow.tabbingIdentifier
            keyWindow.addTabbedWindow(window, ordered: .above)
        }
        window.makeKeyAndOrderFront(nil)
    }
}

extension Notification.Name {
    static let openURLFromDelegate = Notification.Name("MDViewer.openURLFromDelegate")
}