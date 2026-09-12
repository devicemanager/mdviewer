// Ported 1:1 from MDViewer/Models/MarkdownTheme.swift. PDFPageSize lives in
// that same Swift file (an odd co-location — unrelated to themes — kept here
// to mirror the source rather than "fixing" the file boundary).

export type PDFPageSizeId = "a4" | "letter" | "a3";

export interface PDFPageSize {
    id: PDFPageSizeId;
    displayName: string;
    cssSize: string;
    /** 1pt = 1/72 inch, 1mm = 72/25.4 pt */
    pointSize: { width: number; height: number };
}

export const pdfPageSizes: Record<PDFPageSizeId, PDFPageSize> = {
    a4: {
        id: "a4",
        displayName: "A4",
        cssSize: "210mm 297mm",
        pointSize: { width: 595.28, height: 841.89 },
    },
    letter: {
        id: "letter",
        displayName: "Letter",
        cssSize: "8.5in 11in",
        pointSize: { width: 612.0, height: 792.0 },
    },
    a3: {
        id: "a3",
        displayName: "A3",
        cssSize: "297mm 420mm",
        pointSize: { width: 841.89, height: 1190.55 },
    },
};

export interface MarkdownTheme {
    id: string;
    displayName: string;
    cssFileName: string;
    isDark: boolean;
}

export const themes: MarkdownTheme[] = [
    { id: "github-light", displayName: "GitHub Light", cssFileName: "github-light", isDark: false },
    { id: "github-dark", displayName: "GitHub Dark", cssFileName: "github-dark", isDark: true },
    { id: "solarized-light", displayName: "Solarized Light", cssFileName: "solarized-light", isDark: false },
    { id: "solarized-dark", displayName: "Solarized Dark", cssFileName: "solarized-dark", isDark: true },
    { id: "dracula", displayName: "Dracula", cssFileName: "dracula", isDark: true },
    { id: "nord", displayName: "Nord", cssFileName: "nord", isDark: true },
];

export const githubLight: MarkdownTheme = themes[0];
export const githubDark: MarkdownTheme = themes[1];

export function findTheme(id: string): MarkdownTheme | undefined {
    return themes.find((theme) => theme.id === id);
}
