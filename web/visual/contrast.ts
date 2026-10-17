// Colour maths for the visual contrast audit (visual/audit.visual.ts) —
// 2026-10-17, after a real-device report that parts of the UI were hard to
// see on the phone. Pure functions only, so they're unit-tested in the
// normal suite (test/contrast.test.ts); the audit itself needs a real
// browser engine and runs separately (`npm run test:visual`).
//
// Thresholds are WCAG 2.2's, which Apple's HIG and its App Store
// "Sufficient Contrast" criteria both point to:
// - 1.4.3 Contrast (Minimum): 4.5:1 for text, 3:1 for large text
//   (≥ 24px, or ≥ 18.66px at bold weight).
// - 1.4.11 Non-text Contrast: 3:1 for icons and other UI graphics.
// The HIG additionally asks for 7:1 on custom colours in small text, which
// the audit reports as advice, not failure.

export interface RGBA {
    r: number; // 0–255
    g: number;
    b: number;
    a: number; // 0–1
}

export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

/** Parses what WebKit's getComputedStyle returns for colours: `rgb()`,
 * `rgba()`, `color(srgb r g b / a)` (how color-mix() results serialize),
 * hex, and `transparent`. Anything else is `undefined` — the audit
 * reports that rather than guessing. */
export function parseCssColor(value: string): RGBA | undefined {
    const v = value.trim().toLowerCase();
    if (v === "transparent") return TRANSPARENT;

    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
    if (rgb) {
        return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: parseAlpha(rgb[4]) };
    }

    const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
    if (srgb) {
        const ch = (s: string) => Math.round(Math.min(1, Math.max(0, Number(s))) * 255);
        return { r: ch(srgb[1]), g: ch(srgb[2]), b: ch(srgb[3]), a: parseAlpha(srgb[4]) };
    }

    const hex = /^#([0-9a-f]{3,8})$/.exec(v);
    if (hex) {
        let h = hex[1];
        if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
        if (h.length !== 6 && h.length !== 8) return undefined;
        const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
        return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
    }
    return undefined;
}

function parseAlpha(s: string | undefined): number {
    if (s === undefined) return 1;
    return s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s);
}

/** Source-over compositing of `fg` (with its alpha, times `opacity`) onto an
 * opaque `bg`. */
export function composite(fg: RGBA, bg: RGBA, opacity = 1): RGBA {
    const a = fg.a * opacity;
    const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
    return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(c: RGBA): number {
    const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2.x contrast ratio, 1–21. Opaque colours expected — composite first. */
export function contrastRatio(a: RGBA, b: RGBA): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type ElementKind = "text" | "icon";

/** WCAG 2.2 AA minimum for this element. Large text: ≥ 24px, or ≥ 18.66px
 * (14pt) at weight ≥ 700. */
export function requiredRatio(kind: ElementKind, fontSizePx = 16, fontWeight = 400): number {
    if (kind === "icon") return 3;
    const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
    return large ? 3 : 4.5;
}

/** The background behind a text run, from screenshot pixels with the text
 * itself made transparent: the most common colour (quantized to absorb
 * anti-aliasing and blur noise), then the exact average within that bucket.
 * Most-common rather than mean so a border or a neighbouring line in the
 * sampled box can't drag the result towards a colour that isn't actually
 * behind the glyphs. */
export function dominantColor(pixels: Iterable<RGBA>): RGBA | undefined {
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (const p of pixels) {
        const key = ((p.r >> 3) << 10) | ((p.g >> 3) << 5) | (p.b >> 3);
        const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        bucket.n += 1;
        bucket.r += p.r;
        bucket.g += p.g;
        bucket.b += p.b;
        buckets.set(key, bucket);
    }
    let best: { n: number; r: number; g: number; b: number } | undefined;
    for (const bucket of buckets.values()) {
        if (!best || bucket.n > best.n) best = bucket;
    }
    if (!best) return undefined;
    return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n), a: 1 };
}

export function toHex(c: RGBA): string {
    const h = (v: number) => v.toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
