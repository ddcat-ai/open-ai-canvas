package app

// 普通参考图与首尾帧是不同角色；操作只能从所选模型声明的合同中选择。
func cloudAgentVideoOperation(operations []string, defaultOperation string, images, videos, audios int, explicitFrames bool) string {
	var candidates []string
	switch {
	case explicitFrames:
		candidates = []string{"image_to_video"}
	case videos > 0:
		candidates = []string{"reference_to_video"}
	case images > 0:
		candidates = []string{"reference_to_video", "image_to_video"}
	case audios > 0:
		candidates = []string{"audio_to_video", "reference_to_video"}
	default:
		candidates = []string{"text_to_video"}
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

func cloudAgentVideoCatalogMatches(intent *ModelRequestIntent, operations []string, defaultOperation string) bool {
	return intent == nil || intent.Capability != "video" || cloudAgentVideoOperation(operations, defaultOperation, intent.Inputs["image"], intent.Inputs["video"], intent.Inputs["audio"], false) != ""
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
	operation := cloudAgentVideoOperation(operations, defaultOperation, lenAnySlice(refs["referenceImages"]), lenAnySlice(refs["referenceVideos"]), lenAnySlice(refs["referenceAudios"]), a.VideoStartFrameNodeID != "" || a.VideoEndFrameNodeID != "")
	if operation == "" {
		return "", cloudAgentFieldError("logicalModelId", "unsupported_value", "所选视频模型不支持当前参考素材与首尾帧模式")
	}
	return operation, nil
}
