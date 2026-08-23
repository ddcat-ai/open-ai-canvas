# 影策技能库

插件安装后，Codex 会在新线程中自动发现 `skills/` 下的技能。技能不是一组需要用户手动粘贴的 prompt，而是按请求匹配、按需加载的工作流约束。

当前技能：

- `open-canvas`：打开并连接本地画布。
- `canvas`：通用画布操作路由。
- `canvas-context`：读取语义上下文和资源状态。
- `canvas-editing`：可靠写入、批量校验和结果复核。
- `asset-aware-generation`：复用角色/场景/道具/风格资源进行生成。

安装或更新技能后，建议新建 Codex 线程，让技能和 MCP 工具重新加载。
