# Remote Images Test

A manual check of **Settings → Privacy → Internet images**. Every image
below is MDViewer's own, hosted on GitHub
(`github.com/devicemanager/mdviewer`). The automated version of this is
`web/e2e/remoteImages.e2e.ts` (`npm run test:e2e` in `web/`).

What to expect when this file opens:

| Setting | Prompt | Images below |
|---------|--------|--------------|
| Ask | "Load remote content?" — *references 5 images* | blank until you tap **Load** or **Always Allow** |
| Always | none | all 5 load |
| Never | none | all blank |

**Don’t Load** closes the prompt and leaves them blank. **Always Allow**
also switches the setting to Always, so the next file loads without asking.

---

## 1. A Markdown image

![MDViewer icon](https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png)

## 2. Through a github.com link (redirects to raw.githubusercontent.com)

![Screenshot](https://github.com/devicemanager/mdviewer/raw/main/docs/screenshot.png)

## 3. From the GitHub Pages site

<img src="https://devicemanager.github.io/mdviewer/icon.png" width="64" alt="MDViewer icon from the Pages site">

## 4. Light/dark logo with `<picture>`

Only the `<img>` inside loads; the dark variant’s `srcset` is removed by
the sanitizer, so this shows the screenshot in every theme.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?variant=dark">
  <img alt="Screenshot via picture" src="https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/screenshot.png?variant=light" width="240">
</picture>

## 5. A second Markdown image

![Icon again](https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?copy=2)

---

## Must never load — under any setting

These reference images without an `<img>` tag. The app blocks them under
Ask, Always *and* Never, and they don’t count towards the prompt’s
number. If an icon appears anywhere in this section, that’s a privacy bug.

<p style="padding:24px;background:url(https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?via=style-attr) no-repeat">CSS background in a <code>style</code> attribute — this box should stay plain.</p>

<table background="https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?via=table-bg"><tr><td>Table background — should stay plain.</td></tr></table>

<svg width="64" height="64"><image href="https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?via=svg-image" width="64" height="64"/></svg>

*(above: an SVG `<image>` — should be an empty square)*

<video poster="https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png?via=video-poster" width="120"></video>

*(above: a video poster — should be an empty player, or nothing)*
