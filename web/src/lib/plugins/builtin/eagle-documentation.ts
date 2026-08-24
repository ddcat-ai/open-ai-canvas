/**
 * Eagle 插件文档（markdown，随插件清单渲染）。
 * 插件自带说明数据而非 UI catalog 文案：不属于 MIGRATED 探针名单，
 * 需要双语时按插件文档资源维护，而不是进 i18n catalog。
 */
export const eaglePluginDocumentation = `# Eagle 素材库

Eagle 插件把桌面 Eagle 资料库接入影策素材面板。浏览器不会直接访问 Eagle：所有读取、搜索、下载和写入请求先到影策后端，再由后端访问管理员配置的 Eagle Local API 地址。

## 使用前准备

1. 安装并启动 Eagle 桌面客户端，打开要使用的资料库。
2. 确认 Eagle Local API 可用；默认地址为 \`http://127.0.0.1:41595\`。
3. 以管理员身份进入插件设置，填写 Base URL 并读取文件夹。
4. 保存配置后，在素材库选择 Eagle 来源，即可浏览和导入素材。

> Eagle 必须保持运行。关闭客户端、切换资料库或修改本地 API 端口后，影策会收到连接失败，不能用空列表掩盖。

## 影策后端接口

| 操作 | 影策接口 | 用途 |
| --- | --- | --- |
| 读取资料库 | \`GET /api/plugins/eagle/library?baseUrl=...\` | 获取 Eagle 版本、资料库名称和文件夹树 |
| 列出素材 | \`GET /api/plugins/eagle/items\` | 按文件夹、关键词和分页读取素材 |
| 缩略图 | \`GET /api/plugins/eagle/items/{id}/thumbnail\` | 代理 Eagle 缩略图 |
| 原文件 | \`GET /api/plugins/eagle/items/{id}/file\` | 下载并导入影策资源存储 |
| 写入素材 | \`POST /api/plugins/eagle/items?baseUrl=...\` | 把图片、视频或音频写回 Eagle |
| 创建文件夹 | \`POST /api/plugins/eagle/folders?baseUrl=...\` | 在 Eagle 中创建目录 |

这些是影策内部登录态 API，使用 Cookie 鉴权；不要把它们当作 Eagle 官方接口直接调用。

## 浏览与搜索

插件读取 Eagle 文件夹树并生成完整层级路径。素材列表支持 \`folderId\`、\`keyword\`、\`limit\`、\`offset\`。文件夹列表在当前插件实例内缓存；创建文件夹后会失效并重新读取。切换 Eagle 资料库时应重新打开插件设置确认目录。

## 导入到影策

导入时，后端代理下载 Eagle 原文件，前端再写入影策自己的图片或媒体存储。图片保留可识别的宽高和 MIME；视频、音频和其他模型文件保留字节数、扩展名、Eagle item ID、文件夹和来源元数据。

| Eagle 内容 | 影策结果 | 当前限制 |
| --- | --- | --- |
| 图片 | 图片素材 | 使用原图，不把缩略图当成品 |
| 视频 | 视频素材 | 元数据缺宽高时使用 1280×720 展示兜底，不改写原文件 |
| 音频 | 音频素材 | 时长以浏览器媒体探测结果为准 |
| 其他文件 | 模型素材 | 仅作为文件资源保存 |
| 文本/实体 | 不支持 | 导入会明确报错 |

## 写回 Eagle

插件可把影策图片、视频或音频转换为 data URL，再调用 Eagle 添加素材。已有本地 Blob 优先直接读取；只有没有本地副本时才下载远程生成地址。默认单个手动上传文件不超过 96 MB，且 MIME 必须以 \`image/\`、\`video/\` 或 \`audio/\` 开头。

启用“自动上传生成结果”后，生成资产可以写入配置的目标文件夹。自动写回失败必须显示为写回失败，不应把“影策已保存”误报为“Eagle 已保存”。

## 配置字段

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| \`baseUrl\` | Eagle Local API 地址，只允许明确的 HTTP(S) 地址 | \`http://127.0.0.1:41595\` |
| \`autoUploadGenerated\` | 是否把支持的生成结果自动写回 Eagle | 开启 |
| \`generatedFolderId\` | 自动写回目标文件夹 ID | 空，使用 Eagle 默认位置 |

## 安全边界

- Eagle 通常运行在本机。后端必须继续执行私网目标校验，只允许管理员明确配置的本机服务，不能把该代理变成任意 URL 抓取器。
- \`baseUrl\` 只保存服务地址，不包含 Token、Cookie 或查询密钥。
- 原文件和 data URL 不进入日志、localStorage 或错误上报。
- 多用户部署中，服务器的 \`127.0.0.1\` 指服务器自身，不是访问者电脑；这种部署需要本地 Agent/隧道方案，不能假装直连可用。

## 常见问题

| 现象 | 检查项 |
| --- | --- |
| 无法读取资料库 | Eagle 是否运行、Base URL/端口、后端能否访问该主机 |
| 文件夹为空 | Eagle 当前打开的资料库、筛选条件、文件夹层级 |
| 有缩略图但导入失败 | 原文件是否仍存在、文件权限、后端响应状态 |
| 写回失败 | 文件大小/MIME、目标文件夹是否存在、远程生成链接是否过期 |
| 部署服务器连接不到本机 Eagle | 网络拓扑不成立，需要本地桥接而不是更换前端 URL |

## 官方资料

- [Eagle API Documentation](https://api.eagle.cool/)
- [Eagle 产品与下载](https://eagle.cool/)
`;
