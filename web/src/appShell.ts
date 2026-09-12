// New logic, not a 1:1 Swift port: `ContentView.swift`'s `WelcomeView` is
// conditionally mounted/unmounted SwiftUI (`documentVM.text.isEmpty &&
// documentVM.fileURL == nil`); `app.html` has no SwiftUI equivalent, so
// this toggles the `hidden` attribute on the two static DOM nodes it
// already declares (`#welcome`, `#content`) instead. Kept as its own
// module — not folded into `mdviewerApi.ts` — because it's shell-page
// layout, not render-pipeline logic; `renderer.html` (no `#welcome`
// region at all) never needs this.

export interface AppShellElements {
    welcome: HTMLElement;
    content: HTMLElement;
}

/** Shows `#content` and hides `#welcome` — call once a document has been opened/rendered. */
export function showContent(elements: AppShellElements): void {
    elements.welcome.hidden = true;
    elements.content.hidden = false;
}

/** Shows `#welcome` and hides `#content` — the initial/no-document state. */
export function showWelcome(elements: AppShellElements): void {
    elements.content.hidden = true;
    elements.welcome.hidden = false;
}
