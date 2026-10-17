"use strict";
(() => {
  // src/dom.ts
  function slugify(text) {
    return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  }
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/markedRenderer.ts
  function renderHeading(token, parseInline) {
    const plain = token.text != null ? String(token.text) : "";
    const inner = token.tokens ? parseInline(token.tokens) : plain;
    const anchor = slugify(plain);
    return {
      html: `<h${token.depth} id="${anchor}">${inner}</h${token.depth}>
`,
      heading: { level: token.depth, title: plain, anchor }
    };
  }
  function renderCode(token, highlightCode2) {
    const code = token.text != null ? token.text : "";
    const lang = (token.lang || "").trim().split(/\s+/)[0];
    if (lang === "mermaid") {
      return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }
    return highlightCode2(code, lang);
  }

  // src/math.ts
  function blockPlaceholder(index) {
    return `MATHBLOCK_${index}_END`;
  }
  function inlinePlaceholder(index) {
    return `MATHINLINE_${index}_END`;
  }
  function protectMath(markdown) {
    const blocks = [];
    let processed = markdown.replace(/\$\$([^$]+?)\$\$/gs, function(_m, expr) {
      const placeholder = blockPlaceholder(blocks.length);
      blocks.push({ type: "block", expr: expr.trim() });
      return placeholder;
    });
    processed = processed.replace(/\$([^$\n]+?)\$/g, function(_m, expr) {
      const placeholder = inlinePlaceholder(blocks.length);
      blocks.push({ type: "inline", expr: expr.trim() });
      return placeholder;
    });
    return { processed, blocks };
  }
  function restoreMath(html, blocks, katex) {
    let result = html;
    blocks.forEach((block, index) => {
      const blockPattern = new RegExp(blockPlaceholder(index), "g");
      const inlinePattern = new RegExp(inlinePlaceholder(index), "g");
      let rendered;
      try {
        rendered = katex.renderToString(block.expr, {
          displayMode: block.type === "block",
          throwOnError: false
        });
      } catch {
        rendered = escapeHtml(block.expr);
      }
      result = result.replace(blockPattern, rendered).replace(inlinePattern, rendered);
    });
    return result;
  }

  // src/highlightCode.ts
  function fallback(code, lang) {
    const label = lang ? `<span class="code-lang-label">${escapeHtml(lang)}</span>` : "";
    return `<div class="code-block-wrapper">${label}<pre><code>${escapeHtml(code)}</code></pre></div>`;
  }
  function highlightCode(code, lang, highlighter) {
    if (!highlighter) return fallback(code, lang);
    try {
      const loaded = highlighter.getLoadedLanguages();
      const resolvedLang = loaded.includes(lang) ? lang : "text";
      const html = highlighter.codeToHtml(code, {
        lang: resolvedLang,
        themes: { light: "github-light", dark: "github-dark" }
      });
      if (lang) {
        return html.replace("<pre ", `<div class="code-block-wrapper"><span class="code-lang-label">${escapeHtml(lang)}</span><pre `).replace("</pre>", "</pre></div>");
      }
      return html;
    } catch {
      return fallback(code, lang);
    }
  }

  // src/sanitize.ts
  var SANITIZE_CONFIG = {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcset", "formaction", "ping"]
  };
  function sanitizeHtml(html, domPurify) {
    return domPurify.sanitize(html, SANITIZE_CONFIG);
  }

  // src/emoji.ts
  var emojiMap = {
    "+1": "\u{1F44D}",
    "-1": "\u2716\uFE0F",
    white_check_mark: "\u2714\uFE0F",
    grinning: "\u{1F600}",
    smiley: "\u{1F603}",
    smile: "\u{1F604}",
    grin: "\u{1F601}",
    laughing: "\u{1F606}",
    sweat_smile: "\u{1F605}",
    joy: "\u{1F602}",
    wink: "\u{1F609}",
    blush: "\u{1F60A}",
    yum: "\u{1F60B}",
    sunglasses: "\u{1F60E}",
    heart: "\u2764",
    orange_heart: "\u{1F9E1}",
    yellow_heart: "\u{1F49B}",
    green_heart: "\u{1F49A}",
    blue_heart: "\u{1F499}",
    purple_heart: "\u{1F49C}",
    broken_heart: "\u{1F494}",
    thinking: "\u{1F914}",
    neutral_face: "\u{1F610}",
    expressionless: "\u{1F611}",
    no_mouth: "\u{1F636}",
    smirk: "\u{1F60F}",
    unamused: "\u{1F612}",
    sweat: "\u{1F613}",
    pensive: "\u{1F614}",
    confused: "\u{1F615}",
    confounded: "\u{1F616}",
    kissing: "\u{1F617}",
    kissing_heart: "\u{1F618}",
    kissing_smiling_eyes: "\u{1F619}",
    kissing_closed_eyes: "\u{1F61A}",
    stuck_out_tongue: "\u{1F61B}",
    stuck_out_tongue_winking_eye: "\u{1F61C}",
    stuck_out_tongue_closed_eyes: "\u{1F61D}",
    angry: "\u{1F620}",
    rage: "\u{1F621}",
    cry: "\u{1F622}",
    persevere: "\u{1F623}",
    triumph: "\u{1F624}",
    disappointed: "\u{1F625}",
    worried: "\u{1F61F}",
    zealous: "\u{1F97A}",
    imp: "\u{1F47F}",
    skull: "\u{1F480}",
    ghost: "\u{1F47B}",
    alien: "\u{1F47D}",
    robot: "\u{1F916}",
    poop: "\u{1F4A9}",
    shushing_face: "\u{1F92D}",
    notes: "\u{1F3B6}",
    muscle: "\u{1F4AA}",
    hand_wave: "\u{1F44B}",
    raised_hands: "\u{1F64C}",
    clap: "\u{1F44F}",
    writing_hand: "\u270D",
    pray: "\u{1F64F}",
    rocket: "\u{1F680}",
    check_mark_button: "\u2714\uFE0F",
    fire: "\u{1F525}",
    sparkles: "\u2728",
    star: "\u2B50",
    sunrise_over_mountains: "\u{1F305}",
    snowflake: "\u2744\uFE0F",
    zap: "\u26A1",
    evergreen_tree: "\u{1F332}",
    deciduous_tree: "\u{1F333}",
    flower: "\u{1F338}",
    coffee: "\u2615",
    pizza: "\u{1F355}",
    beer: "\u{1F37A}",
    musical_note: "\u{1F3B5}",
    calendar: "\u{1F4C5}",
    lightbulb: "\u{1F4A1}",
    email: "\u2709\uFE0F",
    link: "\u{1F517}",
    eye: "\u{1F441}",
    thumbs_up: "\u{1F44D}",
    thumbs_down: "\u{1F44E}",
    warning: "\u26A0\uFE0F",
    lock: "\u{1F512}",
    open_lock: "\u{1F513}",
    gear: "\u2699\uFE0F",
    bookmark: "\u{1F516}",
    wrench: "\u{1F527}",
    clipboard: "\u{1F4CB}",
    chart_with_upwards_trend: "\u{1F4C8}",
    pencil: "\u270F\uFE0F",
    package: "\u{1F4E6}",
    telescope: "\u{1F52D}",
    bell: "\u{1F514}",
    key: "\u{1F511}",
    money_with_wings: "\u{1F4B8}",
    gift: "\u{1F381}",
    confetti_ball: "\u{1F389}",
    trophy: "\u{1F3C6}",
    medal: "\u{1F3C5}",
    megaphone: "\u{1F4E2}",
    inbox_tray: "\u{1F4E5}",
    telephone_receiver: "\u260E\uFE0F",
    mobile_phone: "\u{1F4F1}",
    laptop: "\u{1F4BB}",
    desktop_computer: "\u{1F5A5}\uFE0F",
    printer: "\u{1F5A8}\uFE0F",
    keyboard: "\u2328\uFE0F",
    game_die: "\u{1F3B2}",
    watch: "\u231A",
    tv: "\u{1F4FA}",
    camera: "\u{1F4F7}",
    movie_camera: "\u{1F3AC}",
    globe_showing_americas: "\u{1F30E}",
    map: "\u{1F5FA}\uFE0F",
    compass: "\u{1F9ED}"
  };
  function resolveEmoji(str) {
    return str.replace(/:([\w+-]+):/g, function(match, code) {
      return emojiMap[code] || match;
    });
  }

  // src/remote.ts
  function gateRemoteResourcesInHTML(htmlString, policy) {
    if (policy === "always") {
      return { html: htmlString, blockedCount: 0 };
    }
    let blockedCount = 0;
    const html = htmlString.replace(
      /(<img\b[^>]*?)\ssrc=(["'])(https?:\/\/[^"']*)\2/gi,
      function(_m, pre, q, url) {
        blockedCount++;
        return pre + " data-mdv-remote=" + q + url + q;
      }
    );
    return { html, blockedCount };
  }
  function loadRemoteResources(root, baseURI) {
    root.querySelectorAll("img[data-mdv-remote]").forEach(function(img) {
      const remoteSrc = img.getAttribute("data-mdv-remote");
      if (remoteSrc) {
        try {
          const parsed = new URL(remoteSrc, baseURI);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            img.setAttribute("src", parsed.href);
          }
        } catch {
        }
      }
      img.removeAttribute("data-mdv-remote");
    });
  }

  // src/localResources.ts
  function isAbsolute(src) {
    return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#");
  }
  function rewriteLocalResources(root, localBaseURL) {
    if (!localBaseURL) {
      return;
    }
    root.querySelectorAll("img[src]").forEach(function(img) {
      const src = img.getAttribute("src");
      if (!src || isAbsolute(src)) {
        return;
      }
      const encoded = src.split("/").map(encodeURIComponent).join("/");
      const path = encoded.startsWith("/") ? encoded.slice(1) : encoded;
      img.setAttribute("src", localBaseURL + path);
    });
  }

  // src/mermaid.ts
  var DARK_THEME_VARIABLES = {
    primaryTextColor: "#e6e6e6",
    // flowchart node and edge labels: 5.7:1 on #585858
    textColor: "#e6e6e6",
    gitBranchLabel0: "#111111",
    // "main" label on its #797d7d swatch: 4.9:1
    noteTextColor: "#e6e6e6"
    // sequence-diagram notes: #b8b6b6 on #474949 was 4.49:1, now 7.3:1
  };
  function initializeMermaid(mermaid, isDark) {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose",
      ...isDark ? { themeVariables: DARK_THEME_VARIABLES } : {}
    });
  }
  function runMermaidDiagrams(mermaid) {
    try {
      mermaid.run({ querySelector: ".mermaid" });
    } catch (e) {
      console.warn("Mermaid render error:", e);
    }
  }
  function rememberMermaidSources(root) {
    for (const el of root.querySelectorAll(".mermaid")) {
      if (el.dataset.mermaidSource === void 0) el.dataset.mermaidSource = el.textContent ?? "";
    }
  }
  function rerenderMermaidDiagrams(mermaid, root) {
    const diagrams = [...root.querySelectorAll(".mermaid[data-mermaid-source]")];
    if (diagrams.length === 0) return;
    for (const el of diagrams) {
      el.textContent = el.dataset.mermaidSource ?? "";
      el.removeAttribute("data-processed");
    }
    runMermaidDiagrams(mermaid);
  }

  // src/markdownTheme.ts
  var pdfPageSizes = {
    a4: {
      id: "a4",
      displayName: "A4",
      cssSize: "210mm 297mm",
      pointSize: { width: 595.28, height: 841.89 }
    },
    letter: {
      id: "letter",
      displayName: "Letter",
      cssSize: "8.5in 11in",
      pointSize: { width: 612, height: 792 }
    },
    a3: {
      id: "a3",
      displayName: "A3",
      cssSize: "297mm 420mm",
      pointSize: { width: 841.89, height: 1190.55 }
    }
  };
  var themes = [
    { id: "github-light", displayName: "GitHub Light", cssFileName: "github-light", isDark: false },
    { id: "github-dark", displayName: "GitHub Dark", cssFileName: "github-dark", isDark: true },
    { id: "solarized-light", displayName: "Solarized Light", cssFileName: "solarized-light", isDark: false },
    { id: "solarized-dark", displayName: "Solarized Dark", cssFileName: "solarized-dark", isDark: true },
    { id: "dracula", displayName: "Dracula", cssFileName: "dracula", isDark: true },
    { id: "nord", displayName: "Nord", cssFileName: "nord", isDark: true }
  ];
  var githubLight = themes[0];
  var githubDark = themes[1];
  function findTheme(id) {
    return themes.find((theme) => theme.id === id);
  }

  // src/mdviewerApi.ts
  function createMDViewerApi(deps) {
    let localBaseURL;
    let remoteContentPolicy = "ask";
    let shikiHighlighter;
    return {
      async setContent(markdown) {
        if (!shikiHighlighter && deps.shikiReady) {
          shikiHighlighter = await Promise.race([
            deps.shikiReady,
            new Promise((resolve) => setTimeout(() => resolve(void 0), 8e3))
          ]);
        }
        const headings = [];
        const renderer = new deps.marked.Renderer();
        renderer.heading = function(token) {
          const result = renderHeading(token, (tokens) => this.parser.parseInline(tokens));
          headings.push(result.heading);
          return result.html;
        };
        renderer.code = function(token) {
          return renderCode(token, (code, lang) => highlightCode(code, lang, shikiHighlighter));
        };
        const { processed, blocks } = protectMath(markdown);
        let html = deps.marked.parse(processed, { renderer, async: false });
        html = sanitizeHtml(html, deps.domPurify);
        html = restoreMath(html, blocks, deps.katex);
        html = resolveEmoji(html);
        const gated = gateRemoteResourcesInHTML(html, remoteContentPolicy);
        const contentEl = document.getElementById("content");
        if (contentEl) {
          contentEl.innerHTML = gated.html;
          rewriteLocalResources(contentEl, localBaseURL ?? null);
          rememberMermaidSources(contentEl);
          runMermaidDiagrams(deps.mermaid);
        }
        return { headings, blockedRemoteCount: gated.blockedCount };
      },
      setTheme(themeName) {
        const link = document.getElementById("theme-css");
        if (link) {
          link.href = `themes/${themeName}.css`;
        }
        const isDark = themes.find((t) => t.cssFileName === themeName)?.isDark ?? themeName.includes("dark");
        document.body.classList.toggle("dark-theme", isDark);
        initializeMermaid(deps.mermaid, isDark);
        const contentEl = document.getElementById("content");
        if (contentEl) rerenderMermaidDiagrams(deps.mermaid, contentEl);
      },
      setFontSize(size) {
        document.documentElement.style.setProperty("--font-size", `${size}px`);
      },
      scrollToAnchor(anchorId) {
        const el = document.getElementById(anchorId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("heading-anchor-target");
          setTimeout(() => {
            el.classList.remove("heading-anchor-target");
          }, 2e3);
        }
      },
      findText(text) {
        const win = window;
        if (win.find) {
          win.find(text, false, false, true, false, true, false);
        }
      },
      setBaseURL(url) {
        localBaseURL = url;
        const contentEl = document.getElementById("content");
        if (contentEl) {
          rewriteLocalResources(contentEl, localBaseURL);
        }
      },
      setRemoteContentPolicy(policy) {
        remoteContentPolicy = policy === "always" || policy === "never" ? policy : "ask";
      },
      loadRemoteResources() {
        loadRemoteResources(document, document.baseURI);
      }
    };
  }

  // src/interactionListeners.ts
  function closestLink(target) {
    if (!target || !(target instanceof Element)) {
      return null;
    }
    return target.closest("a[href]");
  }
  function attachInteractionListeners(callbacks) {
    let scrollTimer;
    window.addEventListener("scroll", () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        callbacks.onScroll?.({ y: window.scrollY, height: document.body.scrollHeight });
      }, 100);
    });
    document.addEventListener("mouseover", (e) => {
      const link = closestLink(e.target);
      if (link) {
        callbacks.onLinkHovered?.(link.href || "");
      }
    });
    document.addEventListener("mouseout", (e) => {
      const link = closestLink(e.target);
      if (link) {
        callbacks.onLinkHovered?.("");
      }
    });
    document.addEventListener("click", (e) => {
      const link = closestLink(e.target);
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) return;
      e.preventDefault();
      callbacks.onLinkClicked?.(link.href);
    });
  }

  // src/appShell.ts
  function showContent(elements) {
    elements.welcome.hidden = true;
    elements.content.hidden = false;
  }
  function showWelcome(elements) {
    elements.content.hidden = true;
    elements.welcome.hidden = false;
  }

  // src/errorForwarding.ts
  var MAX_FORWARDED = 50;
  var MAX_MESSAGE_LENGTH = 2e3;
  function formatErrorEvent(event) {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    const stack = event.error instanceof Error && event.error.stack ? `
${event.error.stack}` : "";
    return truncate(`error: ${event.message}${where}${stack}`);
  }
  function formatRejection(reason) {
    if (reason instanceof Error) {
      return truncate(`unhandled rejection: ${reason.message}${reason.stack ? `
${reason.stack}` : ""}`);
    }
    let text;
    try {
      text = typeof reason === "string" ? reason : JSON.stringify(reason) ?? String(reason);
    } catch {
      text = String(reason);
    }
    return truncate(`unhandled rejection: ${text}`);
  }
  function truncate(text) {
    return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}\u2026 [truncated]` : text;
  }
  function wireErrorForwarding(target, send) {
    let forwarded = 0;
    function forward(message) {
      if (forwarded > MAX_FORWARDED) return;
      forwarded += 1;
      const text = forwarded > MAX_FORWARDED ? `further errors suppressed after ${MAX_FORWARDED}` : message;
      try {
        send(text).catch(() => {
        });
      } catch {
      }
    }
    target.addEventListener("error", (event) => {
      forward(formatErrorEvent(event));
    });
    target.addEventListener("unhandledrejection", (event) => {
      forward(formatRejection(event.reason));
    });
  }

  // src/aboutPanel.ts
  var ACKNOWLEDGEMENTS = `MDViewer is open source under the MIT License. Originally created by Masanori Sakai (@Masakai); this fork is maintained by @devicemanager, adding a Quick Look preview extension and security hardening.

Third-party libraries

marked 18.0.6 \u2014 MIT
  Copyright (c) 2018-2026 MarkedJS; (c) 2011-2018 Christopher Jeffrey
  https://github.com/markedjs/marked

Shiki 4.3.1 \u2014 MIT
  Copyright (c) 2021 Pine Wu; (c) 2023 Anthony Fu
  https://github.com/shikijs/shiki

KaTeX 0.18.11 \u2014 MIT (fonts under SIL Open Font License 1.1)
  Copyright (c) 2013-2020 Khan Academy and other contributors
  https://github.com/KaTeX/KaTeX

Mermaid 11.17.2 \u2014 MIT
  Copyright (c) 2014-2024 Knut Sveidqvist and contributors
  https://github.com/mermaid-js/mermaid

DOMPurify 3.4.17 \u2014 Apache-2.0 OR MPL-2.0
  Copyright (c) Cure53 and other contributors
  https://github.com/cure53/DOMPurify

The MIT-licensed components above are provided under the following terms:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

DOMPurify is dual-licensed under Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0) or MPL-2.0 (https://www.mozilla.org/MPL/2.0/).

Full copyright notices and license texts:
https://github.com/devicemanager/mdviewer/blob/main/THIRD_PARTY_NOTICES.md`;
  function aboutPaneHTML() {
    return `
        <p class="prefs-about-title">MDViewer <span data-app-version></span></p>
        <pre class="prefs-credits">${escapeHtml(ACKNOWLEDGEMENTS)}</pre>
    `;
  }
  function updateAboutVersion(root, version) {
    const el = root.querySelector("[data-app-version]");
    if (el) el.textContent = version;
  }

  // src/drawer.ts
  function openDrawer(drawer, backdrop) {
    drawer.classList.add("open");
    backdrop?.classList.add("open");
  }
  function closeDrawer(drawer, backdrop) {
    drawer.classList.remove("open");
    backdrop?.classList.remove("open");
  }
  function toggleDrawer(drawer, backdrop) {
    if (drawer.classList.contains("open")) {
      closeDrawer(drawer, backdrop);
    } else {
      openDrawer(drawer, backdrop);
    }
  }

  // src/toolbar.ts
  var ICON_BROWSE = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5a1 1 0 0 1 1-1h4l1.5 2h6.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8Z"/><path d="M2.5 9.5h15"/></svg>`;
  var ICON_OPEN = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2H16.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9.5Z"/></svg>`;
  var ICON_FIND = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="16.5" y1="16.5" x2="12.6" y2="12.6"/></svg>`;
  var ICON_PREFERENCES = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"/></svg>`;
  function renderToolbar(toolbar) {
    toolbar.innerHTML = `
        <span class="toolbar-icon-group">
            <button type="button" data-action="file-browser-toggle" class="icon-btn" aria-label="Browse files">${ICON_BROWSE}</button>
            <button type="button" data-action="open" class="icon-btn" aria-label="Open\u2026">${ICON_OPEN}</button>
        </span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-icon-group">
            <button type="button" data-action="find" class="icon-btn" aria-label="Find">${ICON_FIND}</button>
            <button type="button" data-action="preferences" class="icon-btn" aria-label="Preferences">${ICON_PREFERENCES}</button>
        </span>
    `;
  }
  function attachToolbarHandlers(toolbar, callbacks) {
    toolbar.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!button) return;
      switch (button.dataset.action) {
        case "file-browser-toggle":
          callbacks.onToggleFileBrowser();
          break;
        case "open":
          callbacks.onOpen();
          break;
        case "preferences":
          callbacks.onPreferences();
          break;
        case "find":
          callbacks.onFind();
          break;
      }
    });
  }

  // src/toolbarAutoHide.ts
  var DEFAULT_FADE_DELAY_MS = 2500;
  function showToolbar(toolbarEl) {
    toolbarEl.classList.remove("toolbar-faded");
  }
  function fadeToolbar(toolbarEl) {
    toolbarEl.classList.add("toolbar-faded");
  }
  function wireToolbarAutoHide(toolbarEl, sources, mobileQuery, fadeDelayMs = DEFAULT_FADE_DELAY_MS, canFade = () => true) {
    let fadeTimer;
    function wake() {
      if (!mobileQuery.matches) return;
      showToolbar(toolbarEl);
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        if (canFade()) fadeToolbar(toolbarEl);
      }, fadeDelayMs);
    }
    toolbarEl.addEventListener(
      "click",
      (event) => {
        if (toolbarEl.classList.contains("toolbar-faded")) {
          event.preventDefault();
          event.stopPropagation();
        }
        wake();
      },
      { capture: true }
    );
    for (const { target, type } of sources) {
      target.addEventListener(type, wake, { passive: true });
    }
    mobileQuery.addEventListener("change", () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      showToolbar(toolbarEl);
      wake();
    });
    wake();
  }

  // src/preferences.ts
  var TABS = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "privacy", label: "Privacy" },
    // 2026-10-17 — the port's home for v1.2.1's About-panel credits; see
    // aboutPanel.ts.
    { id: "about", label: "About" }
  ];
  var POLICY_OPTIONS = [
    { id: "ask", label: "Ask each time" },
    { id: "always", label: "Always load" },
    { id: "never", label: "Never (block)" }
  ];
  var PRIVACY_EXPLANATION = "Markdown files can reference images hosted online. Loading one reveals your IP address (and that you opened the document) to that server. \u201CAsk\u201D blocks them and prompts you per document; \u201CNever\u201D blocks them silently with no prompts.";
  function policyOptionsHTML(selected) {
    return POLICY_OPTIONS.map((o) => {
      const sel = o.id === selected ? " selected" : "";
      return `<option value="${o.id}"${sel}>${escapeHtml(o.label)}</option>`;
    }).join("");
  }
  function themeOptionsHTML(selectedThemeId) {
    return themes.map((theme) => {
      const selected = theme.id === selectedThemeId ? " selected" : "";
      return `<option value="${theme.id}"${selected}>${theme.displayName}</option>`;
    }).join("");
  }
  function tabsHTML(activeTab) {
    return TABS.map((t) => {
      const active = t.id === activeTab ? " active" : "";
      return `<button type="button" class="prefs-tab${active}" data-tab="${t.id}">${t.label}</button>`;
    }).join("");
  }
  function renderPreferences(root, initialPolicy, initialThemeId, initialFontSize, activeTab = "general") {
    root.innerHTML = `
        <div class="prefs-overlay">
            <div class="prefs-panel" role="dialog" aria-label="Preferences">
                <button type="button" class="prefs-close" aria-label="Close">\xD7</button>
                <div class="prefs-tabs">${tabsHTML(activeTab)}</div>
                <div class="prefs-content">
                    <div class="prefs-pane${activeTab === "general" ? " active" : ""}" data-pane="general">
                        <p class="prefs-placeholder">Not available yet.</p>
                    </div>
                    <div class="prefs-pane${activeTab === "appearance" ? " active" : ""}" data-pane="appearance">
                        <label class="prefs-field">
                            <span>Theme</span>
                            <select data-action="theme">${themeOptionsHTML(initialThemeId)}</select>
                        </label>
                        <div class="prefs-field">
                            <span>Font size</span>
                            <span class="segmented-control">
                                <button type="button" data-action="font-decrease" aria-label="Decrease font size">A\u2212</button>
                                <button type="button" data-action="font-reset" aria-label="Reset font size" data-font-size>${initialFontSize}</button>
                                <button type="button" data-action="font-increase" aria-label="Increase font size">A+</button>
                            </span>
                        </div>
                    </div>
                    <div class="prefs-pane${activeTab === "privacy" ? " active" : ""}" data-pane="privacy">
                        <label class="prefs-field">
                            <span>Internet images &amp; resources</span>
                            <select data-action="policy">${policyOptionsHTML(initialPolicy)}</select>
                        </label>
                        <p class="prefs-explanation">${PRIVACY_EXPLANATION}</p>
                    </div>
                    <div class="prefs-pane${activeTab === "about" ? " active" : ""}" data-pane="about">${aboutPaneHTML()}</div>
                </div>
            </div>
        </div>
    `;
  }
  function showPreferences(root) {
    root.hidden = false;
  }
  function hidePreferences(root) {
    root.hidden = true;
  }
  function updatePreferencesPolicy(root, policy) {
    const select = root.querySelector('select[data-action="policy"]');
    if (select) select.value = policy;
  }
  function updatePreferencesTheme(root, themeId) {
    const select = root.querySelector('select[data-action="theme"]');
    if (select) select.value = themeId;
  }
  function updatePreferencesFontSize(root, fontSize) {
    const el = root.querySelector("[data-font-size]");
    if (el) el.textContent = String(fontSize);
  }
  function attachPreferencesHandlers(root, callbacks) {
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const tabButton = target.closest("button[data-tab]");
      if (tabButton?.dataset.tab) {
        const tab = tabButton.dataset.tab;
        root.querySelectorAll(".prefs-tab").forEach((el) => {
          el.classList.toggle("active", el.dataset.tab === tab);
        });
        root.querySelectorAll(".prefs-pane").forEach((el) => {
          el.classList.toggle("active", el.dataset.pane === tab);
        });
        return;
      }
      if (target.closest(".prefs-close")) {
        callbacks.onClose();
        return;
      }
      if (target.classList.contains("prefs-overlay")) {
        callbacks.onClose();
        return;
      }
      const actionButton = target.closest("button[data-action]");
      switch (actionButton?.dataset.action) {
        case "font-decrease":
          callbacks.onFontDecrease();
          break;
        case "font-reset":
          callbacks.onFontReset();
          break;
        case "font-increase":
          callbacks.onFontIncrease();
          break;
      }
    });
    root.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.dataset.action === "theme") {
        const theme = themes.find((t) => t.id === target.value);
        if (theme) callbacks.onThemeChange(theme);
        return;
      }
      if (target.dataset.action !== "policy") return;
      callbacks.onPolicyChange(target.value);
    });
  }

  // src/search.ts
  function runFind(win, query) {
    return win.find(query, false, false, true, false, false, false);
  }
  function searchFromStart(win, query) {
    if (!query) return false;
    win.getSelection()?.removeAllRanges();
    return runFind(win, query);
  }
  function searchNext(win, query) {
    if (!query) return false;
    return runFind(win, query);
  }
  function renderSearchBar(container) {
    container.innerHTML = `
        <span class="search-icon" aria-hidden="true">\u2315</span>
        <input type="text" class="search-input" data-action="query" placeholder="Search" autocomplete="off" spellcheck="false">
        <button type="button" class="search-clear" data-action="clear" aria-label="Clear" hidden>\xD7</button>
        <button type="button" class="search-done" data-action="done">Done</button>
    `;
  }
  function showSearchBar(container) {
    container.hidden = false;
    container.querySelector(".search-input")?.focus();
  }
  function hideSearchBar(container) {
    container.hidden = true;
  }
  function updateSearchClearVisibility(container, query) {
    const clearButton = container.querySelector(".search-clear");
    if (clearButton) clearButton.hidden = query.length === 0;
  }
  var SEARCH_DEBOUNCE_MS = 200;
  function refocusInput(input) {
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }
  function attachSearchBarHandlers(container, callbacks) {
    const input = container.querySelector(".search-input");
    if (!input) return;
    let debounceTimer;
    input.addEventListener("input", () => {
      updateSearchClearVisibility(container, input.value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const query = input.value;
      debounceTimer = setTimeout(() => {
        callbacks.onQueryChange(query);
        refocusInput(input);
      }, SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (debounceTimer) clearTimeout(debounceTimer);
        callbacks.onSubmit(input.value);
        refocusInput(input);
      } else if (e.key === "Escape") {
        callbacks.onClose();
      }
    });
    container.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-action="clear"]')) {
        if (debounceTimer) clearTimeout(debounceTimer);
        input.value = "";
        updateSearchClearVisibility(container, "");
        callbacks.onQueryChange("");
        refocusInput(input);
        return;
      }
      if (target.closest('[data-action="done"]')) {
        callbacks.onClose();
      }
    });
  }

  // src/fileBrowser.ts
  function upRowHTML(parentPath2) {
    if (parentPath2 === null) return "";
    return '<li><button type="button" class="file-browser-item file-browser-up" data-action="up">.. (up one level)</button></li>';
  }
  function renderFileBrowser(container, state) {
    if (state.kind === "no-document") {
      container.innerHTML = '<div class="file-browser-empty"><p>Open a document to browse its folder.</p></div>';
      return;
    }
    const up = upRowHTML(state.parentPath);
    if (state.kind === "loading") {
      container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-loading">Loading\u2026</div>`;
      return;
    }
    if (state.kind === "error") {
      container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-error">${escapeHtml(state.message)}</div>`;
      return;
    }
    if (state.entries.length === 0) {
      container.innerHTML = `<ul class="file-browser-list">${up}</ul><div class="file-browser-empty"><p>No documents in this folder.</p></div>`;
      return;
    }
    const items = state.entries.map((entry) => {
      const cls = entry.isDir ? "file-browser-folder" : "file-browser-file";
      const action = entry.isDir ? "navigate" : "open";
      return `<li><button type="button" class="file-browser-item ${cls}" data-action="${action}" data-name="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</button></li>`;
    }).join("");
    container.innerHTML = `<ul class="file-browser-list">${up}${items}</ul>`;
  }
  function attachFileBrowserHandlers(container, callbacks) {
    container.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!button) return;
      switch (button.dataset.action) {
        case "up":
          callbacks.onUp();
          break;
        case "navigate":
          if (button.dataset.name) callbacks.onNavigate(button.dataset.name);
          break;
        case "open":
          if (button.dataset.name) callbacks.onOpenFile(button.dataset.name);
          break;
      }
    });
  }
  var FOLDER_CACHE_KEY = "mdviewer.folderCache";
  var FOLDER_CACHE_VERSION = 1;
  var FOLDER_CACHE_MAX_FOLDERS = 20;
  function emptyFolderCache() {
    return { v: FOLDER_CACHE_VERSION, folders: {} };
  }
  function loadFolderCacheData() {
    try {
      const raw = localStorage.getItem(FOLDER_CACHE_KEY);
      if (raw === null) return emptyFolderCache();
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || parsed.v !== FOLDER_CACHE_VERSION || typeof parsed.folders !== "object" || parsed.folders === null) {
        return emptyFolderCache();
      }
      return parsed;
    } catch {
      return emptyFolderCache();
    }
  }
  function storeFolderCacheData(data) {
    try {
      localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(data));
    } catch {
    }
  }
  function loadCachedFolder(canonicalPath) {
    return loadFolderCacheData().folders[canonicalPath]?.entries;
  }
  function diffFolderEntries(a, b) {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || a[i].isDir !== b[i].isDir) return true;
    }
    return false;
  }
  function storeCachedFolder(canonicalPath, entries) {
    const data = loadFolderCacheData();
    data.folders[canonicalPath] = { entries, cachedAt: Date.now() };
    const keys = Object.keys(data.folders);
    if (keys.length > FOLDER_CACHE_MAX_FOLDERS) {
      const oldestFirst = keys.sort((a, b) => data.folders[a].cachedAt - data.folders[b].cachedAt);
      for (const key of oldestFirst.slice(0, keys.length - FOLDER_CACHE_MAX_FOLDERS)) {
        delete data.folders[key];
      }
    }
    storeFolderCacheData(data);
  }

  // src/permissions.ts
  var POLICY_OPTIONS2 = [
    { id: "ask", label: "Ask each time" },
    { id: "always", label: "Always load" },
    { id: "never", label: "Never (block)" }
  ];
  var FOLDER_EXPLANATION = "To browse and open documents, MDViewer needs access to a folder. Granting one lets it read that folder and everything inside it \u2014 including images your documents reference. Nothing outside a folder you grant is ever read.";
  var REMOTE_EXPLANATION = "Markdown files can reference images hosted online. Loading one reveals your IP address (and that you opened the document) to that server.";
  function policyOptionsHTML2(selected) {
    return POLICY_OPTIONS2.map(
      (option) => `<option value="${option.id}"${option.id === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    ).join("");
  }
  function foldersHTML(folders) {
    if (folders.length === 0) {
      return '<p class="permissions-no-folders">No folder granted yet.</p>';
    }
    const items = folders.map((folder) => `<li class="permissions-folder">${escapeHtml(folder.path)}</li>`).join("");
    return `<ul class="permissions-folder-list">${items}</ul>`;
  }
  function renderPermissions(root, state) {
    root.innerHTML = `
        <div class="permissions-overlay">
            <div class="permissions-panel" role="dialog" aria-label="Permissions">
                <h2 class="permissions-title">Before you start</h2>
                <p class="permissions-intro">MDViewer asks for everything it needs up front, once. You can change any of this later in Settings.</p>

                <section class="permissions-section">
                    <h3>Folder access</h3>
                    <p class="permissions-explanation">${escapeHtml(FOLDER_EXPLANATION)}</p>
                    ${foldersHTML(state.folders)}
                    <button type="button" class="permissions-grant-btn" data-action="grant-folder">Choose a folder\u2026</button>
                </section>

                <section class="permissions-section">
                    <h3>Internet images &amp; resources</h3>
                    <p class="permissions-explanation">${escapeHtml(REMOTE_EXPLANATION)}</p>
                    <label class="permissions-field">
                        <span>When a document references one</span>
                        <select data-action="policy">${policyOptionsHTML2(state.policy)}</select>
                    </label>
                </section>

                <button type="button" class="permissions-done-btn" data-action="done">Done</button>
            </div>
        </div>
    `;
  }
  function attachPermissionsHandlers(root, callbacks) {
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "grant-folder") {
        callbacks.onGrantFolder();
      } else if (button.dataset.action === "done") {
        callbacks.onDone();
      }
    });
    root.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "policy") return;
      const policy = POLICY_OPTIONS2.find((option) => option.id === target.value);
      if (policy) callbacks.onPolicyChange(policy.id);
    });
  }
  function showPermissions(root) {
    root.hidden = false;
  }
  function hidePermissions(root) {
    root.hidden = true;
  }
  var PERMISSIONS_SEEN_KEY = "mdviewer.permissionsPromptSeen";
  function hasSeenPermissionsPrompt() {
    try {
      return localStorage.getItem(PERMISSIONS_SEEN_KEY) === "true";
    } catch {
      return false;
    }
  }
  function markPermissionsPromptSeen() {
    try {
      localStorage.setItem(PERMISSIONS_SEEN_KEY, "true");
    } catch {
    }
  }

  // src/renderViewModel.ts
  var MIN_FONT_SIZE = 10;
  var MAX_FONT_SIZE = 32;
  var DEFAULT_FONT_SIZE = 16;
  var LOCAL_BASE_URL = "mdviewer-local://localhost/";
  var PDF_PAGE_STYLE_ELEMENT_ID = "mdviewer-page-style";
  var RenderViewModel = class {
    constructor(deps) {
      this.hoveredURL = "";
      this.deps = deps;
      const storedThemeId = deps.loadStoredThemeId?.();
      this.theme = storedThemeId && findTheme(storedThemeId) || githubLight;
      this.fontSize = deps.loadStoredFontSize?.() ?? DEFAULT_FONT_SIZE;
      this.pdfPageSizeId = deps.loadStoredPDFPageSizeId?.() ?? "a4";
    }
    setTheme(theme) {
      this.theme = theme;
      this.deps.storeThemeId?.(theme.id);
      this.deps.renderer.setTheme(theme.cssFileName);
    }
    setFontSize(size) {
      const clamped = Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);
      this.fontSize = clamped;
      this.deps.storeFontSize?.(clamped);
      this.deps.renderer.setFontSize(clamped);
    }
    increaseFontSize() {
      this.setFontSize(this.fontSize + 2);
    }
    decreaseFontSize() {
      this.setFontSize(this.fontSize - 2);
    }
    resetFontSize() {
      this.setFontSize(DEFAULT_FONT_SIZE);
    }
    /** The Markdown file's directory, served via the mdviewer-local:// scheme. */
    setBaseURL(directoryURL) {
      this.deps.setLocalBaseDirectory?.(directoryURL);
      this.deps.renderer.setBaseURL(LOCAL_BASE_URL);
    }
    renderMarkdown(markdown) {
      this.deps.renderer.setRemoteContentPolicy(this.deps.getRemoteContentPolicy());
      this.deps.renderer.setContent(markdown);
    }
    scrollToAnchor(anchor) {
      this.deps.renderer.scrollToAnchor(anchor);
    }
    applyCurrentThemeAndFontSize() {
      this.deps.renderer.setTheme(this.theme.cssFileName);
      this.deps.renderer.setFontSize(this.fontSize);
    }
    applySystemAppearance(isDark) {
      if (this.theme.id === githubLight.id && isDark) {
        this.setTheme(githubDark);
      } else if (this.theme.id === githubDark.id && !isDark) {
        this.setTheme(githubLight);
      }
    }
    setPDFPageSize(id) {
      this.pdfPageSizeId = id;
      this.deps.storePDFPageSizeId?.(id);
      this.applyPDFPageSize();
    }
    /** Injects the @page CSS rule the browser print pipeline reads for PDF export. */
    applyPDFPageSize() {
      const doc = this.deps.document ?? document;
      const css = `@page { size: ${pdfPageSizes[this.pdfPageSizeId].cssSize}; margin: 15mm; }`;
      let styleEl = doc.getElementById(PDF_PAGE_STYLE_ELEMENT_ID);
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = PDF_PAGE_STYLE_ELEMENT_ID;
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    }
  };

  // src/main.ts
  wireErrorForwarding(window, (message) => window.__TAURI__.core.invoke("log_frontend_error", { message }));
  window.MDViewer = createMDViewerApi({
    marked: window.marked,
    domPurify: window.DOMPurify,
    katex: window.katex,
    mermaid: window.mermaid,
    shikiReady: window.__shikiReady
  });
  function wireWelcomeContentToggle() {
    const welcomeEl = document.getElementById("welcome");
    const contentEl = document.getElementById("content");
    if (!welcomeEl || !contentEl) return;
    const elements = { welcome: welcomeEl, content: contentEl };
    showWelcome(elements);
    const rawSetContent = window.MDViewer.setContent.bind(window.MDViewer);
    window.MDViewer.setContent = async (markdown) => {
      const result = await rawSetContent(markdown);
      showContent(elements);
      return result;
    };
    welcomeEl.querySelector('[data-action="open"]')?.addEventListener("click", () => {
      void window.__TAURI__.core.invoke("open_document_command");
    });
  }
  var THEME_STORAGE_KEY = "mdviewer.themeId";
  var FONT_SIZE_STORAGE_KEY = "mdviewer.fontSize";
  function loadStoredThemeId() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) ?? void 0;
    } catch {
      return void 0;
    }
  }
  function storeThemeId(id) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
    }
  }
  function loadStoredFontSize() {
    try {
      const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      return raw === null ? void 0 : Number(raw);
    } catch {
      return void 0;
    }
  }
  function storeFontSize(size) {
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
    } catch {
    }
  }
  function createRenderViewModel() {
    const renderVM = new RenderViewModel({
      renderer: window.MDViewer,
      getRemoteContentPolicy: () => "ask",
      loadStoredThemeId,
      storeThemeId,
      loadStoredFontSize,
      storeFontSize
    });
    renderVM.applyCurrentThemeAndFontSize();
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    renderVM.applySystemAppearance(darkModeQuery.matches);
    darkModeQuery.addEventListener("change", (e) => {
      renderVM.applySystemAppearance(e.matches);
    });
    return renderVM;
  }
  function wirePreferences(renderVM) {
    const prefsEl = document.getElementById("preferences");
    if (!prefsEl) return void 0;
    renderPreferences(prefsEl, "ask", renderVM.theme.id, renderVM.fontSize);
    void window.__TAURI__.app.getVersion().then((version) => updateAboutVersion(prefsEl, version));
    attachPreferencesHandlers(prefsEl, {
      onClose: () => hidePreferences(prefsEl),
      onPolicyChange: (policy) => {
        void window.__TAURI__.core.invoke("set_remote_content_policy", { policy });
      },
      onThemeChange: (theme) => {
        renderVM.setTheme(theme);
      },
      onFontDecrease: () => {
        renderVM.decreaseFontSize();
        updatePreferencesFontSize(prefsEl, renderVM.fontSize);
      },
      onFontReset: () => {
        renderVM.resetFontSize();
        updatePreferencesFontSize(prefsEl, renderVM.fontSize);
      },
      onFontIncrease: () => {
        renderVM.increaseFontSize();
        updatePreferencesFontSize(prefsEl, renderVM.fontSize);
      }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      updatePreferencesTheme(prefsEl, renderVM.theme.id);
    });
    return {
      open: () => {
        void window.__TAURI__.core.invoke("get_remote_content_policy").then((policy) => {
          updatePreferencesPolicy(prefsEl, policy);
        });
        showPreferences(prefsEl);
      }
    };
  }
  function wireSearch() {
    const searchEl = document.getElementById("search");
    if (!searchEl) return void 0;
    renderSearchBar(searchEl);
    attachSearchBarHandlers(searchEl, {
      onQueryChange: (query) => {
        searchFromStart(window, query);
      },
      onSubmit: (query) => {
        searchNext(window, query);
      },
      onClose: () => {
        hideSearchBar(searchEl);
      }
    });
    return {
      open: () => {
        showSearchBar(searchEl);
      }
    };
  }
  function wireGlobalShortcuts(search) {
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search?.open();
      }
    });
  }
  function wireToolbar(preferences, search, fileBrowser) {
    const toolbarEl = document.getElementById("toolbar");
    if (!toolbarEl) return;
    renderToolbar(toolbarEl);
    toolbarEl.hidden = false;
    const syncToolbarHeightVar = () => {
      document.documentElement.style.setProperty("--toolbar-h", `${toolbarEl.getBoundingClientRect().height}px`);
    };
    syncToolbarHeightVar();
    window.addEventListener("resize", syncToolbarHeightVar);
    const mainEl = document.getElementById("main");
    if (mainEl) {
      const autoHideSources = [{ target: mainEl, type: "scroll" }];
      if (window.visualViewport) {
        autoHideSources.push({ target: window.visualViewport, type: "resize" }, { target: window.visualViewport, type: "scroll" });
      }
      wireToolbarAutoHide(
        toolbarEl,
        autoHideSources,
        window.matchMedia("(max-width: 768px)"),
        void 0,
        () => mainEl.scrollHeight > mainEl.clientHeight
      );
    }
    attachToolbarHandlers(toolbarEl, {
      onOpen: () => {
        void window.__TAURI__.core.invoke("open_document_command");
      },
      onPreferences: () => {
        preferences?.open();
      },
      onFind: () => {
        search?.open();
      },
      onToggleFileBrowser: () => {
        fileBrowser?.toggle();
      }
    });
  }
  function toEntries(listing) {
    return listing.entries.map((e) => ({ name: e.name, isDir: e.is_dir }));
  }
  function joinPath(dir, name) {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
  }
  function parentPath(path) {
    const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
    const idx = path.lastIndexOf(sep);
    if (idx <= 0) return null;
    return path.slice(0, idx);
  }
  function wireFileBrowser() {
    const browserEl = document.getElementById("file-browser");
    if (!browserEl) return void 0;
    const backdropEl = document.getElementById("file-browser-backdrop");
    browserEl.hidden = false;
    let currentPath;
    let upTarget = null;
    async function show(path) {
      const cached = path === null ? void 0 : loadCachedFolder(path);
      const guessedParent = path === null ? null : parentPath(path);
      upTarget = guessedParent;
      renderFileBrowser(browserEl, {
        kind: cached ? "loaded" : "loading",
        path: path ?? "",
        parentPath: guessedParent,
        ...cached ? { entries: cached } : {}
      });
      try {
        const listing = await window.__TAURI__.core.invoke("list_directory", { path });
        const entries = toEntries(listing);
        currentPath = listing.path;
        upTarget = listing.parent;
        storeCachedFolder(listing.path, entries);
        if (cached === void 0 || diffFolderEntries(cached, entries) || guessedParent !== listing.parent) {
          renderFileBrowser(browserEl, {
            kind: "loaded",
            path: listing.path,
            parentPath: listing.parent,
            entries
          });
        }
      } catch (e) {
        const message = String(e);
        if (path === null) {
          upTarget = null;
          if (message.includes("not_found:")) {
            renderFileBrowser(browserEl, { kind: "no-document" });
          } else {
            renderFileBrowser(browserEl, {
              kind: "error",
              path: "",
              parentPath: null,
              message
            });
          }
        } else {
          upTarget = parentPath(path);
          renderFileBrowser(browserEl, {
            kind: "error",
            path,
            parentPath: upTarget,
            message
          });
        }
      }
    }
    attachFileBrowserHandlers(browserEl, {
      onOpenFile: (name) => {
        if (!currentPath) return;
        void window.__TAURI__.core.invoke("handle_link_click", {
          href: `file://${joinPath(currentPath, name)}`
        });
        closeDrawer(browserEl, backdropEl);
      },
      onNavigate: (name) => {
        if (!currentPath) return;
        void show(joinPath(currentPath, name));
      },
      onUp: () => {
        if (upTarget) void show(upTarget);
      }
    });
    backdropEl?.addEventListener("click", () => {
      closeDrawer(browserEl, backdropEl);
    });
    return {
      toggle: () => {
        const opening = !browserEl.classList.contains("open");
        if (opening) {
          void show(currentPath ?? null);
        }
        toggleDrawer(browserEl, backdropEl);
      },
      // Unconditional open-and-show, as opposed to `toggle`: used right
      // after granting a folder (wirePermissions, below) for immediate
      // feedback, where the caller always wants the drawer visible and
      // pointed at a specific path, never toggled shut if it happened to
      // already be open.
      openTo: (path) => {
        void show(path);
        openDrawer(browserEl, backdropEl);
      }
    };
  }
  function wirePermissions(fileBrowser) {
    const permsEl = document.getElementById("permissions");
    if (!permsEl) return;
    let folders = [];
    let policy = "ask";
    const rerender = () => renderPermissions(permsEl, { policy, folders });
    rerender();
    attachPermissionsHandlers(permsEl, {
      onGrantFolder: () => {
        void window.__TAURI__.core.invoke("request_folder_access").then((granted) => {
          if (!granted) return;
          void window.__TAURI__.core.invoke("list_granted_folders").then((paths) => {
            folders = paths.map((path) => ({ path }));
            rerender();
            const justGranted = folders[folders.length - 1]?.path;
            if (justGranted) fileBrowser?.openTo(justGranted);
          });
        });
      },
      onPolicyChange: (next) => {
        policy = next;
        void window.__TAURI__.core.invoke("set_remote_content_policy", { policy: next });
      },
      onDone: () => {
        markPermissionsPromptSeen();
        hidePermissions(permsEl);
      }
    });
    if (!hasSeenPermissionsPrompt()) {
      void window.__TAURI__.core.invoke("get_remote_content_policy").then((current) => {
        policy = current;
        rerender();
      });
      void window.__TAURI__.core.invoke("list_granted_folders").then((paths) => {
        folders = paths.map((path) => ({ path }));
        rerender();
      });
      showPermissions(permsEl);
    }
  }
  function wireUIShell() {
    wireWelcomeContentToggle();
    const renderVM = createRenderViewModel();
    const preferences = wirePreferences(renderVM);
    const search = wireSearch();
    wireGlobalShortcuts(search);
    const fileBrowser = wireFileBrowser();
    wirePermissions(fileBrowser);
    wireToolbar(preferences, search, fileBrowser);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUIShell);
  } else {
    wireUIShell();
  }
  attachInteractionListeners({
    onLinkClicked: (href) => {
      void window.__TAURI__.core.invoke("handle_link_click", { href });
    }
  });
})();
