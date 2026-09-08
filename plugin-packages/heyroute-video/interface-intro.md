# 接口合同

此包提供两个后台可选协议，均使用渠道中的 apiKey 做 Bearer 鉴权；不会在 URL、请求正文或包内保存密钥。Base URL 为 https://heyroute.ai，接口路径统一包含 /v1。

## 创建与响应

POST /videos，application/json。model、prompt 原样映射；duration 校验后转为字符串 seconds；aspectRatio 映射 ratio；resolution 映射同名字段；generateAudio 映射 generate_audio。固定输出线路只发送有意义的字段。images、videos、audios 根据模型变为标量 input_reference 或带 role 的数组；按序转场协议只发送图片 input_reference 数组。

创建响应取 task_id/id，queued 为等待。GET /videos/{taskId} 不再发送 model；in_progress 为处理中，completed 为成功，failed 或未知状态为失败。error.code/error.message 表示业务失败，即使 HTTP 为 200。仅 completed 接收 video_url，标记临时资源后交宿主保存。若 completed 没有 video_url，则 GET /videos/{taskId}/content，带同一 Bearer 密钥请求媒体字节。

无上游取消端点，不提供 cancel；图片由 heyroute-image 提供。新版支持经校验的 Seedance seed、negative_prompt、shots；高级编辑/延长仍需实际时长结算支持。异常和 HTTP 状态由宿主处理，本插件不重试收费创建请求。

## Manifest 完整接口定义

下方内容由 build.py 与实际 manifest 同步生成。documentation 用固定占位文本避免自引用；安装包内实际字段包含 README 与本文。
