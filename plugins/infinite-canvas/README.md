# Infinite Canvas Codex Plugin

这个插件把 Infinite Canvas 的本地 Canvas Agent MCP 打包给 Codex app 使用，让 Codex 能打开本地画布、读取当前节点、创建内容并触发生成流程。

## 安装

> Infinite Canvas 尚未上架 Codex 公共插件目录，直接搜索不会显示。请从本仓库自带的 marketplace 安装。

### AI 自动安装

把下面这段发给 Codex：

```text
请从 https://github.com/ddcat-ai/open-ai-canvas.git 安装 Infinite Canvas Codex 插件。
请 clone 仓库到 ~/plugins/open-ai-canvas，确认 .agents/plugins/marketplace.json 和
plugins/infinite-canvas/.codex-plugin/plugin.json 都存在。然后运行
codex plugin marketplace add ~/plugins/open-ai-canvas，
再运行 codex plugin add infinite-canvas@infinite-canvas-local。
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
codex plugin add infinite-canvas@infinite-canvas-local
```

安装后建议开启一个新的 Codex 对话，让新的 skill 和 MCP 工具完整加载。

### 本仓库开发调试

如果你就在 Infinite Canvas 仓库中调试插件，可以直接添加当前仓库。建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

## 使用

1. 新建 Codex 线程后说“打开 Infinite Canvas”。
2. 插件会确认当前仓库的本地画布服务是否已运行；端口被占用时会检查进程归属，不会把其他项目的 `3000` 当作 Infinite Canvas。
3. 确认或启动后，插件会直接打开新建画布 URL，并自动尝试连接本地 Agent。
4. 画布打开后，让 Codex 读取或操作当前画布。

常用提示：

```text
打开 Infinite Canvas
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
