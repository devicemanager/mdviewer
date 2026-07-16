# Vendored Dependency Provenance

Dev-time supply-chain record for the bundled web libraries in
`MDViewer/Resources/Web/vendor/`. **This file is documentation only** — MDViewer
performs **no runtime version or update checks** and never contacts the network
to validate dependencies. Verification is done here, by hand, at development time.

Verification method: byte-exact SHA-256 comparison against the official artifact
served by `https://cdn.jsdelivr.net/npm/<pkg>@<version>/…` (npm mirror).

_Last verified: 2026-07-16._

| Library | Version | SHA-256 (local file) | Verified vs official |
|---|---|---|---|
| marked | 18.0.6 (UMD) | `62ad5de5bea6d79b4c47e5c0b5cbe4be61e25ee8994595c2cc0969b2a144cc5d` | ✅ identical to CDN (`lib/marked.umd.js` — marked 18 ships no pre-minified single file; vendored as `marked.min.js`) |
| KaTeX | 0.17.0 | `45fbe318fea878fdc0a111913dc1f87894b2c439360d0228c086ef313f213efc` | ✅ identical to CDN |
| mermaid | 11.16.0 | `74d7c46dabca328c2294733910a8aa1ed0c37451776e8d5295da38a2b758fb9b` | ✅ identical to CDN |
| Shiki | 4.3.1 (bundled) | `9c10cb84e9467ce0b6e317e2615de025a55038ec5e885fd38c3eaee715a57feb` | ✅ reproducibly built from official npm `shiki@4.3.1` (pinned in `tools/shiki-bundle/package-lock.json`) via esbuild — 40 languages + github light/dark. Rebuild: `cd tools/shiki-bundle && npm ci && npx esbuild entry.mjs --bundle --format=iife --minify --outfile=../../MDViewer/Resources/Web/vendor/shiki.bundle.js` |
| DOMPurify | 3.4.12 | `c45ba939765574f96cbf35ee9b6d89f73756a17921814425e74b82f7c54603ce` | ✅ identical to CDN (official Cure53 build) |

## How to re-verify a library

```bash
cd MDViewer/Resources/Web/vendor
shasum -a 256 <file>
/usr/bin/curl -sL "https://cdn.jsdelivr.net/npm/<pkg>@<version>/<path>" | shasum -a 256
# the two hashes must match
```

## Updating a library

1. Confirm the latest version: `curl -sL https://registry.npmjs.org/<pkg>/latest`.
2. Download the official minified artifact from the CDN (never a random mirror).
3. Re-compute + record the SHA-256 here.
4. Rebuild + manually verify the render pipeline before committing.
