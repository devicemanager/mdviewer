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
  function initializeMermaid(mermaid, isDark) {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose"
    });
  }
  function runMermaidDiagrams(mermaid) {
    try {
      mermaid.run({ querySelector: ".mermaid" });
    } catch (e) {
      console.warn("Mermaid render error:", e);
    }
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
          runMermaidDiagrams(deps.mermaid);
        }
        return { headings, blockedRemoteCount: gated.blockedCount };
      },
      setTheme(themeName) {
        const link = document.getElementById("theme-css");
        if (link) {
          link.href = `themes/${themeName}.css`;
        }
        const isDark = themeName.includes("dark");
        document.body.classList.toggle("dark-theme", isDark);
        initializeMermaid(deps.mermaid, isDark);
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

  // src/sidebar.ts
  function classForLevel(level) {
    if (level === 1) return "toc-level-1";
    if (level === 2) return "toc-level-2";
    return "toc-level-3-plus";
  }
  function renderTOC(sidebar, headings) {
    if (headings.length === 0) {
      sidebar.innerHTML = '<div class="toc-empty"><p>No headings found</p></div>';
      return;
    }
    const items = headings.map((h) => {
      const indent = (h.level - 1) * 12;
      return `<li><button type="button" class="toc-item ${classForLevel(h.level)}" style="padding-left:${indent}px" data-anchor="${escapeHtml(h.anchor)}">${escapeHtml(h.title)}</button></li>`;
    }).join("");
    sidebar.innerHTML = `<ul class="toc-list">${items}</ul>`;
  }
  function attachTOCClickHandler(sidebar, onSelect) {
    sidebar.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-anchor]");
      if (button?.dataset.anchor) {
        onSelect(button.dataset.anchor);
      }
    });
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

  // src/toolbar.ts
  var ICON_SIDEBAR = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="5.5" x2="17" y2="5.5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="14.5" x2="17" y2="14.5"/></svg>`;
  var ICON_OPEN = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2H16.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9.5Z"/></svg>`;
  var ICON_FIND = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="16.5" y1="16.5" x2="12.6" y2="12.6"/></svg>`;
  var ICON_PREFERENCES = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"/></svg>`;
  function themeOptionsHTML(selectedThemeId) {
    return themes.map((theme) => {
      const selected = theme.id === selectedThemeId ? " selected" : "";
      return `<option value="${theme.id}"${selected}>${theme.displayName}</option>`;
    }).join("");
  }
  function renderToolbar(toolbar, initialFontSize, initialThemeId) {
    toolbar.innerHTML = `
        <button type="button" data-action="sidebar-toggle" class="sidebar-toggle-btn icon-btn" aria-label="Table of contents">${ICON_SIDEBAR}</button>
        <button type="button" data-action="open" class="icon-btn" aria-label="Open\u2026">${ICON_OPEN}</button>
        <span class="toolbar-group">
            <button type="button" data-action="font-decrease" aria-label="Decrease font size">A\u2212</button>
            <button type="button" data-action="font-reset" aria-label="Reset font size" data-font-size>${initialFontSize}</button>
            <button type="button" data-action="font-increase" aria-label="Increase font size">A+</button>
        </span>
        <select data-action="theme" aria-label="Theme">${themeOptionsHTML(initialThemeId)}</select>
        <span class="toolbar-spacer"></span>
        <button type="button" data-action="find" class="icon-btn" aria-label="Find">${ICON_FIND}</button>
        <button type="button" data-action="preferences" class="icon-btn" aria-label="Preferences">${ICON_PREFERENCES}</button>
    `;
  }
  function updateToolbarFontSize(toolbar, fontSize) {
    const el = toolbar.querySelector("[data-font-size]");
    if (el) el.textContent = String(fontSize);
  }
  function updateToolbarTheme(toolbar, themeId) {
    const select = toolbar.querySelector('select[data-action="theme"]');
    if (select) select.value = themeId;
  }
  function attachToolbarHandlers(toolbar, callbacks) {
    toolbar.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!button) return;
      switch (button.dataset.action) {
        case "sidebar-toggle":
          callbacks.onToggleSidebar();
          break;
        case "open":
          callbacks.onOpen();
          break;
        case "font-decrease":
          callbacks.onFontDecrease();
          break;
        case "font-reset":
          callbacks.onFontReset();
          break;
        case "font-increase":
          callbacks.onFontIncrease();
          break;
        case "preferences":
          callbacks.onPreferences();
          break;
        case "find":
          callbacks.onFind();
          break;
      }
    });
    toolbar.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "theme") return;
      const theme = themes.find((t) => t.id === target.value);
      if (theme) callbacks.onThemeChange(theme);
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
  function wireToolbarAutoHide(toolbarEl, sources, mobileQuery, fadeDelayMs = DEFAULT_FADE_DELAY_MS) {
    let fadeTimer;
    function wake() {
      if (!mobileQuery.matches) return;
      showToolbar(toolbarEl);
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => fadeToolbar(toolbarEl), fadeDelayMs);
    }
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
    { id: "privacy", label: "Privacy" }
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
  function tabsHTML(activeTab) {
    return TABS.map((t) => {
      const active = t.id === activeTab ? " active" : "";
      return `<button type="button" class="prefs-tab${active}" data-tab="${t.id}">${t.label}</button>`;
    }).join("");
  }
  function renderPreferences(root, initialPolicy, activeTab = "general") {
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
                        <p class="prefs-placeholder">Not available yet \u2014 use the toolbar's font size and theme controls.</p>
                    </div>
                    <div class="prefs-pane${activeTab === "privacy" ? " active" : ""}" data-pane="privacy">
                        <label class="prefs-field">
                            <span>Internet images &amp; resources</span>
                            <select data-action="policy">${policyOptionsHTML(initialPolicy)}</select>
                        </label>
                        <p class="prefs-explanation">${PRIVACY_EXPLANATION}</p>
                    </div>
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
      }
    });
    root.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "policy") return;
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
  function wireSidebar() {
    const sidebarEl = document.getElementById("sidebar");
    if (!sidebarEl) return void 0;
    const backdropEl = document.getElementById("sidebar-backdrop");
    renderTOC(sidebarEl, []);
    attachTOCClickHandler(sidebarEl, (anchor) => {
      window.MDViewer.scrollToAnchor(anchor);
      closeDrawer(sidebarEl, backdropEl);
    });
    backdropEl?.addEventListener("click", () => {
      closeDrawer(sidebarEl, backdropEl);
    });
    const rawSetContent = window.MDViewer.setContent.bind(window.MDViewer);
    window.MDViewer.setContent = async (markdown) => {
      const result = await rawSetContent(markdown);
      renderTOC(sidebarEl, result.headings);
      return result;
    };
    return {
      toggle: () => {
        toggleDrawer(sidebarEl, backdropEl);
      }
    };
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
  function wirePreferences() {
    const prefsEl = document.getElementById("preferences");
    if (!prefsEl) return void 0;
    renderPreferences(prefsEl, "ask");
    attachPreferencesHandlers(prefsEl, {
      onClose: () => hidePreferences(prefsEl),
      onPolicyChange: (policy) => {
        void window.__TAURI__.core.invoke("set_remote_content_policy", { policy });
      }
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
  function wireToolbar(preferences, search, sidebar) {
    const toolbarEl = document.getElementById("toolbar");
    if (!toolbarEl) return;
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
    renderToolbar(toolbarEl, renderVM.fontSize, renderVM.theme.id);
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
      wireToolbarAutoHide(toolbarEl, autoHideSources, window.matchMedia("(max-width: 768px)"));
    }
    darkModeQuery.addEventListener("change", (e) => {
      renderVM.applySystemAppearance(e.matches);
      updateToolbarTheme(toolbarEl, renderVM.theme.id);
    });
    attachToolbarHandlers(toolbarEl, {
      onOpen: () => {
        void window.__TAURI__.core.invoke("open_document_command");
      },
      onFontDecrease: () => {
        renderVM.decreaseFontSize();
        updateToolbarFontSize(toolbarEl, renderVM.fontSize);
      },
      onFontReset: () => {
        renderVM.resetFontSize();
        updateToolbarFontSize(toolbarEl, renderVM.fontSize);
      },
      onFontIncrease: () => {
        renderVM.increaseFontSize();
        updateToolbarFontSize(toolbarEl, renderVM.fontSize);
      },
      onThemeChange: (theme) => {
        renderVM.setTheme(theme);
      },
      onPreferences: () => {
        preferences?.open();
      },
      onFind: () => {
        search?.open();
      },
      onToggleSidebar: () => {
        sidebar?.toggle();
      }
    });
  }
  function wireUIShell() {
    wireWelcomeContentToggle();
    const sidebar = wireSidebar();
    const preferences = wirePreferences();
    const search = wireSearch();
    wireGlobalShortcuts(search);
    wireToolbar(preferences, search, sidebar);
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
