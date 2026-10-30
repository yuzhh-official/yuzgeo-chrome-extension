# 搜狐号、百家号接入记录

2026-10-28 更新：已处理搜狐号新建页自动恢复旧草稿的情况，用户重新加载扩展后确认真实账号同步成功。以下未实名/未验证描述为 10 月 26 日的历史记录，最新状态见[故障修复与验收](DRAFT-FIXES-2026-10-28.md)。

日期：2026-10-26。范围按用户最新指示缩小为搜狐号和百家号；微博暂停，未注册适配器。所有新增操作仅保存文字草稿。

## 搜狐号

采用方式 C：在新建文章标签页调用自包含的编辑器操作函数；登录校验采用方式 B，在平台页面内请求账号接口。不会改动用户已有的编辑器。

本轮在官方页面实测确认的事实：

- 创作中心：`https://mp.sohu.com/home`。
- 新建图文：`https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle`。
- 账号请求：`GET /mpbp/bp/account/info?accountId=...`；成功响应含 `code: 2000000`、`success: true`、`data.id`、`data.nickName`。
- 当前账号 ID 取自站点自身 localStorage 的 `currentAccount.id`，必须再经服务端验证；不把缓存或 Cookie 存在视为已登录。
- 不带 accountId 的账号请求返回 `code: 6000003`，因此不使用无参数请求。
- 页面自身请求携带 `sp-cm` / `dv-id` 客户端标识；省略它们返回 `code: 1301`（获取客户端失败）。标识取自页面已有的 `preview-sp-cm` 和 `dv-id` / `preview-dv-id`，只在页面内请求本站账号接口，不传回扩展、不自行生成。带齐标识后，新增账号检测函数已在真实页面确认返回登录状态和用户名。
- 标题输入框提示 5–72 字，正文是 `.ql-editor[contenteditable=true]`。保存控件文字为“存草稿”。当前账号未实名，该控件带 `disable-button`，实测点击未产生保存请求。

实现保留平台限制，不移除 disabled、不调用内部保存处理器、不尝试其他写入接口。正文以 HTML 粘贴；为适配编辑器，代码按行、表格按行转换为段落。只在标题及全文文字校验通过后点击保存。必须出现新的成功提示，或内容列表包含该标题，才认定成功。返回内容管理页供用户查看草稿；`local-` 前缀 ID 仅为扩展内部追踪标识，不冒充服务端文章 ID。

**未验证**：有保存权限的账号能否完整落地测试文章；真实保存接口和成功提示形态。保存成功分支目前通过隔离浏览器夹具验证，不等于真实平台保存成功。

## 百家号

采用方式 A：扩展后台请求账号信息和编辑器页面，从页面提取 token，再提交草稿。只允许 `/pcui/article/save`，可选查询参数严格限定为 `callback=bjhdraft`；禁止发布路径、未知查询参数和跨域重定向。不会执行返回的 JSONP 或编辑页脚本。

协议事实来自交接文档和 [Wechatsync 历史适配器](https://github.com/wechatsync/Wechatsync/blob/old/packages/@wechatsync/drivers/src/baijiahao.js)，仅参考接口/字段，不复制其代码或大段模板：

- 登录：`GET https://baijiahao.baidu.com/builder/app/appinfo`，账号字段 `data.user.userid` / `data.user.name`。
- 编辑器：`GET https://baijiahao.baidu.com/builder/rc/edit`，令牌变量 `window.__BJH__INIT__AUTH__`。
- 保存：`POST https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft`，URL 编码表单、`token` 请求头。
- 最小请求字段：`title`、`content`、`type=news`、`feed_cat=1`、`len`。不代替用户声明原创、商业活动或发布选项。
- 预期成功标志：`errmsg=success`，存在 errno 时必须为 0；草稿 ID 为 `ret.article_id`。
- 草稿链接：`/builder/rc/edit?type=news&article_id=...`。

**未验证**：上述历史协议在当前平台是否仍适用、是否需要额外字段或签名。本轮访问百家号时被浏览器站点安全策略拦截；未绕过限制，没有使用真实账号发请求。单元测试使用模拟响应，不能据此标记“已实测”。

## 权限与数据

仅新增 `https://mp.sohu.com/*`、`https://baijiahao.baidu.com/*` 两项 hostPermissions，用于各自账号和草稿流程。没有新增 manifest 权限、通配全站权限或常驻 content script。

Cookie 只用于本站会话。百家号 token 仅保留在请求函数的局部变量，不存储、不写日志，不转发到其他域名。两平台 uploadImage 均明确拒绝；没有图片上传、直接发布或自动重试写请求。

## 验证范围

- 单元测试覆盖账号校验、401/403、网络错误、令牌缺失/解析、JSON/JSONP、草稿 ID、路径白名单、请求体和失败不重试。
- 浏览器夹具验证搜狐填入全文、代码与表格转换、禁用控件、已有正文保护、粘贴丢字、过期成功提示、危险 HTML；发布按钮调用数始终为零。
- 工作台回归检查两个新平台出现、未登录不能勾选、微博未注册。
- 真实草稿最终验收尚未完成。待账号/访问条件满足后，以 `examples/test-post/hello-yuzgeo.md` 保存并在平台草稿箱确认，再更新 README 状态。

本轮结果：137 项单元测试通过；浏览器回归包含 13 个场景（测试运行器连同父测试计 15 项），后台启动检查通过；类型检查、lint、构建通过。修改文件的 Prettier 检查通过；全仓检查仍报告 63 个本轮未修改文件的既有格式问题，未进行全仓格式化。构建保留体积超过 500 kB 的提示。
