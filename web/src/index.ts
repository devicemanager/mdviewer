// Library-style barrel export of every ported mdviewer.js module — dom
// (slugify/escapeHtml), emoji, math (protect + restore), remote gating,
// local-resource rewriting, the DOMPurify sanitize call, the marked
// renderer overrides, highlightCode, Mermaid, the createMDViewerApi
// assembly layer, the interaction listeners, and appShell's
// welcome/content toggle — plus everything ported for Milestone C
// (renderViewModel.ts, markdownTheme.ts) and Milestone E's UI shell so far
// (sidebar.ts, toolbar.ts, preferences.ts, search.ts). Side-effect-free on purpose:
// nothing here touches `window` or runs anything at import time, so this
// stays freely importable from tests (which is what every test file
// actually does — importing individual modules directly, not this
// barrel, but this file exists as the single place documenting what's
// been ported).
//
// This is NOT esbuild's bundle entry point — that's main.ts, which wires
// these modules to the real vendor globals (window.marked, window.katex,
// etc.), assigns window.MDViewer, and calls attachInteractionListeners.
// See main.ts's own header for what's still unwired there (scroll/hover
// position and the remote-content prompt banner's "Load"/"Don't Load"/
// "Always Allow" buttons specifically — no such banner UI exists yet.
// The *setting* itself is reachable now, via Preferences' Privacy tab
// (preferences.ts) and the `get_remote_content_policy`/
// `set_remote_content_policy` commands; `handle_link_click` is also
// already wired).
//
// mdviewer.js's port reached parity and went live 2026-09-09 (Milestone
// D's flip) — `MDViewer/Resources/Web/mdviewer.js` is this bundle now,
// not a hand-written file. See porting-brief.md's "What does not get
// ported" section.

export * from "./dom.js";
export * from "./emoji.js";
export * from "./math.js";
export * from "./remote.js";
export * from "./localResources.js";
export * from "./sanitize.js";
export * from "./markedRenderer.js";
export * from "./highlightCode.js";
export * from "./mermaid.js";
export * from "./mdviewerApi.js";
export * from "./interactionListeners.js";
export * from "./appShell.js";
export * from "./renderViewModel.js";
export * from "./markdownTheme.js";
export * from "./sidebar.js";
export * from "./toolbar.js";
export * from "./preferences.js";
export * from "./search.js";
