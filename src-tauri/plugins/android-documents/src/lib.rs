//! Android document helpers for MDViewer that the stock Tauri plugins
//! don't expose to Rust (2026-10-24). Today: a `content://` document's
//! display name, so a document picked through the system picker keeps its
//! real name instead of a generated one. Meant to grow the Storage Access
//! Framework folder access next (see docs/project/plan.md).
//!
//! Rust-facing only: the plugin registers no JS commands, so the page
//! gets no new surface. Only Android has a Kotlin side; elsewhere `init`
//! is an empty plugin and nothing is managed.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "org.devicemanager.mdviewer.documents";

#[cfg(target_os = "android")]
pub struct AndroidDocuments<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: Runtime> AndroidDocuments<R> {
    /// The user-visible name of a `content://` document, or `None` when
    /// the provider has none (or the call fails — callers fall back).
    /// Blocks on the Kotlin side: never call it on the UI thread.
    pub fn display_name(&self, uri: &str) -> Option<String> {
        #[derive(serde::Serialize)]
        struct Args<'a> {
            uri: &'a str,
        }
        #[derive(serde::Deserialize)]
        struct Response {
            name: Option<String>,
        }
        self.0
            .run_mobile_plugin::<Response>("displayName", Args { uri })
            .ok()
            .and_then(|r| r.name)
    }
}

#[cfg(target_os = "android")]
pub trait AndroidDocumentsExt<R: Runtime> {
    fn android_documents(&self) -> &AndroidDocuments<R>;
}

#[cfg(target_os = "android")]
impl<R: Runtime, T: tauri::Manager<R>> AndroidDocumentsExt<R> for T {
    fn android_documents(&self) -> &AndroidDocuments<R> {
        self.state::<AndroidDocuments<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-documents")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "DocumentsPlugin")?;
                _app.manage(AndroidDocuments(handle));
            }
            Ok(())
        })
        .build()
}
