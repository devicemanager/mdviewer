import { resolvePathInDirectory } from './pathResolver.js';

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'txt']);

export function isMarkdownFile(fileOrHandleName) {
  const dot = fileOrHandleName.lastIndexOf('.');
  if (dot < 0) return false;
  return MARKDOWN_EXT.has(fileOrHandleName.slice(dot + 1).toLowerCase());
}

async function readFileAsText(file) {
  return file.text();
}

// Open via <input type=file>. Returns {name, text, dirHandle:null}.
export function openViaFileInput(inputEl) {
  return new Promise((resolve, reject) => {
    inputEl.onchange = async () => {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return resolve(null);
      if (!isMarkdownFile(file.name)) return reject(new Error(`Not a Markdown file: ${file.name}`));
      resolve({ name: file.name, text: await readFileAsText(file), dirHandle: null });
    };
  });
}

// Open via File System Access API (Chromium). Best effort: if the picker or
// directory access is unavailable, fall back to showOpenFilePicker without a
// directory handle.
export async function openViaPicker() {
  if (!window.showOpenFilePicker) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.click();
    return openViaFileInput(input);
  }
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
    multiple: false
  });
  const file = await handle.getFile();
  return { name: file.name, text: await file.text(), dirHandle: null };
}

// Extract an array of File items from a drag/drop DataTransfer, filtered to
// markdown files.
export function markdownFilesFromDataTransfer(dt) {
  const out = [];
  for (const item of dt.items || []) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && isMarkdownFile(f.name)) out.push(f);
    }
  }
  if (out.length) return out;
  for (const f of dt.files || []) {
    if (isMarkdownFile(f.name)) out.push(f);
  }
  return out;
}

export async function fileToDocument(file) {
  return { name: file.name, text: await readFileAsText(file), dirHandle: null };
}