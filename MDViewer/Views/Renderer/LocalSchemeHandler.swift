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
               !path.path.hasPrefix(bundleDir.path) {
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
    
    // MARK: - Private helper methods
    
    private func resolveBundlePath(for path: String) -> URL? {
        guard let bundleDir = bundleResourceDirectory else { return nil }
        
        // If the path is already absolute, use it directly
        if path.hasPrefix("/") {
            return URL(fileURLWithPath: path)
        }
        
        // Normalize the path by removing leading slashes and ensure it's relative to bundle directory
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        
        let fullURL = bundleDir.appendingPathComponent(normalizedPath, isDirectory: false)
        return fullURL
    }
    
    private func resolveRelativePath(for path: String) -> URL? {
        // If we're using base directory
        if let dir = baseDirectory {
            // Resolve path relative to base directory, with proper sanitization
            let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
            
            // Prevent directory traversal attacks by ensuring the path remains within base directory
            let fullPath = dir.appendingPathComponent(normalizedPath, isDirectory: false)
            
            // Additional security check to make sure the resolved path is still within baseDirectory
            if !fullPath.path.hasPrefix(dir.path) {
                return nil
            }
            
            return fullPath
        }
        
        // If no base directory specified, try bundle resource directory
        if let bundleDir = bundleResourceDirectory {
            let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
            let fullPath = bundleDir.appendingPathComponent(normalizedPath, isDirectory: false)
            return fullPath
        }
        
        return nil
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
