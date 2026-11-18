# 火山方舟 Seedance 2.5 官方视频生成

火山方舟官方 Seedance 2.5 声明式协议插件，面向 Seedance 2.5 视频生成 API。

- Provider：`volcengine-ark-seedance-25`
- Endpoint：`POST /api/v3/contents/generations/tasks`
- 查询：`GET /api/v3/contents/generations/tasks/{task_id}`
- 取消：`DELETE /api/v3/contents/generations/tasks/{task_id}`
- 鉴权：火山方舟 API Key（Bearer）

该包使用官方 `/api/v3` Contents Generations Tasks 接口，支持文本、图片、视频、音频全模态输入。Seedance 2.5 允许单独传入参考音频；扩展参数仅接受下列文档声明的字段，不提供任意请求体覆盖。首尾帧与全模态参考互斥。

完整字段映射见 [`docs/interface.md`](docs/interface.md)。
