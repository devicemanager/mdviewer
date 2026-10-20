use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod debug_log;
mod remote_image;
mod scoped_bookmarks;

/// The native iOS folder picker — the only way to grant access to a folder
/// on iOS, since `tauri-plugin-dialog` has no mobile folder-picker at all
/// (see `request_folder_access`'s own doc comment, and the module's).
#[cfg(target_os = "ios")]
mod ios_folder_picker;

/// The currently-open document's directory, so `mdviewer-local://` requests
/// (relative image paths in the rendered Markdown) know what to resolve
/// against. Ported from `LocalSchemeHandler.baseDirectory` — Swift stores it
/// directly on the scheme handler instance; here it's Tauri-managed state,
/// read by the `mdviewer-local` protocol handler registered in `run()`.
#[derive(Default)]
struct DocumentBaseDir(Mutex<Option<PathBuf>>);

/// Same fixed origin `web/src/renderViewModel.ts` and the Swift
/// `RenderViewModel.applyBaseURL()` use — the renderer always prefixes
/// relative resource URLs with this, regardless of where the real directory
/// lives on disk.
const LOCAL_BASE_URL: &str = "mdviewer-local://localhost/";

/// Ported from `DocumentViewModel.fileURL`/`.text` — Swift tracks these as
/// separate `@Published` properties on the view model; here they're one
/// piece of Tauri-managed state, since nothing else needs them
/// independently. There's no editor yet (Milestone E), so `text` never
/// actually diverges from what's on disk right now — but the path/text
/// pairing, and the write-and-adopt logic below, are exactly what an editor
/// will need to hook into later. `write_document`/`save_as_to` are correct
/// today even though nothing can dirty a document yet.
#[derive(Clone)]
struct CurrentDocumentState {
    path: PathBuf,
    text: String,
}

#[derive(Default)]
struct CurrentDocument(Mutex<Option<CurrentDocumentState>>);

/// Ported from `FileWatcher.swift`: watches the current document's file and
/// reloads it on external changes, debounced 500ms (Swift's
/// `debounceDelay`; `notify-debouncer-mini`'s own default happens to match
/// exactly, set explicitly here anyway for parity-with-source clarity, not
/// coincidence). Holds at most one active watch — like Swift's `start()`
/// calling `stop()` first — because storing a new `Debouncer` here drops
/// (and so stops) whatever was watched before.
#[derive(Default)]
struct FileWatcher(Mutex<Option<notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

/// Ported from `FolderAccessManager` — the second tier of the two-tier
/// access model documented in plan.md's Milestone B (read from the real
/// Swift source, not assumed): tier one is `DocumentBaseDir`, granted
/// automatically by the act of opening a file; this is tier two, folders
/// explicitly granted so a document's relative images *outside* its own
/// directory can still be read. No third, whole-disk tier exists in either
/// version.
///
/// Swift persists grants across launches via a macOS security-scoped
/// bookmark (`files.bookmarks.app-scope`) and holds at most one folder's
/// scoped access open at a time, balancing `startAccessingSecurityScopedResource`/
/// `stopAccessingSecurityScopedResource`. This struct still only tracks
/// grants for the app's *current* run — unchanged by the bookmark
/// persistence added below (2026-09-10), deliberately: `resolve_local_path`/
/// `folder_covers` consult this exact `Vec<PathBuf>`, so restoring a grant
/// on relaunch means *repopulating* this list at startup
/// (`restore_granted_folders`), not replacing it with a differently-shaped
/// lookup. Mobile has no security-scoped-bookmark equivalent at all — that
/// stays a distinct, not-yet-decided follow-up, not silently dropped.
#[derive(Default)]
struct GrantedFolders(Mutex<Vec<PathBuf>>);

/// Keeps each granted-or-restored folder's sandbox access extension open
/// for the app's lifetime. A `scoped_bookmarks::ScopedAccess` stops
/// accessing when dropped (see that module's own doc comment quoting
/// Apple's warning about leaked kernel resources), so the access must be
/// held *somewhere* for as long as the grant should remain usable — this
/// is that somewhere. Keyed the same way the on-disk bookmark store is
/// (the folder's canonicalized path string via `to_string_lossy`), purely
/// so a later `forget`-style command (not built — nothing revokes a grant
/// yet, matching `GrantedFolders` itself having no removal either) could
/// find the right entry; nothing reads these keys today beyond insertion.
#[derive(Default)]
struct GrantedFolderAccess(Mutex<HashMap<String, scoped_bookmarks::ScopedAccess>>);

/// New 2026-09-11 (the user's own request, after their first real-device
/// OTA install: "get a file extension registered so a .md file will
/// show/open in mdviewer") — a document handed to the app by the OS
/// itself (tapping a .md file in iOS's Files app / Android's "Open with",
/// or double-clicking one in Finder), as opposed to every existing path
/// into `render_file` here, which all originate from *inside* the app:
/// the Open button/menu item's file dialog, a clicked in-document link,
/// or `restoreLastOpened`'s own remembered path. Tauri surfaces this
/// uniformly across macOS/iOS/Android as `RunEvent::Opened { urls }` (see
/// `run()`'s own `.run(|app, event| ...)` closure below) — genuinely
/// cross-platform in the vendored `tauri` crate itself (`app.rs`'s
/// `RunEvent::Opened` variant is `cfg`-gated to exactly those three
/// targets), not something built from scratch per platform.
///
/// Buffers a URL that arrived *before* the "main" window's first page
/// load finished (a cold launch — the app process didn't exist yet when
/// the file was tapped, so no window/JS runtime exists to `render_file`
/// into) so `on_page_load`'s own priority chain (test-hook, then this,
/// then `restore_last_opened_document` — see that closure's own comment)
/// can pick it up once the page genuinely exists. A warm open (the app
/// was already running) never touches this — `take_and_render_pending`'s
/// caller in the `RunEvent::Opened` arm renders directly instead, since
/// the window is already known-ready by then; see `INITIAL_LOAD_COMPLETE`
/// below for how that's told apart from the cold-launch case.
///
/// The URL's own **string** form, not an already-converted `PathBuf` —
/// added 2026-09-11, after `PendingOpenedDocument` originally stored a
/// `PathBuf` and the first real-device test of file-association opening
/// showed the document simply didn't load. `render_opened_document`
/// needs the string specifically to re-acquire security-scoped access
/// (see `scoped_bookmarks::access_url`'s own doc comment for the full
/// why); a `PathBuf` alone has already thrown that away.
#[derive(Default)]
struct PendingOpenedDocument(Mutex<Option<String>>);

/// Set exactly once, the same moment `on_page_load`'s own comment
/// describes ("ready to eval() into a real page") — moved to module scope
/// (was a function-local `static` inside that closure alone until this
/// same document-opening work needed to read it from a second place, the
/// `RunEvent::Opened` handler in `run()`) purely so both closures can
/// agree on one shared answer to "has the window actually loaded a page
/// yet" rather than each guessing independently.
static INITIAL_LOAD_COMPLETE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Shared by both `PendingOpenedDocument` consumers described above —
/// takes whatever's buffered (if anything) and renders it. Returns
/// whether there was anything to take, so `on_page_load`'s priority chain
/// can fall through to `restore_last_opened_document` exactly when this
/// didn't already handle it, the same "only if the thing before it didn't
/// already set a document" gating every step in that chain already uses.
fn take_and_render_pending<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(url_str) = app.state::<PendingOpenedDocument>().0.lock().unwrap().take() else {
        return false;
    };
    render_opened_document(app, &url_str);
    true
}

/// Renders a document the OS just handed the app via `RunEvent::Opened` —
/// shared by both `take_and_render_pending` (cold launch) and the
/// `RunEvent::Opened` handler itself (warm open) in `run()` below, so the
/// security-scoped-access handling lives in exactly one place rather than
/// being duplicated at each call site.
///
/// On macOS/iOS, brackets the actual read with `scoped_bookmarks::access_url`
/// — see that function's own doc comment for the full 2026-09-11 story of
/// why this exists at all (the short version: `LSSupportsOpeningDocumentsInPlace`
/// means iOS can hand the app a *live* Files/iCloud Drive reference instead
/// of only ever a copy, and a live reference needs
/// `startAccessingSecurityScopedResource` or the read fails). The guard is
/// dropped immediately after `render_file` returns — deliberately short-
/// lived, not held for the document's whole lifetime: `render_file` also
/// starts a debounced file-watcher for external changes
/// (`watch_file`/`FileWatcher`), and re-reading on an external change would
/// need the same scope to still be live at that later, unpredictable time.
/// That's a real, known, un-closed gap for an in-place-opened document
/// specifically (a locally-opened or dialog-picked document doesn't have
/// this problem at all) — flagged here and in plan.md rather than silently
/// left, not solved this pass: it needs a place to persist a `ScopedAccess`
/// guard per current document, the same shape `GrantedFolderAccess` already
/// does for granted folders, which is more than this fix needed to land.
/// Android has no equivalent call at all — `access_url` returns
/// `Unsupported` there (see that function's own platform split), and
/// nothing calls it on Android regardless, since Android's own equivalent
/// gap (a `content://` URI's file descriptor, not a security-scoped file
/// URL) is a completely different mechanism, tracked separately in
/// `AndroidManifest.xml`'s own comment on this same feature.
fn render_opened_document<R: Runtime>(app: &AppHandle<R>, url_str: &str) {
    debug_log::log(&format!("render_opened_document: {url_str}"));
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let _scope = match scoped_bookmarks::access_url(url_str) {
        Ok(scope) => Some(scope),
        Err(e) => {
            debug_log::log(&format!("render_opened_document: no security scope: {e}"));
            None
        }
    };
    let Ok(url) = url::Url::parse(url_str) else {
        debug_log::log("render_opened_document: unparseable URL");
        return;
    };
    let Ok(path) = url.to_file_path() else {
        debug_log::log("render_opened_document: not a file:// URL");
        return;
    };

    // TEMPORARY — 2026-09-12 file-browser plan's Phase 0 spike, remove once
    // answered (see docs/project/plan.md and the mobile file-browser plan).
    // Tests variant (a): can the parent directory be listed *while the
    // file's own `_scope` guard is still held*, on a real device, for a
    // document that arrived via `RunEvent::Opened` (Files/iCloud Drive),
    // as opposed to the Open-button/dialog path which is already known to
    // work fine. Logged via `eval()` so it shows in Safari's Web Inspector
    // console attached to the real device — the same diagnostic channel
    // that found the CSP `ipc:` gap and the search-focus bug this session.
    // Answering this in isolation, before variant (b)/(c) (spike_read_dir_variants
    // below) and before any real caching/UI work, is the whole point of
    // Phase 0: this is the cheapest possible way to find out whether iOS's
    // security scope for a single file extends to `read_dir` on its parent
    // at all, before anything is built assuming one way or the other.
    #[cfg(debug_assertions)]
    if let Some(parent) = path.parent() {
        let result = match std::fs::read_dir(parent) {
            Ok(entries) => format!("OK, {} entries", entries.count()),
            Err(e) => format!("ERR: {e}"),
        };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(format!(
                "console.log('[spike-a] read_dir(parent) while _scope held: {}');",
                escape_for_js(&result)
            ));
        }
    }

    if let Err(e) = render_file(app, &path) {
        debug_log::log(&format!("render_opened_document: render failed: {e}"));
    }
}

/// TEMPORARY — 2026-09-12 file-browser plan's Phase 0 spike, remove once
/// answered. Manually `invoke`-able from the Web Inspector console
/// (`await window.__TAURI__.core.invoke('spike_read_dir_variants')`) any time
/// *after* a document has been opened via `RunEvent::Opened` on a real
/// device, so it can be run seconds/minutes later than the automatic
/// variant-(a) check in `render_opened_document` above — testing:
///
/// - **(b)** a bare `std::fs::read_dir` on the current document's parent
///   with no scope reacquisition at all (the security scope from whatever
///   opened it, if any, has long since been dropped by this point) — does
///   access persist, or was (a) only working because the scope was still
///   fresh?
/// - **(c)** the same read, but after reconstructing the *directory's own*
///   URL string (not the file's) and calling `scoped_bookmarks::access_url`
///   on that — testing whether a fresh scope grant works when constructed
///   directly for the directory, rather than inherited from the file.
///
/// Returns a plain string (both results) rather than a structured type —
/// this is a throwaway diagnostic, not permanent API surface, so it isn't
/// worth a dedicated response shape.
///
/// Debug builds only (2026-10-17, ahead of the first App Store submission):
/// the spike is still unanswered, so it stays for OTA dev builds, but a
/// diagnostic `invoke` surface has no business in a public release.
#[cfg(debug_assertions)]
#[tauri::command]
fn spike_read_dir_variants<R: Runtime>(app: AppHandle<R>) -> String {
    let Some(current) = app.state::<CurrentDocument>().0.lock().unwrap().clone() else {
        return "no current document — open one via Files/Share first".to_string();
    };
    let Some(parent) = current.path.parent() else {
        return "current document has no parent directory".to_string();
    };

    let b_result = match std::fs::read_dir(parent) {
        Ok(entries) => format!("OK, {} entries", entries.count()),
        Err(e) => format!("ERR: {e}"),
    };

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let c_result = {
        match url::Url::from_file_path(parent) {
            Ok(dir_url) => {
                let _scope = scoped_bookmarks::access_url(dir_url.as_str()).ok();
                match std::fs::read_dir(parent) {
                    Ok(entries) => format!("OK, {} entries", entries.count()),
                    Err(e) => format!("ERR: {e}"),
                }
            }
            Err(()) => "ERR: parent path is not a valid file URL".to_string(),
        }
    };
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let c_result = "N/A (not macOS/iOS)".to_string();

    format!("(b) bare read_dir, no fresh scope: {b_result}\n(c) read_dir after access_url(directory URL): {c_result}")
}

// Ported from DocumentViewModel.openFile()/load(url:)/reload(),
// LocalSchemeHandler, and FileWatcher — Milestone A/B, host glue only (see
// porting-brief.md's Host glue table). A native file dialog picks a file,
// its contents are read and pushed into the renderer, its directory
// becomes servable through the mdviewer-local:// scheme for relative image
// paths, and the file itself is watched for external changes.
//
// Still not ported from DocumentViewModel: NSDocumentController's recent-
// documents tracking, BookmarkManager-backed restoreLastOpened() on launch,
// and surfacing a read error to the user (there's no UI to show it in yet —
// render_file returns an Err so the caller *could*, it's just discarded for
// now). One concern at a time, per the working agreement.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First, before Tauri itself starts, so a crash anywhere after this
    // still leaves a "session start" line behind — see debug_log.rs.
    debug_log::init_for_platform();
    debug_log::log("run: building app");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DocumentBaseDir::default())
        .manage(CurrentDocument::default())
        .manage(FileWatcher::default())
        .manage(GrantedFolders::default())
        .manage(GrantedFolderAccess::default())
        .manage(PendingOpenedDocument::default())
        .setup(|app| {
            // Pure Rust/OS work — no webview, no `eval()` — so, unlike
            // `restore_last_opened_document` below, this has none of the
            // Android on_page_load/UI-thread deadlock risk that function's
            // own comment documents, and doesn't need to wait for a page
            // load at all. Runs as early as possible so a document opened
            // moments later can already see any folder this restores.
            debug_log::log("setup: restoring granted folders");
            restore_granted_folders(app.handle());
            debug_log::log("setup: done");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            request_folder_access,
            handle_link_click,
            set_remote_content_policy_always,
            open_document_command,
            open_sample_document,
            get_remote_content_policy,
            set_remote_content_policy,
            fetch_remote_image,
            #[cfg(debug_assertions)]
            spike_read_dir_variants,
            list_directory,
            list_granted_folders,
            log_frontend_error
        ]);

    // `tauri::menu` — and so a native File menu — is `#[cfg(desktop)]` only;
    // there's no menu-bar equivalent on Android/iOS. Confirmed 2026-09-08
    // getting the first `cargo tauri ios build` to compile at all: this and
    // `blocking_pick_folder` below (see `request_folder_access`) were the
    // only two desktop-only APIs this file had reached for.
    //
    // **Update (2026-09-09):** `open_document` now also has an
    // `invoke`-based surface (`open_document_command`, see its own doc
    // comment), reachable from `toolbar.ts`'s Open button on every
    // platform including mobile — closing that part of this gap for real.
    // `save_document`/`save_document_as` stay menu-only still: the
    // toolbar's Save button isn't built (needs dirty-tracking, which needs
    // an editor — see plan.md's Milestone C), so there's no caller for an
    // `invoke` surface on those two yet.
    #[cfg(desktop)]
    let builder = builder
        .menu(|handle| {
            let open_item = MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let save_item = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?;
            let save_as_item = MenuItemBuilder::with_id("save_as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(handle)?;
            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .build()?;
            MenuBuilder::new(handle).item(&file_menu).build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "open" {
                open_document(app);
            } else if event.id() == "save" {
                save_document(app);
            } else if event.id() == "save_as" {
                save_document_as(app);
            }
        });

    let builder = builder.register_uri_scheme_protocol("mdviewer-local", |ctx, request| {
        handle_local_scheme_request(ctx.app_handle(), request.uri().path())
    });

    let builder = builder.on_page_load(|webview, payload| {
        // `Finished`, not `Started`: firing from `.setup()` (tried first)
        // raced the "main" window's *first* real navigation to
        // `renderer.html` — that eval landed in a transient blank JS
        // context that got wiped out the moment the real page navigated
        // in, so it silently never took effect. `on_page_load`'s
        // `Finished` event is the actual per-navigation-complete hook;
        // guarded with `INITIAL_LOAD_COMPLETE` so a later, unrelated page
        // load (once mobile can navigate at all — it can't yet) doesn't
        // re-fire this startup-only behaviour.
        use std::sync::atomic::Ordering;
        if payload.event() == tauri::webview::PageLoadEvent::Finished
            && !INITIAL_LOAD_COMPLETE.swap(true, Ordering::SeqCst)
        {
            debug_log::log(&format!("page load finished: {}", payload.url()));
            let app = webview.app_handle().clone();
            // Deferred via spawn, not called inline: this callback fires
            // on Android's UI thread (confirmed 2026-09-09 debugging a
            // real hang — `render_file`'s `window.eval()` calls need that
            // same UI thread, and calling them synchronously from here
            // deadlocks — the callback can't return to free the thread
            // that `eval()` is blocked waiting for). Desktop's WKWebView-
            // backed `on_page_load` doesn't have this problem, which is
            // exactly why it went unnoticed until testing on a real
            // Android device. Spawning moves the call off this thread so
            // Tauri's own thread-hop for `eval()` isn't reentrant.
            tauri::async_runtime::spawn(async move {
                // Matches `ContentView.swift`'s `onAppear` priority chain:
                // the test-document hook (test builds only), then a
                // file the OS handed the app at launch (`RunEvent::Opened`,
                // buffered in `PendingOpenedDocument` if it arrived before
                // this exact moment — see that struct's own doc comment),
                // then `restoreLastOpened()`. Only reaches each successive
                // step if nothing before it already populated
                // `CurrentDocument`.
                #[cfg(debug_assertions)]
                load_test_document_if_configured(&app);
                if app.state::<CurrentDocument>().0.lock().unwrap().is_none() {
                    debug_log::log("startup: checking for an OS-opened document");
                    take_and_render_pending(&app);
                }
                if app.state::<CurrentDocument>().0.lock().unwrap().is_none() {
                    debug_log::log("startup: restoring last-opened document");
                    restore_last_opened_document(&app);
                }
                debug_log::log("startup: complete");
            });
        }
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    debug_log::log("run: app built, entering event loop");
    app.run(|app_handle, event| {
        // Lifecycle events only — not every event, `MainEventsCleared`
        // and friends fire on every loop iteration and would bury the
        // log.
        match &event {
            tauri::RunEvent::Ready => debug_log::log("event: Ready"),
            tauri::RunEvent::Resumed => debug_log::log("event: Resumed"),
            tauri::RunEvent::ExitRequested { .. } => debug_log::log("event: ExitRequested"),
            tauri::RunEvent::Exit => debug_log::log("event: Exit"),
            _ => {}
        }

        // The user's own request (2026-09-11), after their first real
        // OTA install: register the .md file extension so tapping one
        // in iOS's Files app (or Android's "Open with", or double-
        // clicking one in Finder) opens it here. The actual
        // extension/UTI/intent-filter registration is platform config
        // (iOS: gen/apple/mdviewer_iOS/Info.plist's
        // CFBundleDocumentTypes; Android:
        // gen/android/.../AndroidManifest.xml's intent-filters; desktop:
        // this file's own tauri.conf.json `bundle.fileAssociations`) —
        // this is the other half, actually receiving the file once the
        // OS hands it over. `RunEvent::Opened` is Tauri's own
        // unified surface for that hand-off across exactly macOS/iOS/
        // Android (confirmed in the vendored `tauri` crate's `app.rs` —
        // the variant is `cfg`-gated to those three targets, not
        // invented per platform here), covering both a cold launch
        // (tapping a file when the app isn't running) and a warm one
        // (tapping a second file while it already is).
        if let tauri::RunEvent::Opened { urls } = event {
            // Only the first URL — matches Swift's own single-document
            // model (`DocumentViewModel` has no concept of multiple
            // simultaneously "opened" files, and neither does anything
            // else in this port yet). Kept as its string form here
            // (not converted to a `PathBuf` yet) — `render_opened_document`
            // needs that string to re-acquire security-scoped access on
            // iOS (see its own doc comment); converting early, the way
            // an earlier version of this handler did, throws that away
            // before it can ever be used.
            if let Some(url) = urls.first() {
                let url_str = url.to_string();
                debug_log::log(&format!("event: Opened {url_str}"));
                use std::sync::atomic::Ordering;
                if INITIAL_LOAD_COMPLETE.load(Ordering::SeqCst) {
                    // Warm open — the window's already showing a real
                    // page, so render directly rather than buffering
                    // for a page-load event that isn't coming again.
                    // Spawned for the same UI-thread/eval-deadlock
                    // reason `on_page_load`'s own callback is above —
                    // this closure runs on the platform's main/UI
                    // thread too, not a plain async context.
                    let app = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        render_opened_document(&app, &url_str);
                    });
                } else {
                    // Cold launch, racing the first page load — buffer
                    // it for on_page_load's own priority chain (above)
                    // to pick up once the page genuinely exists.
                    *app_handle.state::<PendingOpenedDocument>().0.lock().unwrap() = Some(url_str);
                }
            }
        }
    });
}

/// The frontend's half of the out-of-band debug log: `errorForwarding.ts`
/// sends uncaught JS errors and unhandled rejections here so they land in
/// the same file as the native breadcrumbs (see `debug_log.rs`). A no-op
/// wherever that log isn't active, i.e. everywhere but iOS debug builds.
#[tauri::command]
fn log_frontend_error(message: String) {
    debug_log::log(&format!("js: {message}"));
}

/// Test-only, mirrors `ContentView.swift`'s `MDVIEWER_TEST_DOCUMENT_PATH`
/// hook exactly (same env var name, same purpose): load a document at
/// startup without driving a real file-picker dialog. Originally needed
/// here for a reason Swift's version wasn't (still true of its two
/// original justifications, `tauri::menu` staying desktop-only and no
/// mobile file-picker UI to drive automatically): mobile has no menu, and
/// — until 2026-09-11, see `PendingOpenedDocument`/`RunEvent::Opened`
/// above and each mobile platform's own document-type/intent-filter
/// declaration (iOS's `gen/apple/mdviewer_iOS/Info.plist`, Android's
/// `gen/android/.../AndroidManifest.xml`) — no way at all to get a real
/// document into the app on iOS/Android short of this hook. That gap is
/// closed now; this hook stays purely for deterministic automated
/// testing (a real file-association launch isn't scriptable the same way
/// `MDVIEWER_TEST_DOCUMENT_PATH`/the `/data/local/tmp` fallback are).
///
/// `#[cfg(debug_assertions)]`-gated in `run()` above, so this is compiled
/// out of release builds entirely — stricter than Swift's version, which
/// stays compiled in and relies solely on the env var being absent in
/// normal use (its own comment says as much). Falls back to a fixed,
/// well-known path when the env var isn't set: Android's `adb shell am
/// start` can't set a launched process's actual environment the way
/// `xcrun simctl launch` can (via `SIMCTL_CHILD_*`, which Apple documents
/// specifically for this) or a desktop test scheme can, so an env var
/// alone doesn't reach Android — a fixed path `adb push` can write to
/// does. `/data/local/tmp` specifically because it's a shell-owned,
/// world-readable location outside scoped storage's reach, the same spot
/// Android's own instrumentation tooling stages test fixtures. Harmless
/// on desktop/iOS: the fallback path simply won't exist there.
#[cfg(debug_assertions)]
fn load_test_document_if_configured<R: Runtime>(app: &AppHandle<R>) {
    const FALLBACK_PATH: &str = "/data/local/tmp/mdviewer_test_document.md";
    let path = std::env::var("MDVIEWER_TEST_DOCUMENT_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(FALLBACK_PATH));
    if path.exists() {
        let _ = render_file(app, &path);
    }
}

fn open_document<R: Runtime>(app: &AppHandle<R>) {
    // Matches DocumentViewModel.openFile(): a blocking modal panel, same as
    // NSOpenPanel.runModal() being synchronous on the main thread.
    let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file()
    else {
        return; // User cancelled.
    };
    let Ok(path) = file_path.into_path() else { return };
    let _ = render_file(app, &path);
}

/// Thin `invoke`-able wrapper around `open_document`, so `toolbar.ts`'s
/// Open button can reach it — same split-for-testability shape as
/// `render_file`/`open_document` and `grant_folder_access`/
/// `request_folder_access` above, except here the wrapper exists for
/// *invokability* rather than testability (`open_document` itself was
/// already tested indirectly via `render_file`'s tests; a real file
/// dialog still isn't something `cargo test` can drive).
///
/// Unlike `request_folder_access`'s `blocking_pick_folder`, `pick_file`/
/// `blocking_pick_file` (used by `open_document`) has both a `desktop.rs`
/// *and* a `mobile.rs` implementation in `tauri-plugin-dialog` 2.7.3
/// (checked directly in the vendored crate source, not assumed) — no
/// `#[cfg(desktop)]` gate on it anywhere. So this closes the gap the
/// `run()` comment above flags for real, not just partially: Open is now
/// genuinely reachable on Android/iOS via `invoke`, the same as desktop's
/// File menu. Save/Save As stay menu-only for now — the toolbar's Save
/// button is deliberately not built yet (see toolbar.ts's header comment,
/// blocked on dirty-tracking having no consumer without an editor), so
/// there's no caller for an `invoke` surface on those two yet either.
///
/// **`async` here is load-bearing, not decoration — a real deadlock found
/// on triton's first-ever real-device install (2026-09-09), the same
/// shape as the Android `on_page_load`/`eval` deadlock found earlier this
/// session, on iOS instead of Android.** A non-`async` `#[tauri::command]`
/// runs its body inline on whatever thread delivered the IPC call — no
/// thread hop (confirmed in `tauri-macros`' `body_blocking`, which just
/// calls the function directly, versus `body_async`'s
/// `resolver.respond_async_serialized`, which genuinely spawns onto
/// Tauri's async runtime — checked, not assumed). On iOS, `WKWebView`
/// delivers `WKScriptMessageHandler` callbacks — and so this command's
/// invocation — on the main thread, by Apple's own contract. `open_document`
/// calls `blocking_pick_file()`, which does a real blocking wait
/// (`rx.recv()`) for a callback the Swift picker plugin only ever fires
/// from inside `DispatchQueue.main.async` (`DialogPlugin.swift`,
/// `showFilePicker`). A synchronous command already running ON the main
/// thread blocks it waiting for a callback that can only run once the
/// main thread's run loop is free to process that same `DispatchQueue.main.async`
/// block — a self-deadlock, not a crash or a silent no-op, which is
/// exactly what tapping "Open…" looked like live: no response, no error,
/// no console output at all, forever. `tauri::async_runtime::spawn_blocking`
/// moves `open_document`'s call (and so its blocking wait) onto a real
/// OS thread from the async runtime's blocking pool instead, leaving the
/// main thread free to run the picker's own dispatch — not verified via
/// pixels yet this pass (see plan.md), but grounded in the same
/// source-level reasoning that correctly diagnosed and fixed the Android
/// case.
#[tauri::command]
async fn open_document_command<R: Runtime>(app: AppHandle<R>) {
    let _ = tauri::async_runtime::spawn_blocking(move || open_document(&app)).await;
}

/// The built-in sample document, compiled into the binary rather than
/// shipped as a bundle resource so it needs no per-platform packaging.
/// New, not a Swift port (2026-10-20): App Review rejected iOS 1.0.0
/// under guideline 2.1(a) because a fresh review device has no `.md`
/// files to open, and asked for a demo mode. The user chose this over a
/// reply-only answer.
const SAMPLE_DOCUMENT: &str = include_str!("../sample/Welcome.md");
const SAMPLE_IMAGE: &[u8] = include_bytes!("../icons/128x128.png");

/// Writes the sample document and the image it references into `dir`,
/// overwriting any earlier copy, and returns the document's path. Split
/// from `open_sample_document` so it's testable without an app handle.
fn write_sample_document(dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("icon.png"), SAMPLE_IMAGE).map_err(|e| e.to_string())?;
    let path = dir.join("Welcome.md");
    std::fs::write(&path, SAMPLE_DOCUMENT).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Opens the sample document like any other file, so it gets the same
/// base directory (its relative image loads), file watching and
/// last-opened restore as a real one. Written to the cache directory:
/// the copy is disposable and rewritten on every call.
#[tauri::command]
fn open_sample_document<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("sample");
    let path = write_sample_document(&dir)?;
    render_file(&app, &path)
}

/// Ported from `FolderAccessManager.requestAccess(to:)`: a Tauri command so
/// the frontend can trigger it (`invoke('request_folder_access', { seed })`)
/// once Milestone F builds the in-page "Grant Folder Access…" banner Swift
/// shows when a document's relative images fail to load — the same UI
/// trigger this exists to serve, not yet built, so nothing calls this
/// command today. Registered now, ahead of that UI, the same way
/// `open_document`/`save_document` were wired to native menu items before
/// any richer UI existed. `seed` mirrors `panel.directoryURL` — Swift seeds
/// the picker at the directory access was denied for; `None` lets the OS
/// pick a default starting location.
///
/// **Was desktop-only until 2026-09-12.** `FileDialogBuilder::{pick_folder,
/// blocking_pick_folder}` are themselves `#[cfg(desktop)]` in
/// `tauri-plugin-dialog` — confirmed 2026-09-08 trying to compile this for
/// iOS, there is no folder-picker API on mobile at all in the plugin today,
/// not just an untested one. iOS now has its own native picker instead
/// (`ios_folder_picker`), built after the user chose that over limiting the
/// file browser to whatever folder a document was opened from. Android is
/// still unsupported — see the `#[cfg(target_os = "android")]` branch.
///
/// `async` + `spawn_blocking`, not a plain sync command, and that is
/// load-bearing rather than stylistic: every picker below blocks its
/// thread waiting on the user, and a non-async Tauri command runs *inline
/// on the calling thread* (confirmed in `tauri-macros`' own
/// `body_blocking` vs. `body_async` code generation, the same reading that
/// fixed `open_document_command`). On iOS that caller is the main thread,
/// and the delegate callback the picker waits for can only ever fire *on*
/// the main thread — so a sync version deadlocks the app outright.
#[tauri::command]
async fn request_folder_access<R: Runtime>(app: AppHandle<R>, seed: Option<PathBuf>) -> bool {
    tauri::async_runtime::spawn_blocking(move || request_folder_access_blocking(app, seed))
        .await
        .unwrap_or(false)
}

/// The actual picker-and-grant work, always off the main thread — see
/// `request_folder_access`'s own comment on why that separation matters.
fn request_folder_access_blocking<R: Runtime>(app: AppHandle<R>, seed: Option<PathBuf>) -> bool {
    #[cfg(desktop)]
    {
        let mut picker = app.dialog().file();
        if let Some(dir) = &seed {
            picker = picker.set_directory(dir);
        }
        let Some(folder_path) = picker.blocking_pick_folder() else {
            return false; // User cancelled.
        };
        let Ok(path) = folder_path.into_path() else { return false };
        grant_folder_access(&app, &path)
    }
    // iOS got a real folder picker 2026-09-12 (`ios_folder_picker`), after
    // the user chose "build the native folder picker" over scoping the file
    // browser to whatever folder a document happened to be opened from.
    // `seed` is ignored here: the deprecated `initWithDocumentTypes:inMode:`
    // initializer this is built on has no starting-directory equivalent
    // (`directoryURL` is settable on the modern one only), and inventing a
    // partial version of it would be worse than plainly not having it.
    //
    // The picked URL arrives as a *string*, not a path, and stays one until
    // scope is re-acquired — `access_url` on the directory URL, then
    // `grant_folder_access` (canonicalize → `GrantedFolders` → persistent
    // bookmark) while that scope is live. Doing it in the other order
    // (path first, scope later) is exactly the bug that cost a real-device
    // round-trip on 2026-09-11's file-association work.
    #[cfg(target_os = "ios")]
    {
        let _ = seed;
        let Ok(Some(url_str)) = ios_folder_picker::pick_folder_blocking(&app) else {
            return false; // Cancelled, or the picker could not be presented.
        };
        let _scope = scoped_bookmarks::access_url(&url_str).ok();
        let Ok(url) = url::Url::parse(&url_str) else { return false };
        let Ok(path) = url.to_file_path() else { return false };
        grant_folder_access(&app, &path)
    }

    // Android has no equivalent yet — its own access model is a
    // `content://` URI from the Storage Access Framework, a different
    // mechanism entirely from a security-scoped file URL, tracked with the
    // rest of the Android content-URI gap in AndroidManifest.xml's comment.
    #[cfg(target_os = "android")]
    {
        let _ = (app, seed);
        false
    }
}

/// Records `path` as an accessible folder — matches `requestAccess`'s
/// `setCurrent(url); persist(url)` once the (untestable, real) picker
/// above has returned a path. Split out so it's testable without a real
/// dialog, same reason `render_file` is split from `open_document`.
/// Returns `false` only if `path` can't be canonicalized (doesn't exist);
/// Swift has no equivalent failure mode here since `panel.url` is already
/// a resolved filesystem URL by the time `requestAccess` sees it.
///
/// The `persist(url)` half of that Swift call — a security-scoped
/// bookmark — is `bookmark_granted_folder` below, not inlined here: this
/// function's own contract (canonicalize, record in `GrantedFolders`,
/// return whether that succeeded) is unaffected by whether bookmarking
/// also succeeds, so keeping them separate keeps `grant_folder_access`
/// itself trivially testable without needing macOS/a filesystem bookmark
/// to actually resolve.
/// The folders currently granted (tier two of the access model — see
/// `GrantedFolders`). Added 2026-09-12 for the consolidated permissions
/// prompt (permissions.ts), which shows what access has actually been
/// given rather than only what the user was asked for.
///
/// Reads the authoritative in-memory list rather than the on-disk bookmark
/// store, deliberately: `restore_granted_folders` already repopulates this
/// at startup from those bookmarks, and a bookmark that failed to resolve
/// this run is *not* usable access, so reporting it would overstate what
/// the app can really read.
#[tauri::command]
fn list_granted_folders<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    app.state::<GrantedFolders>()
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

fn grant_folder_access<R: Runtime>(app: &AppHandle<R>, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    app.state::<GrantedFolders>().0.lock().unwrap().push(canonical.clone());
    bookmark_granted_folder(app, &canonical);
    true
}

/// The on-disk store's filename — same directory/convention as
/// `remote_content_policy.txt`/`last_opened_document.txt`
/// (`app.path().app_config_dir()`). Unlike those two, this holds more than
/// one value at once (one entry per granted folder), so it's JSON rather
/// than a raw string — matches the audited reference crate's own stated
/// reasoning for the same choice ("deliberately dumb so the file stays
/// inspectable and portable"), not a new decision made here.
const GRANTED_FOLDER_BOOKMARKS_FILE: &str = "granted_folder_bookmarks.json";

fn granted_folder_bookmarks_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(GRANTED_FOLDER_BOOKMARKS_FILE))
        .map_err(|e| e.to_string())
}

/// A missing or corrupt store both read back as empty — same reasoning as
/// the audited reference crate's own `corrupt_store_file_loads_empty_
/// rather_than_failing` test: a hand-edited or truncated store must not
/// brick every previously-granted folder at once, and (unlike
/// `read_remote_content_policy_from`'s single value, which has an "ask"
/// default to fall back to) there is no meaningful non-empty default here.
/// Path injected so tests never touch the real `app_config_dir()`, same
/// split as every other persisted value in this file.
fn read_granted_folder_bookmarks_from(path: &Path) -> HashMap<String, Vec<u8>> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_granted_folder_bookmarks_to(path: &Path, bookmarks: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec(bookmarks).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Persists a security-scoped bookmark for a freshly-granted folder and
/// keeps its access open for this run, so `restore_granted_folders` can
/// bring it back on the next launch — the actual gap this Milestone B item
/// exists to close (Tauri's own allowlist persisting is not the same as
/// the macOS sandbox grant persisting; see `scoped_bookmarks`'s and
/// plan.md's own notes).
///
/// Deliberately best-effort and folded into `grant_folder_access` rather
/// than surfaced in its `bool` result: `canonical` is already usable for
/// the rest of *this* run purely through `GrantedFolders`' in-memory list,
/// which this function cannot affect either way — bookmark creation
/// failing (a non-Apple platform, where `scoped_bookmarks::Bookmark::
/// create` always returns `Unsupported`, or a genuine Cocoa error) should
/// not make an otherwise-successful grant look like it failed. Only
/// cross-launch persistence is at stake here, not this session's access.
fn bookmark_granted_folder<R: Runtime>(app: &AppHandle<R>, canonical: &Path) {
    let id = canonical.to_string_lossy().to_string();
    let Ok(bookmark) = scoped_bookmarks::Bookmark::create(canonical) else { return };
    let Ok(access) = bookmark.resolve() else { return };

    if let Ok(store_path) = granted_folder_bookmarks_path(app) {
        let mut stored = read_granted_folder_bookmarks_from(&store_path);
        stored.insert(id.clone(), bookmark.into_bytes());
        let _ = write_granted_folder_bookmarks_to(&store_path, &stored);
    }

    app.state::<GrantedFolderAccess>().0.lock().unwrap().insert(id, access);
}

/// Restores every persisted folder grant at launch, repopulating
/// `GrantedFolders` exactly as if each had just been granted again this
/// run — the actual behavior a user should see is "never re-asked," which
/// only holds if `resolve_local_path`/`folder_covers` see these paths the
/// same way they'd see a fresh grant. Called from `.setup()` (see `run()`);
/// unlike `restore_last_opened_document`, this never touches the webview
/// or calls `eval()`, so it has none of that function's Android
/// UI-thread deadlock risk and doesn't need to wait for a page load.
///
/// A folder that fails to resolve (deleted, moved off an unmounted volume,
/// or — off macOS/iOS — bookmarks being `Unsupported` at all, so this is
/// always a silent no-op on Windows/Linux/Android today) is skipped, not
/// treated as an error — same "no error UI to show it in yet" pattern as
/// `restore_last_opened_document`. A stale-but-still-resolving bookmark
/// (the OS moved or renamed the folder) is re-created from its now-current
/// path and re-persisted, matching the audited reference crate's own
/// staleness handling — re-creation only succeeds while access is live,
/// which is exactly the moment this function has it.
fn restore_granted_folders<R: Runtime>(app: &AppHandle<R>) {
    let Ok(store_path) = granted_folder_bookmarks_path(app) else { return };
    let mut stored = read_granted_folder_bookmarks_from(&store_path);
    debug_log::log(&format!("restore_granted_folders: {} stored", stored.len()));
    if stored.is_empty() {
        return;
    }

    let mut changed = false;
    for (id, bytes) in stored.clone() {
        let access = match scoped_bookmarks::Bookmark::from_bytes(bytes).resolve() {
            Ok(access) => access,
            Err(e) => {
                debug_log::log(&format!("restore_granted_folders: {id} failed to resolve: {e}"));
                continue;
            }
        };
        let resolved_path = access.path().to_path_buf();
        debug_log::log(&format!(
            "restore_granted_folders: {id} -> {}{}",
            resolved_path.display(),
            if access.is_stale() { " (stale)" } else { "" }
        ));

        if access.is_stale() {
            if let Ok(fresh) = scoped_bookmarks::Bookmark::create(&resolved_path) {
                stored.insert(id.clone(), fresh.into_bytes());
                changed = true;
            }
        }

        app.state::<GrantedFolders>().0.lock().unwrap().push(resolved_path);
        app.state::<GrantedFolderAccess>().0.lock().unwrap().insert(id, access);
    }

    if changed {
        let _ = write_granted_folder_bookmarks_to(&store_path, &stored);
    }
}

/// Ported from `FolderAccessManager.covers()`. Swift compares
/// `standardizedFileURL.path` strings with a manual trailing-slash
/// boundary check, specifically to stop a sibling directory whose name
/// happens to share a prefix (`/Foo-evil`) from "covering" `/Foo`.
/// `Path::starts_with` is component-wise, so that hack isn't needed here —
/// same simplification already relied on in `resolve_local_path`.
fn folder_covers(folder: &Path, dir: &Path) -> bool {
    dir.starts_with(folder)
}

/// Reads `path`, grants `mdviewer-local://` access to its directory, and
/// pushes the content into the "main" webview window. Split out from
/// `open_document` so it's testable without a real file dialog or a visible
/// window — see the `tests` module, which drives this with
/// `tauri::test::mock_app()`.
fn render_file<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    let markdown = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no \"main\" webview window".to_string())?;

    // Matches RenderViewModel.setBaseURL, called before renderMarkdown in
    // MarkdownRenderView's onReceive(documentVM.$text) — only on a
    // successful read (text only updates on success there too).
    if let Some(parent) = path.parent() {
        *app.state::<DocumentBaseDir>().0.lock().unwrap() = Some(parent.to_path_buf());
        window
            .eval(format!("if (window.MDViewer) {{ window.MDViewer.setBaseURL('{LOCAL_BASE_URL}'); }}"))
            .map_err(|e| e.to_string())?;
    }

    adopt_current_document(app, path, &markdown);

    // Matches `renderMarkdown()` calling `applyRemoteContentPolicy()`
    // immediately before `setContent` — always, not just on a policy
    // change, since the renderer's own `remoteContentPolicy` is
    // per-page state that a fresh `setContent` call doesn't otherwise
    // know about.
    let policy = read_remote_content_policy(app);
    window
        .eval(build_set_remote_content_policy_script(&policy))
        .map_err(|e| e.to_string())?;

    window.eval(build_set_content_script(&markdown)).map_err(|e| e.to_string())
}

/// Ported from `WebRendererView.Coordinator.userContentController`'s
/// `linkClicked` case — the one piece of the `WKScriptMessageHandler`
/// bridge (see plan.md's Milestone A "Command/event bridge" re-scoping)
/// that genuinely needs Rust: switching to a local document, or opening
/// an external URL with the OS's default handler, neither of which JS can
/// do itself. A Tauri command so `interactionListeners.ts`'s
/// `onLinkClicked` callback can call it via `invoke` once wired.
///
/// **Preserved limitation, not fixed here**: only matches an absolute
/// `file://` URL. Confirmed by reading `mdviewer.js` directly (2026-09-08,
/// not assumed) that it sets no `<base>` element, so a *relative*
/// markdown link (`[other](other.md)`) resolves its `.href` against the
/// page's own origin (`tauri://localhost/other.md` on desktop, `http://
/// tauri.localhost/other.md` on Android — never a real filesystem path),
/// which never matches `file://` here, exactly as it never matches
/// Swift's own `url.scheme == "file"` check either. Relative document-to-
/// document links do not actually work as navigation in either version;
/// only an absolute `file://` URL a document author wrote explicitly
/// would. A real, shared limitation worth flagging, not something to
/// silently fix beyond parity.
///
/// The scheme-dispatch decision itself lives in `classify_link`, split
/// out purely for testability — see its own doc comment.
#[tauri::command]
fn handle_link_click<R: Runtime>(app: AppHandle<R>, href: String) {
    match classify_link(&href) {
        LinkAction::OpenLocalDocument(path) => {
            let _ = render_file(&app, &path);
        }
        LinkAction::OpenExternal(url) => {
            let _ = app.opener().open_url(url, None::<&str>);
        }
        LinkAction::Ignore => {}
    }
}

#[derive(Debug, PartialEq)]
enum LinkAction {
    OpenLocalDocument(PathBuf),
    OpenExternal(String),
    Ignore,
}

/// The decision logic `handle_link_click` acts on, split out so it's
/// testable without a registered opener plugin — `app.opener()` panics
/// under `tauri::test::mock_app()` unless the plugin is actually
/// registered, and registering it for real in a test would risk actually
/// launching a browser/mail client. Testing this pure function instead
/// covers the scheme dispatch and the markdown-extension check without
/// ever touching the OS.
fn classify_link(href: &str) -> LinkAction {
    let Ok(url) = url::Url::parse(href) else { return LinkAction::Ignore };
    match url.scheme() {
        "file" => {
            let is_markdown = Path::new(url.path())
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"));
            if !is_markdown {
                return LinkAction::Ignore;
            }
            match url.to_file_path() {
                Ok(path) => LinkAction::OpenLocalDocument(path),
                Err(()) => LinkAction::Ignore,
            }
        }
        "http" | "https" | "mailto" => LinkAction::OpenExternal(href.to_string()),
        // SECURITY: ignore any other scheme (custom schemes, etc.) — a
        // malicious document must not be able to make the app open or
        // launch arbitrary handlers. Matches Swift's own comment exactly.
        _ => LinkAction::Ignore,
    }
}

/// Records `path`/`text` as the current document and (re)starts watching
/// `path` for external changes — matches `load(url:)` calling
/// `fileWatcher.start(url:)`. Shared by `render_file` (open) and
/// `save_as_to` (save as), the two places Swift also starts/restarts the
/// watcher; a plain `save()` to the same path does not, since it's already
/// being watched.
fn adopt_current_document<R: Runtime>(app: &AppHandle<R>, path: &Path, text: &str) {
    *app.state::<CurrentDocument>().0.lock().unwrap() = Some(CurrentDocumentState {
        path: path.to_path_buf(),
        text: text.to_string(),
    });
    watch_file(app, path);
    // Matches `saveLastOpened(url:)`, called from the same two places in
    // Swift this is: `load(url:)` (open) and `writeDocument(to:
    // adoptAsCurrent: true)` (save as). A plain `save()` to an
    // already-current document doesn't call this in Swift either — it's
    // already the one that would be restored.
    record_last_opened_document(app, path);
}

/// Starts watching `path`, replacing (and so stopping) any previous watch —
/// matches `FileWatcher.start(url:)` calling `stop()` first. Silently does
/// nothing on failure (matches Swift: `open()` returning -1 just returns
/// early), since there's no error UI to surface this to yet, same as the
/// rest of this file.
fn watch_file<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    let app_handle = app.clone();
    // Compare against the *canonicalized* path, not the one passed in:
    // notify's macOS backend reports events with symlinks resolved (e.g.
    // "/var/..." watched becomes "/private/var/..." in the event), so a
    // plain equality check against the original path silently never
    // matches — same shape of bug as resolve_local_path's traversal check,
    // same fix. Falls back to the original if canonicalize fails (the file
    // not existing yet), though in practice this is always called right
    // after a successful read, so the file exists.
    let watched_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let Ok(mut debouncer) = notify_debouncer_mini::new_debouncer(
        std::time::Duration::from_millis(500),
        move |result: notify_debouncer_mini::DebounceEventResult| {
            let Ok(events) = result else { return };
            if events.iter().any(|e| e.path == watched_path) {
                reload_current_document(&app_handle);
            }
        },
    ) else {
        return;
    };
    if debouncer
        .watcher()
        .watch(path, notify_debouncer_mini::notify::RecursiveMode::NonRecursive)
        .is_err()
    {
        return;
    }
    // Storing the new Debouncer here drops (and so stops) whatever was
    // being watched before — matches FileWatcher.start() calling stop().
    *app.state::<FileWatcher>().0.lock().unwrap() = Some(debouncer);
}

/// Ported from `DocumentViewModel.reload()`: re-reads the current
/// document's own path and pushes the new content, *without* touching the
/// base directory or restarting the watcher (already correct — it's the
/// same file). Deliberately does not update `DocumentBaseDir` or call
/// `adopt_current_document`/`watch_file` again, matching Swift's `reload()`
/// being a lighter operation than `load(url:)`.
fn reload_current_document<R: Runtime>(app: &AppHandle<R>) {
    let Some(current) = app.state::<CurrentDocument>().0.lock().unwrap().clone() else { return };
    let Ok(markdown) = std::fs::read_to_string(&current.path) else { return };
    let Some(window) = app.get_webview_window("main") else { return };

    if let Some(doc) = app.state::<CurrentDocument>().0.lock().unwrap().as_mut() {
        doc.text = markdown.clone();
    }

    // Matches render_file's own policy push — see its comment for why
    // this happens on every setContent, not just the first.
    let policy = read_remote_content_policy(app);
    let _ = window.eval(build_set_remote_content_policy_script(&policy));

    let _ = window.eval(build_set_content_script(&markdown));
}

fn save_document<R: Runtime>(app: &AppHandle<R>) {
    let current = app.state::<CurrentDocument>().0.lock().unwrap().clone();
    match current {
        // Matches DocumentViewModel.save(): an existing document writes to
        // its own path, adoptAsCurrent: false (nothing to adopt — it's
        // already current).
        Some(doc) => {
            let _ = write_document(&doc.path, &doc.text);
        }
        // Matches save()'s fallback when fileURL is nil: "no backing file
        // yet ... offer a standard Save dialog". Unreachable via today's
        // UI (nothing creates a document without opening one first — no
        // File > New yet), kept for when an editor makes it reachable.
        None => save_document_as(app),
    }
}

fn save_document_as<R: Runtime>(app: &AppHandle<R>) {
    // Matches DocumentViewModel.saveAs(): pre-fill the panel with the
    // current document's name/directory when there is one, else the
    // "Untitled.md" default.
    let current = app.state::<CurrentDocument>().0.lock().unwrap().clone();
    let default_name = current
        .as_ref()
        .and_then(|doc| doc.path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md");

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(default_name);
    if let Some(dir) = current.as_ref().and_then(|doc| doc.path.parent()) {
        dialog = dialog.set_directory(dir);
    }

    let Some(file_path) = dialog.blocking_save_file() else { return }; // User cancelled.
    let Ok(path) = file_path.into_path() else { return };
    let text = current.map(|doc| doc.text).unwrap_or_default();
    let _ = save_as_to(app, &path, &text);
}

/// Writes `text` to `path` and adopts it as the current document — matches
/// `writeDocument(to:adoptAsCurrent: true)`. Split out from
/// `save_document_as` so it's testable without a real save dialog, same
/// reasoning as `render_file`.
fn save_as_to<R: Runtime>(app: &AppHandle<R>, path: &Path, text: &str) -> Result<(), String> {
    write_document(path, text)?;
    adopt_current_document(app, path, text);
    Ok(())
}

fn write_document(path: &Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// The JS this pushes into the renderer via `window.eval` — same shape as
/// Swift's `webView.evaluateJavaScript("MDViewer.setContent('\(escaped)')")`.
/// Polls for `window.MDViewer` for up to 5s (100 × 50ms, the same
/// real-world-latency slack already used for `FileWatcher`'s debounce
/// test elsewhere in this file) instead of a single one-shot check.
/// Needed once `load_test_document_if_configured` started calling this
/// from `.setup()`, which — unlike every other caller (`open_document`'s
/// menu action, `save_as_to`) — runs *before* the page has necessarily
/// finished loading `mdviewer.js`: found by testing the mobile test hook
/// against a real Android emulator (2026-09-08) and seeing the injected
/// call silently no-op, since the original single-shot
/// `if (window.MDViewer) {...}` guard just skipped it once and never
/// retried. Harmless for every existing caller — they already run well
/// after the page has loaded, so `window.MDViewer` is on the first check.
/// Ported from `RenderViewModel.applyRemoteContentPolicy()`, called right
/// before `setContent` in both `renderMarkdown()` and its
/// pending-markdown-on-load path — `render_file`/`reload_current_document`
/// do the same here. `policy` is always one of `"ask"`/`"always"`/
/// `"never"` (see `read_remote_content_policy`), so no JS-string escaping
/// is needed the way `build_set_content_script`'s markdown content needs.
fn build_set_remote_content_policy_script(policy: &str) -> String {
    format!("if (window.MDViewer) {{ window.MDViewer.setRemoteContentPolicy('{policy}'); }}")
}

fn build_set_content_script(markdown: &str) -> String {
    format!(
        "(function poll(attemptsLeft) {{ \
           if (window.MDViewer) {{ window.MDViewer.setContent('{}'); }} \
           else if (attemptsLeft > 0) {{ setTimeout(function() {{ poll(attemptsLeft - 1); }}, 50); }} \
         }})(100);",
        escape_for_js(markdown)
    )
}

/// Ported from RenderViewModel.escapeForJS — still needed here (unlike the
/// TypeScript port's renderViewModel.ts) because this really does cross a
/// process boundary: Rust host process to webview JS, the same shape as
/// Swift's WKWebView.evaluateJavaScript. Same 5 replacements, same order —
/// see porting-brief.md's "No evaluateJavaScript-style string building" note
/// for why the TypeScript side gets to skip this and why the Rust host-glue
/// side can't.
fn escape_for_js(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace("</", "<\\/")
}

/// Ported from `LocalSchemeHandler`'s `mdviewer-local://localhost/...`
/// handling (the `resolveRelativePath`-with-`baseDirectory` path — this
/// scheme has no bundle:// equivalent here, since Tauri's own frontendDist
/// asset protocol already serves renderer.html and vendor scripts).
///
/// Two bugs were found and fixed in the Swift original while porting this
/// (see `docs/project/plan.md` and `LocalSchemeHandlerTests.swift`): a
/// `hasPrefix` check on unresolved paths that directory traversal
/// (`../../etc/passwd`) bypassed entirely, and — specific to Swift's
/// `String`-based comparison, not reproducible in Rust — a sibling
/// directory whose name happened to share a prefix (e.g. `/Web-evil`
/// matching `/Web`) would also have passed. `Path::starts_with` is
/// component-wise, so that second class doesn't exist here; `canonicalize`
/// (resolves `..` *and* symlinks, stricter than Swift's lexical-only
/// `standardizedFileURL`) still handles the first.
fn handle_local_scheme_request<R: Runtime>(app: &AppHandle<R>, request_path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let forbidden = || tauri::http::Response::builder().status(403).body(Vec::new()).unwrap();

    let Some(base_dir) = app.state::<DocumentBaseDir>().0.lock().unwrap().clone() else {
        return not_found(); // No document open yet.
    };
    let granted = app.state::<GrantedFolders>().0.lock().unwrap().clone();
    let Some(resolved) = resolve_local_path(&base_dir, &granted, request_path) else {
        return forbidden();
    };
    match std::fs::read(&resolved) {
        Ok(data) => tauri::http::Response::builder()
            .header(tauri::http::header::CONTENT_TYPE, mime_type_for(&resolved))
            .body(data)
            .unwrap(),
        Err(_) => not_found(),
    }
}

/// Resolves a scheme request path against `base_dir` — the request is
/// always relative to the *document's* directory (see `LOCAL_BASE_URL`),
/// even when it escapes upward into a `granted_folders` entry, matching
/// how a relative image reference in the Markdown itself works. Rejects
/// anything that escapes both `base_dir` and every granted folder
/// (directory traversal) once symlinks and `..`/`.` are resolved. Returns
/// `None` if the path can't be resolved at all (doesn't exist) or resolves
/// outside all of them — tier one (`base_dir`, automatic) and tier two
/// (`granted_folders`, explicit) of the access model documented on
/// `GrantedFolders`; there is no third, whole-disk tier.
fn resolve_local_path(base_dir: &Path, granted_folders: &[PathBuf], request_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(request_path)
        .decode_utf8()
        .ok()?;
    let relative = decoded.strip_prefix('/').unwrap_or(&decoded);
    let joined = base_dir.join(relative);
    let canonical_joined = joined.canonicalize().ok()?;

    path_is_accessible(base_dir, granted_folders, &canonical_joined).then_some(canonical_joined)
}

/// The two-tier access check itself — tier one (`base_dir`, automatic) and
/// tier two (`granted_folders`, explicit), extracted 2026-09-12 (file-browser
/// plan's Phase 1) so `resolve_local_path` (image/resource URLs) and
/// `list_directory` (directory listings) share one predicate instead of two
/// copies risking drift. `target` must already be canonical — each caller
/// canonicalizes it first, for its own reason (`resolve_local_path` to
/// collapse `..`/symlinks in a request path; `list_directory` because the
/// directory being checked is the very thing being listed, already
/// resolved). `base_dir` is canonicalized *here*, not by the caller — neither
/// caller has a canonical copy on hand already (`DocumentBaseDir` itself is
/// stored uncanonicalized; `render_file` just does `parent.to_path_buf()`).
fn path_is_accessible(base_dir: &Path, granted_folders: &[PathBuf], target: &Path) -> bool {
    let Ok(canonical_base) = base_dir.canonicalize() else { return false };
    target.starts_with(&canonical_base) || granted_folders.iter().any(|folder| folder_covers(folder, target))
}

/// The same four extensions `Info.plist`/`AndroidManifest.xml`'s file-
/// association registration declares (2026-09-11) — kept in sync with that
/// list deliberately, since a file the OS would hand the app directly is
/// exactly the set the in-app browser should also surface. Not reused from
/// `classify_link`'s own narrower two-extension check (`md`/`markdown`
/// only) — that function is about clicked in-document links specifically,
/// a different, already-documented scope not touched here.
const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| MARKDOWN_EXTENSIONS.iter().any(|known| ext.eq_ignore_ascii_case(known)))
}

/// One entry in a `DirListing` — either a subdirectory (always shown, so a
/// user can navigate deeper looking for documents) or a markdown file
/// (`has_markdown_extension`; other file types are filtered out entirely —
/// this is a markdown viewer's file browser, not a general file manager).
/// Deliberately just `{name, is_dir}`, not a full path: the frontend
/// reconstructs a child's full path by joining `DirListing.path` + `name`
/// itself when navigating in, matching how `resolve_local_path`'s own
/// request-path shape already works (relative-to-a-known-base, not a full
/// path carried around).
#[derive(Debug, serde::Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

/// `path` is the *canonical* form of whatever was listed — the frontend's
/// folder cache (file-browser plan's own design) keys off this returned
/// value, not whatever path string it asked with, so two different-but-
/// equivalent requests (a symlink, a trailing slash) collapse to one cache
/// entry rather than silently duplicating it.
///
/// `parent` is the listed folder's parent — but only when that parent is
/// itself browsable (2026-10-17). The frontend used to compute "up one
/// level" by string arithmetic and always offered it, so at the top of a
/// grant (or of an ungranted document's folder) the row led straight to
/// this function's own `access_denied:` error — a dead end the UI invited,
/// and the raw error text an App Store reviewer would see. This function
/// is what enforces access, so it's the one place that can say honestly
/// whether going up will work; `None` serializes as `null` and hides the
/// row.
#[derive(Debug, serde::Serialize)]
struct DirListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirEntry>,
}

/// New 2026-09-12 (file-browser plan's Phase 1) — lists a directory's
/// subfolders and markdown files for the in-app file browser. `path: None`
/// defaults to `DocumentBaseDir` (the current document's own folder) — the
/// starting point every browse session begins from, and, on mobile, the
/// *only* folder ever reachable at all (see `request_folder_access`'s own
/// doc comment: there is no folder-picker on mobile, so `GrantedFolders`
/// can only ever be populated on desktop or restored from a desktop-made
/// grant — mobile users can browse `DocumentBaseDir`'s subtree and nothing
/// beyond it, which this command doesn't work around, just honestly
/// reflects).
///
/// **Fallback added 2026-10-03** (real-user report: granting a folder from
/// the first-launch permissions prompt, before ever opening a document,
/// produced no folder view at all). `DocumentBaseDir` being unset no longer
/// means "nothing to browse" outright — if a folder has already been
/// granted (tier two, `GrantedFolders`) with no document open yet, the
/// *most recently* granted one stands in as the browse root instead. Once a
/// document is open this never triggers (`DocumentBaseDir` always wins),
/// matching the behavior every other caller still relies on unchanged.
///
/// Thin wrapper over `list_directory_at`, same split as every other command
/// in this file, purely so the real logic is testable against real temp
/// dirs via `tauri::test::mock_app()`-managed state without needing a real
/// window or OS dialog.
#[tauri::command]
fn list_directory<R: Runtime>(app: AppHandle<R>, path: Option<String>) -> Result<DirListing, String> {
    let document_base_dir = app.state::<DocumentBaseDir>().0.lock().unwrap().clone();
    let granted = app.state::<GrantedFolders>().0.lock().unwrap().clone();
    let base_dir = match document_base_dir {
        Some(dir) => dir,
        None => granted
            .last()
            .cloned()
            .ok_or_else(|| "not_found: no document open yet".to_string())?,
    };
    let target = path.map(PathBuf::from).unwrap_or_else(|| base_dir.clone());
    list_directory_at(&base_dir, &granted, &target)
}

/// The actual listing logic — same ordering as `resolve_local_path`
/// (canonicalize first, since access can't be checked without knowing the
/// real resolved path anyway; then the access check; only then touch the
/// filesystem again for the actual read) so both commands fail the same
/// way for the same reasons. Error strings carry a stable `kind: ` prefix
/// (not a serialized enum — every other command in this file returns a
/// plain `Result<T, String>`, and introducing a second error-shape
/// convention just for this command isn't worth it) so a caller that wants
/// to react differently to "not found" vs. "access denied" vs. "OS
/// permission error" can match on the prefix without parsing the whole
/// message.
fn list_directory_at(base_dir: &Path, granted_folders: &[PathBuf], target: &Path) -> Result<DirListing, String> {
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("not_found: {e}"))?;
    if !canonical.is_dir() {
        return Err("not_found: not a directory".to_string());
    }
    if !path_is_accessible(base_dir, granted_folders, &canonical) {
        return Err("access_denied: outside the document's folder and no folder has been granted".to_string());
    }

    let read = std::fs::read_dir(&canonical).map_err(|e| format!("permission_denied: {e}"))?;
    let mut entries: Vec<DirEntry> = read
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let is_dir = entry.file_type().ok()?.is_dir();
            if !is_dir && !has_markdown_extension(&entry.path()) {
                return None;
            }
            Some(DirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    let parent = canonical
        .parent()
        .filter(|p| path_is_accessible(base_dir, granted_folders, p))
        .map(|p| p.to_string_lossy().to_string());

    Ok(DirListing {
        path: canonical.to_string_lossy().to_string(),
        parent,
        entries,
    })
}

/// Ported from `LocalSchemeHandler.mimeType(for:)`.
fn mime_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) {
        Some(ext) => match ext.as_str() {
            "html" => "text/html",
            "css" => "text/css",
            "js" => "application/javascript",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "woff" | "woff2" => "font/woff",
            "json" => "application/json",
            _ => "application/octet-stream",
        },
        None => "application/octet-stream",
    }
}

/// Ported from `RemoteContentPolicy` (`PreferencesView.swift`) — the
/// other genuinely-Rust piece of the `WKScriptMessageHandler` bridge (see
/// `handle_link_click`'s doc comment and plan.md's Milestone A
/// re-scoping): the "Always Allow" choice on the remote-content prompt
/// needs to persist outside the page, the same way Swift's version
/// persists to `UserDefaults` under the `"remoteContentPolicy"` key. No
/// `UserDefaults` equivalent exists in Rust/Tauri, and a single string
/// doesn't justify a full key-value-store plugin dependency, so this
/// writes the same three raw values ("ask"/"always"/"never") to a plain
/// text file in the platform's app-config directory instead — Tauri's
/// own `app.path().app_config_dir()`, no extra plugin needed for that
/// part either.
///
/// The "Load"/"Don't Load" choices on the same prompt are *not* handled
/// here — they're in-page state (matches Swift: only "Always Allow"
/// persists anything), and the actual restoring of blocked images either
/// way is `window.MDViewer.loadRemoteResources()`, already built in
/// `mdviewerApi.ts`.
const REMOTE_CONTENT_POLICY_FILE: &str = "remote_content_policy.txt";

fn remote_content_policy_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(REMOTE_CONTENT_POLICY_FILE))
        .map_err(|e| e.to_string())
}

/// Matches `RemoteContentPolicy.current` — defaults to `"ask"` if unset,
/// unreadable, or holding anything other than the three known values.
/// Split from `read_remote_content_policy` (which resolves the real
/// `app_config_dir()`) so this is testable against a real temp file
/// instead of the actual system config directory — `cargo test` must
/// never write there. Same split as `write_document`/`save_document`.
fn read_remote_content_policy_from(path: &Path) -> String {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| s == "ask" || s == "always" || s == "never")
        .unwrap_or_else(|| "ask".to_string())
}

fn read_remote_content_policy<R: Runtime>(app: &AppHandle<R>) -> String {
    match remote_content_policy_path(app) {
        Ok(path) => read_remote_content_policy_from(&path),
        Err(_) => "ask".to_string(),
    }
}

/// Matches the "Always Allow" button's
/// `UserDefaults.standard.set(RemoteContentPolicy.always.rawValue, ...)`.
/// Same testable-core/thin-wrapper split as the read side above.
fn write_remote_content_policy_always_to(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, "always").map_err(|e| e.to_string())
}

/// A Tauri command so the frontend can call it via `invoke` once wired to
/// the remote-content prompt (not built yet — see plan.md; that prompt is
/// currently an in-page concern with nowhere to trigger it from, same gap
/// `request_folder_access` has with its own not-yet-built banner).
#[tauri::command]
fn set_remote_content_policy_always<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    write_remote_content_policy_always_to(&remote_content_policy_path(&app)?)
}

/// General 3-way write, unlike `write_remote_content_policy_always_to`
/// above (which only ever writes `"always"`, matching the one button that
/// calls it). `preferences.ts`'s Privacy tab picker needs to set any of
/// the three values freely — not a replacement for the "always" helper
/// above, which still exists for its own future single-purpose caller
/// (the remote-content prompt's "Always Allow" button, still not built).
/// Rejects anything else so a malformed `invoke` argument can't write
/// garbage the reader would just silently fall back from anyway — fails
/// loudly instead of writing-then-silently-defaulting.
fn write_remote_content_policy_to(path: &Path, policy: &str) -> Result<(), String> {
    if policy != "ask" && policy != "always" && policy != "never" {
        return Err(format!("invalid remote content policy: {policy:?}"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, policy).map_err(|e| e.to_string())
}

/// `preferences.ts`'s Privacy tab reads the current policy when the panel
/// opens, so its picker starts on the real stored value rather than
/// always defaulting to "Ask". No Swift equivalent command to port from —
/// `RemoteContentPolicy.current` there is a plain synchronous
/// `UserDefaults` read available directly in the same process; this port
/// needs an explicit round trip since the value lives in Rust.
#[tauri::command]
fn get_remote_content_policy<R: Runtime>(app: AppHandle<R>) -> String {
    read_remote_content_policy(&app)
}

/// `preferences.ts`'s Privacy tab picker → this, on every change (not just
/// "Always Allow" like the single-purpose command above).
#[tauri::command]
fn set_remote_content_policy<R: Runtime>(app: AppHandle<R>, policy: String) -> Result<(), String> {
    write_remote_content_policy_to(&remote_content_policy_path(&app)?, &policy)
}

/// The page's "Load" / "Always Allow" (and every render under Always) →
/// this, once per gated `<img>`; see `remote_image.rs` for why the webview
/// doesn't load remote images itself. Refuses under Never whatever the
/// page asks, so the stored setting is the last word. `spawn_blocking`:
/// a slow image server mustn't hold up the command thread.
#[tauri::command]
async fn fetch_remote_image<R: Runtime>(app: AppHandle<R>, url: String) -> Result<String, String> {
    if read_remote_content_policy(&app) == "never" {
        return Err("remote content is set to Never".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || remote_image::fetch_as_data_url(&url))
        .await
        .map_err(|e| e.to_string())?
}

/// Ported from `DocumentViewModel.restoreLastOpened()`/
/// `saveLastOpened(url:)` — reopening the last document on launch, if
/// nothing else (the debug-only test hook, a future file-association
/// argument) already loaded one first.
///
/// Swift persists a *security-scoped* bookmark
/// (`@AppStorage("lastOpenedBookmark")`) specifically so access survives
/// a cold relaunch under the App Sandbox. This port has no sandbox
/// entitlements configured at all yet (porting-brief.md's "Known gap"),
/// so a security-scoped bookmark's actual value — surviving sandbox
/// re-authorization — doesn't apply here yet either; a plain path,
/// persisted the same way as `remote_content_policy.txt`, is genuinely
/// equivalent to what Swift's bookmark buys today, not a simplification
/// that drops something real. Worth revisiting once Milestone B's
/// `BookmarkManager` item adds real entitlements — a plain path won't
/// survive whatever access-scoping that adds, any more than an
/// unscoped bookmark would in Swift without one.
const LAST_OPENED_DOCUMENT_FILE: &str = "last_opened_document.txt";

fn last_opened_document_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(LAST_OPENED_DOCUMENT_FILE))
        .map_err(|e| e.to_string())
}

/// Pure core of the write side — path injected so tests never touch the
/// real `app_config_dir()`, same split as the remote-content-policy
/// functions above.
fn write_last_opened_document_to(state_file: &Path, document_path: &Path) -> Result<(), String> {
    if let Some(parent) = state_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(state_file, document_path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

/// Pure core of the read side. `None` covers Swift's
/// `guard !lastOpenedBookmarkData.isEmpty else { return }` (nothing ever
/// recorded) and its bookmark-resolution failure case (recorded, but no
/// longer valid) in one: a missing, unreadable, or blank state file all
/// mean "nothing to restore."
fn read_last_opened_document_from(state_file: &Path) -> Option<PathBuf> {
    let contents = std::fs::read_to_string(state_file).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn record_last_opened_document<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    if let Ok(state_file) = last_opened_document_path(app) {
        let _ = write_last_opened_document_to(&state_file, path);
    }
}

/// Ported from `restoreLastOpened()`. Silently does nothing if there's
/// nothing recorded or the recorded file can no longer be read (deleted,
/// moved, permissions changed) — matches Swift's own silent failure
/// here, same "no error UI to show it in yet" reasoning as the rest of
/// this file.
fn restore_last_opened_document<R: Runtime>(app: &AppHandle<R>) {
    let Ok(state_file) = last_opened_document_path(app) else { return };
    let Some(path) = read_last_opened_document_from(&state_file) else {
        debug_log::log("restore_last_opened_document: nothing recorded");
        return;
    };
    debug_log::log(&format!("restore_last_opened_document: {}", path.display()));
    if let Err(e) = render_file(app, &path) {
        debug_log::log(&format!("restore_last_opened_document: render failed: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // MARK: - escape_for_js (parity with Swift's RenderViewModel.escapeForJS)

    #[test]
    fn escape_for_js_backslash() {
        assert_eq!(escape_for_js(r"a\b"), r"a\\b");
    }

    #[test]
    fn escape_for_js_single_quote() {
        assert_eq!(escape_for_js("it's"), r"it\'s");
    }

    #[test]
    fn escape_for_js_newline() {
        assert_eq!(escape_for_js("a\nb"), "a\\nb");
    }

    #[test]
    fn escape_for_js_carriage_return() {
        assert_eq!(escape_for_js("a\rb"), "a\\rb");
    }

    #[test]
    fn escape_for_js_closing_tag() {
        // Defends against the string ever being embedded where "</script>"
        // could terminate a real <script> block early.
        assert_eq!(escape_for_js("</script>"), r"<\/script>");
    }

    #[test]
    fn escape_for_js_backslash_before_quote_ordering() {
        // Order matters: backslash must be escaped first, or a text like
        // `\'` would double-escape into `\\\'` instead of `\\\\'`.
        assert_eq!(escape_for_js(r"\'"), r"\\\'");
    }

    #[test]
    fn escape_for_js_plain_text_untouched() {
        assert_eq!(escape_for_js("# Title\n\nplain paragraph"), "# Title\\n\\nplain paragraph");
    }

    #[test]
    fn escape_for_js_empty_string() {
        assert_eq!(escape_for_js(""), "");
    }

    // MARK: - build_set_content_script

    #[test]
    fn build_set_content_script_wraps_set_content_call() {
        let script = build_set_content_script("# Hi");
        assert!(script.contains("window.MDViewer.setContent('# Hi');"));
        assert!(script.contains("if (window.MDViewer)"));
    }

    #[test]
    fn build_set_content_script_escapes_the_markdown() {
        let script = build_set_content_script("it's\na test");
        assert!(script.contains(r"window.MDViewer.setContent('it\'s\na test');"));
    }

    // MARK: - render_file (headless, via tauri::test::mock_app — no real
    // window, no file dialog, no visible screen required)

    fn mock_app_with_state() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(DocumentBaseDir::default());
        app.manage(CurrentDocument::default());
        app.manage(FileWatcher::default());
        app.manage(GrantedFolders::default());
        app.manage(GrantedFolderAccess::default());
        app
    }

    #[test]
    fn render_file_missing_file_returns_err() {
        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let result = render_file(&app.handle().clone(), Path::new("/no/such/file.md"));

        assert!(result.is_err());
    }

    #[test]
    fn render_file_real_file_no_window_returns_err() {
        let dir = std::env::temp_dir().join(format!("mdviewer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "# Hello").unwrap();

        // mock_app() alone creates no "main" window — exercises the
        // "window not found" branch distinctly from the missing-file one.
        let app = mock_app_with_state();
        let result = render_file(&app.handle().clone(), &file);

        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn render_file_real_file_and_window_succeeds() {
        let dir = std::env::temp_dir().join(format!("mdviewer-test-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "# Hello, from a real file\n").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let result = render_file(&app.handle().clone(), &file);

        assert!(result.is_ok(), "expected Ok, got {result:?}");
        // render_file stores path.parent() as-is — no canonicalization —
        // so this should be exactly `dir`, unchanged.
        assert_eq!(app.state::<DocumentBaseDir>().0.lock().unwrap().as_deref(), Some(dir.as_path()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_sample_document_writes_document_and_its_image() {
        let dir = std::env::temp_dir().join(format!("mdviewer-test-sample-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();

        let path = write_sample_document(&dir).unwrap();

        assert_eq!(path, dir.join("Welcome.md"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("](icon.png)"), "the sample's image reference must match the file written");
        assert_eq!(std::fs::read(dir.join("icon.png")).unwrap(), SAMPLE_IMAGE);
        // A second call overwrites rather than failing on existing files.
        assert!(write_sample_document(&dir).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn render_file_populates_current_document_state() {
        let dir = std::env::temp_dir().join(format!("mdviewer-test-current-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "# Tracked\n").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        render_file(&app.handle().clone(), &file).unwrap();

        let current = app.state::<CurrentDocument>().0.lock().unwrap().clone().unwrap();
        assert_eq!(current.path, file);
        assert_eq!(current.text, "# Tracked\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    // MARK: - write_document / save_as_to (headless — no real save dialog)

    #[test]
    fn write_document_writes_the_given_text() {
        let dir = std::env::temp_dir().join(format!("mdviewer-write-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("out.md");

        let result = write_document(&file, "# Written\n");

        assert!(result.is_ok());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "# Written\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_document_nonexistent_parent_dir_returns_err() {
        let result = write_document(Path::new("/no/such/parent/dir/out.md"), "text");
        assert!(result.is_err());
    }

    #[test]
    fn save_as_to_writes_and_adopts_as_current_document() {
        let dir = std::env::temp_dir().join(format!("mdviewer-saveas-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("saved.md");

        let app = mock_app_with_state();
        let result = save_as_to(&app.handle().clone(), &file, "# Saved As\n");

        assert!(result.is_ok());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "# Saved As\n");
        let current = app.state::<CurrentDocument>().0.lock().unwrap().clone().unwrap();
        assert_eq!(current.path, file);
        assert_eq!(current.text, "# Saved As\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_as_to_failure_does_not_adopt_current_document() {
        let app = mock_app_with_state();

        let result = save_as_to(&app.handle().clone(), Path::new("/no/such/dir/out.md"), "text");

        assert!(result.is_err());
        assert!(app.state::<CurrentDocument>().0.lock().unwrap().is_none());
    }

    #[test]
    fn save_document_with_current_document_rewrites_its_own_path() {
        let dir = std::env::temp_dir().join(format!("mdviewer-save-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "original").unwrap();

        let app = mock_app_with_state();
        *app.state::<CurrentDocument>().0.lock().unwrap() = Some(CurrentDocumentState {
            path: file.clone(),
            text: "updated text".to_string(),
        });

        save_document(&app.handle().clone());

        assert_eq!(std::fs::read_to_string(&file).unwrap(), "updated text");
        std::fs::remove_dir_all(&dir).ok();
    }

    // MARK: - reload_current_document / FileWatcher (real disk writes and a
    // real debounce wait — the one place in this suite that isn't
    // instantaneous, since it's testing actual filesystem event timing, not
    // just function calls. Still fully headless: no window, no dialog, no
    // visible screen.)

    #[test]
    fn reload_current_document_rereads_and_updates_state() {
        // Exercises reload_current_document() directly, without going
        // through a real filesystem watch — the debounced, end-to-end path
        // is covered separately below.
        let dir = std::env::temp_dir().join(format!("mdviewer-reload-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "original").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        *app.state::<CurrentDocument>().0.lock().unwrap() = Some(CurrentDocumentState {
            path: file.clone(),
            text: "original".to_string(),
        });

        std::fs::write(&file, "changed on disk").unwrap();
        reload_current_document(&app.handle().clone());

        let current = app.state::<CurrentDocument>().0.lock().unwrap().clone().unwrap();
        assert_eq!(current.text, "changed on disk");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reload_current_document_with_no_current_document_does_nothing() {
        // Must not panic when nothing is open — mirrors reload()'s
        // `guard let url = fileURL else { return }`.
        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        reload_current_document(&app.handle().clone());
        assert!(app.state::<CurrentDocument>().0.lock().unwrap().is_none());
    }

    #[test]
    fn watch_file_detects_external_change_and_reloads_after_debounce() {
        let dir = std::env::temp_dir().join(format!("mdviewer-watch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.md");
        std::fs::write(&file, "original").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        // adopt_current_document does this pairing in real use (render_file,
        // save_as_to); set state directly here since we're not going
        // through either of those.
        *app.state::<CurrentDocument>().0.lock().unwrap() = Some(CurrentDocumentState {
            path: file.clone(),
            text: "original".to_string(),
        });
        watch_file(&app.handle().clone(), &file);

        // A real external change: written from outside this document's own
        // save/reload path, same as another program editing the file.
        std::fs::write(&file, "changed by another process").unwrap();

        // The debounce window is 500ms; poll rather than sleep-then-check
        // once, so this isn't flaky under a loaded CI machine.
        let mut reloaded = false;
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if app.state::<CurrentDocument>().0.lock().unwrap().as_ref().map(|d| d.text.as_str())
                == Some("changed by another process")
            {
                reloaded = true;
                break;
            }
        }

        assert!(reloaded, "expected the debounced watcher to reload the changed file within 2s");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn watch_file_replacing_the_watch_stops_watching_the_previous_file() {
        let dir = std::env::temp_dir().join(format!("mdviewer-rewatch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let old_file = dir.join("old.md");
        let new_file = dir.join("new.md");
        std::fs::write(&old_file, "old content").unwrap();
        std::fs::write(&new_file, "new content").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        watch_file(&app.handle().clone(), &old_file);
        // Adopting the new file (as open_document/render_file would) both
        // updates state and re-watches, replacing the old watch.
        adopt_current_document(&app.handle().clone(), &new_file, "new content");

        // Change the OLD file — should not trigger a reload, since it's no
        // longer watched.
        std::fs::write(&old_file, "old content, changed").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1200));

        let current = app.state::<CurrentDocument>().0.lock().unwrap().clone().unwrap();
        assert_eq!(current.path, new_file, "current document should still be the new file");
        assert_eq!(current.text, "new content", "the old file's change should not have reloaded anything");
        std::fs::remove_dir_all(&dir).ok();
    }

    // MARK: - resolve_local_path (the two Swift bugs, ported as tests)

    fn temp_dir_for(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdviewer-scheme-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_local_path_file_in_base_dir_resolves() {
        let dir = temp_dir_for("basic");
        std::fs::write(dir.join("image.png"), b"fake png").unwrap();

        let resolved = resolve_local_path(&dir, &[], "/image.png");

        assert_eq!(resolved, Some(dir.canonicalize().unwrap().join("image.png")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_local_path_nested_subdirectory_resolves() {
        let dir = temp_dir_for("nested");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets/photo.jpg"), b"fake jpg").unwrap();

        let resolved = resolve_local_path(&dir, &[], "/assets/photo.jpg");

        assert_eq!(resolved, Some(dir.canonicalize().unwrap().join("assets/photo.jpg")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_local_path_directory_traversal_returns_none() {
        let dir = temp_dir_for("traversal");
        // A real, existing file *outside* the base dir, so canonicalize()
        // succeeds and we're genuinely testing the boundary check, not just
        // a 404.
        let secret = std::env::temp_dir().join(format!("mdviewer-secret-{}", std::process::id()));
        std::fs::write(&secret, b"secret").unwrap();
        let traversal = format!(
            "/../{}",
            secret.file_name().unwrap().to_str().unwrap()
        );

        let resolved = resolve_local_path(&dir, &[], &traversal);

        assert_eq!(resolved, None);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_file(&secret).ok();
    }

    #[test]
    fn resolve_local_path_nonexistent_file_returns_none() {
        let dir = temp_dir_for("missing");
        let resolved = resolve_local_path(&dir, &[], "/does-not-exist.png");
        assert_eq!(resolved, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_local_path_percent_encoded_space_decodes() {
        let dir = temp_dir_for("space");
        std::fs::write(dir.join("my photo.png"), b"fake png").unwrap();

        let resolved = resolve_local_path(&dir, &[], "/my%20photo.png");

        assert_eq!(resolved, Some(dir.canonicalize().unwrap().join("my photo.png")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_local_path_outside_base_dir_but_within_granted_folder_resolves() {
        // The document lives in `dir`; the image it references lives in a
        // sibling directory the document doesn't own, reached via `../`.
        // Tier one (`base_dir` alone) would reject this — same shape as
        // `resolve_local_path_directory_traversal_returns_none` above — but
        // an explicit grant on the sibling (tier two) allows it.
        let root = temp_dir_for("granted-root");
        let dir = root.join("doc");
        let sibling = root.join("assets");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("photo.jpg"), b"fake jpg").unwrap();

        let granted = vec![sibling.canonicalize().unwrap()];
        let resolved = resolve_local_path(&dir, &granted, "/../assets/photo.jpg");

        assert_eq!(resolved, Some(sibling.canonicalize().unwrap().join("photo.jpg")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_local_path_outside_base_dir_and_ungranted_folder_returns_none() {
        // Same layout as above, but the sibling was never granted — must
        // still be rejected, matching the "never whole-disk" invariant.
        let root = temp_dir_for("ungranted-root");
        let dir = root.join("doc");
        let sibling = root.join("assets");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("photo.jpg"), b"fake jpg").unwrap();

        let resolved = resolve_local_path(&dir, &[], "/../assets/photo.jpg");

        assert_eq!(resolved, None);
        std::fs::remove_dir_all(&root).ok();
    }

    // MARK: - list_directory_at (file-browser plan, Phase 1, 2026-09-12)

    #[test]
    fn list_directory_at_base_dir_lists_subfolders_and_markdown_files() {
        let dir = temp_dir_for("browse-basic");
        std::fs::create_dir_all(dir.join("subfolder")).unwrap();
        std::fs::write(dir.join("note.md"), "# hi").unwrap();
        std::fs::write(dir.join("readme.markdown"), "# hi").unwrap();
        // Non-markdown files must be filtered out entirely.
        std::fs::write(dir.join("image.png"), b"fake png").unwrap();

        let listing = list_directory_at(&dir, &[], &dir).unwrap();

        assert_eq!(listing.path, dir.canonicalize().unwrap().to_string_lossy());
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["subfolder", "note.md", "readme.markdown"]);
        assert!(listing.entries[0].is_dir);
        assert!(!listing.entries[1].is_dir);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_at_sorts_folders_before_files_then_alphabetically() {
        let dir = temp_dir_for("browse-sort");
        std::fs::create_dir_all(dir.join("zzz-folder")).unwrap();
        std::fs::create_dir_all(dir.join("aaa-folder")).unwrap();
        std::fs::write(dir.join("bbb.md"), "").unwrap();
        std::fs::write(dir.join("aaa.md"), "").unwrap();

        let listing = list_directory_at(&dir, &[], &dir).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["aaa-folder", "zzz-folder", "aaa.md", "bbb.md"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_at_empty_folder_returns_no_entries() {
        let dir = temp_dir_for("browse-empty");
        let listing = list_directory_at(&dir, &[], &dir).unwrap();
        assert!(listing.entries.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_at_nested_subdirectory_within_base_dir_resolves() {
        let dir = temp_dir_for("browse-nested");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/nested.md"), "").unwrap();

        let listing = list_directory_at(&dir, &[], &dir.join("sub")).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["nested.md"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_at_outside_base_dir_and_ungranted_is_access_denied() {
        // Same two-tier boundary resolve_local_path's own tests already
        // cover — reusing `path_is_accessible` means this must behave
        // identically, not just "similarly."
        let root = temp_dir_for("browse-denied-root");
        let dir = root.join("doc");
        let sibling = root.join("other");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let err = list_directory_at(&dir, &[], &sibling).unwrap_err();

        assert!(err.starts_with("access_denied:"), "{err}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_directory_at_outside_base_dir_but_within_granted_folder_resolves() {
        let root = temp_dir_for("browse-granted-root");
        let dir = root.join("doc");
        let sibling = root.join("other");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("granted.md"), "").unwrap();

        let granted = vec![sibling.canonicalize().unwrap()];
        let listing = list_directory_at(&dir, &granted, &sibling).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["granted.md"]);
        std::fs::remove_dir_all(&root).ok();
    }

    /// The exact real-device report (2026-09-17): granting a folder *above*
    /// `base_dir` (not a sibling, a genuine ancestor covering base_dir
    /// itself) was reported as not actually letting the browser reach any
    /// other folder under it. Unlike the sibling-grant test above, `granted`
    /// here is `root` itself, an ancestor of `base_dir` (`root/doc`) — this
    /// is the "grant a folder one level above Downloads" shape from that
    /// report, not the "grant a specific sibling folder" shape already
    /// covered.
    #[test]
    fn list_directory_at_granted_ancestor_of_base_dir_lists_the_ancestor_itself() {
        let root = temp_dir_for("browse-granted-ancestor-root");
        let dir = root.join("doc");
        let sibling = root.join("other");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let granted = vec![root.canonicalize().unwrap()];
        let listing = list_directory_at(&dir, &granted, &root).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"doc"), "{names:?}");
        assert!(names.contains(&"other"), "{names:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Continuing the scenario above: once the ancestor's own listing shows
    /// `other` as a subfolder, can the browser actually navigate *into*
    /// it? `other` was never itself granted — only `root` (its parent) was
    /// — so this specifically exercises `folder_covers`'s transitive
    /// coverage of a granted folder's own descendants, not just the
    /// granted folder itself.
    #[test]
    fn list_directory_at_subfolder_of_a_granted_ancestor_also_resolves() {
        let root = temp_dir_for("browse-granted-ancestor-child-root");
        let dir = root.join("doc");
        let sibling = root.join("other");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("note.md"), "").unwrap();

        let granted = vec![root.canonicalize().unwrap()];
        let listing = list_directory_at(&dir, &granted, &sibling).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["note.md"]);
        std::fs::remove_dir_all(&root).ok();
    }

    /// The 2026-10-17 dead-end fix: at the top of what's browsable, there is
    /// no `parent` to offer — neither above an ungranted document's own
    /// folder, nor above a granted folder.
    #[test]
    fn list_directory_at_reports_no_parent_at_the_top_of_what_is_browsable() {
        let root = temp_dir_for("browse-parent-top-root");
        let dir = root.join("doc");
        let sibling = root.join("other");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let ungranted = list_directory_at(&dir, &[], &dir).unwrap();
        assert_eq!(ungranted.parent, None);

        let granted = vec![sibling.canonicalize().unwrap()];
        let at_grant_root = list_directory_at(&dir, &granted, &sibling).unwrap();
        assert_eq!(at_grant_root.parent, None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_directory_at_reports_a_parent_that_is_itself_browsable() {
        let root = temp_dir_for("browse-parent-ok-root");
        let dir = root.join("doc");
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).unwrap();

        // Inside the document's own folder: up leads back to it.
        let inside = list_directory_at(&dir, &[], &nested).unwrap();
        assert_eq!(inside.parent.as_deref(), Some(dir.canonicalize().unwrap().to_string_lossy().as_ref()));

        // A granted ancestor makes the document folder's own parent reachable.
        let granted = vec![root.canonicalize().unwrap()];
        let under_grant = list_directory_at(&dir, &granted, &dir).unwrap();
        assert_eq!(under_grant.parent.as_deref(), Some(root.canonicalize().unwrap().to_string_lossy().as_ref()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_directory_at_nonexistent_path_is_not_found() {
        let dir = temp_dir_for("browse-missing");
        let err = list_directory_at(&dir, &[], &dir.join("does-not-exist")).unwrap_err();
        assert!(err.starts_with("not_found:"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_at_a_file_not_a_directory_is_not_found() {
        let dir = temp_dir_for("browse-file-not-dir");
        let file = dir.join("note.md");
        std::fs::write(&file, "").unwrap();

        let err = list_directory_at(&dir, &[], &file).unwrap_err();

        assert!(err.starts_with("not_found:"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Permission-denied is only meaningfully testable on Unix — Windows'
    // ACL model doesn't respond to a plain chmod the same way. Checks the
    // actual outcome rather than pre-detecting root (no `libc` dependency
    // needed just for this): an environment running as root, or any other
    // reason `chmod 000` doesn't actually block the read, produces an
    // unexpected `Ok(...)` here — treated as "this environment can't
    // exercise the case," a skip, not a failure, rather than asserting a
    // specific uid check that would itself need a new dependency.
    #[cfg(unix)]
    #[test]
    fn list_directory_at_permission_denied_directory_is_permission_denied() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir_for("browse-no-permission");
        let locked = dir.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = list_directory_at(&dir, &[], &locked);

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&dir).ok();

        let Err(err) = result else { return };
        assert!(err.starts_with("permission_denied:"), "{err}");
    }

    // MARK: - list_directory (command, fallback to a granted folder —
    // 2026-10-03 real-user report: granting a folder before ever opening a
    // document produced no folder view at all)

    #[test]
    fn list_directory_with_no_document_and_no_grant_is_not_found() {
        let app = mock_app_with_state();
        let err = list_directory(app.handle().clone(), None).unwrap_err();
        assert!(err.starts_with("not_found:"), "{err}");
    }

    #[test]
    fn list_directory_with_no_document_falls_back_to_the_granted_folder() {
        let dir = temp_dir_for("browse-fallback-granted");
        std::fs::write(dir.join("note.md"), "# hi").unwrap();

        let app = mock_app_with_state();
        app.state::<GrantedFolders>().0.lock().unwrap().push(dir.canonicalize().unwrap());

        let listing = list_directory(app.handle().clone(), None).unwrap();

        assert_eq!(listing.path, dir.canonicalize().unwrap().to_string_lossy());
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["note.md"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_directory_with_no_document_and_multiple_grants_uses_the_most_recent() {
        let first = temp_dir_for("browse-fallback-first");
        let second = temp_dir_for("browse-fallback-second");
        std::fs::write(second.join("latest.md"), "# hi").unwrap();

        let app = mock_app_with_state();
        {
            let state = app.state::<GrantedFolders>();
            let mut granted = state.0.lock().unwrap();
            granted.push(first.canonicalize().unwrap());
            granted.push(second.canonicalize().unwrap());
        }

        let listing = list_directory(app.handle().clone(), None).unwrap();

        assert_eq!(listing.path, second.canonicalize().unwrap().to_string_lossy());
        std::fs::remove_dir_all(&first).ok();
        std::fs::remove_dir_all(&second).ok();
    }

    #[test]
    fn list_directory_prefers_the_open_document_over_any_granted_folder() {
        let doc_dir = temp_dir_for("browse-fallback-doc");
        let granted_dir = temp_dir_for("browse-fallback-other-granted");
        std::fs::write(doc_dir.join("current.md"), "# hi").unwrap();
        std::fs::write(granted_dir.join("other.md"), "# hi").unwrap();

        let app = mock_app_with_state();
        *app.state::<DocumentBaseDir>().0.lock().unwrap() = Some(doc_dir.clone());
        app.state::<GrantedFolders>().0.lock().unwrap().push(granted_dir.canonicalize().unwrap());

        let listing = list_directory(app.handle().clone(), None).unwrap();

        assert_eq!(listing.path, doc_dir.canonicalize().unwrap().to_string_lossy());
        std::fs::remove_dir_all(&doc_dir).ok();
        std::fs::remove_dir_all(&granted_dir).ok();
    }

    // MARK: - folder_covers (parity with FolderAccessManager.covers())

    #[test]
    fn folder_covers_itself() {
        assert!(folder_covers(Path::new("/Users/me/notes"), Path::new("/Users/me/notes")));
    }

    #[test]
    fn folder_covers_a_subdirectory() {
        assert!(folder_covers(Path::new("/Users/me/notes"), Path::new("/Users/me/notes/assets/img")));
    }

    #[test]
    fn folder_does_not_cover_a_sibling_with_a_shared_prefix() {
        // The exact false-positive Swift's manual trailing-slash boundary
        // check exists to avoid — here it's ruled out structurally by
        // `Path::starts_with` being component-wise, not string-prefix.
        assert!(!folder_covers(Path::new("/Users/me/notes"), Path::new("/Users/me/notes-evil/img")));
    }

    #[test]
    fn folder_does_not_cover_its_own_parent() {
        assert!(!folder_covers(Path::new("/Users/me/notes/assets"), Path::new("/Users/me/notes")));
    }

    // MARK: - grant_folder_access (headless, via tauri::test::mock_app)

    #[test]
    fn grant_folder_access_records_the_canonicalized_path() {
        let app = mock_app_with_state();
        let dir = temp_dir_for("grant");

        let ok = grant_folder_access(&app.handle().clone(), &dir);

        assert!(ok);
        assert_eq!(
            app.state::<GrantedFolders>().0.lock().unwrap().clone(),
            vec![dir.canonicalize().unwrap()]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn grant_folder_access_nonexistent_path_returns_false_and_records_nothing() {
        let app = mock_app_with_state();

        let ok = grant_folder_access(&app.handle().clone(), Path::new("/no/such/folder"));

        assert!(!ok);
        assert!(app.state::<GrantedFolders>().0.lock().unwrap().is_empty());
    }

    // MARK: - granted-folder bookmark persistence (read/write core; real
    // temp files, never the actual system app_config_dir() — confirmed
    // empirically (see the read_last_opened_document_from block below) that
    // app_config_dir() fails to resolve under mock_app(), so
    // bookmark_granted_folder's/restore_granted_folders' own file I/O never
    // actually fires through any mock_app()-based test in this file,
    // including grant_folder_access's own tests above — same constraint
    // every other app_config_dir()-backed persisted value here already has.

    #[test]
    fn read_granted_folder_bookmarks_from_a_missing_file_returns_empty() {
        assert!(read_granted_folder_bookmarks_from(Path::new("/no/such/bookmarks-file.json")).is_empty());
    }

    #[test]
    fn read_granted_folder_bookmarks_from_a_corrupt_file_returns_empty_rather_than_panicking() {
        let f = temp_dir_for("bookmarks-corrupt").join("store.json");
        std::fs::write(&f, b"{ this is not json").unwrap();
        assert!(read_granted_folder_bookmarks_from(&f).is_empty());
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn write_then_read_granted_folder_bookmarks_round_trips() {
        let f = temp_dir_for("bookmarks-roundtrip").join("store.json");
        let mut bookmarks = HashMap::new();
        bookmarks.insert("/Users/me/notes".to_string(), vec![9u8, 8, 7]);
        bookmarks.insert("/Users/me/assets".to_string(), vec![1u8, 2, 3]);

        write_granted_folder_bookmarks_to(&f, &bookmarks).unwrap();
        let read_back = read_granted_folder_bookmarks_from(&f);

        assert_eq!(read_back, bookmarks);
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn write_granted_folder_bookmarks_to_creates_parent_dirs() {
        let f = temp_dir_for("bookmarks-parent-dirs").join("nested/deeper/store.json");
        write_granted_folder_bookmarks_to(&f, &HashMap::new()).unwrap();
        assert!(f.exists());
    }

    // MARK: - restore_granted_folders (headless, via mock_app — see the note
    // above on why its actual file I/O can't be exercised this way)

    #[test]
    fn restore_granted_folders_with_nothing_persisted_does_not_panic() {
        let app = mock_app_with_state();
        restore_granted_folders(&app.handle().clone());
        assert!(app.state::<GrantedFolders>().0.lock().unwrap().is_empty());
    }

    // MARK: - mime_type_for

    #[test]
    fn mime_type_for_known_extensions() {
        assert_eq!(mime_type_for(Path::new("a.png")), "image/png");
        assert_eq!(mime_type_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_type_for(Path::new("a.JPG")), "image/jpeg");
    }

    #[test]
    fn mime_type_for_unknown_extension_is_octet_stream() {
        assert_eq!(mime_type_for(Path::new("a.bin")), "application/octet-stream");
        assert_eq!(mime_type_for(Path::new("a")), "application/octet-stream");
    }

    // MARK: - classify_link (parity with WebRendererView.Coordinator's
    // linkClicked case, minus the OS-touching dispatch — see handle_link_click)

    #[test]
    fn classify_link_a_local_markdown_file_opens_it() {
        assert_eq!(
            classify_link("file:///Users/me/docs/other.md"),
            LinkAction::OpenLocalDocument(PathBuf::from("/Users/me/docs/other.md"))
        );
    }

    #[test]
    fn classify_link_markdown_extension_is_case_insensitive() {
        assert_eq!(
            classify_link("file:///Users/me/docs/OTHER.MD"),
            LinkAction::OpenLocalDocument(PathBuf::from("/Users/me/docs/OTHER.MD"))
        );
    }

    #[test]
    fn classify_link_accepts_the_full_markdown_extension_too() {
        assert_eq!(
            classify_link("file:///Users/me/docs/other.markdown"),
            LinkAction::OpenLocalDocument(PathBuf::from("/Users/me/docs/other.markdown"))
        );
    }

    #[test]
    fn classify_link_a_non_markdown_local_file_is_ignored() {
        assert_eq!(classify_link("file:///Users/me/docs/image.png"), LinkAction::Ignore);
    }

    #[test]
    fn classify_link_https_opens_externally() {
        assert_eq!(
            classify_link("https://example.com/page"),
            LinkAction::OpenExternal("https://example.com/page".to_string())
        );
    }

    #[test]
    fn classify_link_http_opens_externally() {
        assert_eq!(
            classify_link("http://example.com"),
            LinkAction::OpenExternal("http://example.com".to_string())
        );
    }

    #[test]
    fn classify_link_mailto_opens_externally() {
        assert_eq!(
            classify_link("mailto:demo@example.com"),
            LinkAction::OpenExternal("mailto:demo@example.com".to_string())
        );
    }

    #[test]
    fn classify_link_a_relative_markdown_link_resolved_to_the_page_origin_is_ignored() {
        // Documents the real, shared limitation (see handle_link_click's
        // doc comment): a relative `[other](other.md)` link resolves its
        // `.href` against the page's own origin, never `file://`, so it's
        // ignored here exactly as it is in Swift.
        assert_eq!(classify_link("tauri://localhost/other.md"), LinkAction::Ignore);
    }

    #[test]
    fn classify_link_an_unknown_scheme_is_ignored() {
        assert_eq!(classify_link("javascript:alert(1)"), LinkAction::Ignore);
    }

    #[test]
    fn classify_link_an_unparseable_string_is_ignored() {
        assert_eq!(classify_link("not a url"), LinkAction::Ignore);
    }

    // MARK: - handle_link_click (headless, via tauri::test::mock_app — the
    // file:// branch only; http/https/mailto would need a registered
    // opener plugin, which would risk actually launching a browser)

    #[test]
    fn handle_link_click_a_local_markdown_file_switches_the_current_document() {
        let dir = temp_dir_for("link-click");
        let file = dir.join("other.md");
        std::fs::write(&file, "# Other Doc\n").unwrap();

        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        handle_link_click(app.handle().clone(), format!("file://{}", file.display()));

        let current = app.state::<CurrentDocument>().0.lock().unwrap().clone().unwrap();
        assert_eq!(current.path, file);
        assert_eq!(current.text, "# Other Doc\n");
    }

    #[test]
    fn handle_link_click_a_non_markdown_local_file_does_not_change_current_document() {
        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        handle_link_click(app.handle().clone(), "file:///Users/me/docs/image.png".to_string());

        assert!(app.state::<CurrentDocument>().0.lock().unwrap().is_none());
    }

    // MARK: - build_set_remote_content_policy_script

    #[test]
    fn build_set_remote_content_policy_script_for_each_known_value() {
        assert_eq!(
            build_set_remote_content_policy_script("ask"),
            "if (window.MDViewer) { window.MDViewer.setRemoteContentPolicy('ask'); }"
        );
        assert_eq!(
            build_set_remote_content_policy_script("always"),
            "if (window.MDViewer) { window.MDViewer.setRemoteContentPolicy('always'); }"
        );
        assert_eq!(
            build_set_remote_content_policy_script("never"),
            "if (window.MDViewer) { window.MDViewer.setRemoteContentPolicy('never'); }"
        );
    }

    // MARK: - read_remote_content_policy_from / write_remote_content_policy_always_to
    // (real temp files — never the actual system app_config_dir())

    #[test]
    fn read_remote_content_policy_from_a_missing_file_defaults_to_ask() {
        assert_eq!(read_remote_content_policy_from(Path::new("/no/such/policy/file")), "ask");
    }

    #[test]
    fn read_remote_content_policy_from_reads_each_known_value() {
        let dir = temp_dir_for("policy-read");
        for value in ["ask", "always", "never"] {
            let path = dir.join(format!("policy-{value}.txt"));
            std::fs::write(&path, value).unwrap();
            assert_eq!(read_remote_content_policy_from(&path), value);
        }
    }

    #[test]
    fn read_remote_content_policy_from_trims_whitespace() {
        let dir = temp_dir_for("policy-trim");
        let path = dir.join("policy.txt");
        std::fs::write(&path, "always\n").unwrap();
        assert_eq!(read_remote_content_policy_from(&path), "always");
    }

    #[test]
    fn read_remote_content_policy_from_an_unknown_value_defaults_to_ask() {
        let dir = temp_dir_for("policy-garbage");
        let path = dir.join("policy.txt");
        std::fs::write(&path, "not-a-real-policy").unwrap();
        assert_eq!(read_remote_content_policy_from(&path), "ask");
    }

    #[test]
    fn write_remote_content_policy_always_to_creates_parent_dirs_and_writes() {
        let dir = temp_dir_for("policy-write");
        let path = dir.join("nested/policy.txt");

        let result = write_remote_content_policy_always_to(&path);

        assert!(result.is_ok());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "always");
    }

    #[test]
    fn write_then_read_remote_content_policy_round_trips() {
        let dir = temp_dir_for("policy-roundtrip");
        let path = dir.join("policy.txt");

        write_remote_content_policy_always_to(&path).unwrap();

        assert_eq!(read_remote_content_policy_from(&path), "always");
    }

    #[test]
    fn write_remote_content_policy_to_accepts_each_known_value() {
        let dir = temp_dir_for("policy-write-general");
        for value in ["ask", "always", "never"] {
            let path = dir.join(format!("policy-{value}.txt"));
            assert!(write_remote_content_policy_to(&path, value).is_ok());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), value);
        }
    }

    #[test]
    fn write_remote_content_policy_to_rejects_an_unknown_value() {
        let dir = temp_dir_for("policy-write-invalid");
        let path = dir.join("policy.txt");

        let result = write_remote_content_policy_to(&path, "sometimes");

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn write_remote_content_policy_to_creates_parent_dirs() {
        let dir = temp_dir_for("policy-write-general-nested");
        let path = dir.join("nested/policy.txt");

        assert!(write_remote_content_policy_to(&path, "never").is_ok());

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "never");
    }

    // MARK: - read_last_opened_document_from / write_last_opened_document_to
    // (real temp files — never the actual system app_config_dir(); confirmed
    // empirically that app_config_dir() fails to resolve under mock_app(),
    // so record_last_opened_document's write never fires during any test
    // here, same as remote_content_policy's read side)

    #[test]
    fn read_last_opened_document_from_a_missing_file_returns_none() {
        assert_eq!(read_last_opened_document_from(Path::new("/no/such/last-opened/file")), None);
    }

    #[test]
    fn read_last_opened_document_from_an_empty_file_returns_none() {
        let dir = temp_dir_for("last-opened-empty");
        let path = dir.join("last_opened.txt");
        std::fs::write(&path, "").unwrap();
        assert_eq!(read_last_opened_document_from(&path), None);
    }

    #[test]
    fn write_then_read_last_opened_document_round_trips() {
        let dir = temp_dir_for("last-opened-roundtrip");
        let state_file = dir.join("last_opened.txt");
        let doc_path = dir.join("doc.md");

        write_last_opened_document_to(&state_file, &doc_path).unwrap();

        assert_eq!(read_last_opened_document_from(&state_file), Some(doc_path));
    }

    #[test]
    fn write_last_opened_document_to_creates_parent_dirs() {
        let dir = temp_dir_for("last-opened-nested");
        let state_file = dir.join("nested/last_opened.txt");
        let doc_path = dir.join("doc.md");

        let result = write_last_opened_document_to(&state_file, &doc_path);

        assert!(result.is_ok());
        assert!(state_file.exists());
    }

    #[test]
    fn write_last_opened_document_to_trims_correctly_on_read_back() {
        let dir = temp_dir_for("last-opened-trim");
        let state_file = dir.join("last_opened.txt");
        // Written with a trailing newline by hand, matching what a text
        // editor (or a future re-run of write_last_opened_document_to)
        // would leave — read side must still trim it.
        std::fs::write(&state_file, "/Users/me/doc.md\n").unwrap();

        assert_eq!(read_last_opened_document_from(&state_file), Some(PathBuf::from("/Users/me/doc.md")));
    }

    // MARK: - restore_last_opened_document / adopt_current_document's
    // last-opened recording (headless, via tauri::test::mock_app)

    #[test]
    fn restore_last_opened_document_with_nothing_recorded_does_not_panic() {
        let app = mock_app_with_state();
        let _window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        // app_config_dir() fails under mock_app(), so this always hits
        // the early-return path — asserting only that it's safe to call,
        // matching the same untested-thin-wrapper treatment as
        // set_remote_content_policy_always's real AppHandle path.
        restore_last_opened_document(&app.handle().clone());

        assert!(app.state::<CurrentDocument>().0.lock().unwrap().is_none());
    }
}
