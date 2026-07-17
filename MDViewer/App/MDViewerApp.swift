import SwiftUI
import AppKit

@main
struct MDViewerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About MDViewer") {
                    AboutPanel.present()
                }
            }

            CommandGroup(replacing: .newItem) {
                Button("Open…") {
                    NotificationCenter.default.post(name: .openFile, object: nil)
                }
                .keyboardShortcut("o", modifiers: .command)
            }

            CommandGroup(after: .newItem) {
                Button("Reload") {
                    NotificationCenter.default.post(name: .reloadFile, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)
            }

            CommandGroup(replacing: .saveItem) {
                Button("Save") {
                    NotificationCenter.default.post(name: .saveFile, object: nil)
                }
                .keyboardShortcut("s", modifiers: .command)
            }

            CommandMenu("View") {
                Button("Toggle Editor Mode") {
                    NotificationCenter.default.post(name: .toggleEditorMode, object: nil)
                }
                .keyboardShortcut("e", modifiers: .command)

                Divider()

                Button("Toggle Sidebar") {
                    NotificationCenter.default.post(name: .toggleSidebar, object: nil)
                }
                .keyboardShortcut("s", modifiers: [.command, .shift])

                Button("Find…") {
                    NotificationCenter.default.post(name: .showSearchBar, object: nil)
                }
                .keyboardShortcut("f", modifiers: .command)

                Divider()

                Button("Increase Font Size") {
                    NotificationCenter.default.post(name: .increaseFontSize, object: nil)
                }
                .keyboardShortcut("+", modifiers: .command)

                Button("Decrease Font Size") {
                    NotificationCenter.default.post(name: .decreaseFontSize, object: nil)
                }
                .keyboardShortcut("-", modifiers: .command)

                Button("Reset Font Size") {
                    NotificationCenter.default.post(name: .resetFontSize, object: nil)
                }
                .keyboardShortcut("0", modifiers: .command)
            }

            CommandMenu("Export") {
                Button("Export as PDF…") {
                    NotificationCenter.default.post(name: .exportPDF, object: nil)
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])

                Button("Export as HTML…") {
                    NotificationCenter.default.post(name: .exportHTML, object: nil)
                }
                .keyboardShortcut("e", modifiers: [.command, .shift])
            }
        }

        Settings {
            PreferencesView()
        }
    }
}

// MARK: - Additional Notification names

extension Notification.Name {
    static let increaseFontSize = Notification.Name("MDViewer.increaseFontSize")
    static let decreaseFontSize = Notification.Name("MDViewer.decreaseFontSize")
    static let resetFontSize = Notification.Name("MDViewer.resetFontSize")
    static let exportPDF = Notification.Name("MDViewer.exportPDF")
    static let exportHTML = Notification.Name("MDViewer.exportHTML")
    static let pdfPageSizeChanged = Notification.Name("MDViewer.pdfPageSizeChanged")
}

// MARK: - About panel

/// Presents the standard macOS About panel with third-party license notices in
/// its Credits area, so the notices ship *inside* the app (as MIT / Apache /
/// MPL expect) rather than only living in the source repository.
enum AboutPanel {
    static func present() {
        let credits = NSAttributedString(
            string: acknowledgements,
            attributes: [
                .font: NSFont.systemFont(ofSize: 10),
                .foregroundColor: NSColor.labelColor,
            ]
        )
        NSApplication.shared.orderFrontStandardAboutPanel(options: [.credits: credits])
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private static let acknowledgements = """
    MDViewer is open source under the MIT License. Originally created by Masanori Sakai (@Masakai); this fork is maintained by @devicemanager, adding a Quick Look preview extension and security hardening.

    Third-party libraries

    marked 18.0.6 — MIT
      Copyright (c) 2018-2026 MarkedJS; (c) 2011-2018 Christopher Jeffrey
      https://github.com/markedjs/marked

    Shiki 4.3.1 — MIT
      Copyright (c) 2021 Pine Wu; (c) 2023 Anthony Fu
      https://github.com/shikijs/shiki

    KaTeX 0.17.0 — MIT (fonts under SIL Open Font License 1.1)
      Copyright (c) 2013-2020 Khan Academy and other contributors
      https://github.com/KaTeX/KaTeX

    Mermaid 11.16.0 — MIT
      Copyright (c) 2014-2024 Knut Sveidqvist and contributors
      https://github.com/mermaid-js/mermaid

    DOMPurify 3.4.12 — Apache-2.0 OR MPL-2.0
      Copyright (c) Cure53 and other contributors
      https://github.com/cure53/DOMPurify

    The MIT-licensed components above are provided under the following terms:

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

    DOMPurify is dual-licensed under Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0) or MPL-2.0 (https://www.mozilla.org/MPL/2.0/).

    Full copyright notices and license texts:
    https://github.com/devicemanager/mdviewer/blob/main/THIRD_PARTY_NOTICES.md
    """
}
