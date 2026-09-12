import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    renderPermissions,
    attachPermissionsHandlers,
    showPermissions,
    hidePermissions,
    hasSeenPermissionsPrompt,
    markPermissionsPromptSeen,
    type PermissionsState,
} from "../src/permissions.js";

let root: HTMLElement;

const EMPTY_STATE: PermissionsState = { policy: "ask", folders: [] };

beforeEach(() => {
    document.body.innerHTML = '<div id="permissions" hidden></div>';
    root = document.getElementById("permissions")!;
    localStorage.clear();
});

describe("renderPermissions", () => {
    it("asks both security questions in one dialog", () => {
        renderPermissions(root, EMPTY_STATE);
        // Folder access and remote content, together — the user's own
        // "covers all the security questions at once".
        expect(root.querySelector('button[data-action="grant-folder"]')).not.toBeNull();
        expect(root.querySelector('select[data-action="policy"]')).not.toBeNull();
        expect(root.querySelector('button[data-action="done"]')).not.toBeNull();
    });

    it("says plainly that no folder has been granted yet", () => {
        renderPermissions(root, EMPTY_STATE);
        expect(root.textContent).toContain("No folder granted yet.");
        expect(root.querySelector(".permissions-folder-list")).toBeNull();
    });

    it("lists granted folders once there are some", () => {
        renderPermissions(root, { policy: "ask", folders: [{ path: "/Users/me/notes" }, { path: "/Users/me/docs" }] });
        const items = root.querySelectorAll(".permissions-folder");
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toBe("/Users/me/notes");
        expect(root.textContent).not.toContain("No folder granted yet.");
    });

    it("preselects the current remote-content policy", () => {
        renderPermissions(root, { policy: "never", folders: [] });
        expect(root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!.value).toBe("never");
    });

    it("explains that a folder grant covers everything inside it", () => {
        renderPermissions(root, EMPTY_STATE);
        // The recursive consequence of a grant isn't obvious from the word
        // "folder" alone — folder_covers is a subtree check on the Rust side.
        expect(root.textContent).toContain("everything inside it");
    });

    it("escapes folder paths", () => {
        renderPermissions(root, { policy: "ask", folders: [{ path: "/tmp/<script>" }] });
        expect(root.querySelector("script")).toBeNull();
        expect(root.querySelector(".permissions-folder")!.textContent).toBe("/tmp/<script>");
    });

    it("replaces a previous render wholesale rather than appending", () => {
        renderPermissions(root, EMPTY_STATE);
        renderPermissions(root, { policy: "ask", folders: [{ path: "/one" }] });
        expect(root.querySelectorAll(".permissions-panel")).toHaveLength(1);
        expect(root.querySelectorAll(".permissions-folder")).toHaveLength(1);
    });
});

describe("attachPermissionsHandlers", () => {
    it("calls onGrantFolder when the choose-a-folder button is clicked", () => {
        renderPermissions(root, EMPTY_STATE);
        const onGrantFolder = vi.fn();
        attachPermissionsHandlers(root, { onGrantFolder, onPolicyChange: vi.fn(), onDone: vi.fn() });

        root.querySelector('button[data-action="grant-folder"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onGrantFolder).toHaveBeenCalledOnce();
    });

    it("calls onDone when Done is clicked", () => {
        renderPermissions(root, EMPTY_STATE);
        const onDone = vi.fn();
        attachPermissionsHandlers(root, { onGrantFolder: vi.fn(), onPolicyChange: vi.fn(), onDone });

        root.querySelector('button[data-action="done"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onDone).toHaveBeenCalledOnce();
    });

    it("calls onPolicyChange with the chosen policy", () => {
        renderPermissions(root, EMPTY_STATE);
        const onPolicyChange = vi.fn();
        attachPermissionsHandlers(root, { onGrantFolder: vi.fn(), onPolicyChange, onDone: vi.fn() });

        const select = root.querySelector<HTMLSelectElement>('select[data-action="policy"]')!;
        select.value = "never";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onPolicyChange).toHaveBeenCalledWith("never");
    });

    it("ignores clicks that aren't on a control", () => {
        renderPermissions(root, EMPTY_STATE);
        const onDone = vi.fn();
        const onGrantFolder = vi.fn();
        attachPermissionsHandlers(root, { onGrantFolder, onPolicyChange: vi.fn(), onDone });

        root.querySelector(".permissions-intro")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onDone).not.toHaveBeenCalled();
        expect(onGrantFolder).not.toHaveBeenCalled();
    });

    it("still works after a re-render, via delegation", () => {
        const onGrantFolder = vi.fn();
        attachPermissionsHandlers(root, { onGrantFolder, onPolicyChange: vi.fn(), onDone: vi.fn() });

        renderPermissions(root, EMPTY_STATE);
        renderPermissions(root, { policy: "ask", folders: [{ path: "/one" }] });
        root.querySelector('button[data-action="grant-folder"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onGrantFolder).toHaveBeenCalledOnce();
    });
});

describe("showPermissions / hidePermissions", () => {
    it("toggles the hidden attribute", () => {
        showPermissions(root);
        expect(root.hidden).toBe(false);
        hidePermissions(root);
        expect(root.hidden).toBe(true);
    });
});

describe("hasSeenPermissionsPrompt / markPermissionsPromptSeen", () => {
    it("is false before the prompt has ever been shown", () => {
        expect(hasSeenPermissionsPrompt()).toBe(false);
    });

    it("is true once marked", () => {
        markPermissionsPromptSeen();
        expect(hasSeenPermissionsPrompt()).toBe(true);
    });

    it("treats a garbage stored value as not-yet-seen", () => {
        // Fails open (shows the prompt again) rather than closed — a
        // re-shown dialog is harmless, whereas wrongly skipping it would
        // leave the user never asked.
        localStorage.setItem("mdviewer.permissionsPromptSeen", "banana");
        expect(hasSeenPermissionsPrompt()).toBe(false);
    });
});
