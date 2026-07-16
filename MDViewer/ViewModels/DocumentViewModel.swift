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
        guard let url = fileURL else { return }
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            isDirty = false
        } catch {
            errorMessage = error.localizedDescription
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
