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
| marked | 12.0.2 | `15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894` | ✅ identical to CDN |
| KaTeX | 0.16.11 | `e6bfe5deebd4c7ccd272055bab63bd3ab2c73b907b6e6a22d352740a81381fd4` | ✅ identical to CDN |
| mermaid | 10.9.5 | `616a109f19cd186842e11d45b35ac07456b3a75513310f6ea075351aa430b1e2` | ✅ identical to CDN |
| Shiki | custom bundle (~1.x) | `f52bfbe8e7d17145858b82064d31befb5edd5bd467e9ca2d40decff3d0df27d8` | ⚠️ hand-rolled IIFE bundle — cannot single-file hash-verify (see Phase 2: rebuilt reproducibly via `tools/shiki-bundle/`) |
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
