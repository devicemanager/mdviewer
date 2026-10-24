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

/// File name for the cached copy. Prefers `display_name` — the name Files
/// and the system picker show, from the `android-documents` plugin — and
/// adds `.md` when it has no Markdown extension (a provider may report a
/// bare "README"). Without one, falls back to the URI itself: Android's own
/// providers encode the path in the last segment — Files/external storage
/// as `primary%3ADownload%2Fnotes.md`, Downloads as
/// `raw%3A%2Fstorage%2F…%2Fnotes.md` — so the name is whatever follows the
/// last `/` or `:` once decoded; an opaque id (the picker's Recent list,
/// cloud drives) gets `FALLBACK_NAME`. Never returns a path or a hidden
/// name, since the result is joined onto the cache directory.
pub fn cache_file_name(url_str: &str, display_name: Option<&str>) -> String {
    if let Some(name) = display_name.and_then(plain_name) {
        return if is_markdown(&name) { name } else { format!("{name}.md") };
    }
    let last_segment = url_str.rsplit('/').next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(last_segment).decode_utf8_lossy();
    match plain_name(decoded.rsplit(':').next().unwrap_or("")) {
        Some(name) if is_markdown(&name) => name,
        _ => FALLBACK_NAME.to_string(),
    }
}

/// The last path component of `name`, trimmed — `None` if that is empty or
/// hidden (starts with `.`, which also rules out `.` and `..`).
fn plain_name(name: &str) -> Option<String> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    (!name.is_empty() && !name.starts_with('.') && !name.contains('\0')).then(|| name.to_string())
}

fn is_markdown(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && ["md", "markdown", "mdown", "mkd"].contains(&ext.to_ascii_lowercase().as_str()))
}

/// Reads `url_str` through the ContentResolver and writes it to
/// `<cache>/opened/<name>`, returning that path. Blocks on calls into the
/// plugins' Kotlin side, so it must not run on the UI thread — both
/// callers are already off it (see `render_opened_document` and
/// `open_document`).
#[cfg(target_os = "android")]
pub fn copy_to_cache<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url_str: &str) -> std::io::Result<std::path::PathBuf> {
    use tauri::Manager;
    use tauri_plugin_android_documents::AndroidDocumentsExt;
    use tauri_plugin_fs::FsExt;

    let url = url::Url::parse(url_str).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let text = app.fs().read_to_string(url)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .join("opened");
    std::fs::create_dir_all(&dir)?;
    let display_name = app.android_documents().display_name(url_str);
    let path = dir.join(cache_file_name(url_str, display_name.as_deref()));
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
            cache_file_name("content://com.android.externalstorage.documents/document/primary%3ADownload%2Fandroid-open-test.md", None),
            "android-open-test.md"
        );
    }

    #[test]
    fn names_a_downloads_raw_document() {
        assert_eq!(
            cache_file_name("content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2FREADME.markdown", None),
            "README.markdown"
        );
    }

    #[test]
    fn falls_back_for_opaque_ids() {
        assert_eq!(cache_file_name("content://com.android.providers.downloads.documents/document/msf%3A1000000033", None), FALLBACK_NAME);
        assert_eq!(cache_file_name("content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3Dencoded%3DabC", None), FALLBACK_NAME);
    }

    #[test]
    fn never_yields_a_path_or_hidden_name() {
        assert_eq!(cache_file_name("content://x/document/primary%3A..%2F..%2Fescape.md", None), "escape.md");
        assert_eq!(cache_file_name("content://x/document/primary%3A.md", None), FALLBACK_NAME);
        assert_eq!(cache_file_name("content://x/document/primary%3A", None), FALLBACK_NAME);
    }

    // The picker's own URI from the emulator, 2026-10-24: no name in it.
    const PICKER_URI: &str = "content://com.android.providers.media.documents/document/document%3A1000000027";

    #[test]
    fn prefers_the_display_name() {
        assert_eq!(cache_file_name(PICKER_URI, Some("Meeting notes.md")), "Meeting notes.md");
        assert_eq!(cache_file_name(PICKER_URI, None), FALLBACK_NAME);
    }

    #[test]
    fn adds_md_to_a_bare_display_name() {
        assert_eq!(cache_file_name(PICKER_URI, Some("README")), "README.md");
        assert_eq!(cache_file_name(PICKER_URI, Some("notes.MARKDOWN")), "notes.MARKDOWN");
    }

    #[test]
    fn never_trusts_a_display_name_as_a_path() {
        assert_eq!(cache_file_name(PICKER_URI, Some("../../escape.md")), "escape.md");
        assert_eq!(cache_file_name(PICKER_URI, Some("..")), FALLBACK_NAME);
        assert_eq!(cache_file_name(PICKER_URI, Some("  ")), FALLBACK_NAME);
        assert_eq!(cache_file_name(PICKER_URI, Some(".hidden.md")), FALLBACK_NAME);
    }
}
