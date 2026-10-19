// Ported from `WebRendererView.Coordinator.promptRemoteContent(count:)`
// (2026-10-19): the "Load remote content?" question Ask exists for. Swift
// shows it as an NSAlert sheet; here it's an in-page dialog, since the
// whole UI is one webview (porting-brief.md's single-webview default) and
// a native alert with three custom buttons isn't available on every
// platform Tauri targets. Same wording, same three answers, same meaning:
//
// - Load: this document's images, this time (`MDViewer.loadRemoteResources`).
// - Don't Load: nothing — they stay blocked.
// - Always Allow: stores Always, then loads.
//
// Like Swift, it asks again on every render under Ask that blocks
// something — including a live reload of the same file.
//
// Same module shape as permissions.ts (and it borrows that dialog's
// overlay/panel styles: the same kind of thing): pure render + handlers,
// no `invoke` in here — main.ts's `wireRemotePrompt` does that.

export function remotePromptMessage(count: number): string {
    const noun = count === 1 ? "image" : "images";
    return `This document references ${count} ${noun} hosted on the internet. Loading them reveals your IP address to those servers.`;
}

export function renderRemotePrompt(root: HTMLElement, count: number): void {
    root.innerHTML = `
        <div class="permissions-overlay">
            <div class="permissions-panel" role="alertdialog" aria-labelledby="remote-prompt-title" aria-describedby="remote-prompt-message">
                <h2 class="permissions-title" id="remote-prompt-title">Load remote content?</h2>
                <p class="permissions-intro" id="remote-prompt-message">${remotePromptMessage(count)}</p>
                <div class="remote-prompt-buttons">
                    <button type="button" class="permissions-done-btn" data-action="load">Load</button>
                    <button type="button" class="permissions-grant-btn" data-action="dont-load">Don’t Load</button>
                    <button type="button" class="permissions-grant-btn" data-action="always-allow">Always Allow</button>
                </div>
            </div>
        </div>
    `;
}

export interface RemotePromptCallbacks {
    onLoad: () => void;
    onDontLoad: () => void;
    onAlwaysAllow: () => void;
}

export function attachRemotePromptHandlers(root: HTMLElement, callbacks: RemotePromptCallbacks): void {
    root.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const action = target.closest<HTMLElement>("button[data-action]")?.dataset.action;
        if (action === "load") callbacks.onLoad();
        else if (action === "dont-load") callbacks.onDontLoad();
        else if (action === "always-allow") callbacks.onAlwaysAllow();
    });
}

export function showRemotePrompt(root: HTMLElement): void {
    root.hidden = false;
}

export function hideRemotePrompt(root: HTMLElement): void {
    root.hidden = true;
}
