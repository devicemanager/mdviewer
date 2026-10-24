//! Android `content://` documents (2026-10-24, the Google Play/GitHub APK
//! work). Android never hands an app a plain path for a user's document:
//! tapping a `.md` in Files, "Open with…", a share, and the Open button's
//! own picker all deliver a `content://` URI instead, which `to_file_path()`
//! rejects — so before this, every one of those silently rendered nothing.
//!
//! The document is read once through Android's ContentResolver (via
//! `tauri-plugin-fs`) and written to the app's cache as a real file, which
//! then goes through the same `render_file` path as everything else. That
//! is deliberately the iOS model, not a new one: iOS also hands over a copy
//! (its Inbox), so both mobile platforms share the same limits — no live
//! reload of later edits made elsewhere, and relative images beside the
//! original don't resolve. Folder access (the Storage Access Framework's
//! tree URIs) is a separate, later piece; see plan.md.

/// Name used when a URI carries no usable file name (some providers, e.g.
/// cloud drives, use opaque document ids).
const FALLBACK_NAME: &str = "Document.md";

pub fn is_content_uri(url_str: &str) -> bool {
    url_str.starts_with("content://")
}

/// File name for the cached copy, derived from the URI alone. Android's
/// own providers encode the path in the last segment — Files/external
/// storage as `primary%3ADownload%2Fnotes.md`, Downloads as
/// `raw%3A%2Fstorage%2F…%2Fnotes.md` — so the name is whatever follows the
/// last `/` or `:` once decoded. Anything that doesn't end in a Markdown
/// extension (an opaque id) falls back to `FALLBACK_NAME`, since the
/// window title and file browser show this name.
pub fn cache_file_name(url_str: &str) -> String {
    let last_segment = url_str.rsplit('/').next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(last_segment).decode_utf8_lossy();
    let name = decoded.rsplit(['/', ':']).next().unwrap_or("").trim();
    let is_markdown = name
        .rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && ["md", "markdown", "mdown", "mkd"].contains(&ext.to_ascii_lowercase().as_str()));
    if is_markdown && !name.starts_with('.') {
        name.to_string()
    } else {
        FALLBACK_NAME.to_string()
    }
}

/// Reads `url_str` through the ContentResolver and writes it to
/// `<cache>/opened/<name>`, returning that path. Blocks on a call into the
/// plugin's Kotlin side, so it must not run on the UI thread — both
/// callers are already off it (see `render_opened_document` and
/// `open_document`).
#[cfg(target_os = "android")]
pub fn copy_to_cache<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url_str: &str) -> std::io::Result<std::path::PathBuf> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    let url = url::Url::parse(url_str).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let text = app.fs().read_to_string(url)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .join("opened");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(cache_file_name(url_str));
    std::fs::write(&path, text)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_content_uris_only() {
        assert!(is_content_uri("content://com.android.externalstorage.documents/document/primary%3Anotes.md"));
        assert!(!is_content_uri("file:///sdcard/Download/notes.md"));
    }

    #[test]
    fn names_a_files_app_document() {
        // The exact URI the emulator's Files app delivered, 2026-10-24.
        assert_eq!(
            cache_file_name("content://com.android.externalstorage.documents/document/primary%3ADownload%2Fandroid-open-test.md"),
            "android-open-test.md"
        );
    }

    #[test]
    fn names_a_downloads_raw_document() {
        assert_eq!(
            cache_file_name("content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2FREADME.markdown"),
            "README.markdown"
        );
    }

    #[test]
    fn falls_back_for_opaque_ids() {
        assert_eq!(cache_file_name("content://com.android.providers.downloads.documents/document/msf%3A1000000033"), FALLBACK_NAME);
        assert_eq!(cache_file_name("content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3Dencoded%3DabC"), FALLBACK_NAME);
    }

    #[test]
    fn never_yields_a_path_or_hidden_name() {
        assert_eq!(cache_file_name("content://x/document/primary%3A..%2F..%2Fescape.md"), "escape.md");
        assert_eq!(cache_file_name("content://x/document/primary%3A.md"), FALLBACK_NAME);
        assert_eq!(cache_file_name("content://x/document/primary%3A"), FALLBACK_NAME);
    }
}
