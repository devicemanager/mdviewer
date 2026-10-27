import Foundation
import WebKit

/// A WebKit URL scheme handler that serves local resources from the app bundle or a specified directory.
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    /// The directory to serve resources from. This should contain the Web directory with renderer.html, etc.
    var bundleResourceDirectory: URL? {
        didSet { 
            // Ensure trailing slash for proper path resolution
            if let dir = bundleResourceDirectory,
               !dir.path.hasSuffix("/") {
                bundleResourceDirectory = dir.appendingPathComponent("/")
            }
        }
    }
    
    /// The base directory to serve from. This is used when the scheme handler doesn't have its own resource directory.
    var baseDirectory: URL?
    
    /// Called when access is denied to a local resource (e.g., file not found, or sandbox violation).
    var onAccessDenied: ((URL) -> Void)?

    /// Whether remote content (external images, etc.) is allowed. When false, the CSP will block remote resources.
    var allowsRemoteContent: Bool = true
    
    // MARK: - WKURLSchemeHandler
    
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        guard let url = request.url else {
            let error = NSError(domain: "LocalSchemeHandler", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
            urlSchemeTask.didFailWithError(error)
            return
        }
        
        // Determine the file path to serve based on scheme and host
        let filePath: URL?
        switch url.scheme?.lowercased() {
        case "mdviewer-local":
            if url.host == "localhost" || url.host == "" {
                // If it's a localhost request, we should resolve it against baseDirectory or bundleResourceDirectory
                filePath = resolveRelativePath(for: url.path)
            } else if url.host == "bundle" {
                // For bundle://host, we directly use bundleResourceDirectory
                filePath = resolveBundlePath(for: url.path)
            } else {
                // Other hosts - may not be handled by this scheme
                filePath = nil
            }
            
        default:
            // Let other schemes pass through to system handling (e.g., http/https)
            filePath = nil
        }
        
        guard let path = filePath else {
            let error = NSError(domain: "LocalSchemeHandler", code: 404, userInfo: [NSLocalizedDescriptionKey: "File not found"])
            urlSchemeTask.didFailWithError(error)
            return
        }
        
        // Check accessibility and if we can access this file
        do {
            // Verify the file exists before attempting to read it
            let fileManager = FileManager.default
            
            // For security reasons, make sure any resolved path is within a permitted scope
            if let bundleDir = bundleResourceDirectory,
               !LocalSchemeHandler.isPath(path, within: bundleDir) {
                let error = NSError(domain: "LocalSchemeHandler", code: 403, userInfo: [NSLocalizedDescriptionKey: "Access denied - path outside permitted scope"])
                urlSchemeTask.didFailWithError(error)
                return
            }
            
            if !fileManager.fileExists(atPath: path.path) {
                let error = NSError(domain: "LocalSchemeHandler", code: 404, userInfo: [NSLocalizedDescriptionKey: "File not found"])
                urlSchemeTask.didFailWithError(error)
                return
            }
            
            // Check if resource is readable by checking its attributes
            let attributes = try fileManager.attributesOfItem(atPath: path.path)
            guard let fileSize = attributes[.size] as? NSNumber else {
                let error = NSError(domain: "LocalSchemeHandler", code: 500, userInfo: [NSLocalizedDescriptionKey: "Cannot determine file size"])
                urlSchemeTask.didFailWithError(error)
                return
            }
            
            // Read file contents and respond
            let data = try Data(contentsOf: path)
            let response = URLResponse(url: url, mimeType: mimeType(for: path.path), expectedContentLength: data.count, textEncodingName: nil)
            
            // In newer APIs, we need to use different pattern for sending responses
            urlSchemeTask.didReceive(response)
            
            // Send the data - using the correct API pattern
            if #available(macOS 12.0, *) {
                // For macOS 12+ and iOS 15+, use didReceive with data only
                urlSchemeTask.didReceive(data)
            } else {
                // For older versions, we need to send all data at once
                urlSchemeTask.didReceive(data)
            }
            
            urlSchemeTask.didFinish()
        } catch {
            // Handle file access errors properly, potentially notify the user of access denial
            let nsError = error as NSError
            
            // Log specific error codes that indicate sandbox violations
            switch nsError.code {
            case NSFileReadNoPermissionError:
                onAccessDenied?(path)
            case NSFileReadNoSuchFileError:
                let error = NSError(domain: "LocalSchemeHandler", code: 404, userInfo: [NSLocalizedDescriptionKey: "File not found"])
                urlSchemeTask.didFailWithError(error)
            default:
                break
            }
            
            urlSchemeTask.didFailWithError(error)
        }
    }
    
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // We don't need to do anything special when stopping
    }
    
    // MARK: - Path resolution
    //
    // Not private: unit-tested directly (see LocalSchemeHandlerTests) rather
    // than through a mocked WKURLSchemeTask, same reasoning as
    // DocumentViewModel.writeDocument.

    func resolveBundlePath(for path: String) -> URL? {
        guard let bundleDir = bundleResourceDirectory else { return nil }

        // A hierarchical URL's `.path` always starts with "/" (e.g.
        // "mdviewer-local://bundle/renderer.html" has path "/renderer.html") —
        // that's not an absolute filesystem path, it's scheme-relative. Treating
        // it as one (the previous behaviour here) resolved outside bundleDir
        // entirely and tripped the security check below in webView(_:start:),
        // which is why renderer.html failed to load at all.
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return bundleDir.appendingPathComponent(normalizedPath, isDirectory: false)
    }
    
    /// The local Markdown document a clicked link points to, or nil if the link
    /// should not open in-app. Accepts an absolute `file://` Markdown URL, or a
    /// relative link the renderer rewrote to `mdviewer-local://localhost/...`,
    /// which resolves against `baseDirectory` only (never the bundle) with the
    /// same traversal guard as relative images.
    func localMarkdownDocumentURL(for url: URL) -> URL? {
        guard ["md", "markdown"].contains(url.pathExtension.lowercased()) else { return nil }
        switch url.scheme?.lowercased() {
        case "file":
            return url
        case "mdviewer-local" where url.host == "localhost" && baseDirectory != nil:
            return resolveRelativePath(for: url.path)
        default:
            return nil
        }
    }

    func resolveRelativePath(for path: String) -> URL? {
        // If we're using base directory
        if let dir = baseDirectory {
            // Resolve path relative to base directory, with proper sanitization
            let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
            let fullPath = dir.appendingPathComponent(normalizedPath, isDirectory: false)

            // Prevent directory traversal (e.g. "../../etc/passwd"): must check
            // the *standardized* path, since appendingPathComponent never
            // collapses ".." — an unresolved hasPrefix check here would always
            // pass, because the base directory's path is still a literal
            // string-prefix of the traversed one even though it resolves
            // outside it.
            guard LocalSchemeHandler.isPath(fullPath, within: dir) else { return nil }
            return fullPath
        }

        // If no base directory specified, try bundle resource directory
        if let bundleDir = bundleResourceDirectory {
            let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
            let fullPath = bundleDir.appendingPathComponent(normalizedPath, isDirectory: false)
            guard LocalSchemeHandler.isPath(fullPath, within: bundleDir) else { return nil }
            return fullPath
        }

        return nil
    }

    /// Whether `path`, once `.`/`..` segments are resolved, is `directory`
    /// itself or something inside it. Deliberately not a plain `hasPrefix` on
    /// the raw paths: that both (a) misses traversal, since
    /// appendingPathComponent never collapses ".." segments, and (b) would
    /// wrongly accept a sibling directory whose name happens to start with
    /// `directory`'s name (e.g. "/Web-evil" prefix-matches "/Web").
    static func isPath(_ path: URL, within directory: URL) -> Bool {
        let resolvedPath = path.standardizedFileURL.path
        let resolvedDir = directory.standardizedFileURL.path
        return resolvedPath == resolvedDir || resolvedPath.hasPrefix(resolvedDir + "/")
    }

    private func mimeType(for filePath: String) -> String {
        // Determine content type based on file extension
        let pathExtension = (filePath as NSString).pathExtension.lowercased()
        
        switch pathExtension {
        case "html":
            return "text/html"
        case "css":
            return "text/css"
        case "js":
            return "application/javascript"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "gif":
            return "image/gif"
        case "svg":
            return "image/svg+xml"
        case "woff", "woff2":
            return "font/woff"
        case "json":
            return "application/json"
        default:
            // For unknown types, try to be generic but safe
            return "application/octet-stream"
        }
    }
}
