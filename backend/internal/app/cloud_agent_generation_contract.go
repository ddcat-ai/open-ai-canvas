package app

import (
	"fmt"
	"strings"
	"yingce/backend/internal/canvas/contract"
)

// cloudAgentGenerationSpec 将 Agent 参数和已解析素材转换为画布生成合同。
// refs 提供真实素材类型，resolvedConfig 提供准入后的模型默认值；返回可保存的规格或参数错误。
func cloudAgentGenerationSpec(a cloudAgentMediaArgs, refs map[string]any, resolvedConfig map[string]any) (contract.GenerationSpec, error) {
	selection := &contract.ModelSelection{Kind: "channel", ChannelID: a.ChannelID, ModelKey: a.ChannelModelKey}
	if a.LogicalModelID != "" {
		selection = &contract.ModelSelection{Kind: "logical", LogicalModelID: a.LogicalModelID}
	}
	options := cloudAgentMediaOptions(a)
	if resolvedConfig != nil {
		config := options.TaskConfig()
		for key, value := range resolvedConfig {
			config[key] = value
		}
		var err error
		options, err = contract.OptionsFromTaskConfig(a.Mode, config)
		if err != nil {
			return contract.GenerationSpec{}, err
		}
	}
	byID := map[string]contract.ReferenceBinding{}
	for _, media := range []struct{ field, kind string }{{"referenceImages", "image"}, {"referenceVideos", "video"}, {"referenceAudios", "audio"}, {"referenceCharacters", "text"}} {
		for _, ref := range creationMaps(refs[media.field]) {
			id := stringValue(ref["id"])
			binding := contract.ReferenceBinding{ID: "node:" + id, NodeID: id, MediaType: media.kind, Role: "reference", Resolution: "latest"}
			if media.field == "referenceCharacters" {
				binding.Role = "source-text"
			}
			if key := stringValue(ref["storageKey"]); strings.HasPrefix(key, "resource:") {
				binding.ResourceID = strings.TrimPrefix(key, "resource:")
			}
			byID[id] = binding
		}
	}
	bindings := []contract.ReferenceBinding{}
	// 帧选择沿用视频编辑器的 metadata 字段；这里只校验真实引用，不从提示词或图片顺序猜用途。
	for _, frame := range []struct{ field, id string }{
		{"videoStartFrameNodeId", a.VideoStartFrameNodeID},
		{"videoEndFrameNodeId", a.VideoEndFrameNodeID},
	} {
		if frame.id == "" {
			continue
		}
		binding, exists := byID[frame.id]
		if a.Mode != "video" || !exists || binding.MediaType != "image" || !containsString(a.ReferenceNodeIDs, frame.id) {
			return contract.GenerationSpec{}, cloudAgentFieldError(frame.field, "invalid_value", "首尾帧仅用于视频，必须选择 referenceNodeIds 中的真实图片节点")
		}
	}
	for _, id := range a.ReferenceNodeIDs {
		binding, exists := byID[id]
		if !exists {
			return contract.GenerationSpec{}, BadAuthRequest("生成引用未解析，不能保存不完整生成规格")
		}
		binding.Order = len(bindings)
		bindings = append(bindings, binding)
	}
	for _, id := range a.ReferenceTransientIDs {
		bindings = append(bindings, contract.ReferenceBinding{ID: "transient:" + id, TransientID: id, MediaType: "image", Role: "reference", Order: len(bindings), Resolution: "snapshot"})
	}
	if a.SourceNodeID != "" {
		bindings = append(bindings, contract.ReferenceBinding{ID: "node:" + a.SourceNodeID, NodeID: a.SourceNodeID, MediaType: "text", Role: "source-text", Order: len(bindings), Resolution: "latest"})
	}
	spec := contract.GenerationSpec{Version: contract.GenerationVersion, Mode: a.Mode, Prompt: a.Prompt, ModelSelection: selection, Options: options, ReferenceBindings: bindings, TextInputMode: "prompt-only"}
	return spec, spec.Validate()
}

func cloudAgentMediaOptions(a cloudAgentMediaArgs) contract.Options {
	options := contract.Options{}
	// Absence stays absent until capability admission resolves model defaults.
	if (a.Mode == "image" || a.Mode == "video") && strings.TrimSpace(a.Size) != "" {
		options.Size = &a.Size
	}
	if a.Mode == "video" {
		if a.Duration > 0 {
			options.DurationSeconds = &a.Duration
		}
		options.GenerateAudio = a.VideoGenerateAudio
		options.Watermark = a.VideoWatermark
		if a.Quality != "" {
			options.Resolution = &a.Quality
		}
	} else if a.Mode == "image" {
		count := 1
		options.Count = &count
		if a.ImageResolution != "" {
			options.ImageResolution = &a.ImageResolution
		}
		if a.ImageParameters != "" {
			options.ImageParameters = &a.ImageParameters
		}
		if a.Quality != "" {
			options.Quality = &a.Quality
		}
	}
	if a.Mode == "audio" && strings.TrimSpace(a.AudioMode) != "" {
		options.AudioMode = &a.AudioMode
	}
	return options
}

func compileCloudAgentAudioVoiceBindings(prompt string, bindings []cloudAgentAudioVoiceBinding, refs map[string]any) (string, error) {
	if len(bindings) == 0 {
		return prompt, nil
	}
	audios := creationMaps(refs["referenceAudios"])
	characters := creationMaps(refs["referenceCharacters"])
	blocks := make([]string, 0, len(bindings))
	seen := map[string]bool{}
	for _, binding := range bindings {
		if seen[binding.CharacterNodeID] || binding.CharacterNodeID == "" || binding.AudioNodeID == "" {
			return "", cloudAgentFieldError("audioVoiceBindings", "invalid_value", "每个角色只能绑定一段参考音频，角色与音频节点 ID 不能为空或重复")
		}
		seen[binding.CharacterNodeID] = true
		characterName, audioIndex := "", -1
		for _, ref := range characters {
			if stringValue(ref["id"]) == binding.CharacterNodeID && stringValue(ref["canvasReferenceKind"]) == "character" {
				characterName = stringValue(ref["name"])
			}
		}
		for index, ref := range audios {
			if stringValue(ref["id"]) == binding.AudioNodeID {
				audioIndex = index + 1
			}
		}
		if characterName == "" || audioIndex < 1 {
			return "", cloudAgentFieldError("audioVoiceBindings", "invalid_value", "角色音色对应必须引用 referenceNodeIds 中已连接的角色和音频节点")
		}
		blocks = append(blocks, fmt.Sprintf("【角色音色对应】%s → @音频%d", characterName, audioIndex))
	}
	return strings.TrimSpace(prompt) + "\n\n" + strings.Join(blocks, "\n"), nil
}
