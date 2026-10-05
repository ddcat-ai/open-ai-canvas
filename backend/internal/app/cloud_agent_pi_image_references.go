package app

// 独立 Agent 运行时（Pi）的模型步骤带上获准图片清单。
//
// canvas_inspect_image 看图后，服务端的规范历史里会多一条带 resource: 图片占位的 user 消息。
// 旧的 Go 执行循环在发请求前调用 cloudAgentImageReferences，把这些占位对应的资源写进
// input.referenceImages，供应商层据此读取真实图片；Pi 路径（runCloudAgentModelStep）漏了这一步，
// 预检发现占位不在获准清单里，整轮以「模型协议引用了未获准的图片」失败。
//
// 这里复用同一个函数：校验资源归属与大小、按模型的图片数量上限移出多余图片，并返回清单。
// 它会改写传入的 canonical（只影响本次请求的副本），所以必须在组装任务输入之前调用，
// 且在 state.Canonical 已经保存完整历史之后调用。
func (s *Service) cloudAgentPiStepImageReferences(userID string, req CloudAgentRequest, canonical *canonicalAgentRequest) ([]providerMedia, error) {
	return s.cloudAgentImageReferences(userID, req, canonical)
}
