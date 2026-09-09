# 影策 Canvas Agent

Canvas Agent 是远程画布的 stdio MCP 适配器。它通过 HTTPS 调用影策后端，不启动 HTTP 服务，不监听 `127.0.0.1:17371`，也不提供本机 Agent、Dreamina CLI 或肖像排查能力。

网页内的在线 Agent 与外部 MCP 是两条独立路径：网页在线 Agent 继续在站点内运行；Codex、Claude Code 等 MCP 宿主通过本适配器操作用户明确选择的远端画布。

## 环境要求

- Node.js 18+
- 可通过 HTTPS 访问的影策服务（默认使用 `https://kraftreel.com`）
- 浏览器中可登录该影策服务的账号

CLI 默认连接 `https://kraftreel.com`，普通用户不需要设置服务地址。自部署用户可以用 `KRAFTREEL_SERVER_URL` 覆盖；它必须是没有用户名、密码、查询参数和片段的 HTTPS 根地址。`KRAFTREEL_CONFIG_DIR` 可选，默认使用 `~/.kraftreel`；旧版 `YINGCE_*` 环境变量和 `~/.yingce` 配置仍可读取。

```bash
# 仅自部署时需要；公网 KraftReel 用户跳过这一行
export KRAFTREEL_SERVER_URL=https://canvas.example.com
```

## 登录和选择画布

首次使用时发起设备登录（插件会按需下载 CLI，不需要全局 npm 安装）：

```bash
npx -y kraftreel-cli login web
```

命令会输出审批页面地址。用户在网页中确认后，访问令牌和刷新令牌保存到 `~/.kraftreel/credentials.json`，文件权限会尽可能限制为当前用户。数据库只保存令牌哈希。

登录后选择一个画布：

```bash
npx -y kraftreel-cli project list
npx -y kraftreel-cli project use <canvas-project-id>
npx -y kraftreel-cli project unuse
```

当前选择保存在 `~/.kraftreel/project.json`。`project unuse` 只删除该选择文件，不撤销令牌；需要撤销访问时应调用服务端 MCP revoke 接口或在账号安全入口撤销。

从网页安装 KraftReel Skill 后，Codex App 会自动注册同一条 MCP 配置，并在启动时按需执行 `npx -y kraftreel-cli mcp`。用户不需要手动执行 npm 安装命令或填写公网服务地址。

## 注册 MCP

Codex CLI：

```bash
codex mcp add kraftreel -- npx -y kraftreel-cli mcp
```

Claude Code：

```bash
claude mcp add --scope user --transport stdio kraftreel -- npx -y kraftreel-cli mcp
```

仓库内的 Codex app 插件位于 `plugins/kraftreel`，默认注册名为 `kraftreel` 并使用同一条 stdio 命令。插件安装后需要新建对话，使 MCP 和技能完整加载。

本仓库开发时可改用本地构建产物：

```bash
cd canvas-agent
npm install
npm test
npm run build
codex mcp add kraftreel -- node /absolute/path/to/open-ai-canvas/canvas-agent/dist/index.js mcp
```

## 写入和审批边界

- 所有写操作携带服务端返回的 `expectedRevision` 和 `expectedStateHash`。
- HTTP 409 表示画布已被其他窗口或 MCP 修改；客户端必须重新读取，不会用旧快照重放写入。
- HTTP 428 表示缺少前置条件，HTTP 422 表示操作不合法，HTTP 429 表示限流。
- 已发送的写请求遇到 401 或 429 时不会自动重放，避免重复创建、移动、删除或生成。
- 删除、覆盖、移动、改边和生成由 MCP 宿主审批。画布网页不会为外部 MCP 再弹出确认框。
- 后端仍会执行登录态、scope、资源归属、参数、并发和审计校验；宿主批准不代表服务端跳过权限。
- MCP 输出递归移除媒体 URL、Cookie、Token、API Key 等敏感字段，审计记录不保存 prompt、原始 payload 或凭据。

推荐先调用 `canvas_get_context`，再按真实节点 ID 读取或修改。复杂写操作先使用 `canvas_validate_ops`；生成任务只报告已提交或任务状态，不能把节点创建等同于媒体已经生成完成。

## Skill 与计划编排

远程 MCP 宿主（例如 Codex、Claude 或 Hermes）负责理解用户意图、加载自己的 Skill、生成 Plan/Task 和处理审批；CLI 不运行通用外部工具，也不替宿主调用模型。远程 MCP 只提供画布上下文读取、版本校验和画布操作，不暴露 Skill、Plan、Task 或 `ask/auto` 编排接口。外部 Agent 应先读取画布，再把自己的计划转换为基础画布操作并携带 `expectedRevision` 与 `expectedStateHash`。

### 对话直接生成图片

完成 CLI 登录并执行 `project use <画布ID>` 后，用户可以直接说“操作 XX 画布，在沈舟角色卡右侧生成一张校园夜景图”。外部 Agent 应按以下顺序调用基础 MCP：

1. `canvas_get_context`，确认当前绑定画布、真实版本号和 `stateHash`。
2. `canvas_find_nodes` 或 `canvas_get_selection`，找到用户提到的真实参考节点。
3. 生成带 `prompt`、尺寸和 `referenceNodeIds` 的图片操作；位置应避开现有节点。
4. `canvas_validate_ops`，携带读取到的 `revision` 和 `stateHash`。
5. 通过宿主审批后调用 `canvas_apply_ops` 或 `canvas_generate_image`。
6. 使用 `canvas_get_generation_tasks` 回读提交状态，只能把真实终态报告为“生成完成”。

如果画布在确认期间发生变化，服务端返回 409；Agent 必须重新读取上下文并重新生成操作，不能给旧操作替换新的版本号。创建图片节点、提交生成任务和媒体实际完成是三个不同状态。

## 能力边界

Canvas Agent 仅包含远程 CLI、stdio MCP、工具规划和 HTTPS 客户端。以下能力已完全移除：

- Local Runtime HTTP/SSE 和浏览器本机会话
- 本机 Codex/Claude Agent 进程桥接
- Dreamina CLI 本机生成
- 肖像排查本机模型与报告

ComfyUI Bridge 保留，但它是站点提供的独立原生程序，由“设置 -> ComfyUI Bridge”生成启动命令。它不属于 Canvas Agent 的 Local Runtime，也不会恢复 `17371` 端口或网页本机 Agent 连接。

## 发布

包名为 `kraftreel-cli`，版本由 `canvas-agent/package.json` 独立管理。全局安装后使用 `kraftreel` 命令。发布前运行：

```bash
npm test
npm run build
npm pack --dry-run
```
