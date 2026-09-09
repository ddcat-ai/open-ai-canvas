---
name: kraftreel-cli
description: 用户明确要求安装、初始化或登录 KraftReel 远程画布 CLI/MCP 时使用；仅询问用法或状态不触发安装流程。
---

# KraftReel CLI Skill

KraftReel 的公开服务地址是 `https://kraftreel.com`。普通用户不需要设置环境变量，也不需要全局安装 npm 包；插件的 MCP 配置会在启动时按需获取 `kraftreel-cli`。

## 安装

当用户要求安装 KraftReel Skill 时，优先安装本插件中的 `plugins/kraftreel`，不要让用户复制多条 npm 命令：

1. 下载 `https://kraftreel.com/cli/latest/kraftreel-cli-skill.zip` 并解压。
2. 按操作系统执行包内 `scripts/install-kraftreel-cli.sh`、`scripts/install-kraftreel-cli.ps1` 或 `scripts/install-kraftreel-cli.cmd`，由 Agent 完成 CLI 安装，不要求用户手动输入 npm 命令。
3. 将 marketplace 加入 Codex，并安装 `kraftreel@kraftreel-local`。
4. 告知用户新建 Codex 对话以加载 Skill 和 MCP。

如果宿主支持直接安装 GitHub 插件，使用插件安装器完成上述步骤；不要把 `127.0.0.1:17371`、Local Runtime、Dreamina CLI 或本机 Agent 加入配置。

## 首次授权

安装后，如果 MCP 尚未登录，提示用户在终端执行一次：

```bash
npx -y kraftreel-cli login web
```

CLI 默认会访问 `https://kraftreel.com`，因此不需要先设置 `KRAFTREEL_SERVER_URL`。命令会打开或输出网页登录地址，用户批准设备后凭据保存到 `~/.kraftreel`。不要要求用户手动复制 access token、refresh token 或 JSON。

登录后使用 `npx -y kraftreel-cli project list` 查看画布，并使用 `npx -y kraftreel-cli project use <canvas-project-id>` 选择 MCP 目标。若宿主允许执行终端命令，可以代用户运行这些无密钥命令，但网页登录批准必须由用户完成。

## 自部署覆盖

只有用户明确使用自部署服务时，才设置 `KRAFTREEL_SERVER_URL`。值必须是 HTTPS 根地址，例如 `https://canvas.example.com`；不要在 URL 中放用户名、密码、查询参数、片段或 token。

## 使用边界

- MCP 读取和写入都通过远程 HTTPS 完成。
- 写入前先读取画布上下文，并携带服务端 revision/hash 前置条件。
- 删除、覆盖、移动、改边和生成由 MCP 宿主审批，服务端仍执行权限、归属和审计校验。
- 设备登录失败、令牌失效或画布冲突时如实报告，不猜测项目 ID，也不重放已经发送的写请求。
