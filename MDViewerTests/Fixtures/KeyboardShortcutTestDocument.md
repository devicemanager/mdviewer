# Keyboard Shortcut Test Fixture

Loaded automatically at test-host launch via `MDVIEWER_TEST_DOCUMENT_PATH`
(see `MDViewer.xcscheme`'s `TestAction` and `ContentView.swift`'s `onAppear`)
so `KeyboardShortcutTests` can reach a document-loaded, editor-mounted state
without a modal open panel or driving real UI. Not used by anything else.
