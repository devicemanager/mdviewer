package org.devicemanager.mdviewer.documents

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class DisplayNameArgs {
    lateinit var uri: String
}

/**
 * Android document helpers the stock Tauri plugins don't expose to Rust.
 * Called from Rust only (`run_mobile_plugin`); no capability grants these
 * commands to the page.
 */
@TauriPlugin
class DocumentsPlugin(private val activity: Activity) : Plugin(activity) {
    /**
     * The name the user sees for a `content://` document, the same
     * OpenableColumns.DISPLAY_NAME Files and the system picker show.
     * Resolves `{ name: null }` when the provider has none or the
     * query fails, so the caller falls back rather than erroring.
     */
    @Command
    fun displayName(invoke: Invoke) {
        val args = invoke.parseArgs(DisplayNameArgs::class.java)
        val res = JSObject()
        var name: String? = null
        try {
            activity.contentResolver.query(
                Uri.parse(args.uri),
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0 && cursor.moveToFirst()) {
                    name = cursor.getString(column)
                }
            }
        } catch (e: Exception) {
            // SecurityException for a URI without a read grant, or a
            // provider that doesn't support the query; fall back.
        }
        res.put("name", name)
        invoke.resolve(res)
    }
}
