//! Native iOS folder picker — new 2026-09-12, the user's own decision when
//! the file-browser work hit iOS's access model head-on: "the security-scope
//! handling should be a question to the user and handled before the
//! filebrowser is invoked," answered with "build the native folder picker."
//!
//! **Why this exists at all.** `request_folder_access` (src-tauri/src/lib.rs)
//! is `#[cfg(desktop)]`-only, because `tauri-plugin-dialog` has no
//! folder-picker on mobile — not an untested one, none at all. Its iOS file
//! picker *does* use the right class (`UIDocumentPickerViewController`) and
//! even the right access mode (`asCopy: false`, i.e. real security-scoped
//! access to the original, not a sandbox copy) — read directly from its
//! `ios/Sources/DialogPlugin.swift`, not assumed — but its Rust-facing API
//! builds its allowed-types list only from file extensions and MIME types
//! (`parseFiltersOption`), and a folder has neither, so `UTType.folder` is
//! simply unreachable through it. Hence this module.
//!
//! **Why the deprecated initializer.** `initForOpeningContentTypes:asCopy:`
//! (iOS 14+) needs `UTType`, which would mean pulling in
//! `objc2-uniform-type-identifiers` purely to name one constant. The
//! deprecated `initWithDocumentTypes:inMode:` takes plain UTI strings
//! instead — `"public.folder"` with `UIDocumentPickerMode::Open` is exactly
//! "let the user pick a folder, and give me the original (security-scoped),
//! not a copy" — and needs no extra crate. `tauri-plugin-dialog`'s own
//! `showFilePickerLegacy` still uses this same initializer today, so it's a
//! path that remains real rather than a fossil. Worth revisiting if Apple
//! ever actually removes it; flagged rather than silently depended on.
//!
//! **The URL that comes back is security-scoped**, and the scope belongs to
//! *that specific `NSURL` instance* — which is why this hands the caller the
//! URL's `absoluteString` rather than a `PathBuf`: the caller re-acquires
//! scope with `scoped_bookmarks::access_url` (built 2026-09-11 for exactly
//! this problem on the file-open path) before touching the filesystem or
//! creating a persistent bookmark. Converting to a path here and losing the
//! string would repeat the precise bug that cost a real-device round-trip
//! the day before.

use std::sync::mpsc::{channel, Sender};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, DefinedClass, MainThreadMarker, MainThreadOnly};
use tauri::{AppHandle, Runtime};
use objc2_foundation::{NSArray, NSObject, NSObjectProtocol, NSString, NSURL};
use objc2_ui_kit::{
    UIApplication, UIDocumentPickerDelegate, UIDocumentPickerMode, UIDocumentPickerViewController,
};

/// `Some(url_string)` on a pick, `None` if the user cancelled.
type PickResult = Option<String>;

struct PickerIvars {
    tx: Sender<PickResult>,
}

define_class!(
    // `MainThreadOnly`: `UIDocumentPickerDelegate` requires it, and every
    // UIKit call below is main-thread-only anyway.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "MDViewerFolderPickerDelegate"]
    #[ivars = PickerIvars]
    struct FolderPickerDelegate;

    unsafe impl NSObjectProtocol for FolderPickerDelegate {}

    unsafe impl UIDocumentPickerDelegate for FolderPickerDelegate {
        #[unsafe(method(documentPicker:didPickDocumentsAtURLs:))]
        fn document_picker_did_pick(
            &self,
            _picker: &UIDocumentPickerViewController,
            urls: &NSArray<NSURL>,
        ) {
            // `absoluteString`, not `path` — see this module's own header
            // on why the string form specifically is what the caller needs.
            let picked = urls
                .firstObject()
                .and_then(|url| url.absoluteString())
                .map(|s| s.to_string());
            let _ = self.ivars().tx.send(picked);
        }

        #[unsafe(method(documentPickerWasCancelled:))]
        fn document_picker_was_cancelled(&self, _picker: &UIDocumentPickerViewController) {
            let _ = self.ivars().tx.send(None);
        }
    }
);

impl FolderPickerDelegate {
    fn new(mtm: MainThreadMarker, tx: Sender<PickResult>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PickerIvars { tx });
        unsafe { objc2::msg_send![super(this), init] }
    }
}

/// Presents the system folder picker and blocks until the user picks or
/// cancels. Returns the picked folder's URL **string** (`file://…`), or
/// `None` on cancellation.
///
/// **Must not be called on the main thread**: it blocks waiting for the
/// delegate callback, and that callback can only ever fire *on* the main
/// thread — doing both on one thread deadlocks. The command wrapper in
/// lib.rs hops off via `spawn_blocking` for exactly this reason, the same
/// main-thread-deadlock shape already documented on `open_document_command`
/// for the file dialog. Guarded rather than trusted: if this ever does run
/// on the main thread, it returns an error instead of hanging the app,
/// which is a far easier failure to diagnose than a freeze.
///
/// Main-thread dispatch goes through Tauri's own `run_on_main_thread`
/// rather than a new dispatch dependency — objc2 0.6/objc2-foundation 0.3
/// expose no `run_on_main` equivalent, and Tauri already has to solve this
/// exact problem for every platform it runs on.
pub fn pick_folder_blocking<R: Runtime>(app: &AppHandle<R>) -> Result<PickResult, String> {
    if MainThreadMarker::new().is_some() {
        return Err("pick_folder_blocking must not be called from the main thread".to_string());
    }

    let (tx, rx) = channel::<PickResult>();
    let (present_tx, present_rx) = channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        // Safe: `run_on_main_thread` guarantees exactly this.
        let mtm = MainThreadMarker::new().expect("run_on_main_thread ran off the main thread");
        let _ = present_tx.send(present_picker(mtm, tx));
    })
    .map_err(|e| format!("could not reach the main thread to present the folder picker: {e}"))?;

    present_rx
        .recv()
        .map_err(|e| format!("folder picker presentation channel closed: {e}"))??;

    rx.recv()
        .map_err(|e| format!("folder picker result channel closed: {e}"))
}

/// The UIKit half — main thread only, by construction (`MainThreadMarker`).
fn present_picker(mtm: MainThreadMarker, tx: Sender<PickResult>) -> Result<(), String> {
    let delegate = FolderPickerDelegate::new(mtm, tx);

    let types = NSArray::from_retained_slice(&[NSString::from_str("public.folder")]);
    #[allow(deprecated)]
    let picker = UIDocumentPickerViewController::initWithDocumentTypes_inMode(
        UIDocumentPickerViewController::alloc(mtm),
        &types,
        UIDocumentPickerMode::Open,
    );

    let proto = ProtocolObject::from_ref(&*delegate);
    picker.setDelegate(Some(proto));

    // UIKit holds its delegate *weakly*, and nothing else owns this one once
    // this function returns — so it's deliberately leaked for the lifetime
    // of the picker rather than being dropped out from under UIKit and
    // crashing on the first callback. A one-shot, once-per-grant object;
    // threading ownership through the presenting view controller instead
    // would buy nothing for a dialog dismissed within seconds.
    std::mem::forget(delegate);

    let ui_app = UIApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    let window = ui_app.keyWindow().or_else(|| ui_app.windows().firstObject());
    let Some(root) = window.and_then(|w| w.rootViewController()) else {
        return Err("no root view controller to present the folder picker from".to_string());
    };
    root.presentViewController_animated_completion(&picker, true, None);
    Ok(())
}
