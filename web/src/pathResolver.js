// Resolve a markdown-relative path (e.g. "img/a.png", "../doc.md") against a
// FileSystemDirectoryHandle. Returns a FileSystemFileHandle, or null when the
// handle cannot be reached. Splits on '/' (and '\' as a fallback), collapses
// "." segments, and walks ".." segments upward.
export async function resolvePathInDirectory(dirHandle, relativePath) {
  if (!dirHandle) return null;
  const parts = relativePath.split('/').flatMap(p => p.split('\\')).filter(Boolean);
  let current = dirHandle;
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      // Directory handles have no parent reference in the spec; bail on '..'.
      return null;
    }
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      try {
        return await current.getFileHandle(part);
      } catch {
        return null;
      }
    }
  }
  return null;
}