package app

import (
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
	options := contract.Options{}
	if a.Mode == "image" || a.Mode == "video" {
		// A blank option means "use the selected model's declared default". Do
		// not turn absence into an explicit empty value: task admission is where
		// the model capability contract resolves defaults and validates support.
		if strings.TrimSpace(a.Size) != "" {
			options.Size = &a.Size
		}
	}
	if a.Mode == "video" {
		if a.Duration > 0 {
			options.DurationSeconds = &a.Duration
		}
		options.GenerateAudio = a.VideoGenerateAudio
		if a.Quality != "" {
			options.Resolution = &a.Quality
		}
	} else if a.Mode == "image" {
		count := 1
		options.Count = &count
		if a.Quality != "" {
			options.Quality = &a.Quality
		}
	}
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
	for _, media := range []struct{ field, kind string }{{"referenceImages", "image"}, {"referenceVideos", "video"}, {"referenceAudios", "audio"}} {
		for _, ref := range creationMaps(refs[media.field]) {
			id := stringValue(ref["id"])
			binding := contract.ReferenceBinding{ID: "node:" + id, NodeID: id, MediaType: media.kind, Role: "reference", Resolution: "latest"}
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
