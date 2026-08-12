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

// Cross-browser searched text highlight. The native app relies on window.find
// because the search field lives outside the WebView; in the web chrome the
// search box is part of the same DOM, so window.find matches the query inside
// the input itself (returns "found" for any typed text). A text-node scan is
// deterministic here and gives visible match highlighting for free.
const MARK_CLASS = 'mdv-hit';
let hitEls = [];
let currentHitIndex = 0;

function clearHits() {
  for (const el of hitEls) {
    const parent = el.parentNode;
    if (!parent) continue;
    const text = document.createTextNode(el.textContent);
    parent.replaceChild(text, el);
    parent.normalize();
  }
  hitEls = [];
  currentHitIndex = 0;
}

// Wrap one occurrence at [start, start+len) of `node` in a <mark>. Mutates the
// DOM via splitText and returns the remainder text node for continued scanning.
function insertHit(node, start, len) {
  const tail = start > 0 ? node.splitText(start) : node;
  const rest = len < tail.length ? tail.splitText(len) : null;
  const mark = document.createElement('mark');
  mark.className = MARK_CLASS;
  tail.parentNode.replaceChild(mark, tail);
  mark.appendChild(tail);
  hitEls.push(mark);
  return rest;
}

function performSearch(query) {
  const status = document.getElementById('statusbar');
  clearHits();
  const q = query.trim().toLowerCase();
  if (!q) { status.textContent = ''; return; }

  const content = document.getElementById('content');
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement && node.parentElement.closest('script, style, mark')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let count = 0;
  for (const textNode of nodes) {
    let node = textNode;
    let lower = node.nodeValue.toLowerCase();
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      const tail = node.splitText(idx);           // node = before-q, tail = q + rest
      const restOfTail = tail.splitText(q.length); // tail = exactly q, restOfTail = rest
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      tail.parentNode.replaceChild(mark, tail); // mark contains exactly the match text
      mark.appendChild(tail);
      hitEls.push(mark);
      count++;
      node = restOfTail;
      lower = node.nodeValue.toLowerCase();
      idx = lower.indexOf(q);
    }
  }

  if (count === 0) {
    status.textContent = 'Not found';
    return;
  }
  status.textContent = count === 1 ? `1 match for "${query.trim()}"` : `${count} matches for "${query.trim()}"`;
  hitEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  hitEls[0].classList.add('current');
}

function buildSearch(input) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => performSearch(input.value), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      performSearch(input.value);
    }
  });
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

  buildSearch(document.getElementById('search-box'));

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