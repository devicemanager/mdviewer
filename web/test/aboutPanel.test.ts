import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACKNOWLEDGEMENTS, aboutPaneHTML, updateAboutVersion } from "../src/aboutPanel.js";

// Relative to vitest's root (web/, where its config lives) — under jsdom
// `import.meta.url` isn't a file: URL, so it can't anchor these.
const vendorDir = resolve(process.cwd(), "../MDViewer/Resources/Web/vendor");
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
};

describe("ACKNOWLEDGEMENTS", () => {
    // The Swift credits went stale after a version bump once; these pin
    // every listed version to what actually ships.
    it.each([
        ["marked", "marked"],
        ["Shiki", "shiki"],
        ["KaTeX", "katex"],
        ["DOMPurify", "dompurify"],
    ])("lists %s at the pinned %s version", (label, npmName) => {
        expect(ACKNOWLEDGEMENTS).toContain(`${label} ${pkg.devDependencies[npmName]} —`);
    });

    it("lists Mermaid at the vendored mermaid.min.js version", () => {
        const listed = /Mermaid (\d+\.\d+\.\d+) —/.exec(ACKNOWLEDGEMENTS)?.[1];
        expect(listed).toBeDefined();
        expect(readFileSync(resolve(vendorDir, "mermaid.min.js"), "utf8")).toContain(`version:"${listed}"`);
    });

    it("carries the MIT permission notice and the DOMPurify license terms", () => {
        expect(ACKNOWLEDGEMENTS).toContain("The above copyright notice and this permission notice shall be included");
        expect(ACKNOWLEDGEMENTS).toContain("Apache-2.0 OR MPL-2.0");
    });
});

describe("aboutPaneHTML / updateAboutVersion", () => {
    it("renders the acknowledgements escaped, and fills in the version later", () => {
        const root = document.createElement("div");
        root.innerHTML = aboutPaneHTML();
        expect(root.querySelector(".prefs-credits")?.textContent).toBe(ACKNOWLEDGEMENTS);
        expect(root.querySelector("[data-app-version]")?.textContent).toBe("");

        updateAboutVersion(root, "1.0.0");
        expect(root.querySelector(".prefs-about-title")?.textContent).toBe("MDViewer 1.0.0");
    });
});
