import Combine
import SwiftUI

@MainActor
final class DocumentViewModel: ObservableObject {
    @Published var text: String = ""
    @Published var fileURL: URL?
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var isDirty: Bool = false

    @AppStorage("lastOpenedBookmark") private var lastOpenedBookmarkData: Data = .init()
    @AppStorage("lastOpenedScoped") private var lastOpenedScoped: Bool = false

    private let fileWatcher = FileWatcher()

    init() {
        fileWatcher.onChange = { [weak self] in
            Task { @MainActor in
                self?.reload()
            }
        }
    }

    func openFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.markdown, .plainText]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        if panel.runModal() == .OK, let url = panel.url {
            load(url: url)
        }
    }

    func load(url: URL) {
        isLoading = true
        errorMessage = nil

        do {
            let contents = try String(contentsOf: url, encoding: .utf8)
            fileURL = url
            text = contents
            isDirty = false
            fileWatcher.start(url: url)
            BookmarkManager.shared.save(url: url)
            saveLastOpened(url: url)
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func reload() {
        guard let url = fileURL else { return }
        do {
            let contents = try String(contentsOf: url, encoding: .utf8)
            isDirty = false
            text = contents
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func updateText(_ newText: String) {
        guard text != newText else { return }
        isDirty = true
        text = newText
    }

    func save() {
        guard let url = fileURL else {
            // No backing file yet (e.g. content typed in the editor): offer a
            // standard Save dialog so the user picks a real, accessible location
            // rather than the write silently going nowhere.
            saveAs()
            return
        }
        writeDocument(to: url, adoptAsCurrent: false)
    }

    /// Saves the current text to a user-chosen location via the standard macOS
    /// Save panel (Powerbox), then adopts that file as the working document.
    func saveAs() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.markdown, .plainText]
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "Untitled.md"
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        // Start in the current document's folder when we have one; otherwise leave
        // the directory unset so Powerbox defaults to the user's real Documents
        // folder (never the hidden sandbox container).
        if let dir = fileURL?.deletingLastPathComponent() {
            panel.directoryURL = dir
        }

        guard panel.runModal() == .OK, let url = panel.url else { return }
        writeDocument(to: url, adoptAsCurrent: true)
    }

    /// Writes the current `text` to a user-accessible `url`. When
    /// `adoptAsCurrent` is true the file becomes the working document (used by
    /// Save As and by saving freshly-typed content). Returns whether the write
    /// succeeded. Extracted from `save()`/`saveAs()` so the persistence logic can
    /// be unit-tested without presenting an `NSSavePanel`.
    @discardableResult
    func writeDocument(to url: URL, adoptAsCurrent: Bool) -> Bool {
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            if adoptAsCurrent {
                fileURL = url
                fileWatcher.start(url: url)
                BookmarkManager.shared.save(url: url)
                saveLastOpened(url: url)
            }
            isDirty = false
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func restoreLastOpened() {
        guard !lastOpenedBookmarkData.isEmpty else { return }
        var isStale = false
        let options: URL.BookmarkResolutionOptions = lastOpenedScoped ? .withSecurityScope : []
        guard let url = try? URL(
            resolvingBookmarkData: lastOpenedBookmarkData,
            options: options,
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        ) else { return }
        // Under the sandbox a security-scoped bookmark must be activated before the
        // file (and its watcher) can be accessed after a cold relaunch. Held for
        // the session; the process exit releases it.
        if lastOpenedScoped {
            _ = url.startAccessingSecurityScopedResource()
        }
        load(url: url)
    }

    private func saveLastOpened(url: URL) {
        // Prefer an app-scoped, security-scoped bookmark so the last file reopens
        // with access after a cold relaunch under the sandbox; fall back to a plain
        // bookmark if the security-scoped variant can't be created.
        if let data = try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil) {
            lastOpenedBookmarkData = data
            lastOpenedScoped = true
        } else if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            lastOpenedBookmarkData = data
            lastOpenedScoped = false
        }
    }
}
