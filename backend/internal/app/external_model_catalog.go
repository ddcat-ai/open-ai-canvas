package app

import "encoding/json"

type ExternalParameter struct {
	Type        string `json:"type"`
	Default     any    `json:"default,omitempty"`
	Enum        any    `json:"enum,omitempty"`
	Minimum     any    `json:"minimum,omitempty"`
	Maximum     any    `json:"maximum,omitempty"`
	Step        any    `json:"step,omitempty"`
	Required    bool   `json:"required,omitempty"`
	Description string `json:"description,omitempty"`
}

func externalModelSpecification(channelID string, m PublicChannelModel) (ExternalModel, error) {
	item := ExternalModel{ID: channelID + "::" + m.ModelKey, Name: m.DisplayName, Capability: m.Capability, Description: m.Description, Parameters: map[string]ExternalParameter{}}
	raw, err := json.Marshal(m.CapabilityConfig)
	if err != nil {
		return item, err
	}
	var profile ModelCapabilityConfig
	if err := json.Unmarshal(raw, &profile); err != nil {
		return item, err
	}
	p := item.Parameters
	switch m.Capability {
	case "text":
		if profile.Text != nil {
			item.OutputTokenLimit = profile.Text.MaxOutputTokens
		}
		p["thinking"] = ExternalParameter{Type: "boolean", Default: false, Description: "归一为关闭/标准档；无法关闭时采用最低开启档。"}
	case "image":
		if image := profile.Image; image != nil {
			for _, parameter := range image.Parameters {
				name := map[string]string{"size": "aspectRatio", "imageResolution": "resolution", "quality": "quality", "count": "count"}[parameter.Name]
				if name == "" && parameter.IsEnabled() && parameter.Required && parameter.Default == nil {
					item.Limitation = "该模型存在外部 API 尚不支持的必填参数。"
				}
				if name == "" || !parameter.IsEnabled() {
					continue
				}
				spec := ExternalParameter{Type: parameter.Type, Default: parameter.Default, Required: parameter.Required, Description: parameter.Description}
				if len(parameter.Values) > 0 {
					spec.Enum = parameter.Values
				}
				if parameter.Min != nil {
					spec.Minimum = *parameter.Min
				}
				if parameter.Max != nil {
					spec.Maximum = *parameter.Max
				}
				if parameter.Step != nil {
					spec.Step = *parameter.Step
				}
				p[name] = spec
			}
		}
	case "video":
		if video := profile.Video; video != nil {
			if video.Processing != nil || video.References.MinImages > 0 {
				item.Limitation = "该模型需要参考媒体，当前外部 API 不支持调用。"
			}
			ratios, ratio := video.Ratios, video.DefaultRatio
			resolutions, resolution := video.Resolutions, video.DefaultResolution
			if fixed := video.FixedScreenSpec; fixed != nil {
				ratios, ratio, resolutions, resolution = fixed.Ratios, fixed.DefaultRatio, fixed.Resolutions, fixed.DefaultResolution
			}
			if len(ratios) > 0 {
				p["aspectRatio"] = ExternalParameter{Type: "string", Enum: ratios, Default: ratio}
			}
			if len(resolutions) > 0 {
				p["resolution"] = ExternalParameter{Type: "string", Enum: resolutions, Default: resolution}
			}
			if video.DurationSupported == nil || *video.DurationSupported {
				d := video.Duration
				spec := ExternalParameter{Type: "integer"}
				if d.Default > 0 {
					spec.Default = d.Default
				}
				if len(d.Values) > 0 {
					spec.Enum = d.Values
				}
				if d.Min > 0 {
					spec.Minimum = d.Min
				}
				if d.Max > 0 {
					spec.Maximum = d.Max
				}
				if d.Step > 0 {
					spec.Step = d.Step
				}
				p["duration"] = spec
			}
			if video.GenerateAudio.Supported {
				p["generateAudio"] = ExternalParameter{Type: "boolean", Default: video.GenerateAudio.Default}
			}
			if video.Watermark.Supported {
				p["watermark"] = ExternalParameter{Type: "boolean", Default: video.Watermark.Default}
			}
		}
	case "audio":
		for _, name := range []string{"voice", "audioFormat", "audioSpeed"} {
			p[name] = ExternalParameter{Type: "string", Description: "当前模型配置未声明枚举或范围；省略时由音频协议采用默认值。"}
		}
	default:
		item.Limitation = "当前外部 API 不支持此能力。"
	}
	return item, nil
}
