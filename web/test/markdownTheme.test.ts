import { describe, it, expect } from "vitest";
import { themes, githubLight, githubDark, findTheme, pdfPageSizes } from "../src/markdownTheme.js";

describe("themes", () => {
    it("has all 6 themes in the Swift order", () => {
        expect(themes.map((t) => t.id)).toEqual([
            "github-light",
            "github-dark",
            "solarized-light",
            "solarized-dark",
            "dracula",
            "nord",
        ]);
    });

    it("marks the dark themes correctly", () => {
        expect(themes.filter((t) => t.isDark).map((t) => t.id)).toEqual([
            "github-dark",
            "solarized-dark",
            "dracula",
            "nord",
        ]);
    });

    it("exposes githubLight and githubDark as the defaults", () => {
        expect(githubLight.id).toBe("github-light");
        expect(githubDark.id).toBe("github-dark");
    });
});

describe("findTheme", () => {
    it("finds a theme by id", () => {
        expect(findTheme("dracula")?.displayName).toBe("Dracula");
    });

    it("returns undefined for an unknown id", () => {
        expect(findTheme("no-such-theme")).toBeUndefined();
    });
});

describe("pdfPageSizes", () => {
    it("matches the Swift cssSize values exactly", () => {
        expect(pdfPageSizes.a4.cssSize).toBe("210mm 297mm");
        expect(pdfPageSizes.letter.cssSize).toBe("8.5in 11in");
        expect(pdfPageSizes.a3.cssSize).toBe("297mm 420mm");
    });

    it("matches the Swift pointSize values exactly", () => {
        expect(pdfPageSizes.a4.pointSize).toEqual({ width: 595.28, height: 841.89 });
        expect(pdfPageSizes.letter.pointSize).toEqual({ width: 612.0, height: 792.0 });
        expect(pdfPageSizes.a3.pointSize).toEqual({ width: 841.89, height: 1190.55 });
    });
});
