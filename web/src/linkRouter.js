// Decides the fate of a clicked link. The engine posts link.href, which is the
// ALREADY-RESOLVED absolute URL (a relative "./other.md" arrives as
// "http://localhost:5173/other.md", matching the current origin). Returns:
//  {type:'external', url}   -> open in new tab
//  {type:'local', name}     -> load .md relative to the current document folder
//  {type:'ignore'}
export async function routeLink(href) {
  let url;
  try { url = new URL(href, location.href); } catch { return { type: 'ignore' }; }

  const scheme = url.protocol.replace(':', '').toLowerCase();

  // Same-origin: a markdown path is a local document to open in-app.
  if (url.origin === location.origin) {
    const rel = url.pathname.replace(/^\//, '');
    if (/\.(md|markdown|mdown|mkd|txt)$/i.test(rel)) {
      return { type: 'local', name: rel };
    }
    return { type: 'ignore' };
  }

  // http/https/mailto -> external.
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
    return { type: 'external', url: href };
  }

  // file:/mdviewer-local: -> only a .md under the current directory is usable
  // in a browser; the directory handle is the sandbox boundary we control.
  if (scheme === 'file' || scheme === 'mdviewer-local') {
    const rel = url.pathname.replace(/^\//, '');
    if (/\.(md|markdown|mdown|mkd|txt)$/i.test(rel)) {
      return { type: 'local', name: rel };
    }
  }

  return { type: 'ignore' };
}

export function openExternal(url) {
  window.open(url, '_blank', 'noopener');
}