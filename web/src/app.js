import { loadState, saveState, currentDocument } from './state.js';
import { buildChrome } from './chrome.js';
import { openViaPicker, markdownFilesFromDataTransfer, fileToDocument, isMarkdownFile } from './markdownLoader.js';

async function renderDocument(doc) {
  if (!doc) return;
  currentDocument.name = doc.name;
  currentDocument.text = doc.text;
  currentDocument.dirHandle = doc.dirHandle ?? null;
  await window.MDViewer.setContent(doc.text);
}

// Empty-state (native app opens with no document). Content area shows a hint.
function renderEmptyState() {
  currentDocument.name = null;
  currentDocument.text = null;
  currentDocument.dirHandle = null;
  document.getElementById('content').innerHTML =
    '<div id="empty-state">Open a Markdown file, or drop one anywhere.</div>';
}

async function init() {
  const state = loadState();
  window.MDViewer.setTheme(state.theme);
  window.MDViewer.setFontSize(state.fontSize);
  window.MDViewer.setRemoteContentPolicy(state.remoteContentPolicy);
  buildChrome(state);

  document.getElementById('btn-open').addEventListener('click', () => openViaPicker().then(renderDocument));
  document.getElementById('btn-open-folder').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await renderDocument(await fileToDocument(file));
    e.target.value = '';
  });

  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = markdownFilesFromDataTransfer(e.dataTransfer);
    if (files.length) await renderDocument(await fileToDocument(files[0]));
  });
  document.body.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) { await renderDocument(await fileToDocument(file)); return; }
      }
    }
  });
}

init();

renderEmptyState();