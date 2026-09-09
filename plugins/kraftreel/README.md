# KraftReel Codex 插件

这个插件把影策的 Canvas Agent MCP 打包给 Codex app 使用，让 Codex 能打开画布、读取当前节点、创建内容并触发生成流程。

画布网页内的 Agent 固定使用网站模式。插件提供的 MCP 与网页 Agent 是两条独立能力，不再通过 URL 传递本地 Agent 地址或连接令牌。

## 安装

> 影策尚未上架 Codex 公共插件目录，直接搜索不会显示。请从本仓库自带的 marketplace 安装。

### AI 自动安装

把下面这段发给你的 AI 助手：

```text
请帮我安装 KraftReel Skill：
https://kraftreel.com/cli/latest/kraftreel-cli-skill.zip
下载并安装这个 Skill 包，完成 KraftReel CLI 与远程 MCP 初始化，不要启用本机 Runtime 或 Dreamina CLI。
安装后告诉我如何完成网页登录授权。
```

### 手动安装

如果本机还没有仓库，先 clone：

```bash
mkdir -p ~/plugins
git clone https://github.com/wurendao007/open-ai-canvas.git ~/plugins/open-ai-canvas
```

注册仓库 marketplace 并安装插件；如果使用已有仓库，请把路径替换为仓库的绝对路径：

```bash
codex plugin marketplace add ~/plugins/open-ai-canvas
codex plugin add kraftreel@kraftreel-local
```

安装后建议开启一个新的 Codex 对话，让新的 skill 和 MCP 工具完整加载。

### 本仓库开发调试

如果你就在影策仓库中调试插件，可以直接添加当前仓库。建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/open-ai-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add kraftreel@kraftreel-local
```

## 使用

Skill 包内的安装脚本会由 Agent 按操作系统执行，用户不需要手动输入 npm 命令。首次使用 MCP 前，再完成网页登录和画布选择。公网服务地址已内置为 `https://kraftreel.com`，不需要设置环境变量：

```bash
npx -y kraftreel-cli login web
npx -y kraftreel-cli project list
npx -y kraftreel-cli project use <canvas-project-id>
```

也可以直接对已安装插件的 AI 助手说“请完成 KraftReel 网页登录并选择当前画布”。设备批准仍必须由用户在浏览器中完成。

然后新建 Codex 线程并说“打开影策”。插件可以打开网页画布，也可以通过已登录的远程 MCP 读取或修改当前选中的画布。网页内的在线 Agent 不依赖 MCP 登录。

## 用户入口

- 网页用户：直接在画布 Agent 窗口中对话操作画布。
- 外部用户：在 Codex、Claude 等客户端中通过远程 Canvas MCP 对话操作画布。

两条路径共享画布工具合同、权限和 `revision/stateHash` 并发保护，但不互相调用对方的 Agent。Hermes Bridge 暂缓，不影响网页已有 Agent 或外部客户端使用远程 MCP。

常用提示：

```text
打开影策
读取当前画布并总结节点结构
根据选中节点创建一组生图提示词
```

## 工作机制

插件默认通过以下命令启动 stdio MCP：

```bash
npx -y kraftreel-cli mcp
```

KraftReel CLI 只通过 HTTPS 调用影策后端，不启动本机 HTTP Runtime，也不连接网页 Agent。`~/.kraftreel/credentials.json` 保存网页登录取得的凭据，`~/.kraftreel/project.json` 保存当前画布选择。

删除、覆盖、移动、改边和生成由 Codex 的 MCP 宿主审批；影策网页不会再弹出第二次确认。后端仍会检查 scope、资源归属、写入前置条件和审计。遇到画布 revision/hash 冲突时，MCP 会要求重新读取，不会重放旧写入。

## 手动排查

优先本地启动画布：

```bash
cd web
bun install
bun run dev
```

手动排查网页时直接打开 `<画布网页地址>/canvas?mode=new`；`mode=new` 会让网页自动创建具体画布。不要拼接 `agentUrl` 或 `agentToken`。

MCP 无法读取画布时，依次检查是否已执行 `login web`、是否已执行 `project use`，再检查 `codex mcp list` 中的 `kraftreel`。自部署时才检查 `KRAFTREEL_SERVER_URL` 是否为 HTTPS。本插件不支持通过 `127.0.0.1:17371`、Dreamina CLI 或肖像本机引擎恢复连接。

## 技能库

插件的 `skills/` 是可按需加载的 Codex 技能库，不需要把整套规则复制到每次对话里。安装插件后，建议新建一个 Codex 线程；Codex 会根据请求自动发现并加载对应技能：

- `canvas-context`：先读语义化画布上下文、选区、连接和资源就绪状态。
- `canvas-editing`：写入前校验真实节点 id，批量操作后复核结果。
- `asset-aware-generation`：复用已有角色、场景、道具、风格和媒体资源创建生成流程。

安装/更新流程：

```bash
cd /path/to/open-ai-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add kraftreel@kraftreel-local
# 更新插件后开启一个新的 Codex 对话
```

验证技能和 MCP 是否已加载，可以在新对话中直接说：

```text
读取当前画布上下文，列出可用媒体资源，并说明哪些资源可以作为生图参考。
```

如果回答没有调用 `canvas_get_context` / `canvas_get_resources`，先确认当前对话是安装插件后新建的，并检查 `codex mcp list` 中的 `kraftreel`。
