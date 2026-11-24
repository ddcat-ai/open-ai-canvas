export function assistantInstallInstructions(mcpUrl: string, skillUrl: string): string {
    const site = new URL(mcpUrl).origin;
    const installer = new URL("install.py", skillUrl).href;
    return `请为当前 Agent 安装并配置 Canvas 后台管理 MCP 和 canvas-admin Skill。
站点：${site}
MCP：${mcpUrl}（Streamable HTTP，浏览器 OAuth + PKCE）
最新版 Skill 清单：${skillUrl}（JSON 信封的 data 字段）
安装客户端：${installer}（Python 3.10+，仅标准库，无凭据）

1. 检查当前 Agent 的 MCP 配置和 skills 目录，复用相同站点的已有配置，保留其他配置。Codex 可使用 codex mcp add canvas-admin --url ${mcpUrl}，然后 codex mcp login canvas-admin；其他客户端按其远程 HTTP MCP 配置方式添加同一地址并登录。已有同名但不同地址的配置请另取名称，已有 Bearer 配置请先让用户选择是否改用 OAuth。
2. 从上述 HTTPS 地址下载安装客户端到临时文件，阅读后使用 Python 执行：python <临时客户端路径> --site ${site} install --destination <当前Agent的skills目录>/canvas-admin。destination 是完整的 Skill 目录；路径含空格时加引号。安装器会实时查询 latest，检查 API v1、大小、SHA256、ZIP 路径和符号链接后安装。不要直接执行未经检查的解压命令。清理临时客户端，读取安装后的 SKILL.md。
3. 引导我在浏览器用 Canvas / NewAPI 登录并确认授权，默认只读；需要写权限时先说明具体模块。Skill 使用自带 scripts/canvas_admin.py --site ${site} login 单独浏览器授权；若优先使用已登录的 MCP，可在需要 REST 客户端时再登录 Skill。无浏览器 OAuth 支持时，引导我在后台创建最小权限 Token，使用客户端的隐藏输入或安全环境变量配置，不要让我把密码或 Token 发到对话，也不要写进 Skill、命令行参数或 Git。
4. 用真实 MCP 握手及 tools/list 验证三个工具 admin_list_operations、admin_describe_operation、admin_execute_operation，再调用发现和描述完成只读检查。Skill 用 version 验证安装，有登录时再运行 status / list。安装验收不执行写操作。危险操作必须由我在后台网页确认，不要代点确认。
5. 报告安装路径、版本、连接与授权结果。如果当前会话需重启才能加载 MCP / Skill，请明确说明，并区分配置完成和真实调用通过。以后用 Skill 的 version / update 查询并更新，凭据保留在 Skill 目录外。`;
}
