// MDViewer JS Bridge
// Handles Markdown rendering and Swift <-> JS communication.

(function () {
    'use strict';

    // -- Shiki highlighter (resolved async on page load)
    let shikiHighlighter = null;

    if (window.__shikiReady) {
        window.__shikiReady.then(function (h) { shikiHighlighter = h; });
    }

    // -- Mermaid init (must run before DOMContentLoaded diagrams)
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose'
        });
    }

    function slugify(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function highlightCode(code, lang) {
        const fallback = function () {
            const label = lang ? `<span class="code-lang-label">${escapeHtml(lang)}</span>` : '';
            return `<div class="code-block-wrapper">${label}<pre><code>${escapeHtml(code)}</code></pre></div>`;
        };

        if (!shikiHighlighter) { return fallback(); }

        try {
            const loaded = shikiHighlighter.getLoadedLanguages();
            const resolvedLang = loaded.includes(lang) ? lang : 'text';

            const html = shikiHighlighter.codeToHtml(code, {
                lang: resolvedLang,
                themes: { light: 'github-light', dark: 'github-dark' }
            });

            if (lang) {
                return html
                    .replace('<pre ', `<div class="code-block-wrapper"><span class="code-lang-label">${escapeHtml(lang)}</span><pre `)
                    .replace('</pre>', '</pre></div>');
            }
            return html;
        } catch (_) {
            return fallback();
        }
    }

    // Base directory for resolving relative image paths, served via the
    // mdviewer-local:// custom scheme. Set by Swift through setBaseURL().
    let localBaseURL = null;

    // Rewrite relative image sources (and other local resources) to the
    // mdviewer-local:// scheme so the Swift scheme handler can serve them.
    // Absolute URLs (http, https, data, file, the scheme itself) are left alone.
    function rewriteLocalResources(root) {
        if (!localBaseURL) { return; }

        const isAbsolute = function (src) {
            return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#');
        };

        root.querySelectorAll('img[src]').forEach(function (img) {
            const src = img.getAttribute('src');
            if (!src || isAbsolute(src)) { return; }
            // Encode each path segment but preserve slashes.
            const encoded = src.split('/').map(encodeURIComponent).join('/');
            const path = encoded.startsWith('/') ? encoded.slice(1) : encoded;
            img.setAttribute('src', localBaseURL + path);
        });
    }

    // -- Remote (http/https) content policy: 'ask' | 'always' | 'never'.
    // Set by Swift via setRemoteContentPolicy() before setContent().
    let remoteContentPolicy = 'ask';
    let blockedRemoteCount = 0;

    // Gate remote (http/https) resources per policy, operating on the HTML STRING
    // *before* insertion so nothing ever starts loading (setting innerHTML fetches
    // images immediately, so removing src afterwards is too late). On 'ask'/'never'
    // the src attribute of a remote <img> is renamed to data-mdv-remote (restorable
    // via loadRemoteResources); on 'always' the string is returned unchanged.
    function gateRemoteResourcesInHTML(htmlString) {
        blockedRemoteCount = 0;
        if (remoteContentPolicy === 'always') { return htmlString; }
        return htmlString.replace(
            /(<img\b[^>]*?)\ssrc=(["'])(https?:\/\/[^"']*)\2/gi,
            function (_m, pre, q, url) {
                blockedRemoteCount++;
                return pre + ' data-mdv-remote=' + q + url + q;
            }
        );
    }

    // -- Public MDViewer API (called from Swift via evaluateJavaScript)
    window.MDViewer = {

        setContent: async function (markdown) {
            if (!shikiHighlighter && window.__shikiReady) {
                shikiHighlighter = await Promise.race([
                    window.__shikiReady,
                    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 8000); })
                ]);
            }

            const headingsRef = [];
            const renderer = new marked.Renderer();

            // marked v18.0.6 dispatches overridden Renderer methods with EITHER
            // the legacy positional signature (heading(text, level) / code(code,
            // infostring)) OR the token-object signature (heading(token) /
            // code(token)) depending on runtime context (observed: legacy in the
            // main app, token-object in the sandboxed Quick Look extension). These
            // renderers therefore handle BOTH shapes.
            renderer.heading = function (a, b) {
                let level, inner, plain;
                if (a && typeof a === 'object') {          // token-object dispatch
                    level = a.depth;
                    plain = a.text != null ? String(a.text) : '';
                    inner = (this && this.parser && a.tokens) ? this.parser.parseInline(a.tokens) : plain;
                } else {                                    // legacy (text, level)
                    level = b;
                    inner = a != null ? String(a) : '';
                    plain = inner.replace(/<[^>]*>/g, '');
                }
                const anchor = slugify(plain);
                headingsRef.push({ level: level, title: plain, anchor: anchor });
                return `<h${level} id="${anchor}">${inner}</h${level}>\n`;
            };

            renderer.code = function (a, b) {
                let code, lang;
                if (a && typeof a === 'object') {           // token-object dispatch
                    code = a.text != null ? a.text : '';
                    lang = (a.lang || '').trim().split(/\s+/)[0];
                } else {                                    // legacy (code, infostring)
                    code = a != null ? a : '';
                    lang = (b || '').trim().split(/\s+/)[0];
                }
                if (lang === 'mermaid') {
                    return `<div class="mermaid">${escapeHtml(code)}</div>`;
                }
                return highlightCode(code, lang);
            };

            // Pre-process math: protect $...$ from marked parsing
            const mathBlocks = [];
            let processed = markdown;

            processed = processed.replace(/\$\$([^$]+?)\$\$/gs, function (_, expr) {
                const placeholder = `MATHBLOCK_${mathBlocks.length}_END`;
                mathBlocks.push({ type: 'block', expr: expr.trim() });
                return placeholder;
            });

            processed = processed.replace(/\$([^$\n]+?)\$/g, function (_, expr) {
                const placeholder = `MATHINLINE_${mathBlocks.length}_END`;
                mathBlocks.push({ type: 'inline', expr: expr.trim() });
                return placeholder;
            });

            let html = marked.parse(processed, { renderer: renderer });

            // SECURITY: sanitize the user-controlled Markdown-derived HTML before
            // inserting trusted KaTeX/Mermaid output. DOMPurify strips <script>,
            // on* event handlers, javascript: URLs, etc. Math is restored AFTER
            // this step so KaTeX's own markup is not stripped.
            if (typeof DOMPurify !== 'undefined') {
                html = DOMPurify.sanitize(html, {
                    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
                    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
                    FORBID_ATTR: ['srcset', 'formaction', 'ping']
                });
            }

            // Restore math
            if (typeof katex !== 'undefined') {
                mathBlocks.forEach(function (m, i) {
                    const blockPh = new RegExp(`MATHBLOCK_${i}_END`, 'g');
                    const inlinePh = new RegExp(`MATHINLINE_${i}_END`, 'g');
                    try {
                        const rendered = katex.renderToString(m.expr, {
                            displayMode: m.type === 'block',
                            throwOnError: false
                        });
                        html = html.replace(blockPh, rendered).replace(inlinePh, rendered);
                    } catch (e) {
                        html = html.replace(blockPh, escapeHtml(m.expr))
                                   .replace(inlinePh, escapeHtml(m.expr));
                    }
                });
            }

            // Gate remote resources in the HTML string BEFORE insertion so they
            // never start loading.
            const contentEl = document.getElementById('content');
            contentEl.innerHTML = gateRemoteResourcesInHTML(html);

            // Resolve relative image paths against the Markdown file's directory
            rewriteLocalResources(contentEl);

            // Render Mermaid diagrams
            if (typeof mermaid !== 'undefined') {
                try {
                    mermaid.run({ querySelector: '.mermaid' });
                } catch (e) {
                    console.warn('Mermaid render error:', e);
                }
            }

            // Notify Swift with heading list
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headingsExtracted) {
                window.webkit.messageHandlers.headingsExtracted.postMessage(headingsRef);
            }

            // Notify Swift render complete
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.renderComplete) {
                window.webkit.messageHandlers.renderComplete.postMessage(null);
            }

            // If remote content was blocked and the policy is "ask", tell Swift
            // so it can prompt the user to load it.
            if (blockedRemoteCount > 0 && remoteContentPolicy === 'ask' &&
                window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.remoteContentBlocked) {
                window.webkit.messageHandlers.remoteContentBlocked.postMessage({ count: blockedRemoteCount });
            }
        },

        setTheme: function (themeName) {
            const link = document.getElementById('theme-css');
            if (link) {
                link.href = `themes/${themeName}.css`;
            }
            // Toggle Shiki dark-theme class
            const isDark = themeName.includes('dark');
            document.body.classList.toggle('dark-theme', isDark);

            // Update mermaid theme
            if (typeof mermaid !== 'undefined') {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: isDark ? 'dark' : 'default',
                    securityLevel: 'loose'
                });
            }
        },

        setFontSize: function (size) {
            document.documentElement.style.setProperty('--font-size', size + 'px');
        },

        scrollToAnchor: function (anchorId) {
            const el = document.getElementById(anchorId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                el.classList.add('heading-anchor-target');
                setTimeout(function () {
                    el.classList.remove('heading-anchor-target');
                }, 2000);
            }
        },

        findText: function (text) {
            if (window.find) {
                window.find(text, false, false, true, false, true, false);
            }
        },

        setBaseURL: function (url) {
            // Store the base for relative image resolution. We do NOT set a
            // <base> element, since that would also redirect the renderer's own
            // relative resources (theme CSS, vendor scripts) and break them.
            localBaseURL = url;

            // Re-resolve any images already in the DOM (base may arrive after content).
            const contentEl = document.getElementById('content');
            if (contentEl) { rewriteLocalResources(contentEl); }
        },

        // Set the remote-content policy ('ask' | 'always' | 'never'). Must be
        // called before setContent() so gating applies to the rendered document.
        setRemoteContentPolicy: function (p) {
            remoteContentPolicy = (p === 'always' || p === 'never') ? p : 'ask';
        },

        // Load the remote resources that were blocked (restores their src).
        loadRemoteResources: function () {
            document.querySelectorAll('img[data-mdv-remote]').forEach(function (img) {
                img.setAttribute('src', img.getAttribute('data-mdv-remote'));
                img.removeAttribute('data-mdv-remote');
            });
        }
    };

    // Track scroll position and notify Swift
    let scrollTimer = null;
    window.addEventListener('scroll', function () {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scrollPositionChanged) {
                window.webkit.messageHandlers.scrollPositionChanged.postMessage({
                    y: window.scrollY,
                    height: document.body.scrollHeight
                });
            }
        }, 100);
    });

    // Link hover: notify Swift to display URL in status bar
    document.addEventListener('mouseover', function (e) {
        const link = e.target.closest('a[href]');
        if (link && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.linkHovered) {
            window.webkit.messageHandlers.linkHovered.postMessage(link.href || '');
        }
    });
    document.addEventListener('mouseout', function (e) {
        const link = e.target.closest('a[href]');
        if (link && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.linkHovered) {
            window.webkit.messageHandlers.linkHovered.postMessage('');
        }
    });

    // Link click: fragment links scroll in-page; all others handled by Swift
    document.addEventListener('click', function (e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href) return;

        if (href.startsWith('#')) return;

        e.preventDefault();
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.linkClicked) {
            window.webkit.messageHandlers.linkClicked.postMessage(link.href);
        }
    });

})();
