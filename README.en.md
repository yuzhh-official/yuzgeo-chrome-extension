<div align="center">

# yuzgeo

**An open-source Chrome extension for cross-posting: save one local Markdown article as drafts on Juejin, Zhihu, CSDN, Alibaba Cloud Developer Community, Tencent Cloud Developer Community, Douyin and Xiaohongshu long posts in one click.**

[简体中文](README.md) · English

[![CI](https://github.com/yuzhh-official/yuzgeo-chrome-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/yuzhh-official/yuzgeo-chrome-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)

</div>

![yuzgeo workspace: article list on the left, Markdown preview in the middle, target platforms and sync progress on the right](docs/assets/dashboard.png)

## What is yuzgeo?

yuzgeo is a **free, open-source (MIT), local-only** Chrome extension for **publishing a technical blog post to multiple Chinese developer platforms**. Write in Markdown on your machine, pick a file or folder, tick the target platforms, and yuzgeo uses the sessions you are already signed in with in your browser to **create one draft per platform**. You review and publish each draft yourself in the platform's editor.

It is built for developers, tech bloggers and teams who write for several Chinese tech communities at once: write once, get a ready draft everywhere, without copy-pasting and reformatting in every editor.

## Features

- **Local Markdown input**: open a single `.md` file or a whole folder; your files are never modified.
- **Front-matter support**: reads `title`, `summary`/`description` and `tags`; falls back to the first H1 when there is no `title`.
- **One-click multi-platform drafts**: each platform reports its own progress, draft link and error, and failed platforms can be retried on their own.
- **Per-platform formatting**: Markdown as-is for Juejin, CSDN, Alibaba Cloud, Tencent Cloud and Douyin; rich text for Zhihu, with code blocks in Zhihu's editor format. For Xiaohongshu long posts, the extension opens the editor in a background tab, fills it in and clicks the editor's own "save draft", so the draft lands in that browser's Xiaohongshu draft box.
- **Preview before syncing**: preview, raw Markdown and per-platform differences, so you know what each platform will receive.
- **Sync history** stored locally, with links to every draft.
- **Privacy first**: no server, no analytics, no cookie collection; host permissions only for supported platforms. When needed, a function runs only in the selected creator platform, without persistent content scripts.

## Supported platforms

| Platform                                             | Draft format                                   | Login check | Drafts                                    | Status                                                                      |
| ---------------------------------------------------- | ---------------------------------------------- | ----------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Juejin (掘金)                                        | Markdown                                       | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| Zhihu (知乎专栏)                                     | Rich text (HTML)                               | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| CSDN                                                 | Markdown                                       | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| Alibaba Cloud Developer Community (阿里云开发者社区) | Markdown                                       | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| Tencent Cloud Developer Community (腾讯云开发者社区) | Markdown                                       | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| Douyin long posts (抖音长文)                         | Markdown                                       | ✅          | ✅                                        | Implemented, pending real-account verification                              |
| Xiaohongshu long posts (小红书长文)                  | Formatted by its editor                        | ✅          | ✅ Saved to the browser's local draft box | Implemented, pending real-account verification                              |
| Sohu (搜狐号)                                        | HTML via editor; code/tables become paragraphs | ✅          | Implemented                               | Account lookup verified; saving blocked by account verification requirement |
| Baijiahao (百家号)                                   | Rich text (HTML)                               | Implemented | Implemented                               | Pending real-account verification                                           |

> **The current version syncs text only.** Headings, paragraphs, code blocks, tables, links and image captions are kept; images and covers are not uploaded yet.

Sohu uses a fresh editor tab and only clicks “存草稿”; account restrictions are respected. Baijiahao uses its draft API with an editor token held only in memory. See [verification notes](docs/PLATFORM-NOTES-sohu-baijiahao.md) for sources and limitations.

## How it works

1. Pick a local Markdown file or folder on the extension page; front-matter and body are parsed in your browser.
2. Tick the platforms you are signed in to; the content is converted to each platform's format (Markdown or rich text).
3. The extension calls each platform's creator draft API with your existing browser session and creates one draft per platform.
4. You get a draft link per platform; review and publish in the platform's editor.

Everything runs in your browser. Your article is only sent to the platforms you select.

## Installation

yuzgeo is not on the Chrome Web Store yet. Build it from source (Node.js ≥ 22 and pnpm required):

```bash
git clone https://github.com/yuzhh-official/yuzgeo-chrome-extension.git
cd yuzgeo-chrome-extension
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `packages/extension/.output/chrome-mv3`. Click the yuzgeo icon in the toolbar to open the workspace.

## Article format

```markdown
---
title: Article title
summary: One-line summary used as the platform excerpt
tags: [frontend, chrome-extension]
---

Your article starts here…
```

## FAQ

**How is this different from copy-pasting?**
yuzgeo converts the article to each platform's format and creates all drafts at once, so code blocks and tables don't need fixing in every editor.

**Does it publish automatically?**
No. yuzgeo only creates drafts; publishing always needs your confirmation on the platform.

**Are my passwords or cookies uploaded?**
No. yuzgeo never asks for passwords, has no server and uploads no cookies. It sends requests to the platforms from your browser, as the user you are already signed in as.

**Are images supported?**
Not yet. Images are skipped and their captions kept. Image upload is planned.

**Why these browser permissions?**
`storage` keeps settings and sync history; `cookies` reads the login markers and CSRF tokens some platforms require; `declarativeNetRequest` sets the origin headers platforms expect on the extension's own requests. Host permissions cover only the supported platforms.

**Is there any risk?**
yuzgeo uses the platforms' creator APIs, which are not public APIs. They can change at any time and may conflict with some platforms' terms of service, which can trigger account risk controls. Evaluate before use.

**Can AI agents use it?**
The repository includes an MCP server skeleton (`@yuzgeo/mcp-server`). It will let AI agents such as Claude save local articles as multi-platform drafts through MCP.

## Roadmap

- [x] Local Markdown parsing, preview and text drafts on multiple platforms
- [x] Juejin, Zhihu, CSDN, Alibaba Cloud and Tencent Cloud developer communities
- [ ] End-to-end verification with real accounts
- [ ] Image and cover upload
- [ ] MCP server for AI agents
- [x] Douyin long posts
- [x] Xiaohongshu long posts
- [x] Sohu and Baijiahao adapters (live draft verification pending)
- [ ] Weibo long articles (deferred)
- [ ] Chrome Web Store release

## Development

```bash
pnpm install
pnpm dev          # dev mode, opens Chrome with the extension loaded
pnpm build        # build all packages; extension output in packages/extension/.output/chrome-mv3
pnpm test
pnpm lint
pnpm typecheck
```

Browser regression tests (isolated temporary browser profile; no personal accounts, no real drafts):

```bash
pnpm --filter @yuzgeo/extension exec playwright install chromium
pnpm --filter @yuzgeo/extension test:ui
pnpm --filter @yuzgeo/extension test:background
```

On Windows you can use an installed Edge: set `$env:YUZGEO_TEST_BROWSER = 'msedge'` in PowerShell before running `test:ui`.

| Package               | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `packages/core`       | Platform-agnostic types, protocol and Markdown processing         |
| `packages/extension`  | The Chrome extension, built with WXT + React                      |
| `packages/mcp-server` | `@yuzgeo/mcp-server`: stdio MCP server and local WebSocket bridge |

See [docs/DESIGN.md](docs/DESIGN.md) for the design (in Chinese). Issues and pull requests are welcome, especially new platform adapters and fixes for API changes.

## License

[MIT](LICENSE)

<sub>Keywords: cross-posting, multi-platform blog publishing, Markdown publisher, Juejin Zhihu CSDN sync, developer blog distribution, Chrome extension, open source</sub>
