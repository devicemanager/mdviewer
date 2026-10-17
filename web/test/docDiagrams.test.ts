// Colour check for the Mermaid diagrams in docs/ — added 2026-10-17 after
// the hand-drawn diagram palette turned out to be invisible in some themes
// (blue/red/purple outlines under 2:1 on Solarized Light, coloured group
// titles failing almost everywhere). MDViewer renders these docs in any of
// its six themes, so every colour a diagram sets itself has to work on
// every theme's background:
//
// - `stroke:` (outlines) ≥ 3:1, WCAG 2.2 SC 1.4.11 non-text contrast;
// - `color:` (text) ≥ 4.5:1;
// - `fill:` and sequence-diagram `box` colours are composited over the
//   theme background, and the theme's own text colour must still reach
//   4.5:1 on the result (when the style sets no `color:` of its own).
//
// Theme colours are read from the theme stylesheets themselves, so a new
// theme is covered automatically. Text the diagram *doesn't* colour follows
// the theme and is measured in real WebKit by the visual audit's
// doc-diagrams state.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseCssColor, composite, contrastRatio, toHex, type RGBA } from "../visual/contrast.js";

const REPO = resolve(__dirname, "../..");
const THEMES_DIR = join(REPO, "MDViewer/Resources/Web/themes");
const DOCS_DIR = join(REPO, "docs");

interface ThemeColors {
    id: string;
    bg: RGBA;
    text: RGBA;
}

function themeToken(css: string, token: string): RGBA | undefined {
    const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(css);
    return m ? parseCssColor(m[1]) : undefined;
}

function loadThemes(): ThemeColors[] {
    return readdirSync(THEMES_DIR)
        .filter((f) => f.endsWith(".css"))
        .map((f) => {
            const css = readFileSync(join(THEMES_DIR, f), "utf8");
            const bg = themeToken(css, "--bg-color");
            const text = themeToken(css, "--text-color");
            if (!bg || !text) throw new Error(`${f}: missing --bg-color or --text-color`);
            return { id: f.replace(/\.css$/, ""), bg, text };
        });
}

function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return markdownFiles(path);
        return name.endsWith(".md") ? [path] : [];
    });
}

export interface DiagramColor {
    property: "stroke" | "color" | "fill" | "box";
    value: string;
    /** For fills: the `color:` set in the same style, if any. */
    textColor?: string;
    where: string;
}

/** Every colour a Mermaid diagram sets itself: `classDef`/`style` lines and sequence `box` groups. */
export function diagramColors(source: string, where: string): DiagramColor[] {
    const out: DiagramColor[] = [];
    for (const raw of source.split("\n")) {
        const line = raw.trim();
        const styleLine = /^(?:classDef|style)\s+\S+\s+(.+)$/.exec(line);
        if (styleLine) {
            const props = new Map(
                styleLine[1].split(",").map((p) => {
                    const i = p.indexOf(":");
                    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
                }),
            );
            const at = `${where}: ${line}`;
            const stroke = props.get("stroke");
            const color = props.get("color");
            const fill = props.get("fill");
            if (stroke && stroke !== "none") out.push({ property: "stroke", value: stroke, where: at });
            if (color) out.push({ property: "color", value: color, where: at });
            if (fill && fill !== "none" && fill !== "transparent") out.push({ property: "fill", value: fill, textColor: color, where: at });
            continue;
        }
        const box = /^box\s+(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(line);
        if (box) out.push({ property: "box", value: box[1], where: `${where}: ${line}` });
    }
    return out;
}

const themes = loadThemes();
const diagrams = markdownFiles(DOCS_DIR).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m, i) => ({
        name: `${relative(REPO, file)} #${i + 1}`,
        source: m[1],
    })),
);

describe("diagramColors", () => {
    it("reads classDef, style and box colours", () => {
        const colors = diagramColors(
            [
                "classDef web fill:#56a2e826,stroke:#2888e2,stroke-width:2px",
                "style views fill:none,stroke:#63931f,color:#123456",
                "box rgba(86, 162, 232, 0.15) System webview",
                "A --> B",
            ].join("\n"),
            "t",
        );
        expect(colors.map((c) => `${c.property}=${c.value}`)).toEqual([
            "stroke=#2888e2",
            "fill=#56a2e826",
            "stroke=#63931f",
            "color=#123456",
            "box=rgba(86, 162, 232, 0.15)",
        ]);
    });
});

describe("diagram colours in docs/ work in every theme", () => {
    it("finds the themes and the diagrams", () => {
        expect(themes.length).toBeGreaterThanOrEqual(6);
        expect(diagrams.length).toBeGreaterThan(0);
    });

    it.each(diagrams)("$name", ({ name, source }) => {
        const problems: string[] = [];
        for (const c of diagramColors(source, name)) {
            const parsed = parseCssColor(c.value);
            if (!parsed) {
                problems.push(`unreadable colour "${c.value}" — ${c.where}`);
                continue;
            }
            for (const t of themes) {
                if (c.property === "stroke" || c.property === "color") {
                    const shown = composite(parsed, t.bg);
                    const ratio = contrastRatio(shown, t.bg);
                    const required = c.property === "stroke" ? 3 : 4.5;
                    if (ratio < required) problems.push(`${t.id}: ${c.property} ${c.value} is ${ratio.toFixed(2)}:1 < ${required}:1 on ${toHex(t.bg)} — ${c.where}`);
                } else {
                    const surface = composite(parsed, t.bg);
                    const text = c.textColor ? parseCssColor(c.textColor) : t.text;
                    if (!text) continue; // reported above as an unreadable `color:`
                    const ratio = contrastRatio(composite(text, surface), surface);
                    if (ratio < 4.5) problems.push(`${t.id}: text ${toHex(composite(text, surface))} on ${c.property} ${toHex(surface)} is ${ratio.toFixed(2)}:1 < 4.5:1 — ${c.where}`);
                }
            }
        }
        expect(problems).toEqual([]);
    });
});
