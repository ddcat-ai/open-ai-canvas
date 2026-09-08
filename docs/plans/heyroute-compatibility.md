# Heyroute 图片与视频协议

依据已登录 Heyroute 帮助页和官方图片脚本核对，通用 OpenAI/Gemini/MiniMax 协议不能直接覆盖它的图片、视频接口。现通过宿主 HTTP 适配和两个内置声明式包接入，渠道地址统一使用 `https://heyroute.ai`。

## 实现与原上传错误

- `heyroute-image`：5 个正式模型及 nano-banana-pro/nano-banana-2 别名；JSON 文生图 `/v1/images/generations`、multipart 编辑 `/v1/images/edits`，重复 `image` 字段和可选 PNG `mask`。
- `heyroute-video`：11 个视频模型，JSON `/v1/videos`、查询 `/v1/videos/{taskId}`，签名结果 URL 与鉴权 `/content` 下载；`heyroute-video-sequential` 提供三款 Seedance 图片按序转场。
- 图片始终返回 SSE，即使 HTTP 200 也可能是 error。新增显式 `responseMode: sse-json`，读取 started/heartbeat/completed/error/done，终态立即返回，截断、取消和超限失败，不自动重发收费 POST。JSON 错误响应仍可解析。
- 原插件上传 500 来自注册表格式化把内嵌清单膨胀到 512 KiB 上限之外；改为紧凑保存，重载旧注册表时先压缩 JSON 再检查大小。包限制没有放宽。
- providerOptions 先转换成表达式可读取的 JSON 对象；Seedance seed、negative_prompt、shots 的支持按模型校验，保留 0/false，不接受任意模型或正文覆盖。
- Heyroute 视频每 15 秒查询。生产建议图片任务 15 分钟、视频任务 45 分钟；上游没有取消接口，本地取消不代表上游停止或退款。
- 前后端从同一生成文件读取模型默认能力，不沿用通用协议的尺寸/时长。构建先执行视频包 build.py，再执行图片包 build.py。

## 模型边界

图片为 gpt-image-2、grok-imagine-image、flux-klein-2、gemini-3-pro-image、gemini-3.1-flash-image，以及两个 Nano Banana 别名。只有 Grok 支持一次 1–10 张，其余一次 1 张；只有 GPT 发送 quality。Gemini/Grok 的尺寸由提示词控制，不发送被忽略的 size/quality。GPT 的 size 主要控制画幅，不能承诺真实 4K。

视频为 grok-imagine-video、grok-imagine-video-1.5、grok-video、四个小写 minimax-h3 系列、MiniMax-H3、seedance-2.5、seedance-2.0、seedance-2.0-fast。逐模型时长、分辨率、参考素材和限制见 [视频说明](../../plugin-packages/heyroute-video/README.md)。grok-video 固定 720×405；Seedance 2.0 两档固定 15 秒；MiniMax 大小写名称属于不同线路，不能混用参数。

尚未开放 Seedance 2.5 视频编辑/延长：编辑按实际时长结算，延长使用最终总时长，须与源视频、操作入口、报价和最终结算一起实现。Grok Imagine 参考图保守限制 1 张，未文档化的模型/能力不宣称支持。价格页 17 行包含画质档，并不代表 17 个独立视频模型。价格页端点与专门教程存在差异，本实现采用完整教程的 `/v1/videos`，实际出片验收仍需记录。

## 配置与验证

系统支持“系统渠道”和“前台目录”两种模型来源。系统渠道模式直接使用已启用且已定价的渠道模型，不需要另建展示条目；只有启用前台目录模式时才需单独维护展示模型及线路。接入协议不会设定兑换率或把未定价模型免费开放。图片和视频 Key 须具有对应分组权限。上游账号权限不能从模型名称推断。

已通过协议包回归、SSE 解析和 HTTP 模拟集成、上传与旧注册表重载回归、前端能力测试、干净锁文件类型检查和生产构建。后台视频测试已改用 Heyroute 模型的默认时长，避免固定 15 秒的 Seedance 2.0 被通用 6 秒探测误判；回归覆盖实际模拟 HTTP 正文。线上基线的服务测试中原有 DNS/SSRF 环境失败及 NewAPI Channel 2 恢复测试失败在未修改源码中也可复现，本次不顺带修改这些行为。

已登录后台完成单次真实接口测试：gpt-image-2 单张图片约 48 秒、grok-video 6 秒视频约 50 秒，均返回成功，视频包含轮询和结果下载。后台测试不创建用户生成任务或本站计费订单；其他模型、参考素材、资源长期保存及最终扣费不能据此宣称全部验收。部署、备份和模型配置另记项目部署记录。

## 官方依据

- [图片帮助](https://heyroute.ai/help?collection=models-capabilities&page=image-model)
- [视频帮助](https://heyroute.ai/help?collection=models-capabilities&page=video-model)
- [模型页](https://heyroute.ai/pricing)
- [官方图片脚本](https://github.com/heyroute-ai/skills/blob/main/image-gen/scripts/heyroute_image.py)：只读核对，未安装或执行第三方 skill。
