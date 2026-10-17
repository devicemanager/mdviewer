# Contributing to MDViewer

Thank you for your interest in contributing. This guide covers how changes are made in this repository while the Swift app is being ported to Tauri. [Setup](setup.md) gets your environment running; [Architecture](architecture.md) explains the code.

## Ground rules during the port

Until the Tauri port works on all five platforms (macOS, Windows, Linux, Android, iOS), these rules apply. The full version is `docs/project/porting-brief.md`.

- **The Swift tree is the reference. Don't modify it.** That covers `MDViewer/**/*.swift` and `MDViewerTests/`. If the Swift code looks wrong, say so in the PR or `plan.md` rather than fixing it silently.
- **Parity first, improvements later.** New features and redesigns wait for Phase 2 in `docs/project/plan.md`. Deviations found along the way get flagged, not blocked on.
- **`mdviewer.js` is generated.** The source is `web/src/*.ts`; `npm run build` in `web/` overwrites `MDViewer/Resources/Web/mdviewer.js`, so edits made directly to it are lost.
- **Vendored libraries and `mdviewer-base.css` / `renderer.html` stay as they are.** Port-only styling goes in `app.css`. The exception is security fixes, which follow the procedure below. Themes are another: they follow the token contract in [Colour & contrast](color-and-contrast.md).
- **Security invariants are not relaxed.** These are listed under Security in [Architecture](architecture.md): custom scheme, CSP, DOMPurify, link restrictions, remote-image policy and per-folder file access.

## Reporting bugs and requesting features

Open a [GitHub issue](https://github.com/devicemanager/mdviewer/issues).

- **Bugs:** include the steps to reproduce, the expected and actual behaviour, and the platform and app version (Swift app or which Tauri build). Attach a sample `.md` file or a screenshot if you can. iPhone testers can send feedback with a screenshot straight from TestFlight.
- **Feature requests:** describe the problem, your proposed solution, and the alternatives. During the port, new features are collected for Phase 2 rather than built.

## Code conventions

**TypeScript (`web/`):**
- Strict mode, ESM, Node 22.
- Use `T | undefined` for optional values, never `null`.
- Swift structs become interfaces and plain objects, not classes.
- One Swift file maps to one module of the same name in camelCase (`RenderViewModel.swift` → `renderViewModel.ts`). A module with no Swift source says so in its header comment.
- Vendor libraries (`marked`, `shiki`, `katex`, `mermaid`, `DOMPurify`) are globals loaded by the page. Don't import or bundle them.

**Rust (`src-tauri/`):**
- Keep Rust to what needs the OS: files, pickers, permissions, watching, links.
- Commands that block (dialogs, pickers) must be `async` with `spawn_blocking`. Otherwise they deadlock on iOS's main thread.

**Comments:** explain *why*, especially workarounds for real platform bugs. Several oddities are deliberate; the header comments and `file-browser-plan.md` §5 record them.

## Making a change

1. **One concern per commit**, and one file per change where practical. Don't port a whole directory in one pass.
2. **Write tests alongside the code:**
   - web modules get vitest tests in `web/test/`;
   - Rust commands get `cargo test` cases using `tauri::test`;
   - when porting a Swift file, port its `MDViewerTests` cases with it.
3. **Run the checks** that apply:
   ```bash
   cd web && npm run typecheck && npm test && npm run build
   cd web && npm run test:visual          # after any CSS, theme or diagram-colour change
   cd src-tauri && cargo test --offline   # after Rust changes
   ```
4. **Check it in the app**, not only in tests: desktop (`npm run tauri dev`), and the iOS Simulator or an OTA build for anything touching mobile layout. Screenshots of real devices have caught bugs that every test missed.
5. **Commit messages** say what changed and why: "Fit the document to the phone screen", not "fix css".

## Documentation

**Documentation comes before the change it describes, not after.** When a change has a paper trail (a version bump, a recorded hash, a provenance table), write the doc update first or in the same commit, stating the target state. Then make the code or asset change match it. A doc that still describes the old state, even briefly, can't be trusted at a glance. This applies especially to `docs/project/supply-chain.md`, which is a security-relevant provenance record.

Where things are recorded:

| File | What goes in it |
|---|---|
| `docs/project/changelog.md` | User-visible changes, under `[Unreleased]` |
| `docs/project/plan.md` | Port progress, open questions, deferred work |
| `docs/project/porting-brief.md` | Rules for the port (the target of `CLAUDE.md`) |
| `docs/project/supply-chain.md` | Vendored library versions and hashes |
| `docs/development/*` | How the code works and how to build it; update when structure or setup changes |
| `docs/user-guide/*` | Features and keyboard shortcuts, for users |

### Diagrams

Draw diagrams in Mermaid, in the house style used in [Architecture](architecture.md):
- **Header:** start each diagram with `look: handDrawn` and the handwriting `fontFamily`. Don't set `theme`/`themeVariables`, so the diagram follows light and dark mode by itself.
- **Colours** are outlines with a translucent fill of the same colour (`fill:#RRGGBB26`):

  | Colour | Hex | Used for |
  |---|---|---|
  | Blue | `#2888e2` | web page / UI |
  | Green | `#63931f` | Rust core / view models |
  | Red | `#ff3030` | OS and utilities |
  | Orange | `#cb6c00` | storage and models |
  | Purple | `#ce44f0` | extensions and debug |

- **Group boxes** are outlined only: `style <id> fill:none,stroke:<colour>`.
- **Don't set `color:`.** Text follows the theme; no single text colour is readable on all six theme backgrounds.
- **The palette above is tuned to reach at least 3:1 on every theme's background.** `npm test` (`web/test/docDiagrams.test.ts`) checks every outline, fill and text colour in every diagram under `docs/`, and `npm run test:visual` measures the rendered diagrams' text in every theme.

## Common tasks

### Adding or changing a theme

1. Create or edit `MDViewer/Resources/Web/themes/<name>.css`. Define **every** token in the contract (`--bg-color`, `--surface-color`, `--text-color`, `--muted-color`, `--link-color`, `--accent-bg`/`--accent-fg`, `--border-color`, and the content tokens). A missing token silently falls back to a light value.
2. Register it in `web/src/markdownTheme.ts`, including its `isDark` flag.
3. Run `npm run test:visual` until it passes, and look at the screenshots in `web/visual-output/`.

### Fixing a rendering issue

- **Markdown output** (parsing, code, math, diagrams, sanitizing): `web/src/`. Start from `mdviewerApi.ts` and add a test in `web/test/`.
- **Document styling:** `app.css` for the port. `mdviewer-base.css` and the themes are shared with the Swift app.
- **Interface** (toolbar, drawer, Preferences): the matching `web/src` module and `app.css`.
- **Files, links, permissions:** `src-tauri/src/lib.rs`.

### Updating a vendored web dependency

Docs first, per the rule above: the provenance record states the target before the vendored file changes to match it.

1. Confirm the target version and, if this is a security fix, exactly which advisories it resolves.
2. Update to the target state:
   - `docs/project/supply-chain.md`: version, and SHA-256 of the official artifact;
   - `THIRD_PARTY_NOTICES.md`: version, and any version-pinned license URL;
   - the pinned versions in `porting-brief.md`.
3. Only then replace the file under `MDViewer/Resources/Web/vendor/`. Check that it's byte-identical to the npm/CDN artifact (the hash from step 2), and bump the matching exact-version devDependency in `web/package.json`.
4. Update the credits in `web/src/aboutPanel.ts`. A test pins them to the vendored versions. The Swift About panel (`MDViewerApp.swift`) is Swift source and stays untouched during the port; that mismatch is recorded as a known follow-up.
5. Run the unit tests and the visual audit, and check rendering in the app before committing.

## Before opening a pull request

- [ ] Builds without warnings; `typecheck`, `npm test` and `cargo test` pass
- [ ] `npm run test:visual` passes if CSS or themes changed
- [ ] `npm run build` run, so `mdviewer.js` matches `web/src`
- [ ] Checked in the running app on the affected platform(s)
- [ ] No Swift source modified; no debug-only code or test hooks left behind
- [ ] Changelog and docs updated (before or with the change)
- [ ] One concern per commit, clear messages, no unrelated changes

## Communication

- **Issues:** bugs and feature requests.
- **Discussions:** questions and ideas.
- **Pull requests:** keep discussion focused on the change. Be open to feedback; review comments are about the code, not the person.

## Code of conduct

Be kind. Treat everyone with respect. Discrimination, harassment and toxicity have no place here.
