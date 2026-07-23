import XCTest
import Security
@testable import MDViewer

/// Integration check backing App Store Guideline 2.1(a): a sandboxed macOS app
/// cannot present the system print dialog without the `com.apple.security.print`
/// entitlement. This reads the entitlements embedded in the built MDViewer.app
/// that hosts the test bundle and asserts the print entitlement is declared. It
/// skips (rather than fails) only if the signed app cannot be located or its
/// signature cannot be read, so it never produces a false negative.
final class EntitlementsTests: XCTestCase {
    /// Walks up from the (app-hosted) test bundle to the enclosing `.app`.
    ///
    /// When run as an app-hosted test target the bundle lives inside
    /// `MDViewer.app/Contents/PlugIns/MDViewerTests.xctest`, so the app is an
    /// ancestor — not a sibling — of the test bundle.
    private func enclosingAppURL() -> URL? {
        var url = Bundle(for: EntitlementsTests.self).bundleURL
        while url.pathComponents.count > 1 {
            if url.pathExtension == "app" { return url }
            url = url.deletingLastPathComponent()
        }
        return nil
    }

    func test_builtApp_declaresPrintEntitlement() throws {
        let appURL = try XCTUnwrap(
            enclosingAppURL(),
            "Could not locate the enclosing MDViewer.app for the test bundle."
        )
        try XCTSkipUnless(
            appURL.lastPathComponent == "MDViewer.app",
            "Enclosing app is \(appURL.lastPathComponent), not MDViewer.app; skipping entitlement check."
        )

        var staticCode: SecStaticCode?
        let createStatus = SecStaticCodeCreateWithPath(appURL as CFURL, [], &staticCode)
        guard createStatus == errSecSuccess, let code = staticCode else {
            throw XCTSkip("Could not create static code object (OSStatus \(createStatus)).")
        }

        var infoCF: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        let infoStatus = SecCodeCopySigningInformation(code, flags, &infoCF)
        guard infoStatus == errSecSuccess, let info = infoCF as? [String: Any] else {
            throw XCTSkip("Could not read signing information (OSStatus \(infoStatus)).")
        }

        let entitlements = try XCTUnwrap(
            info["entitlements-dict"] as? [String: Any],
            "Signed MDViewer.app exposed no entitlements dictionary."
        )
        XCTAssertEqual(
            entitlements["com.apple.security.print"] as? Bool,
            true,
            "MDViewer.app must declare com.apple.security.print so the in-app Print command works under the sandbox (Guideline 2.1a)."
        )
    }
}
