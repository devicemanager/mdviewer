// Ported from MDViewer/App/MDViewerApp.swift's `AboutPanel` — the macOS
// About panel's Credits area, which v1.2.1 added so the third-party
// notices ship *inside* the app (as MIT / Apache / MPL expect) rather than
// only in the source repository (see changelog.md's 1.2.1 entry). The
// TypeScript port had no equivalent until 2026-10-17, found while
// preparing the first iOS App Store submission: every OTA build until then
// shipped the vendored libraries with no notices anywhere in the app.
//
// iOS has no standard About panel to hang this on, so it renders as the
// Preferences modal's "About" tab (preferences.ts) — the one settings
// surface this port has, on every platform.
//
// `ACKNOWLEDGEMENTS` is Swift's string verbatim except for the version
// numbers, which track the vendored libraries (KaTeX and DOMPurify moved
// on 2026-10-17; the Swift copy didn't). They're pinned by a test against
// the vendored libraries
// (test/aboutPanel.test.ts) — the Swift copy went stale exactly this way
// once (porting-brief.md's "Known follow-up"), so the port checks instead
// of trusting.

import { escapeHtml } from "./dom.js";

export const ACKNOWLEDGEMENTS = `MDViewer is open source under the MIT License. Originally created by Masanori Sakai (@Masakai); this fork is maintained by @devicemanager, adding a Quick Look preview extension and security hardening.

Third-party libraries

marked 18.0.6 — MIT
  Copyright (c) 2018-2026 MarkedJS; (c) 2011-2018 Christopher Jeffrey
  https://github.com/markedjs/marked

Shiki 4.3.1 — MIT
  Copyright (c) 2021 Pine Wu; (c) 2023 Anthony Fu
  https://github.com/shikijs/shiki

KaTeX 0.18.11 — MIT (fonts under SIL Open Font License 1.1)
  Copyright (c) 2013-2020 Khan Academy and other contributors
  https://github.com/KaTeX/KaTeX

Mermaid 11.17.2 — MIT
  Copyright (c) 2014-2024 Knut Sveidqvist and contributors
  https://github.com/mermaid-js/mermaid

DOMPurify 3.4.17 — Apache-2.0 OR MPL-2.0
  Copyright (c) Cure53 and other contributors
  https://github.com/cure53/DOMPurify

The MIT-licensed components above are provided under the following terms:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

DOMPurify is dual-licensed under Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0) or MPL-2.0 (https://www.mozilla.org/MPL/2.0/).

Full copyright notices and license texts:
https://github.com/devicemanager/mdviewer/blob/main/THIRD_PARTY_NOTICES.md`;

/** The About pane's inner HTML. `version` is filled in later by main.ts
 * (`updateAboutVersion`) once Tauri reports it — rendering doesn't wait
 * on an `invoke`, same as every other Preferences value. */
export function aboutPaneHTML(): string {
    return `
        <p class="prefs-about-title">MDViewer <span data-app-version></span></p>
        <pre class="prefs-credits">${escapeHtml(ACKNOWLEDGEMENTS)}</pre>
    `;
}

export function updateAboutVersion(root: HTMLElement, version: string): void {
    const el = root.querySelector<HTMLElement>("[data-app-version]");
    if (el) el.textContent = version;
}
