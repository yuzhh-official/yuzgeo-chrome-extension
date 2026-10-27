# yuzgeo 多平台草稿同步扩展：技术方案（草案）

> 当前阶段仅同步 Markdown 文字内容：图片保留说明文字，封面忽略，不读取或上传图片。下文图片上传、公式转图片等设计保留作后续规划，当前扩展不提供这些功能。

## 0. 目标与边界

- **输入**：本地 Markdown 文件（含 front-matter 和相对路径图片）。
- **输出**：在目标平台**创建草稿**，第一版不做直接发布。
- **目标平台**：CSDN、知乎、掘金、抖音、小红书、阿里云开发者社区、腾讯云开发者社区。
- **AI Agent 驱动**：通过 MCP 让 Claude 之类的 Agent 调用扩展创建草稿。
- **纯本地**：没有自建服务端，不做埋点，不向任何第三方以外的地方发送数据。
- **公开**：上架 Chrome 应用商店，同时在 GitHub 开源。
- **更新**：只通过发版更新，没有远程配置，也没有远程代码。

**不做**：AI 改写、直接发布、账号体系、云端存储。

## 1. 技术选型

| 项       | 选择                                                 | 理由                                                     |
| -------- | ---------------------------------------------------- | -------------------------------------------------------- |
| 扩展框架 | **WXT**                                              | 原生支持 MV3、HMR、多入口；manifest 由代码生成；社区活跃 |
| 语言     | TypeScript（strict）                                 | 适配器多，强类型能降低维护成本                           |
| UI       | React 19 + Tailwind CSS                              | 开源贡献者门槛低                                         |
| Markdown | unified / remark / rehype                            | AST 级处理，按平台插件化转换                             |
| 公式     | KaTeX（离线渲染）                                    | 体积比 MathJax 小                                        |
| Mermaid  | mermaid，在 offscreen 文档中渲染成 PNG               | Service Worker 里没有 DOM                                |
| 包管理   | pnpm workspace（monorepo）                           | 扩展和 MCP Server 共用核心代码                           |
| 测试     | Vitest（单测）+ Playwright（加载扩展做 E2E）         |                                                          |
| CI       | GitHub Actions：lint、test、build，打 tag 时产出 zip |                                                          |

## 2. 仓库结构

```
packages/
  core/          # 与运行环境无关：front-matter 解析、Markdown AST 转换、平台渲染器、协议类型
  extension/     # WXT 扩展：background、dashboard 页、popup、offscreen
    src/platforms/<id>/   # 每个平台一个适配器目录
  mcp-server/    # npm 包 @yuzgeo/mcp-server：stdio MCP server + 本地 WebSocket 桥
docs/
```

## 3. 整体架构

```
┌──────────── Chrome 扩展 ─────────────┐
│ Dashboard 页（扩展页）               │
│   选文件或目录 → 预览 → 选平台 → 存草稿 │
│        │ runtime 消息                 │
│ Background Service Worker            │
│   TaskQueue → PlatformAdapter[]      │◄── WebSocket（127.0.0.1，配对 token）
│   DNR 改写 Origin/Referer            │        ▲
│   Offscreen：mermaid、图片转码       │        │
└──────────────────────────────────────┘   @yuzgeo/mcp-server（Node）
                                           stdio ⇄ Claude 等 MCP 客户端
                                           读取本地 md 和图片
```

### 3.1 输入：本地 Markdown

- **扩展端**：Dashboard 页支持拖拽或选择文件。用 `showDirectoryPicker()` 读取整个目录，以解析 `./images/a.png` 这类相对路径的图片。
- **MCP 端**：MCP Server 直接读取磁盘上的文件，把 Markdown 正文和图片的二进制内容（分块传输）一起发给扩展。
- **front-matter 约定**：

```yaml
title: 标题
summary: 摘要
tags: [前端, Chrome]
cover: ./cover.png
platforms: # 可选：按平台覆盖字段
  juejin: { category: 前端, tags: [...] }
  csdn: { tags: [...] }
```

### 3.2 处理流程（packages/core）

```
md 文本
  → 解析成 AST，提取 front-matter
  → 收集图片：本地、远程、data URI，统一成 ImageRef 列表
  → 对每个目标平台：
      1. 预检：标题长度、封面、字数、标签数量等平台约束
      2. 上传图片到平台图床
         - 同一平台内对图片做哈希去重
         - 限速，失败重试
      3. 按平台渲染：
         - md 直传：掘金、CSDN、阿里云、腾讯云
         - 转 HTML：知乎
         - 公式：转 SVG、PNG 或保留 TeX，由平台能力表决定
         - 代码块、表格降级
      4. 调用 adapter.createDraft()
  → 汇总每个平台的结果：草稿链接或错误原因
```

### 3.3 平台适配器接口

```ts
interface PlatformAdapter {
  meta: {
    id: string;
    name: string;
    homepage: string;
    hosts: string[];
    format: 'markdown' | 'html';
    capabilities: Capabilities;
  };
  checkAuth(): Promise<{ loggedIn: boolean; username?: string }>;
  uploadImage(img: Blob, ctx): Promise<string>; // 返回平台图床 URL
  createDraft(post: RenderedPost, ctx): Promise<{ draftUrl: string; id: string }>;
}
```

- **请求方式**：在 background 中用 `fetch(url, { credentials: 'include' })`，浏览器会带上用户在该平台的 Cookie。
- **Origin/Referer**：通过 DNR 动态规则改写。规则条件写死 `initiatorDomains: [chrome.runtime.id]`，只影响本扩展发出的请求。每个任务结束后删除规则。
- **页面上下文回退**：接口需要页面自己生成风控签名的平台（预计抖音、小红书），在后台标签页打开创作者中心，用 `scripting.executeScript({ world: 'MAIN' })` 在页面内发起请求。遇到验证码，把标签页切到前台交给用户处理。
- **登录态缓存**：已登录缓存 10 分钟，未登录缓存 10 秒。

### 3.4 平台评估

难度和方式都是预估，需要逐个抓包确认。

| 平台             | 格式 | 预计方式                                  | 难度 | 备注                                                |
| ---------------- | ---- | ----------------------------------------- | ---- | --------------------------------------------------- |
| 掘金             | md   | 直接调接口；图片走 ImageX，需要 AWS4 签名 | 中   | 接口相对稳定                                        |
| 知乎             | html | 直接调草稿接口；图片需 STS 加 OSS 签名    | 中   | 只存草稿，不需要 x-zse 签名                         |
| CSDN             | md   | 编辑器接口带网关签名                      | 中高 | 需要研究 mp.csdn.net 编辑器自身的签名方式           |
| 阿里云开发者社区 | md   | 接口加 `c_csrf`                           | 中   |                                                     |
| 腾讯云开发者社区 | md   | 接口；图片走 COS 临时密钥                 | 中   |                                                     |
| 抖音             | md   | 页面上下文                                | 高   | 风控重，可能遇到验证码                              |
| 小红书           | md   | 页面上下文，借用页面的签名函数            | 高   | 需确认长文是否有服务端草稿                          |
| 搜狐号           | html | 页面账号接口 + 新建编辑器点击存草稿       | 中高 | 当前账号未实名，保存禁用；代码/表格按行转段落       |
| 百家号           | html | 草稿接口 + 编辑器 token                   | 中高 | 历史协议线索，待真实账号验证                        |
| 微信公众号       | html | 后台草稿接口，临时 token                  | 中高 | 公开协议实现，待真实账号验证；不保存含 token 的链接 |
| 头条号           | html | 新建编辑器自动保存                        | 中高 | 已实测；代码/表格转段落；不调用发布操作             |
| 凤凰网大风号     | html | 暂缓                                      | —    | 按用户要求暂缓，未注册为可同步平台                  |
| 微博头条文章     | html | 暂缓                                      | —    | 按用户要求本轮不接入                                |

### 3.5 MCP 通道

- **`@yuzgeo/mcp-server`**（Node，通过 npx 运行）
  - 对 MCP 客户端走 stdio。
  - 同时在 `127.0.0.1:<port>` 起 WebSocket 服务，默认端口待定，比如 17321。
- **连接方向**：扩展是 WebSocket 客户端，主动去连 Server。MV3 扩展不能监听端口，所以只能这样。
- **安全**
  - 只监听 127.0.0.1。
  - Server 校验 Origin 是否为 `chrome-extension://<正式扩展 ID>`；开发模式下可以配置扩展 ID。
  - **配对 token**：扩展生成 token 并显示在 popup 里，用户把它配置进 MCP 的环境变量。
  - 默认关闭，需要用户手动开启。
  - Agent 只能创建草稿，无法直接发布。
- **MCP 工具**：
  - `list_platforms`：平台列表及登录状态。
  - `create_drafts`：参数为 `{ file: 本地路径, platforms: [] }`，或直接传 markdown 和图片。
  - `get_task`：查询任务进度和结果。
- **保活**：MV3 的 Service Worker 会休眠，用 `alarms` 定时重连。有活跃的 WebSocket 连接时，Chrome 116 及以上版本会延长 Service Worker 的存活时间。

## 4. 安全与隐私原则

吸取 CSDN 同步助手的教训。

1. **最小权限**
   - `host_permissions` 只列 7 个平台的域名。
   - 用户启用某个平台时，再通过 `optional_host_permissions` 申请对应权限。
   - **不使用 `<all_urls>`**，也**不注入任何全站内容脚本**。
2. **没有网页 API**
   - 不使用 `externally_connectable`，也不在页面上暴露任何全局对象。
   - 扩展只能从自己的扩展页或经过配对的 MCP 连接接收指令。
3. **消息校验**：background 只接受 `sender.id === chrome.runtime.id` 并且来自扩展页（`sender.url` 以 `chrome-extension://` 开头）的消息。
4. **不写死密钥**：代码里不放任何 secret。各平台需要的签名材料都来自平台自己的接口或页面。
5. **Cookie**
   - 只在构造平台 CSRF 头时读取个别 Cookie，比如阿里云的 `c_csrf`。
   - **不持久化，不外发**。
   - 可以的话不申请 `cookies` 权限，改从页面或接口获取。
6. **零埋点**：只有在用户自己点击“复制诊断信息”时，才在本地导出日志。
7. **开源合规**
   - 独立实现：可以参考公开资料、自己抓包，以及同类工具调用平台接口的方式（接口地址、字段名等事实信息），但**不复制**任何闭源扩展的代码。
   - 提供 PRIVACY.md，用于商店审核。
   - 在 README 中提示：本扩展调用的是平台的非公开接口，可能违反部分平台的协议，账号风险由用户自负。

## 5. 里程碑

| 阶段 | 内容                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| M0   | monorepo 脚手架、WXT、CI、lint、协议类型                                             |
| M1   | core 处理流程；Dashboard（选择文件或目录、预览、选平台、看结果）；**掘金和知乎**跑通 |
| M2   | CSDN、阿里云、腾讯云；图片去重和重试；同步历史（存 chrome.storage.local）            |
| M3   | MCP Server 与 WebSocket 桥；配对 UI；发布到 npm                                      |
| M4   | 抖音、小红书（页面上下文方案）                                                       |
| M5   | 隐私政策、商店素材、上架；GitHub Release 自动打包                                    |

每完成一个平台，都要补一份基于录制响应的契约测试（fixture），平台接口一变就能及时发现。

## 6. 已确认决策

- 开源许可证：**MIT**。
- 扩展名称 `yuzgeo`，npm scope `@yuzgeo`。
- 抖音、小红书都做**长文**。
- 首版平台：**掘金、知乎、CSDN**。
- 工具链：TypeScript 6.0（typescript-eslint 暂不支持 7.x）、WXT 0.21.4。
