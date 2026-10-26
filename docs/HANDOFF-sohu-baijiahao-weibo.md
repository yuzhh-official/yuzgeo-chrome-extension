# Handoff：接入搜狐号、百家号、微博头条文章

日期：2026-10-26。接手方：Codex。

## 1. 任务

为 yuzgeo 新增三个平台适配器，让用户把本地 Markdown **保存为草稿**：

| 平台 id（建议） | 名称         | 创作后台（待确认）                         |
| --------------- | ------------ | ------------------------------------------ |
| `sohu`          | 搜狐号       | `https://mp.sohu.com`                      |
| `baijiahao`     | 百家号       | `https://baijiahao.baidu.com`              |
| `weibo`         | 微博头条文章 | `https://card.weibo.com/article/v5/editor` |

完成标准：

- 三个平台出现在工作台平台列表里，能显示登录状态和用户名。
- 已登录时，用 `examples/test-post/hello-yuzgeo.md` 同步，各自在平台草稿箱生成一篇草稿；返回的 `draftUrl` 能打开该草稿或草稿列表。
- 单元测试、类型检查、lint、构建全部通过（命令见第 6 节）。
- README.md / README.en.md 平台表、路线图同步更新；docs/DESIGN.md 3.4 平台评估表补上三行。

## 2. 硬性边界（不可违反）

1. **只存草稿，绝不发布。** 不调用任何发布接口，不点击任何含“发布”的按钮。参照 `packages/extension/src/platforms/douyin/api.ts` 的 `assertDraftOnlyPath`，对请求路径做“只允许草稿”的断言并写测试。
2. **当前版本只同步文字。** `uploadImage` 一律 `Promise.reject(new Error('<平台>暂不支持图片上传'))`，与现有适配器一致。正文由 core 的 `textOnlyMarkdown` 处理过，图片只剩说明文字。
3. **纯本地。** 无服务端、无埋点；Cookie 只在构造请求头时读取，不持久化、不外发。
4. **最小权限。** 只把新平台确实要访问的域名加进 `PLATFORMS[].hostPermissions`（会自动进入 manifest）。不加 `<all_urls>`，不加全站内容脚本，不新增 manifest 权限（现有：storage、cookies、declarativeNetRequestWithHostAccess、scripting）。
5. **开源合规（MIT 公开仓库）。** `~/Downloads/csdn-sync-assistant/` 是一个闭源扩展的解包，**只能**从中取事实信息（接口地址、字段名、返回结构）；**不得复制、改写它的代码或大段数据模板**。实现必须自己写。
6. **Git。** 工作区当前有未提交改动（抖音、小红书适配器、`lib/page-context.ts`、README 等），**不要回滚、不要 stash 掉**，在其上继续。**不要提交或推送**，除非用户明确要求；需要提交时作者邮箱用 `luozongyuan@yuzhh.com`（已在仓库本地 git config 设置）。

## 3. 代码结构与接入步骤

monorepo（pnpm 11，Node ≥ 22，TypeScript 6.0.3，vitest 5，WXT 0.21.4 + React 19）。

接入一个平台要改这些地方：

1. `packages/core/src/platforms.ts`：在 `PLATFORM_IDS` 和 `PLATFORMS` 里加条目（`id`、`name`、`homepage`、`hostPermissions`、`format`）。`format: 'html'` 时 core 会渲染 HTML，平台定制可通过适配器的 `htmlOptions`（参考知乎）。同步更新 `platforms.test.ts`。
2. `packages/extension/src/platforms/<id>/`：
   - `api.ts`：常量（ORIGIN、接口 URL）、纯函数（请求体构造、响应解析），便于单测。
   - `index.ts`：导出 `ExtensionAdapter`（类型见 `platforms/types.ts`）：`meta`、`headerRules`、`checkAuth`、`uploadImage`、`createDraft`。
   - `<id>.test.ts`：vitest 单测，mock `fetch` / `browser.*`，覆盖请求体、响应解析、未登录、错误码、只草稿断言。
3. `packages/extension/src/platforms/index.ts`：注册适配器。
4. 文档：README 双语平台表与路线图、DESIGN.md 3.4。

工具函数：

- `lib/http.ts`：`request` / `requestJson`（`credentials: 'include'`，非 2xx 抛 `HttpError`）、`jsonBody`、`getCookie`。
- `headerRules`：后台为本扩展自己的请求设置 Origin/Referer（DNR 会话规则，限定 `initiatorDomains: [runtime.id]`）。平台校验来源时用它。
- `lib/page-context.ts` 的 `runInPage(target, func, args, signal)`：在平台标签页的 MAIN world 执行一个**自包含**函数（不能引用闭包外变量，参数须可 JSON 序列化），函数返回 `PageResult<T>`、不抛异常。`fresh: true` 时总是新开后台标签页并在结束后关闭。

三种实现方式，按优先级选：

| 方式                    | 何时用                             | 参考                               |
| ----------------------- | ---------------------------------- | ---------------------------------- |
| A. 后台直接调接口       | 草稿接口只依赖 Cookie / CSRF 头    | `aliyun`、`tencentcloud`、`juejin` |
| B. 在平台页面内发请求   | 接口需要页面脚本生成的签名或 token | `douyin`                           |
| C. 驱动平台自己的编辑器 | 没有可用的服务端草稿接口           | `xiaohongshu`（`editor.ts`）       |

`checkAuth` 约定：未登录返回 `{ loggedIn: false }`，网络等异常才抛错；401/403 视为未登录。错误信息用中文、面向用户。

## 4. 各平台已知线索（全部待实测确认）

### 微博头条文章

参考扩展中出现过的地址（事实信息，需自己抓包确认字段）：

- 编辑器页：`https://card.weibo.com/article/v5/editor`
- 草稿：`https://card.weibo.com/article/v5/aj/editor/draft/create?uid=`、`.../draft/save?uid=`、`.../draft/historylist?uid=`
- 发布：`.../draft/publish?uid=` —— **禁止调用**，在只草稿断言里显式拒绝 `publish`。
- 参考扩展把它标为 html 格式，登录检测走 card.weibo.com。
- 需要 `uid`：确认从哪里稳定拿到（Cookie、页面、接口）。
- 可能需要 `Referer: https://card.weibo.com/article/v5/editor`；遇到 `security.weibo.com/verify` 说明触发风控，返回明确错误，别重试。

### 百家号

参考扩展中出现过的地址：

- 账号信息 / 登录检测：`https://baijiahao.baidu.com/builder/app/appinfo`
- 编辑页：`https://baijiahao.baidu.com/builder/rc/edit`（草稿编辑：`?type=news&article_id=<id>`，可作 `draftUrl`）
- 保存草稿：`https://baijiahao.baidu.com/pcui/article/save`（参考扩展带 `callback=bjhdraft` 参数）
- 参考扩展标为 html 格式，“草稿走接口；发布在编辑页注入脚本”。我们只做草稿接口。
- 需确认 token（如编辑页或 appinfo 返回的 token）放在哪个头/字段里。

### 搜狐号

参考扩展**没有**覆盖搜狐号，需要从零抓包：

1. 登录 `https://mp.sohu.com`，打开新建文章编辑器，用 DevTools Network 观察“保存草稿 / 自动保存”请求：URL、方法、请求体字段、所需头（Cookie 之外是否有 token / 签名）。
2. 找账号信息接口做 `checkAuth`。
3. 判断用方式 A 还是 B；正文格式大概率是 html。

## 5. 小红书实测得到的经验（驱动编辑器时有用）

- 平台按钮常是组件库 `<button>` 包着多层 span；**点内层 span 可能不触发**，要 `closest('button, [role="button"], a')` 后再点。
- 落地页上的标签文字（如“写长文”）也会匹配文本查找，要区分“入口按钮”和“当前标签”，并允许重试点击（页面可交互前的点击会丢失）。
- 富文本编辑器（Tiptap/ProseMirror 等）的 schema 有限：粘贴前先把代码块拆成逐行段落、表格拆成逐行段落、过深标题降级，否则会被压平或丢失。
- 用“新出现的成功提示 / 草稿数变化 / URL 变化”确认保存成功，不要把已存在的“已保存”字样当成功。

## 6. 验证

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm exec prettier --check .
pnpm build    # 扩展产物：packages/extension/.output/chrome-mv3
```

真实账号验证需要用户在自己的 Chrome 登录对应平台，加载 `.output/chrome-mv3`，用测试文章同步并到平台草稿箱确认；测试文章标题请带“（请勿发布）”。验证完把 README 平台表的状态写成实际结果（“已接入，待真实账号验证”或“已实测”）。

## 7. 交付时请说明

- 每个平台用了哪种方式（A/B/C）、草稿接口和登录检测接口、哪些字段是实测确认的、哪些仍是推测。
- 新增的 hostPermissions 及理由。
- 测试 / 构建结果；未完成或未验证的部分。
