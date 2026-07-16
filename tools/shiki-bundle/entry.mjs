// Dev-only entry: bundled by esbuild into
// ../../MDViewer/Resources/Web/vendor/shiki.bundle.js
//
// Reproduces the contract mdviewer.js relies on:
//   window.__shikiReady  -> Promise<HighlighterCore>
//   highlighter.getLoadedLanguages()
//   highlighter.codeToHtml(code, { lang, themes: { light, dark } })
//
// Fine-grained core API + explicit imports so esbuild only bundles the
// grammars/themes we actually ship (keeps the bundle small).
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';

import javascript from '@shikijs/langs/javascript';
import typescript from '@shikijs/langs/typescript';
import jsx from '@shikijs/langs/jsx';
import tsx from '@shikijs/langs/tsx';
import python from '@shikijs/langs/python';
import java from '@shikijs/langs/java';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import csharp from '@shikijs/langs/csharp';
import go from '@shikijs/langs/go';
import rust from '@shikijs/langs/rust';
import ruby from '@shikijs/langs/ruby';
import php from '@shikijs/langs/php';
import swift from '@shikijs/langs/swift';
import kotlin from '@shikijs/langs/kotlin';
import objectivec from '@shikijs/langs/objective-c';
import scala from '@shikijs/langs/scala';
import dart from '@shikijs/langs/dart';
import html from '@shikijs/langs/html';
import css from '@shikijs/langs/css';
import scss from '@shikijs/langs/scss';
import less from '@shikijs/langs/less';
import json from '@shikijs/langs/json';
import yaml from '@shikijs/langs/yaml';
import toml from '@shikijs/langs/toml';
import xml from '@shikijs/langs/xml';
import markdown from '@shikijs/langs/markdown';
import bash from '@shikijs/langs/bash';
import shellscript from '@shikijs/langs/shellscript';
import powershell from '@shikijs/langs/powershell';
import sql from '@shikijs/langs/sql';
import graphql from '@shikijs/langs/graphql';
import docker from '@shikijs/langs/docker';
import make from '@shikijs/langs/make';
import ini from '@shikijs/langs/ini';
import diff from '@shikijs/langs/diff';
import lua from '@shikijs/langs/lua';
import perl from '@shikijs/langs/perl';
import r from '@shikijs/langs/r';
import vue from '@shikijs/langs/vue';

window.__shikiReady = createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [
        javascript, typescript, jsx, tsx, python, java, c, cpp, csharp, go,
        rust, ruby, php, swift, kotlin, objectivec, scala, dart, html, css,
        scss, less, json, yaml, toml, xml, markdown, bash, shellscript, powershell,
        sql, graphql, docker, make, ini, diff, lua, perl, r, vue,
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
});
