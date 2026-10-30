# 微信公众号与头条号接入记录

2026-10-28 更新：头条号新增独立短标题设置和提交前校验，用户实际账号复测成功。详见[故障修复与验收](DRAFT-FIXES-2026-10-28.md)。

日期：2026-10-27。范围：仅文字、仅草稿，不上传图片或封面。

用户提供的平台截图中，已有 CSDN、知乎、掘金、百家号、抖音长文、小红书长文、腾讯云、阿里云八个平台适配器。本轮新增微信公众号和头条号；用户随后明确暂缓凤凰网大风号及截图倒数第二个尚未确认名称的平台。微博继续暂缓；已有搜狐号保留。

## 头条号：编辑器方式（C）

- 来源：真实已登录 Chrome 页面及其自动保存网络请求；未读取其他文章正文。
- 后台入口：`https://mp.toutiao.com/profile_v4/index`。
- 新建文章：`https://mp.toutiao.com/profile_v4/graphic/publish`。这是编辑器页面，路径中的 publish 并不表示访问该页面会发布文章。
- 草稿箱：`https://mp.toutiao.com/profile_v4/manage/draft`。
- 登录：页面存在指向 `www.toutiao.com/c/user/<id>/` 且 title/aria-label 含“的个人主页”的账号链接；不把公共页面壳或 Cookie 存在当作有效登录。
- 正文：`.ProseMirror[contenteditable="true"]`；标题为带“请输入文章标题（2～30个字）”占位文字的 textarea。
- 空正文包含 `.syl-placeholder.ProseMirror-widget[ignoreel="true"][contenteditable="false"]` 提示节点，判断正文时排除该节点，保留其他文字。
- 保存：平台在输入后自动保存，观察 `.footer-draft-save` 从本次“草稿保存中”变为“草稿已保存”，并再次核对全文；从不点击“预览并发布”或“定时发布”。
- 抓包观察到平台自动保存使用 `/mp/agw/article/publish`，本次自动草稿请求的 `save=0`。适配器不直接调用该接口或构造其请求，不依赖接口名称猜测发布行为。
- 代码按行、表格按行转为段落，保留文字；只操作新的空白编辑器，已有内容时停止。未知结果不自动重试，提示先检查草稿箱。
- 结果返回草稿箱 URL 和本地追踪 ID，不伪装成服务端文章 ID。

实测记录：

1. 手动输入测试标题“yuzgeo 同步测试（请勿发布）”，观察自动保存成功并在草稿箱确认。
2. 在真实空白编辑器执行本仓库编译后的 `fillDraft`，标题“yuzgeo 适配回归（请勿发布）”，含标题、段落、加粗、代码和表格。返回成功，页面显示“草稿已保存”，文字均保留；刷新草稿箱后确认该条目存在。
3. 在真实页面执行本仓库 `readAccount`，成功返回已登录账号名称。

留下两篇明确标记的测试草稿，未发布；未修改或删除其他草稿。证据截图位于本地忽略目录 `packages/extension/.output/test-results/toutiao-adapter-draft.png`，不提交账号截图。

## 微信公众号：后台接口方式（A），尚未实测

协议事实参考公开仓库 [Wechatsync 的微信公众号适配器](https://github.com/wechatsync/Wechatsync/blob/42f61e39e214b8d5377d09d788a716defc4abdc0/packages/core/src/adapters/platforms/weixin.ts)。只参考请求地址、参数和响应字段；本仓库独立实现，不复制来源实现、样式或大段参数模板。

- 后台：`https://mp.weixin.qq.com/`，从响应 HTML 的 `data.t`、`user_name`、`nick_name` 读取会话事实；不执行 HTML 中的脚本。
- 新建草稿：`POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=...&lang=zh_CN`。
- 表单只允许新建草稿字段，`AppMsgId` 为空、`count=1`，标题/正文/摘要对应 `title0`/`content0`/`digest0`。元数据不能覆盖操作类型，不发送发布、群发、原创声明或广告参数。
- 响应：检查 `base_resp.ret` / `ret`，并要求有效 `appMsgId`；未知响应不能记为成功。不自动重试写请求。
- 会话 token 仅本次请求使用，不写入同步历史、草稿链接或日志。结果链接回后台入口，用户在草稿箱查找文章。
- 所有正文链接降级为文字。不上传图片或封面；缺封面时服务器是否允许保存尚未实测，错误提示用户在后台处理。

本轮浏览器站点安全策略拒绝访问公众号后台，因此未检查真实账号、未发送真实公众号请求、未创建公众号草稿；未通过其他通道绕过。仅做模拟协议测试。公开协议可能变化，不能据此宣称真实账号可用。

## 权限与验证

仅新增 `https://mp.weixin.qq.com/*` 和 `https://mp.toutiao.com/*` 两个 host permissions。保留现有 manifest 权限，无全站脚本、无服务端。

- 单元测试覆盖公众号会话解析、草稿限定、错误/缺失 ID、登录失效、令牌不落地、写入不重试；头条号覆盖新建页面、标题校验和失败处理。
- 独立 Edge 测试使用真实 DOM 与模拟页面，覆盖头条号占位节点、自动保存状态变化、已存在内容、禁用编辑器、正文截断及超时。模拟页面无真实账号或网络写入。
- Dashboard 回归覆盖新增平台展示与未登录状态，其他平台原有流程继续验证。
