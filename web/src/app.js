import { loadState, saveState, currentDocument } from './state.js';
import { buildChrome } from './chrome.js';

const state = loadState();

window.MDViewer.setTheme(state.theme);
window.MDViewer.setFontSize(state.fontSize);
window.MDViewer.setRemoteContentPolicy(state.remoteContentPolicy);

// Placeholder until Task 2 (file input). Lets Task 1 render and be tested.
async function openFixture() {
  const text = `# Web Core Boot

Hello from the shared web core.

- [ ] A task
- [x] Done

$$x^2$$`;
  currentDocument.name = 'boot.md';
  currentDocument.text = text;
  await window.MDViewer.setContent(text);
}

buildChrome(state);
openFixture();