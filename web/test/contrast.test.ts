import { describe, it, expect } from "vitest";
import {
    parseCssColor,
    composite,
    contrastRatio,
    relativeLuminance,
    requiredRatio,
    dominantColor,
    toHex,
    type RGBA,
} from "../visual/contrast.js";

const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };

describe("parseCssColor", () => {
    it("parses the forms WebKit's getComputedStyle returns", () => {
        expect(parseCssColor("rgb(36, 41, 46)")).toEqual({ r: 36, g: 41, b: 46, a: 1 });
        expect(parseCssColor("rgba(0, 0, 0, 0.35)")).toEqual({ r: 0, g: 0, b: 0, a: 0.35 });
        expect(parseCssColor("rgb(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
        expect(parseCssColor("color(srgb 1 1 1 / 0.9)")).toEqual({ r: 255, g: 255, b: 255, a: 0.9 });
        expect(parseCssColor("color(srgb 0.0509804 0.0666667 0.0901961)")).toEqual({ r: 13, g: 17, b: 23, a: 1 });
        expect(parseCssColor("#0366d6")).toEqual({ r: 3, g: 102, b: 214, a: 1 });
        expect(parseCssColor("#fff")).toEqual(white);
        expect(parseCssColor("transparent")?.a).toBe(0);
    });

    it("returns undefined for anything it can't read, instead of guessing", () => {
        expect(parseCssColor("currentcolor")).toBeUndefined();
        expect(parseCssColor("oklch(0.5 0.1 200)")).toBeUndefined();
    });
});

describe("contrast maths", () => {
    it("matches the WCAG reference values", () => {
        expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
        expect(contrastRatio(white, white)).toBe(1);
        // #777777 on white is the textbook near-miss: 4.47, not 4.5.
        expect(contrastRatio(parseCssColor("#777777")!, white)).toBeCloseTo(4.48, 2);
        expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    });

    it("composites alpha and opacity onto the background", () => {
        expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, white)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
        expect(composite(black, white, 0.06)).toEqual({ r: 240, g: 240, b: 240, a: 1 });
    });
});

describe("requiredRatio", () => {
    it("applies WCAG 2.2 AA's text and non-text thresholds", () => {
        expect(requiredRatio("text", 16, 400)).toBe(4.5);
        expect(requiredRatio("text", 24, 400)).toBe(3);
        expect(requiredRatio("text", 19, 700)).toBe(3);
        expect(requiredRatio("text", 19, 400)).toBe(4.5);
        expect(requiredRatio("icon")).toBe(3);
    });
});

describe("dominantColor", () => {
    it("picks the most common colour, not the mean", () => {
        const pixels: RGBA[] = [...Array(90).fill(white), ...Array(10).fill(black)];
        expect(toHex(dominantColor(pixels)!)).toBe("#ffffff");
    });

    it("absorbs small anti-aliasing noise within a bucket", () => {
        const pixels: RGBA[] = [white, { r: 253, g: 254, b: 255, a: 1 }, { r: 254, g: 255, b: 253, a: 1 }];
        const c = dominantColor(pixels)!;
        expect(contrastRatio(c, white)).toBeLessThan(1.02);
    });

    it("is undefined for no pixels", () => {
        expect(dominantColor([])).toBeUndefined();
    });
});
