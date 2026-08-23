# 影策 Codex 插件

这个插件把影策的本地 Canvas Agent MCP 打包给 Codex app 使用，让 Codex 能打开本地画布、读取当前节点、创建内容并触发生成流程。

## 安装

> 影策尚未上架 Codex 公共插件目录，直接搜索不会显示。请从本仓库自带的 marketplace 安装。

### AI 自动安装

把下面这段发给 Codex：

```text
请从 https://github.com/ddcat-ai/open-ai-canvas.git 安装影策 Codex 插件。
请 clone 仓库到 ~/plugins/open-ai-canvas，确认 .agents/plugins/marketplace.json 和
plugins/yingce/.codex-plugin/plugin.json 都存在。然后运行
codex plugin marketplace add ~/plugins/open-ai-canvas，
再运行 codex plugin add yingce@yingce-local。
安装后请校验插件，并告诉我是否需要开启一个新对话来加载新技能和 MCP 工具。
```

### 手动安装

如果本机还没有仓库，先 clone：

```bash
mkdir -p ~/plugins
git clone https://github.com/ddcat-ai/open-ai-canvas.git ~/plugins/open-ai-canvas
```

注册仓库 marketplace 并安装插件；如果使用已有仓库，请把路径替换为仓库的绝对路径：

```bash
codex plugin marketplace add ~/plugins/open-ai-canvas
codex plugin add yingce@yingce-local
```

安装后建议开启一个新的 Codex 对话，让新的 skill 和 MCP 工具完整加载。

### 本仓库开发调试

如果你就在影策仓库中调试插件，可以直接添加当前仓库。建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/open-ai-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add yingce@yingce-local
```

## 使用

1. 新建 Codex 线程后说“打开影策”。
2. 插件会确认当前仓库的本地画布服务是否已运行；端口被占用时会检查进程归属，不会把其他项目的 `3000` 当作影策。
3. 确认或启动后，插件会直接打开新建画布 URL，并自动尝试连接本地 Agent。
4. 画布打开后，让 Codex 读取或操作当前画布。

常用提示：

```text
打开影策
读取当前画布并总结节点结构
根据选中节点创建一组生图提示词
```

## 工作机制

插件默认通过以下命令启动 MCP，并会在 MCP 启动时自动尝试拉起本地 Agent：

```bash
npx -y @ddcat666/open-ai-canvas-agent mcp
```

## 手动排查

优先本地启动画布：

```bash
cd web
bun install
bun run dev
```

然后启动本地 Agent。端口不是 `3000` 时，把 `CANVAS_URL` 换成真实本地画布地址：

```bash
CANVAS_URL=http://localhost:3000 npx -y @ddcat666/open-ai-canvas-agent
```

手动排查时先从 Agent 输出或 `http://127.0.0.1:17371/config` 读取本地地址和 token，然后直接打开 `<画布网页地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>`。不要通过页面点击来新建画布；`mode=new` 会让网页自动创建具体画布并连接本地 Agent。

## 技能库

插件的 `skills/` 是可按需加载的 Codex 技能库，不需要把整套规则复制到每次对话里。安装插件后，建议新建一个 Codex 线程；Codex 会根据请求自动发现并加载对应技能：

- `canvas-context`：先读语义化画布上下文、选区、连接和资源就绪状态。
- `canvas-editing`：写入前校验真实节点 id，批量操作后复核结果。
- `asset-aware-generation`：复用已有角色、场景、道具、风格和媒体资源创建生成流程。

安装/更新流程：

```bash
cd /path/to/open-ai-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add yingce@yingce-local
# 更新插件后开启一个新的 Codex 对话
```

验证技能和 MCP 是否已加载，可以在新对话中直接说：

```text
读取当前画布上下文，列出可用媒体资源，并说明哪些资源可以作为生图参考。
```

如果回答没有调用 `canvas_get_context` / `canvas_get_resources`，先确认当前对话是安装插件后新建的，并检查 `codex mcp list` 中的 `yingce`。
