# {{NAME}}

## 接口

AutoDL.Art 将 ComfyUI 工作流包装为异步任务接口。创建任务使用 `POST /api/v1/comfyui/comfyui_workflow/{workflow_id}`，影策运行时模板为 `/api/v1/comfyui/comfyui_workflow/{model}`；查询结果使用 `GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`，影策运行时模板为 `/api/v1/comfyui/comfyui_workflow/result/{task_id}`。`workflow_id` 由模型字段传入，不能把它写死在渠道地址中。创建接口只返回任务标识，宿主负责按照统一任务生命周期轮询。

## 模型

AutoDL 的模型选择对应 ComfyUI 工作流 ID。不同工作流可以声明不同参数，插件清单中的工作流贡献负责描述参数、默认值和画布能力。当前内置示例使用 `minimax_h3_lightx2v_no_pic`，表示 MiniMax H3 文生视频工作流。后续新增工作流只需增加工作流贡献，不需要修改生成服务代码。

## 参数

请求体为 JSON。常用字段包括 `prompt`、`duration` 和 `resolution`；实际工作流可以扩展自己的参数 schema。工作流声明的分辨率选项属于供应商枚举，画布必须保留其完整值，例如 `768p竖`、`768p横`，插件仅在发送前统一转换为小写，不在宿主中增加 AutoDL 专用归一化。状态返回值位于 `data.status`，任务 ID 位于 `data.task_id`，成功结果位于 `data.results`。结果数组中的地址是短期 URL，成功后必须立即由宿主下载到影策资源存储，不能把临时地址直接写入画布长期数据。

## 鉴权

使用 AutoDL 令牌作为 `Authorization` 请求头。令牌应配置在渠道密钥存储中，只由后端出站请求读取，不进入插件 Manifest、浏览器 URL、日志或持久任务正文。Token 分组应选择 AutoDL 的 ComfyUI 分组。

## 状态与结果

`QUEUED` 映射为排队，`RUNNING` 映射为处理中，`SUCCESS` 映射为成功，`FAILED` 映射为失败。成功但没有 `data.results` 时，宿主应返回真实错误而不是生成空节点。视频结果由宿主读取 MIME、下载并保存，用户界面只消费已保存资源。

## 官方

- [AutoDL ComfyUI API](https://autodl.art/docs/comfyui_api/)
- [AutoDL Token 管理](https://autodl.art/large-model/tokens)

{{CONTRACT}}
