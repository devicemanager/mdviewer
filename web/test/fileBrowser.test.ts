import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    renderFileBrowser,
    attachFileBrowserHandlers,
    loadCachedFolder,
    storeCachedFolder,
    type FileBrowserEntry,
} from "../src/fileBrowser.js";

let container: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<div id="file-browser"></div>';
    container = document.getElementById("file-browser")!;
    localStorage.clear();
});

describe("renderFileBrowser", () => {
    it("shows the disabled state when no document has ever been opened", () => {
        renderFileBrowser(container, { kind: "no-document" });
        expect(container.textContent).toContain("Open a document to browse its folder.");
        expect(container.querySelector("button")).toBeNull();
    });

    it("shows a loading state with an up row when not at the top", () => {
        renderFileBrowser(container, { kind: "loading", path: "/docs/sub", parentPath: "/docs" });
        expect(container.textContent).toContain("Loading");
        expect(container.querySelector('button[data-action="up"]')).not.toBeNull();
    });

    it("omits the up row at the top of the browsing session (parentPath: null)", () => {
        renderFileBrowser(container, { kind: "loading", path: "/docs", parentPath: null });
        expect(container.querySelector('button[data-action="up"]')).toBeNull();
    });

    it("shows an error message, still with the up row available", () => {
        renderFileBrowser(container, {
            kind: "error",
            path: "/docs/sub",
            parentPath: "/docs",
            message: "permission_denied: no access",
        });
        expect(container.textContent).toContain("permission_denied: no access");
        expect(container.querySelector('button[data-action="up"]')).not.toBeNull();
    });

    it("shows an empty-folder state when there are no entries", () => {
        renderFileBrowser(container, { kind: "loaded", path: "/docs", parentPath: null, entries: [] });
        expect(container.textContent).toContain("No documents in this folder.");
    });

    it("renders folders before files, each with the right action and data-name", () => {
        const entries: FileBrowserEntry[] = [
            { name: "notes.md", isDir: false },
            { name: "images", isDir: true },
        ];
        renderFileBrowser(container, { kind: "loaded", path: "/docs", parentPath: null, entries });

        const items = container.querySelectorAll<HTMLButtonElement>(".file-browser-item:not(.file-browser-up)");
        expect(items).toHaveLength(2);
        expect(items[0].dataset.action).toBe("open");
        expect(items[0].dataset.name).toBe("notes.md");
        expect(items[1].dataset.action).toBe("navigate");
        expect(items[1].dataset.name).toBe("images");
    });

    it("escapes entry names", () => {
        renderFileBrowser(container, {
            kind: "loaded",
            path: "/docs",
            parentPath: null,
            entries: [{ name: "<script>.md", isDir: false }],
        });
        // The real security property: no actual <script> element gets
        // created. Checking `innerHTML` for the raw substring instead
        // would be a false negative here — jsdom's innerHTML *getter*
        // re-serializes attribute values without escaping `<`/`>` (only
        // `&` and the matching quote character need escaping in a
        // serialized attribute value), so a correctly-escaped
        // `data-name="&lt;script&gt;.md"` in the source HTML parses into
        // a safe attribute and then re-serializes back to
        // `data-name="<script>.md"` on read — same non-issue
        // sidebar.test.ts's own equivalent test sidesteps by never
        // putting the literal string `<script>` in an attribute position.
        expect(container.querySelector("script")).toBeNull();
        const button = container.querySelector<HTMLButtonElement>("button.file-browser-file")!;
        expect(button.textContent).toBe("<script>.md");
        expect(button.dataset.name).toBe("<script>.md");
    });

    it("replaces a previous render wholesale, not appending", () => {
        renderFileBrowser(container, { kind: "loaded", path: "/a", parentPath: null, entries: [{ name: "one.md", isDir: false }] });
        renderFileBrowser(container, { kind: "loaded", path: "/b", parentPath: null, entries: [{ name: "two.md", isDir: false }] });
        expect(container.querySelectorAll(".file-browser-file")).toHaveLength(1);
        expect(container.textContent).toContain("two.md");
        expect(container.textContent).not.toContain("one.md");
    });
});

describe("attachFileBrowserHandlers", () => {
    function renderTwoEntries() {
        renderFileBrowser(container, {
            kind: "loaded",
            path: "/docs/sub",
            parentPath: "/docs",
            entries: [
                { name: "images", isDir: true },
                { name: "notes.md", isDir: false },
            ],
        });
    }

    it("calls onNavigate with the folder's name when a folder is clicked", () => {
        renderTwoEntries();
        const onNavigate = vi.fn();
        attachFileBrowserHandlers(container, { onOpenFile: vi.fn(), onNavigate, onUp: vi.fn() });

        container.querySelector('button[data-action="navigate"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onNavigate).toHaveBeenCalledWith("images");
    });

    it("calls onOpenFile with the file's name when a file is clicked", () => {
        renderTwoEntries();
        const onOpenFile = vi.fn();
        attachFileBrowserHandlers(container, { onOpenFile, onNavigate: vi.fn(), onUp: vi.fn() });

        container.querySelector('button[data-action="open"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpenFile).toHaveBeenCalledWith("notes.md");
    });

    it("calls onUp when the up row is clicked", () => {
        renderTwoEntries();
        const onUp = vi.fn();
        attachFileBrowserHandlers(container, { onOpenFile: vi.fn(), onNavigate: vi.fn(), onUp });

        container.querySelector('button[data-action="up"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onUp).toHaveBeenCalledOnce();
    });

    it("does nothing when the click isn't on a file-browser item", () => {
        renderTwoEntries();
        const onOpenFile = vi.fn();
        attachFileBrowserHandlers(container, { onOpenFile, onNavigate: vi.fn(), onUp: vi.fn() });

        container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpenFile).not.toHaveBeenCalled();
    });

    it("still works after renderFileBrowser replaces the list, via delegation", () => {
        const onOpenFile = vi.fn();
        attachFileBrowserHandlers(container, { onOpenFile, onNavigate: vi.fn(), onUp: vi.fn() });

        renderFileBrowser(container, { kind: "loaded", path: "/a", parentPath: null, entries: [{ name: "first.md", isDir: false }] });
        renderFileBrowser(container, { kind: "loaded", path: "/a", parentPath: null, entries: [{ name: "second.md", isDir: false }] });
        container.querySelector('button[data-action="open"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onOpenFile).toHaveBeenCalledWith("second.md");
    });
});

describe("loadCachedFolder / storeCachedFolder", () => {
    it("returns undefined for a path that was never cached", () => {
        expect(loadCachedFolder("/never/cached")).toBeUndefined();
    });

    it("round-trips entries for a stored path", () => {
        const entries: FileBrowserEntry[] = [{ name: "a.md", isDir: false }];
        storeCachedFolder("/docs", entries);
        expect(loadCachedFolder("/docs")).toEqual(entries);
    });

    it("keys folders independently — storing one path doesn't affect another", () => {
        storeCachedFolder("/docs/a", [{ name: "a.md", isDir: false }]);
        storeCachedFolder("/docs/b", [{ name: "b.md", isDir: false }]);
        expect(loadCachedFolder("/docs/a")).toEqual([{ name: "a.md", isDir: false }]);
        expect(loadCachedFolder("/docs/b")).toEqual([{ name: "b.md", isDir: false }]);
    });

    it("overwrites a previously cached listing for the same path", () => {
        storeCachedFolder("/docs", [{ name: "old.md", isDir: false }]);
        storeCachedFolder("/docs", [{ name: "new.md", isDir: false }]);
        expect(loadCachedFolder("/docs")).toEqual([{ name: "new.md", isDir: false }]);
    });

    it("degrades to a cache miss when localStorage holds malformed JSON", () => {
        localStorage.setItem("mdviewer.folderCache", "{not valid json");
        expect(loadCachedFolder("/docs")).toBeUndefined();
    });

    it("degrades to a cache miss when localStorage holds a different schema version", () => {
        localStorage.setItem("mdviewer.folderCache", JSON.stringify({ v: 999, folders: { "/docs": { entries: [], cachedAt: 0 } } }));
        expect(loadCachedFolder("/docs")).toBeUndefined();
    });

    it("degrades to a cache miss when the stored value has the wrong shape entirely", () => {
        localStorage.setItem("mdviewer.folderCache", JSON.stringify("just a string, not an object"));
        expect(loadCachedFolder("/docs")).toBeUndefined();
    });

    it("evicts the oldest folder once the cap is exceeded", () => {
        const originalNow = Date.now;
        let now = 1000;
        vi.spyOn(Date, "now").mockImplementation(() => now);

        for (let i = 0; i < 21; i++) {
            storeCachedFolder(`/docs/${i}`, [{ name: `${i}.md`, isDir: false }]);
            now += 1;
        }

        // The very first one stored (oldest cachedAt) should have been evicted.
        expect(loadCachedFolder("/docs/0")).toBeUndefined();
        // The most recent 20 should all still be present.
        expect(loadCachedFolder("/docs/20")).toEqual([{ name: "20.md", isDir: false }]);
        expect(loadCachedFolder("/docs/1")).toEqual([{ name: "1.md", isDir: false }]);

        Date.now = originalNow;
    });
});
