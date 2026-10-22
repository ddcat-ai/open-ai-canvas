package app

import (
	"encoding/json"
	"strconv"
	"strings"

	"yingce/backend/internal/canvas/contract"
)

// Resolve configuration separately from content, graph planning and billed
// execution. User changes, persisted settings and optional LLM hints have
// different authority; only the last category may be normalized away.
func (s *Service) resolveCloudAgentMediaConfiguration(a *cloudAgentMediaArgs, state *cloudAgentRuntime, raw string, doc, refs map[string]any) error {
	if err := validateCloudAgentMediaConfigurationChange(a, state); err != nil {
		return err
	}
	selection, options, err := cloudAgentMediaDraftConfiguration(*a, doc)
	if err != nil {
		return err
	}
	if selection != nil && !a.ConfigurationChange.includes("model") {
		a.LogicalModelID, a.ChannelID, a.ChannelModelKey = selection.LogicalModelID, selection.ChannelID, selection.ModelKey
	}
	cloudAgentApplyUniqueModelListSelection(state, raw, a)
	if err := validateCloudAgentModelSelection(raw, *a); err != nil {
		return err
	}
	// 尺寸编码须使用草稿的有效档位；归一化后仍恢复保存值，不能清除用户配置。
	applyCloudAgentMediaDraftOptions(a, options)
	if err := s.normalizeCloudAgentImageOptions(a, refs); err != nil {
		return err
	}
	applyCloudAgentMediaDraftOptions(a, options)
	return nil
}

// Draft configuration is the baseline. Only separately declared changes can
// replace it; direct user edits in the existing approval bypass this step.
func cloudAgentMediaDraftConfiguration(a cloudAgentMediaArgs, doc map[string]any) (*contract.ModelSelection, contract.Options, error) {
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, contract.Options{}, err
	}
	node := nodes[a.NodeID]
	if node == nil || (a.Mode != "image" && a.Mode != "video") {
		return nil, contract.Options{}, nil
	}
	meta, _ := node["metadata"].(map[string]any)
	var options contract.Options
	var selection *contract.ModelSelection
	if raw, exists := meta["generationSpec"]; exists {
		encoded, err := json.Marshal(raw)
		if err != nil {
			return nil, options, err
		}
		spec, err := contract.Decode(encoded)
		if err != nil || spec.Mode != a.Mode {
			return nil, options, BadAuthRequest("草稿生成配置无效，未提交生成任务")
		}
		options, selection = spec.Options, spec.ModelSelection
	} else {
		config := map[string]any{}
		for _, key := range []string{"size", "quality", "imageResolution", "imageParameters", "vquality"} {
			config[key] = meta[key]
		}
		config["videoSeconds"], config["videoGenerateAudio"], config["videoWatermark"] = meta["seconds"], meta["generateAudio"], meta["watermark"]
		options, err = contract.OptionsFromTaskConfig(a.Mode, config)
		if err != nil {
			return nil, options, BadAuthRequest("草稿生成配置无效，未提交生成任务")
		}
		if id := stringValue(meta["logicalModelId"]); id != "" {
			selection = &contract.ModelSelection{Kind: "logical", LogicalModelID: id}
		} else if id, key := stringValue(meta["channelId"]), stringValue(meta["channelModelKey"]); id != "" && key != "" {
			selection = &contract.ModelSelection{Kind: "channel", ChannelID: id, ModelKey: key}
		} else if id, key, ok := strings.Cut(stringValue(meta["model"]), "::"); ok && id != "" && key != "" {
			selection = &contract.ModelSelection{Kind: "channel", ChannelID: id, ModelKey: key}
		}
	}
	if selection != nil {
		if err := selection.Validate(); err != nil {
			return nil, options, BadAuthRequest("草稿模型选择无效，未提交生成任务")
		}
	}
	return selection, options, nil
}

func applyCloudAgentMediaDraftOptions(a *cloudAgentMediaArgs, options contract.Options) {
	for _, field := range []struct {
		name           string
		stored, target *string
	}{
		{"size", options.Size, &a.Size}, {"quality", options.Quality, &a.Quality},
		{"imageResolution", options.ImageResolution, &a.ImageResolution}, {"imageParameters", options.ImageParameters, &a.ImageParameters},
		{"quality", options.Resolution, &a.Quality},
	} {
		if field.stored != nil && !a.ConfigurationChange.includes(field.name) {
			*field.target = *field.stored
		}
	}
	if options.DurationSeconds != nil && !a.ConfigurationChange.includes("durationSeconds") {
		a.Duration = *options.DurationSeconds
	}
	if options.GenerateAudio != nil && !a.ConfigurationChange.includes("videoGenerateAudio") {
		a.VideoGenerateAudio = options.GenerateAudio
	}
	if options.Watermark != nil {
		a.VideoWatermark = options.Watermark
	}
}

// Strip only undeclared optional image hints from LLM-authored calls, before
// quoting or approval. Supported values, size, model and user approval edits
// still pass through normal strict task admission; no model call is needed.
func (s *Service) normalizeCloudAgentImageOptions(a *cloudAgentMediaArgs, refs map[string]any) error {
	if a.Mode != "image" || (a.Quality == "" && a.ImageResolution == "" && lenAnySlice(refs["referenceImages"]) != 1) {
		return nil
	}
	var spec CapabilitySpec
	defaults := map[string]any{}
	if a.LogicalModelID != "" {
		snapshot, err := s.routeCatalogSnapshot()
		if err != nil {
			return err
		}
		cached, exists := snapshot.Models[a.LogicalModelID]
		if !exists {
			return InvalidModelSelection("指定的逻辑模型不存在")
		}
		spec = cached.ProductSpec
		defaults = cached.Defaults
	} else {
		item, err := s.repo.ChannelModelByKey(a.ChannelID, a.ChannelModelKey)
		if err != nil {
			return InvalidModelSelection("指定的模型不存在")
		}
		profile, err := normalizedChannelModelCapability(item, s.protocolRegistry())
		if err != nil {
			return err
		}
		spec, err = CapabilitySpecFromModelCapabilityConfig(profile, item.Capability)
		if err != nil {
			return err
		}
		applyChannelCapabilityDefaults(defaults, "image", profile)
	}
	if normalizeCapability(spec.Capability) != "image" {
		return ModelCapabilityNotSupported("所选模型与图片生成能力不匹配")
	}
	if resolution, declared := spec.Options["imageResolution"]; declared {
		if _, hasQuality := spec.Options["quality"]; !hasQuality && !a.ConfigurationChange.includes("quality") && a.ImageResolution == "" && a.Quality != "" && matchOptionConstraint("imageResolution", resolution, a.Quality) {
			// Old callers sometimes put a declared resolution in quality. Accept
			// only a value explicitly supported by this selected model.
			a.ImageResolution = a.Quality
		}
	} else if !a.ConfigurationChange.includes("imageResolution") {
		a.ImageResolution = ""
	}
	if _, declared := spec.Options["quality"]; !declared && !a.ConfigurationChange.includes("quality") {
		a.Quality = ""
	}
	if !a.ConfigurationChange.includes("size") && (a.Size == "" || matchOptionConstraint("size", spec.Options["size"], a.Size)) {
		if ratio := cloudAgentReferenceImageRatio(spec, refs); ratio != "" {
			options := cloudAgentMediaOptions(*a).TaskConfig()
			options["size"] = ratio
			if spec.ImageSize != nil && spec.ImageSize.Parameter == "size" && !a.ConfigurationChange.includes("imageResolution") {
				// 像素预设自带分辨率；继承画幅时只能在同一档位内转换，不能降到目录默认档。
				if preset, ok := declaredImageSizePreset(spec.ImageSize.Presets, a.Size, "", ""); ok && strings.EqualFold(a.Size, preset.Size) {
					if normalizeDeclaredImageRatio(preset.Ratio) == normalizeDeclaredImageRatio(ratio) {
						return nil
					}
					if inherited, ok := declaredImageSizePreset(spec.ImageSize.Presets, ratio, preset.Tier, ""); ok {
						a.Size = inherited.Size
					}
					return nil
				}
			}
			// 与能力准入共用预设及默认档位，避免将像素型模型的 size 留成比例字符串。
			intent := resolveModelRequestIntent(spec, ModelRequestIntent{Capability: "image", Options: options}, defaults)
			a.Size = stringValue(intent.Options["size"])
		}
	}
	return nil
}

// Preserve the source's aspect ratio for a single-image edit when the model
// declares that ratio. Never infer from the displayed canvas node dimensions,
// approximate to a different ratio, or turn source pixels into a custom size.
func cloudAgentReferenceImageRatio(spec CapabilitySpec, refs map[string]any) string {
	images := creationMaps(refs["referenceImages"])
	if len(images) != 1 {
		return ""
	}
	w, wok := numericScalar(images[0]["width"])
	h, hok := numericScalar(images[0]["height"])
	if !wok || !hok || w <= 0 || h <= 0 {
		return ""
	}
	for _, value := range spec.Options["size"].Values {
		ratio := stringValue(value)
		left, right, ok := strings.Cut(ratio, ":")
		x, xerr := strconv.Atoi(left)
		y, yerr := strconv.Atoi(right)
		if ok && xerr == nil && yerr == nil && x > 0 && y > 0 && w*float64(y) == h*float64(x) {
			return ratio
		}
	}
	if spec.ImageSize != nil {
		for _, preset := range spec.ImageSize.Presets {
			if float64(preset.Width) == w && float64(preset.Height) == h {
				if _, declared := spec.Options["size"]; declared {
					return preset.Ratio
				}
			}
		}
	}
	return ""
}
