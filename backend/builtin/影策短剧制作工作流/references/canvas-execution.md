# 影策画布执行

本文件只描述影策 Agent 的真实执行合同。工具参数、节点类型和字段以当前能力返回为准；技能正文不能授权未注册工具、任意 metadata、外部媒体 URL 或绕过任务/审批链路的调用。

## 真实工具

### 读取

- `canvas_get_state`：读取项目、节点、连线、快照和关联任务。
- `canvas_list_node_types`：读取可创建节点类型、连接约束和生成模式。
- `canvas_read_storyboard`：分页读取结构化分镜行，取得真实 `rowId` 和快照。
- `canvas_read_batch_table`：读取批量创作表的真实行和配置。
- `model_list`：按模式和实际参考节点查询可用模型、能力和价格。
- `task_get`：查询当前用户任务状态。
- `skill_search`、`skill_read_file`：读取已安装技能的正文和引用文件。

### 写入

- `canvas_apply_ops`：新增合法节点、更新允许字段、建立合法引用边；一次最多 20 项，必须带最新 `snapshotHash`。
- `canvas_create_storyboard`：创建有真实镜头行的 `script` 节点，不用 Markdown 冒充分镜。
- `canvas_edit_storyboard`：追加、修改或删除单行；`update/remove` 必须使用最近读取的真实 `rowId` 和 `snapshotHash`。
- `canvas_edit_batch_table`：只修改批量计划，不提交生成任务。
- `canvas_arrange_nodes`：只整理坐标，不创建、删除或连线。
- `generate_media`：提交图片、视频或音频生成；先准备提示词、模型和真实引用。
- `image_annotation_render`、`image_layer_split`：仅在当前能力和用户目标确实需要时使用。
- `plan_update`、`ask_user`：更新可见计划或询问一个必须由用户决定的问题。

## 标准执行链

1. `canvas_get_state`，确认当前项目、已有内容、快照和用户范围。
2. `canvas_list_node_types`，确认 `text`、`markdown`、`script`、`image`、`video`、`audio` 等真实能力。
3. 复用或用 `canvas_apply_ops` 创建输入文稿节点；不重复创建已有正文。
4. 对多镜头制作调用 `canvas_create_storyboard`，每一行填入已确认事件、时长、画面、对白、运动、声音和连续性字段。
5. 创建后用 `canvas_read_storyboard` 回读，核对行数、顺序、时长和真实行 ID。
6. 需要局部修改时再次读取最新快照，再调用 `canvas_edit_storyboard`；冲突则重新读取，不覆盖用户新改内容。
7. 为每个生成段准备合法媒体节点和引用边；`canvas_apply_ops` 不提交生成、不收费。
8. 用 `model_list` 传入真实媒体参考节点，选择返回的 `logicalModelId` 或完整渠道选择，不猜模型名。
9. 得到用户对具体对象、数量、模型和费用范围的授权后调用 `generate_media`。`prompt` 中只引用真实 `@图片1`、`@视频1`、`@音频1` 顺序。
10. 用 `task_get` 或真实事件流读取任务状态；成功后确认结果资源可访问并回写节点状态。
11. 对独立节点调用 `canvas_arrange_nodes`，再输出报告和待办。

## 禁止事项

- 不调用没有出现在当前能力清单中的函数。
- 不直接写画布 JSON，不伪造节点 ID，不把文本内容当作已生成媒体。
- 不向生成接口传外部 URL、Cookie、密钥或未验证资源。
- 不用节点标题、文件名或 `generating` 状态宣称视频完成。
- 不覆盖已有任务或已有采用结果；重试必须是用户明确的新授权。
- 不把连线当作审批、分镜阶段或采用证明。
- 不把 `canvas_apply_ops` 当作媒体生成工具；生成统一走 `generate_media`。

## 影策后端接口边界

浏览器只通过登录态的影策后端运行 Agent：创建运行使用 `POST /api/agent/runs`，续轮使用 `POST /api/agent/runs/:id/messages`，事件使用 `GET /api/agent/runs/:id/events`，审批使用对应的 approval decision 接口。技能不直接访问模型供应商、画布数据库或第三方 API。
