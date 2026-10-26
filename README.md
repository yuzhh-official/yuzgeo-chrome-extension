# yuzgeo

把本地 Markdown 一键保存为多个平台的**草稿**的 Chrome 扩展，并提供 MCP Server 供 AI Agent 调用。

- 首版平台：掘金、知乎、CSDN（后续：阿里云开发者社区、腾讯云开发者社区、抖音、小红书长文）
- 纯本地运行：无服务端、无埋点，内容只发往你选择的平台
- 只创建草稿，最终发布由你在平台上确认

> ⚠️ 本扩展使用你在各平台的登录态调用其创作后台接口，这些接口并非公开 API，可能违反部分平台的用户协议，存在账号风控风险，请自行评估。

## 仓库结构

| 包                    | 说明                                                       |
| --------------------- | ---------------------------------------------------------- |
| `packages/core`       | 平台无关的类型、协议与 Markdown 处理                       |
| `packages/extension`  | WXT + React 的 Chrome 扩展                                 |
| `packages/mcp-server` | `@yuzgeo/mcp-server`，stdio MCP Server + 本地 WebSocket 桥 |

技术方案见 [docs/DESIGN.md](docs/DESIGN.md)。

## 开发

需要 Node.js ≥ 22 和 pnpm。

```bash
pnpm install
pnpm dev          # 启动扩展开发模式（自动打开 Chrome 加载扩展）
pnpm build        # 构建所有包，扩展产物在 packages/extension/.output/chrome-mv3
pnpm test
pnpm lint
pnpm typecheck
```

## License

[MIT](LICENSE)
