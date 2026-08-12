import { saveState } from './state.js';

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
}