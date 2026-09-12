import { describe, it, expect, beforeEach } from "vitest";
import { openDrawer, closeDrawer, toggleDrawer } from "../src/drawer.js";

let drawer: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = '<nav id="drawer"></nav>';
    drawer = document.getElementById("drawer")!;
});

describe("openDrawer / closeDrawer / toggleDrawer", () => {
    it("openDrawer adds .open to the drawer and, when given one, the backdrop", () => {
        const backdrop = document.createElement("div");
        openDrawer(drawer, backdrop);
        expect(drawer.classList.contains("open")).toBe(true);
        expect(backdrop.classList.contains("open")).toBe(true);
    });

    it("openDrawer works without a backdrop argument", () => {
        openDrawer(drawer);
        expect(drawer.classList.contains("open")).toBe(true);
    });

    it("closeDrawer removes .open from both", () => {
        const backdrop = document.createElement("div");
        openDrawer(drawer, backdrop);
        closeDrawer(drawer, backdrop);
        expect(drawer.classList.contains("open")).toBe(false);
        expect(backdrop.classList.contains("open")).toBe(false);
    });

    it("toggleDrawer opens a closed drawer and closes an open one", () => {
        const backdrop = document.createElement("div");
        toggleDrawer(drawer, backdrop);
        expect(drawer.classList.contains("open")).toBe(true);

        toggleDrawer(drawer, backdrop);
        expect(drawer.classList.contains("open")).toBe(false);
        expect(backdrop.classList.contains("open")).toBe(false);
    });

    // A second, independent drawer instance — proves nothing here is
    // accidentally shared/global state (e.g. a module-level "current
    // drawer" variable), which matters once the TOC sidebar and the file
    // browser (fileBrowser.ts, file-browser plan's Phase 3) are two real,
    // simultaneously-existing drawers in the same page rather than a
    // single one being tested in isolation.
    it("two drawer instances open and close independently of each other", () => {
        document.body.innerHTML += '<nav id="drawer-2"></nav>';
        const drawer2 = document.getElementById("drawer-2")!;

        openDrawer(drawer);
        expect(drawer.classList.contains("open")).toBe(true);
        expect(drawer2.classList.contains("open")).toBe(false);

        openDrawer(drawer2);
        closeDrawer(drawer);
        expect(drawer.classList.contains("open")).toBe(false);
        expect(drawer2.classList.contains("open")).toBe(true);
    });
});
