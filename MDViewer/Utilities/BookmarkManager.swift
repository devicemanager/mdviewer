import Foundation
import AppKit

final class BookmarkManager {
    static let shared = BookmarkManager()

    private let userDefaults = UserDefaults.standard
    private let bookmarkKeyPrefix = "bookmark_"

    private init() {}

    func save(url: URL) {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let data = try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            userDefaults.set(data, forKey: bookmarkKeyPrefix + url.path)
        } catch {
            // Bookmark creation failed — fall back to direct path access
        }
    }

    func resolve(for path: String) -> URL? {
        guard let data = userDefaults.data(forKey: bookmarkKeyPrefix + path) else {
            return nil
        }

        var isStale = false
        do {
            let url = try URL(
                resolvingBookmarkData: data,
                options: .withSecurityScope,
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            if isStale {
                save(url: url)
            }
            return url
        } catch {
            return nil
        }
    }

    func startAccess(url: URL) -> Bool {
        url.startAccessingSecurityScopedResource()
    }

    func stopAccess(url: URL) {
        url.stopAccessingSecurityScopedResource()
    }
}

/// Grants and persists security-scoped access to the *folder* containing a
/// document, so the sandboxed app can read sibling files (e.g. relative images)
/// that `files.user-selected` does not cover on its own.
///
/// Holds at most one folder's scoped access at a time (the current document's).
/// Folder bookmarks are app-scoped and persisted, so a folder authorised once is
/// reused automatically for any document opened from it later.
@MainActor
final class FolderAccessManager {
    static let shared = FolderAccessManager()

    private let defaults = UserDefaults.standard
    private let keyPrefix = "folderbookmark_"
    private var currentURL: URL?

    private init() {}

    private var bookmarkedFolderPaths: [String] {
        defaults.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(keyPrefix) }
            .map { String($0.dropFirst(keyPrefix.count)) }
    }

    private func covers(_ folderPath: String, _ dirPath: String) -> Bool {
        let boundary = folderPath.hasSuffix("/") ? folderPath : folderPath + "/"
        return dirPath == folderPath || dirPath.hasPrefix(boundary)
    }

    /// If a previously-authorised folder covers `directory`, (re)start its
    /// security-scoped access and return true. Otherwise release any held access
    /// and return false.
    @discardableResult
    func useAccessIfAvailable(for directory: URL) -> Bool {
        let dirPath = directory.standardizedFileURL.path
        if let cur = currentURL, covers(cur.standardizedFileURL.path, dirPath) {
            return true
        }
        for stored in bookmarkedFolderPaths where covers(stored, dirPath) {
            guard let data = defaults.data(forKey: keyPrefix + stored) else { continue }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data,
                                     options: .withSecurityScope,
                                     relativeTo: nil,
                                     bookmarkDataIsStale: &stale),
                  url.startAccessingSecurityScopedResource()
            else { continue }
            setCurrent(url)
            if stale { persist(url) } // refresh a stale bookmark
            return true
        }
        setCurrent(nil)
        return false
    }

    /// Prompt the user to authorise `directory` (or an ancestor) so its local
    /// resources become readable. Persists the grant. Returns whether access is
    /// now held.
    func requestAccess(to directory: URL) -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = directory
        panel.message = "Grant access to this folder so the document's local images can be displayed."
        panel.prompt = "Grant Access"
        guard panel.runModal() == .OK, let url = panel.url,
              url.startAccessingSecurityScopedResource()
        else { return false }
        setCurrent(url)
        persist(url)
        return true
    }

    private func persist(_ url: URL) {
        if let data = try? url.bookmarkData(options: .withSecurityScope,
                                            includingResourceValuesForKeys: nil,
                                            relativeTo: nil) {
            defaults.set(data, forKey: keyPrefix + url.standardizedFileURL.path)
        }
    }

    private func setCurrent(_ url: URL?) {
        if let old = currentURL, old.standardizedFileURL != url?.standardizedFileURL {
            old.stopAccessingSecurityScopedResource()
        }
        currentURL = url
    }
}
