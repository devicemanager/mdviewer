# Vendored Dependency Provenance

Dev-time supply-chain record for the bundled web libraries in
`MDViewer/Resources/Web/vendor/`. **This file is documentation only** — MDViewer
performs **no runtime version or update checks** and never contacts the network
to validate dependencies. Verification is done here, by hand, at development time.

Verification method: byte-exact SHA-256 comparison against the official artifact
served by `https://cdn.jsdelivr.net/npm/<pkg>@<version>/…` (npm mirror).

_Last verified: 2026-09-07._

| Library | Version | SHA-256 (local file) | Verified vs official |
|---|---|---|---|
| marked | 18.0.6 (UMD) | `62ad5de5bea6d79b4c47e5c0b5cbe4be61e25ee8994595c2cc0969b2a144cc5d` | ✅ identical to CDN (`lib/marked.umd.js` — marked 18 ships no pre-minified single file; vendored as `marked.min.js`) |
| KaTeX | 0.17.0 | `45fbe318fea878fdc0a111913dc1f87894b2c439360d0228c086ef313f213efc` | ✅ identical to CDN |
| mermaid | 11.17.2 | `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8` | ✅ identical to CDN. Bumped from 11.16.0 2026-09-07 for five moderate security advisories — see `porting-brief.md`'s security-fixes note. |
| Shiki | 4.3.1 (bundled) | `9c10cb84e9467ce0b6e317e2615de025a55038ec5e885fd38c3eaee715a57feb` | ✅ reproducibly built from official npm `shiki@4.3.1` (pinned in `tools/shiki-bundle/package-lock.json`) via esbuild — 40 languages + github light/dark. Rebuild: `cd tools/shiki-bundle && npm ci && npx esbuild entry.mjs --bundle --format=iife --minify --outfile=../../MDViewer/Resources/Web/vendor/shiki.bundle.js` |
| DOMPurify | 3.4.15 | `f263b05369e050fa175d4ecb9c9358eb4253602d510297adfb31df48b2f1c4d5` | ✅ identical to CDN (official Cure53 build). Bumped from 3.4.12 2026-09-07 for a moderate XSS advisory — see `porting-brief.md`'s security-fixes note. |

## How to re-verify a library

```bash
cd MDViewer/Resources/Web/vendor
shasum -a 256 <file>
/usr/bin/curl -sL "https://cdn.jsdelivr.net/npm/<pkg>@<version>/<path>" | shasum -a 256
# the two hashes must match
```

## Updating a library

Docs before code — see `docs/development/contributing.md`'s "Documentation"
section. This table states the target version and hash *before* the
vendored file is swapped to match it, not as after-the-fact cleanup.

1. Confirm the target version: `curl -sL https://registry.npmjs.org/<pkg>/latest`
   (or, for a security fix, the version the advisory says fixes it).
2. Compute the SHA-256 of the official CDN/npm artifact for that version
   and record it in the table above, along with the version number.
   Update `docs/project/third-party-notices.md` (version, and any
   version-pinned license URL) too.
3. Only then replace the file under `MDViewer/Resources/Web/vendor/` and
   confirm its local hash matches what you just recorded.
4. Sync the About panel's Credits text in `MDViewer/App/MDViewerApp.swift`
   — hand-maintained, not generated from this table.
5. Rebuild and manually verify the render pipeline before committing.
