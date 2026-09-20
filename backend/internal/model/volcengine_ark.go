package model

// IsVolcengineArkImageProtocol 识别官方 Ark 图片与 Agent Plan 图片协议。
func IsVolcengineArkImageProtocol(protocol ChannelInterfaceType) bool {
	return protocol == ChannelInterfaceVolcengineArkImage || protocol == ChannelInterfaceVolcengineArkAgentPlanImage
}

// IsVolcengineArkVideoProtocol 识别官方 Ark 视频与 Agent Plan 视频协议。
func IsVolcengineArkVideoProtocol(protocol ChannelInterfaceType) bool {
	return protocol == ChannelInterfaceVolcengineArkVideo || protocol == ChannelInterfaceVolcengineArkAgentPlanVideo
}
