// In-memory + localStorage-backed app state.
const STATE_KEY = 'mdviewer.state.v1';

export const defaultState = {
  theme: 'github-light',
  fontSize: 16,
  remoteContentPolicy: 'ask' // 'ask' | 'always' | 'never'
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : { ...defaultState };
  } catch {
    return { ...defaultState };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch { /* private mode — ignore */ }
}

// The currently open document. dirHandle is null when the file has no
// resolvable parent directory (single-file open without folder access).
export const currentDocument = {
  name: null,
  text: null,
  dirHandle: null
};