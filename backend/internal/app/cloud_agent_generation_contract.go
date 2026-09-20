package app

import (
	"infinite-canvas/backend/internal/canvas/contract"
	"strings"
)

// Agent arguments and the canvas editor enter the same public generation codec.
// Resource materialization and provider credentials remain outside this object.
func cloudAgentGenerationSpec(a cloudAgentMediaArgs, refs map[string]any, resolvedConfig map[string]any) (contract.GenerationSpec, error) {
	selection := &contract.ModelSelection{Kind: "channel", ChannelID: a.ChannelID, ModelKey: a.ChannelModelKey}
	if a.LogicalModelID != "" {
		selection = &contract.ModelSelection{Kind: "logical", LogicalModelID: a.LogicalModelID}
	}
	options := contract.Options{}
	if a.Mode == "image" || a.Mode == "video" {
		options.Size = &a.Size
	}
	if a.Mode == "video" {
		options.DurationSeconds, options.GenerateAudio = &a.Duration, a.VideoGenerateAudio
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
