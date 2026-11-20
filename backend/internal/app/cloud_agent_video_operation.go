package app

// cloudAgentVideoOperation 按参考素材在所选模型声明的操作里挑一个：普通参考图与首尾帧是不同角色，
// 普通图优先 reference_to_video，模型只支持 image_to_video 时沿用原来的首帧语义。
// 首尾帧由调用方提前确定为 image_to_video，不经过这里。operations 为空表示模型未限制操作，与 MatchCapability 一致。
func cloudAgentVideoOperation(operations []string, defaultOperation string, images, videos, audios int) string {
	var candidates []string
	switch {
	case videos > 0:
		candidates = []string{"reference_to_video"}
	case images > 0:
		candidates = []string{"reference_to_video", "image_to_video"}
	case audios > 0:
		candidates = []string{"audio_to_video", "reference_to_video"}
	default:
		candidates = []string{"text_to_video"}
	}
	if len(operations) == 0 {
		return candidates[0]
	}
	if containsCapabilityString(candidates, defaultOperation) && containsCapabilityString(operations, defaultOperation) {
		return defaultOperation
	}
	for _, operation := range candidates {
		if containsCapabilityString(operations, operation) {
			return operation
		}
	}
	return ""
}

// cloudAgentVideoCatalogMatches 让 Agent 的模型目录只列出能处理当前参考素材的视频模型。
// 目录查询不知道首尾帧，按普通参考判断；之后传首尾帧时仍由 CreateTask 的统一准入校验。
func cloudAgentVideoCatalogMatches(intent *ModelRequestIntent, operations []string, defaultOperation string) bool {
	return intent == nil || intent.Capability != "video" || cloudAgentVideoOperation(operations, defaultOperation, intent.Inputs["image"], intent.Inputs["video"], intent.Inputs["audio"]) != ""
}

func (s *Service) resolveCloudAgentMediaOperation(a cloudAgentMediaArgs, refs map[string]any) (string, error) {
	if a.Mode != "video" {
		return cloudAgentMediaOperation(a.Mode, refs), nil
	}
	if a.VideoStartFrameNodeID != "" || a.VideoEndFrameNodeID != "" {
		// 显式帧已确定操作；模型是否接受该操作仍由后续统一准入校验。
		return "image_to_video", nil
	}
	var operations []string
	defaultOperation := ""
	if a.LogicalModelID != "" {
		snapshot, err := s.routeCatalogSnapshot()
		if err != nil {
			return "", err
		}
		cached, exists := snapshot.Models[a.LogicalModelID]
		if !exists {
			return "", InvalidModelSelection("指定的逻辑模型不存在")
		}
		operations = cached.ProductSpec.Operations
	} else {
		item, err := s.repo.ChannelModelByKey(a.ChannelID, a.ChannelModelKey)
		if err != nil {
			return "", InvalidModelSelection("指定的模型不存在")
		}
		profile, err := normalizedChannelModelCapability(item, s.protocolRegistry())
		if err != nil {
			return "", err
		}
		if profile == nil || profile.Video == nil {
			return "", ModelCapabilityNotSupported("所选模型与视频生成能力不匹配")
		}
		operations, defaultOperation = profile.Video.Operations, profile.Video.DefaultOperation
	}
	operation := cloudAgentVideoOperation(operations, defaultOperation, lenAnySlice(refs["referenceImages"]), lenAnySlice(refs["referenceVideos"]), lenAnySlice(refs["referenceAudios"]))
	if operation == "" {
		return "", cloudAgentFieldError("logicalModelId", "unsupported_value", "所选视频模型不支持当前参考素材")
	}
	return operation, nil
}
