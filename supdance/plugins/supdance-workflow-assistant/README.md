# SupDance 创作工作流助手 (`supdance-workflow-assistant`)

本目录是 SupDance 自定义插件的标准参考实现模板，遵循上游 `.yingce-plugin` 与 `yingce.plugin/v2` 清单契约。

## 兼容与隔离规则

- **唯一插件 ID**：`supdance-workflow-assistant`（必须以 `supdance-` 开头，避免与上游 `plugin-packages/` 中的 110+ 官方/系统插件冲突）。
- **版本规范**：遵循 SemVer（当前 `0.1.0`）。
- **宿主契约**：声明 `"apiVersion": "yingce.plugin/v2"`。
- **最小权限**：仅声明 `["canvas.read", "ai.text"]`，不读取用户 Cookie、API Key 或内部私有状态。
