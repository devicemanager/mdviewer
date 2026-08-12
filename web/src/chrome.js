import { saveState } from './state.js';

function renderToc(items) {
  const toc = document.getElementById('toc');
  if (!items || !items.length) { toc.innerHTML = ''; return; }
  toc.innerHTML = items.map(it =>
    `<a href="#${it.anchor}" data-level="${it.level}" data-anchor="${it.anchor}">${escapeHtml(it.title)}</a>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markActiveHeading(anchorId) {
  document.querySelectorAll('#toc a').forEach(a => a.classList.toggle('active', a.dataset.anchor === anchorId));
}

// Holds the IntersectionObserver (created lazily once #toc exists).
let tocObserver = null;

function ensureTocObserver() {
  if (tocObserver) return tocObserver;
  tocObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) markActiveHeading(entry.target.id);
    }
  }, { rootMargin: '-80px 0px -70% 0px' });
  return tocObserver;
}

export function buildChrome(state) {
  document.getElementById('btn-theme').addEventListener('click', () => {
    state.theme = state.theme.includes('dark') ? 'github-light' : 'github-dark';
    window.MDViewer.setTheme(state.theme);
    saveState(state);
  });
  document.getElementById('font-size').addEventListener('input', (e) => {
    state.fontSize = Number(e.target.value);
    window.MDViewer.setFontSize(state.fontSize);
    saveState(state);
  });

  window.addEventListener('mdv:headingsExtracted', (e) => renderToc(e.detail || []));

  document.getElementById('toc').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const anchor = a.getAttribute('href').slice(1);
      window.MDViewer.scrollToAnchor(anchor);
      markActiveHeading(anchor);
    }
  });

  window.addEventListener('mdv:renderComplete', () => {
    const observer = ensureTocObserver();
    observer.disconnect();
    document.querySelectorAll('#content h1,h2,h3,h4,h5,h6').forEach(h => observer.observe(h));
  });
}