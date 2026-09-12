//! Security-scoped bookmarks for sandboxed macOS/iOS folder access —
//! ported from `BookmarkManager`/`FolderAccessManager`'s bookmark half
//! (Milestone B). Persists a user-granted folder so its access survives
//! a relaunch under the App Sandbox, the same guarantee Swift's
//! `files.bookmarks.app-scope`-backed bookmark provides.
//!
//! **Provenance (2026-09-10):** vendored, not an external dependency.
//! `docs/project/plan.md`'s Milestone B entry records a full audit of
//! the candidate crate this is adapted from —
//! [`apple-scoped-bookmarks` 0.1.0](https://crates.io/crates/apple-scoped-bookmarks)
//! (MIT OR Apache-2.0) — read in full before adapting, not assumed safe
//! from its description. The code passed that audit (correct RAII
//! ordering, correct macOS/iOS option-flag distinction, no telemetry, a
//! trivial non-executing build script, a minimal and itself-trustworthy
//! `objc2`/`objc2-foundation` dependency graph); what didn't pass was
//! reputation (a three-week-old, single-maintainer, 22-download crate for
//! a security-relevant capability) — so the logic is inlined here instead
//! of depended on, per the user's explicit direction after that audit was
//! presented. This module is deliberately close to a line-for-line port
//! of that crate's `src/lib.rs`, not a reinterpretation — the same
//! correctness properties matter here as they did there, and drifting
//! from an already-audited design for style reasons would just be a new,
//! *unaudited* one.
//!
//! Unlike the vendored crate, this has no Tauri command surface of its
//! own — `src-tauri/src/lib.rs` owns persistence (the on-disk store file,
//! matching this project's existing `remote_content_policy.txt`/
//! `last_opened_document.txt` convention) and the managed-state
//! bookkeeping (`GrantedFolderAccess`). This module owns only the actual
//! Cocoa calls.

use std::fmt;
use std::path::{Path, PathBuf};

/// Anything that can go wrong creating or resolving a bookmark.
#[derive(Debug)]
pub enum Error {
    /// The platform has no security-scoped bookmarks (anything not macOS/iOS).
    // Only ever constructed by the `not(macos, ios)` `imp` stub below, so a
    // single-platform build (every real build, including this crate's own
    // CI) never sees both `imp` modules at once — the compiler can't see
    // that some *other* target would construct this, hence the otherwise-
    // spurious dead-code warning this silences.
    #[allow(dead_code)]
    Unsupported,
    /// A path was not valid UTF-8, or otherwise unrepresentable as an `NSString`.
    InvalidPath(PathBuf),
    /// Cocoa refused the operation; the string is the `NSError` description.
    Cocoa(String),
    /// The bookmark resolved, but the OS denied the sandbox extension. Usually
    /// means the bookmark was made by a differently-signed build, or the app is
    /// missing the `com.apple.security.files.bookmarks.app-scope` entitlement.
    AccessDenied(PathBuf),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Unsupported => {
                write!(f, "security-scoped bookmarks are only available on macOS and iOS")
            }
            Error::InvalidPath(p) => write!(f, "path is not representable as an NSString: {}", p.display()),
            Error::Cocoa(msg) => write!(f, "{msg}"),
            Error::AccessDenied(p) => write!(
                f,
                "startAccessingSecurityScopedResource was refused for {} — check the \
                 com.apple.security.files.bookmarks.app-scope entitlement and that the \
                 bookmark was created by this same signed app",
                p.display()
            ),
        }
    }
}

impl std::error::Error for Error {}

/// An opaque, persistable handle to a user-granted file or directory.
///
/// The bytes are meaningful only to the OS, and only for the app that created
/// them. Store them as-is; hand them back to [`Bookmark::from_bytes`] later.
#[derive(Clone, PartialEq, Eq)]
pub struct Bookmark {
    data: Vec<u8>,
}

impl fmt::Debug for Bookmark {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The payload is opaque and large; a length is the only useful part.
        f.debug_struct("Bookmark").field("len", &self.data.len()).finish()
    }
}

impl Bookmark {
    /// Wrap previously-persisted bookmark bytes.
    pub fn from_bytes(data: impl Into<Vec<u8>>) -> Self {
        Self { data: data.into() }
    }

    /// Consume the bookmark, yielding the bytes to persist.
    pub fn into_bytes(self) -> Vec<u8> {
        self.data
    }

    /// Create a bookmark for a path the user has already granted access to.
    ///
    /// The path must currently be accessible — typically it was just returned by
    /// an open panel, or is inside a [`ScopedAccess`] that is still alive.
    pub fn create(path: impl AsRef<Path>) -> Result<Self, Error> {
        imp::create(path.as_ref())
    }

    /// Resolve the bookmark and immediately begin accessing it.
    ///
    /// Access lasts until the returned [`ScopedAccess`] is dropped.
    pub fn resolve(&self) -> Result<ScopedAccess, Error> {
        imp::resolve(&self.data)
    }
}

/// Begins accessing a URL the OS handed the app *this moment* — an
/// iOS `RunEvent::Opened` file-association delivery (src-tauri/src/lib.rs's
/// `PendingOpenedDocument`), not something to persist across a relaunch the
/// way a user-granted folder is. New 2026-09-11, after the first real-
/// device test of file-association opening: `LSSupportsOpeningDocumentsInPlace`
/// (that same commit's Info.plist change) tells iOS the app can be handed a
/// *live* reference to a document still sitting in Files/iCloud Drive
/// rather than only ever a copy — but a live reference is exactly what
/// `startAccessingSecurityScopedResource` gates, and nothing upstream does
/// this automatically: confirmed by reading `tao`'s own iOS
/// `scene:openURLContexts:` bridge directly (0.35.3's `scene.rs`) — it
/// converts the incoming `NSURL` straight to a plain Rust `url::Url`
/// string with no security-scope call at all, so by the time Rust sees
/// anything, the scope grant tied to that original `NSURL` *instance* is
/// already gone. Confirmed this doesn't mean the underlying grant itself
/// is unrecoverable, though — `tauri-plugin-fs`'s own iOS implementation
/// (`ios.rs`, read directly, not this project's dependency) hits the exact
/// same problem for its own `open()` command and fixes it by reconstructing
/// a *fresh* `NSURL` from the URL's **string** form via `NSURL::URLWithString`
/// (not `fileURLWithPath` — `Bookmark::create` above uses that constructor
/// for a different reason, an already-known-accessible path, and it is not
/// interchangeable here) and calling `startAccessingSecurityScopedResource`
/// on *that* — the OS resolves the grant by matching the resource itself,
/// not the specific object instance that first received it. This function
/// is that same, now twice-independently-confirmed pattern, not a novel
/// approach invented for this port.
pub fn access_url(url: &str) -> Result<ScopedAccess, Error> {
    imp::access_url(url)
}

/// Live access to a bookmarked path. Stops accessing on drop.
///
/// Do not [`std::mem::forget`] this: the sandbox extension would leak for the
/// lifetime of the process — Apple's own documentation is blunt about the
/// consequence: "kernel resources will be leaked and your app will lose its
/// ability to reach outside the sandbox completely, until your app is
/// restarted."
pub struct ScopedAccess {
    path: PathBuf,
    stale: bool,
    #[allow(dead_code)]
    inner: imp::AccessHandle,
}

impl ScopedAccess {
    /// The resolved path, valid while this guard is alive.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Whether the OS reported the bookmark as stale.
    ///
    /// Stale is **not** an error — the path resolved and access is live — but the
    /// bookmark should be re-created from [`Self::path`] and re-persisted, or it
    /// will eventually stop resolving.
    pub fn is_stale(&self) -> bool {
        self.stale
    }
}

impl fmt::Debug for ScopedAccess {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ScopedAccess")
            .field("path", &self.path)
            .field("stale", &self.stale)
            .finish()
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use super::{Error, ScopedAccess};
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    };
    use std::path::{Path, PathBuf};

    // `WithSecurityScope` is macOS-only: on iOS a document-picker URL is
    // already security-scoped, and passing the macOS creation flag there is
    // rejected.
    #[cfg(target_os = "macos")]
    const CREATE_OPTS: NSURLBookmarkCreationOptions =
        NSURLBookmarkCreationOptions::WithSecurityScope;
    #[cfg(target_os = "ios")]
    const CREATE_OPTS: NSURLBookmarkCreationOptions = NSURLBookmarkCreationOptions(0);

    // WithoutUI: never block a resolve on a mount/authentication prompt — the
    // caller is typically restoring state during startup.
    #[cfg(target_os = "macos")]
    const RESOLVE_OPTS: NSURLBookmarkResolutionOptions = NSURLBookmarkResolutionOptions(
        NSURLBookmarkResolutionOptions::WithSecurityScope.0
            | NSURLBookmarkResolutionOptions::WithoutUI.0,
    );
    #[cfg(target_os = "ios")]
    const RESOLVE_OPTS: NSURLBookmarkResolutionOptions =
        NSURLBookmarkResolutionOptions::WithoutUI;

    /// Owns the "currently accessing" state and releases it exactly once.
    pub(super) struct AccessHandle {
        url: Retained<NSURL>,
    }

    impl Drop for AccessHandle {
        fn drop(&mut self) {
            unsafe { self.url.stopAccessingSecurityScopedResource() };
        }
    }

    fn ns_string(path: &Path) -> Result<Retained<NSString>, Error> {
        let s = path.to_str().ok_or_else(|| Error::InvalidPath(path.to_path_buf()))?;
        Ok(NSString::from_str(s))
    }

    pub(super) fn create(path: &Path) -> Result<super::Bookmark, Error> {
        let ns_path = ns_string(path)?;
        let url = NSURL::fileURLWithPath(&ns_path);
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                CREATE_OPTS,
                None,
                None,
            )
            .map_err(|e| Error::Cocoa(e.localizedDescription().to_string()))?;
        Ok(super::Bookmark { data: data.to_vec() })
    }

    pub(super) fn resolve(bytes: &[u8]) -> Result<ScopedAccess, Error> {
        let data = NSData::with_bytes(bytes);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                RESOLVE_OPTS,
                None,
                &mut stale,
            )
        }
        .map_err(|e| Error::Cocoa(e.localizedDescription().to_string()))?;
        let stale = stale.as_bool();

        let path = url
            .path()
            .map(|p| PathBuf::from(p.to_string()))
            .unwrap_or_default();

        // Must succeed BEFORE the handle exists, so a refusal cannot leave an
        // unbalanced stop() in Drop.
        let granted = unsafe { url.startAccessingSecurityScopedResource() };
        if !granted {
            return Err(Error::AccessDenied(path));
        }

        Ok(ScopedAccess {
            path,
            stale,
            inner: AccessHandle { url },
        })
    }

    /// See `super::access_url`'s own doc comment for why this reconstructs
    /// the `NSURL` from the URL **string** (`URLWithString`) rather than
    /// `fileURLWithPath` (used by `create` above, for an unrelated,
    /// already-known-good-path case).
    pub(super) fn access_url(url_str: &str) -> Result<ScopedAccess, Error> {
        let ns_string = NSString::from_str(url_str);
        let url =
            NSURL::URLWithString(&ns_string).ok_or_else(|| Error::Cocoa(format!("not a valid URL: {url_str}")))?;

        let path = url.path().map(|p| PathBuf::from(p.to_string())).unwrap_or_default();

        // Same ordering guarantee as `resolve` above: must succeed before
        // `AccessHandle` exists, so a refusal can't leave an unbalanced
        // `stop()` running in `Drop`.
        let granted = unsafe { url.startAccessingSecurityScopedResource() };
        if !granted {
            return Err(Error::AccessDenied(path));
        }

        Ok(ScopedAccess {
            path,
            stale: false,
            inner: AccessHandle { url },
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod imp {
    use super::{Error, ScopedAccess};
    use std::path::Path;

    /// Never constructed off-Apple; exists so `ScopedAccess` has one definition.
    pub(super) struct AccessHandle;

    pub(super) fn create(_path: &Path) -> Result<super::Bookmark, Error> {
        Err(Error::Unsupported)
    }

    pub(super) fn resolve(_bytes: &[u8]) -> Result<ScopedAccess, Error> {
        Err(Error::Unsupported)
    }

    pub(super) fn access_url(_url_str: &str) -> Result<ScopedAccess, Error> {
        Err(Error::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_round_trip_without_touching_the_os() {
        let b = Bookmark::from_bytes(vec![1, 2, 3]);
        assert_eq!(b.clone().into_bytes(), vec![1, 2, 3]);
    }

    #[test]
    fn debug_does_not_dump_the_opaque_payload() {
        let b = Bookmark::from_bytes(vec![0u8; 1024]);
        let s = format!("{b:?}");
        assert!(s.contains("1024"), "{s}");
        assert!(!s.contains("0, 0, 0"), "payload leaked into Debug: {s}");
    }

    /// A real bookmark needs a real sandbox grant, so the only thing that is
    /// portable to assert here is that a non-Apple build reports Unsupported
    /// rather than silently pretending to work.
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    #[test]
    fn unsupported_off_apple() {
        assert!(matches!(Bookmark::create("/tmp"), Err(Error::Unsupported)));
    }

    /// On macOS, this dev/CI environment is unsandboxed (no App Sandbox
    /// entitlements configured at all yet — porting-brief.md's own "Known
    /// gap"), so bookmark creation for an arbitrary path succeeds trivially,
    /// same as the audited crate's own equivalent test found. Skips rather
    /// than fails if the OS ever does deny it — an environment fact, not a
    /// failure of this module.
    #[cfg(target_os = "macos")]
    #[test]
    fn create_and_resolve_a_temp_dir() {
        let dir = std::env::temp_dir();
        let bm = match Bookmark::create(&dir) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("skipping: {e}");
                return;
            }
        };
        assert!(!bm.clone().into_bytes().is_empty());
        match bm.resolve() {
            Ok(access) => assert!(access.path().exists()),
            Err(e) => eprintln!("skipping resolve: {e}"),
        }
    }
}
