package app

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func resolveImageCapabilityParameters(image *ImageCapabilityConfig, definitions []protocol.ImageParameter, model string) error {
	configured := image.Parameters
	if configured == nil {
		// Import existing declarations once. A resolution-only plugin may import
		// old quality tiers only when every value is explicitly in its contract.
		hasQuality := false
		for _, p := range definitions {
			if p.Name == "quality" && p.AppliesTo(model) {
				hasQuality = true
			}
		}
		for _, definition := range definitions {
			if !definition.AppliesTo(model) {
				continue
			}
			p := definition
			enabled := p.IsEnabled()
			var values []string
			var initial string
			switch p.Name {
			case "size":
				enabled = image.Size.Parameter != "none"
				values, initial = image.Size.Values, image.Size.Default
			case "imageResolution":
				enabled = image.Resolution.Supported
				values, initial = image.Resolution.Values, image.Resolution.Default
				if !enabled && !hasQuality && image.Quality.Supported {
					valid := len(image.Quality.Values) > 0
					for _, value := range image.Quality.Values {
						valid = valid && definition.Accepts(value)
					}
					if valid {
						enabled, values, initial = true, image.Quality.Values, image.Quality.Default
					}
				}
			case "quality":
				enabled, values, initial = image.Quality.Supported, image.Quality.Values, image.Quality.Default
			case "transparentBackground":
				enabled, p.Default = image.TransparentBackground.Supported, image.TransparentBackground.Default
			case "count":
				maximum := float64(image.MaxOutputs)
				if p.Max == nil || maximum < *p.Max {
					p.Max = &maximum
				}
			}
			if len(values) > 0 {
				p.Values = nil
				for _, value := range values {
					if definition.Accepts(value) {
						p.Values = append(p.Values, value)
					}
				}
				if len(p.Values) == 0 {
					enabled = false
				}
				if p.Accepts(initial) {
					p.Default = initial
				} else if len(p.Values) > 0 {
					p.Default = p.Values[0]
				}
			}
			p.Enabled = &enabled
			configured = append(configured, p)
		}
	}
	parameters, err := protocol.ResolveImageParameters(definitions, configured, model)
	if err != nil {
		return BadAuthRequest("图片参数配置无效：" + err.Error())
	}
	image.Parameters = parameters
	return projectImageParameters(image)
}

// Legacy structs are an execution projection, never a second editable source.
func projectImageParameters(image *ImageCapabilityConfig) error {
	if err := protocol.ValidateImageParameters(image.Parameters); err != nil {
		return BadAuthRequest(err.Error())
	}
	image.Quality = ImageQualityConfig{Default: "auto", Values: []string{}}
	image.Resolution = ImageResolutionConfig{Default: "auto", Values: []string{}}
	image.TransparentBackground = VideoBooleanConfig{}
	image.ResolutionUsesQuality = false
	image.MaxOutputs = 1
	sizeEnabled := false
	for _, p := range image.Parameters {
		if !p.IsEnabled() {
			continue
		}
		values := make([]string, 0, len(p.Values))
		for _, value := range p.Values {
			values = append(values, fmt.Sprint(value))
		}
		initial := "auto"
		if p.Default != nil {
			initial = fmt.Sprint(p.Default)
		} else if len(values) > 0 {
			initial = values[0]
		}
		switch p.Name {
		case "size":
			sizeEnabled = true
			image.Size.Parameter = "aspect_ratio"
			if p.Encoding == "pixels" {
				image.Size.Parameter = "size"
				for _, value := range values {
					if strings.Contains(value, ":") {
						image.Size.Parameter = "aspect_ratio"
						break
					}
				}
			}
			image.Size.Values, image.Size.Default = values, initial
			image.Size.AllowCustom = len(p.Values) == 0
		case "imageResolution":
			image.Resolution = ImageResolutionConfig{Supported: true, Values: values, Default: initial}
		case "quality":
			image.Quality = ImageQualityConfig{Supported: true, Values: values, Default: initial}
		case "transparentBackground":
			image.TransparentBackground = VideoBooleanConfig{Supported: true, Default: p.Default == true}
		case "count":
			if p.Max != nil {
				image.MaxOutputs = int(*p.Max)
			}
		}
	}
	if !sizeEnabled {
		image.Size = ImageSizeConfig{Parameter: "none", Default: "auto", Values: []string{}}
	}
	if sizeEnabled {
		presets := make([]ImageSizePreset, 0, len(image.Size.Presets))
		for _, preset := range image.Size.Presets {
			value := preset.Ratio
			if image.Size.Parameter == "size" {
				value = preset.Size
			}
			if (image.Size.AllowCustom || containsCapabilityString(image.Size.Values, value)) && (!image.Resolution.Supported || len(image.Resolution.Values) == 0 || containsCapabilityString(image.Resolution.Values, preset.Tier)) {
				presets = append(presets, preset)
			}
		}
		image.Size.Presets = presets
	}
	return nil
}

func publicImageParameters(parameters []protocol.ImageParameter) []protocol.ImageParameter {
	result := make([]protocol.ImageParameter, 0, len(parameters))
	for _, p := range parameters {
		p.Binding, p.Models = "", nil
		p.Encoding = ""
		result = append(result, p)
	}
	return result
}

// Disabled resolution keeps its presets for editing; execution uses one explicit
// default group. Multiple groups without a default must not pick by array order.
func singleImageSizeTier(image *ImageCapabilityConfig) (string, bool) {
	if image.Size.DefaultTier != "" {
		return image.Size.DefaultTier, true
	}
	for _, field := range image.Parameters {
		if field.Name == "imageResolution" && field.Default != nil && field.Default != "auto" {
			return fmt.Sprint(field.Default), true
		}
	}
	for _, preset := range image.Size.Presets {
		if preset.Size == image.Size.Default {
			return preset.Tier, true
		}
	}
	if len(image.Size.Presets) == 0 {
		return "", true
	}
	tier := image.Size.Presets[0].Tier
	for _, preset := range image.Size.Presets {
		if preset.Tier != tier {
			return "", false
		}
	}
	return tier, true
}

func activeImageSizePresets(image *ImageCapabilityConfig) []ImageSizePreset {
	if image.Parameters == nil || image.Resolution.Supported {
		return image.Size.Presets
	}
	tier, ok := singleImageSizeTier(image)
	if !ok {
		return nil
	}
	result := make([]ImageSizePreset, 0, len(image.Size.Presets))
	for _, preset := range image.Size.Presets {
		if preset.Tier == tier {
			result = append(result, preset)
		}
	}
	return result
}

func imageParameterConstraints(parameters []protocol.ImageParameter) map[string]OptionConstraint {
	result := map[string]OptionConstraint{}
	for _, p := range parameters {
		if !p.IsEnabled() {
			continue
		}
		constraint := OptionConstraint{Values: p.Values, Min: p.Min, Max: p.Max, Step: p.Step}
		if len(p.Values) > 0 {
			constraint.Min, constraint.Max, constraint.Step = nil, nil, nil
		}
		if len(p.Values) == 0 && p.Type == "boolean" {
			constraint.Values = []any{false, true}
		}
		if len(p.Values) == 0 && p.Type == "string" {
			constraint.Values = []any{"*"}
		}
		if len(p.Values) == 0 && (p.Type == "number" || p.Type == "integer") && (p.Min == nil || p.Max == nil) {
			constraint = OptionConstraint{Values: []any{"*"}}
		}
		result[p.Name] = constraint
	}
	return result
}

func imageParameterDefaults(parameters []protocol.ImageParameter) map[string]any {
	result := map[string]any{}
	for _, p := range parameters {
		if p.IsEnabled() && p.Default != nil {
			result[p.Name] = p.Default
		}
	}
	return result
}

func imageParameterValue(p protocol.ImageParameter, value any) any {
	text, ok := value.(string)
	if !ok || p.Type == "string" {
		return value
	}
	switch p.Type {
	case "boolean":
		if v, err := strconv.ParseBool(text); err == nil {
			return v
		}
	case "number", "integer":
		if v, err := strconv.ParseFloat(text, 64); err == nil {
			return v
		}
	}
	return value
}

func imageParameterUnsupportedMessage(p protocol.ImageParameter) string {
	message := "图片参数超出支持范围：" + p.Label
	if len(p.Values) > 0 {
		values := make([]string, 0, min(len(p.Values), 12))
		for _, value := range p.Values[:min(len(p.Values), 12)] {
			values = append(values, fmt.Sprint(value))
		}
		message += "；支持值：" + strings.Join(values, "、")
		if len(p.Values) > len(values) {
			message += "等"
		}
	} else if p.Min != nil || p.Max != nil {
		message += fmt.Sprintf("；范围：%s-%s", formatImageParameterBound(p.Min), formatImageParameterBound(p.Max))
	}
	if p.Default != nil {
		message += "；默认值：" + fmt.Sprint(p.Default)
	}
	if p.Binding == "aspectRatio" && p.Encoding == "pixels" {
		message += "；若使用比例，按 model_list 的 imageSize.presets 选择对应像素尺寸"
	}
	return message
}

func formatImageParameterBound(value *float64) string {
	if value == nil {
		return "不限"
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

func imageParameterAdmissionError(field, issue, message string) error {
	return NewModelError(ErrCodeModelCapabilityNotSupported, message).WithDetails(map[string]any{
		"field":   field,
		"issue":   issue,
		"message": message,
	})
}

func resolveImageParameterValues(parameters []protocol.ImageParameter, values map[string]any) (map[string]any, error) {
	allowed := map[string]protocol.ImageParameter{}
	result := imageParameterDefaults(parameters)
	for _, p := range parameters {
		if p.IsEnabled() {
			allowed[p.Name] = p
		}
	}
	for name, value := range values {
		p, ok := allowed[name]
		if !ok {
			return nil, imageParameterAdmissionError(name, "unsupported_value", "当前图片模型未启用参数："+name)
		}
		value = imageParameterValue(p, value)
		if !p.Accepts(value) {
			return nil, imageParameterAdmissionError(p.Name, "unsupported_value", imageParameterUnsupportedMessage(p))
		}
		if value != nil && value != "" {
			result[name] = value
		}
	}
	for _, p := range parameters {
		if p.IsEnabled() && p.Required && (result[p.Name] == nil || result[p.Name] == "") {
			return nil, imageParameterAdmissionError(p.Name, "required", "请填写图片参数："+p.Label)
		}
	}
	return result, nil
}

func validateImageParameterPriceSelector(parameters []protocol.ImageParameter, selector map[string]string) error {
	allowed := map[string]protocol.ImageParameter{}
	for _, p := range parameters {
		if p.IsEnabled() && p.Pricing {
			allowed[p.Name] = p
		}
	}
	for name, value := range selector {
		if name == "operation" {
			if value != "text_to_image" && value != "image_to_image" && value != "" && value != "*" {
				return BadAuthRequest("图片价格生成方式无效")
			}
			continue
		}
		p, ok := allowed[name]
		if !ok {
			return BadAuthRequest("当前图片模型未声明此计价参数：" + name)
		}
		if value == "" || value == "*" {
			continue
		}
		if !p.Accepts(imageParameterValue(p, value)) {
			return BadAuthRequest("价格档参数不在支持范围内：" + p.Label)
		}
	}
	return nil
}

func declaredImageParameterValues(config map[string]any, parameters []protocol.ImageParameter) map[string]any {
	values := map[string]any{}
	for _, p := range parameters {
		if !p.IsEnabled() {
			continue
		}
		if value, exists := config[p.Name]; exists && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
			values[p.Name] = value
		}
	}
	if extras, ok := config["imageParameters"].(map[string]any); ok {
		for name, value := range extras {
			values[name] = value
		}
	}
	if encoded, ok := config["imageParameters"].(string); ok && encoded != "" {
		var extras map[string]any
		if json.Unmarshal([]byte(encoded), &extras) == nil {
			for name, value := range extras {
				values[name] = value
			}
		} else {
			values["invalidImageParameters"] = encoded
		}
	}
	return values
}

// Admission and worker execution use the same validated values. Core fields are
// only a transport projection; unknown or disabled extension values fail here.
func applyImageParameterValues(config *providerConfig, profile *ImageCapabilityConfig) error {
	if profile == nil || profile.Parameters == nil {
		return nil
	}
	values := declaredImageParameterValues(map[string]any{
		"size": config.Size, "imageResolution": config.ImageResolution, "quality": config.Quality,
		"count": config.Count, "transparentBackground": config.TransparentBackground, "imageParameters": config.ImageParameters,
	}, profile.Parameters)
	for _, field := range profile.Parameters {
		if field.Name == "size" && !field.Accepts(values["size"]) {
			size, resolution := fmt.Sprint(values["size"]), config.ImageResolution
			if pixels := resolveImageTaskSize(profile, config.InterfaceType, size, resolution); field.Encoding == "pixels" && field.Accepts(pixels) {
				values["size"] = pixels
			} else if ratio := imageSizeRatioForDeclaredPreset(profile, size, resolution); ratio != "" && field.Accepts(ratio) {
				values["size"] = ratio
			}
		}
	}
	resolved, err := resolveImageParameterValues(profile.Parameters, values)
	if err != nil {
		return err
	}
	config.ImageParameters = resolved
	text := func(name string) string {
		if value, exists := resolved[name]; exists {
			return fmt.Sprint(value)
		}
		return ""
	}
	config.Size, config.ImageResolution, config.Quality = text("size"), text("imageResolution"), text("quality")
	config.Count, config.TransparentBackground = text("count"), text("transparentBackground")
	if imageSizePixelOutbound(profile, config.InterfaceType) {
		config.Size = resolveImageTaskSize(profile, config.InterfaceType, config.Size, config.ImageResolution)
		if strings.Contains(config.Size, ":") {
			return BadAuthRequest("当前比例与分辨率缺少明确的像素尺寸映射")
		}
	}
	return nil
}

func imagePriceSelectorForParameters(parameters []protocol.ImageParameter, intent ModelRequestIntent) map[string]string {
	selector := map[string]string{"operation": "text_to_image"}
	if intent.Inputs["image"] > 0 {
		selector["operation"] = "image_to_image"
	}
	for _, p := range parameters {
		if value, ok := intent.Options[p.Name]; ok && p.IsEnabled() && p.Pricing && value != nil {
			selector[p.Name] = fmt.Sprint(value)
		}
	}
	return selector
}

func imagePriceParametersForChannel(channelModel model.ChannelModel, specs ...CapabilitySpec) []protocol.ImageParameter {
	if len(specs) > 0 {
		return specs[0].ImageParameters
	}
	config, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err == nil && config != nil && config.Image != nil {
		return config.Image.Parameters
	}
	return nil
}

// Read projection follows live route declarations. Explicit omissions in a new
// frontend schema remain omissions; a legacy snapshot imports available fields
// once. The saved route graph and administrator restrictions remain untouched.
func effectiveImageParameterSpec(spec CapabilitySpec, routes []CapabilitySpec) CapabilitySpec {
	if spec.Capability != "image" {
		return spec
	}
	sources := map[string]protocol.ImageParameter{}
	conflicts := map[string]bool{}
	order := []string{}
	for _, route := range routes {
		for _, p := range route.ImageParameters {
			if !p.IsEnabled() {
				continue
			}
			previous, exists := sources[p.Name]
			if !exists {
				sources[p.Name] = p
				order = append(order, p.Name)
				continue
			}
			if previous.Type != p.Type {
				conflicts[p.Name] = true
				continue
			}
			previous.Pricing = previous.Pricing && p.Pricing
			if len(previous.Values) > 0 && len(p.Values) > 0 {
				for _, candidate := range p.Values {
					found := false
					for _, value := range previous.Values {
						found = found || protocol.ImageParameterValuesEqual(candidate, value)
					}
					if !found {
						previous.Values = append(previous.Values, candidate)
					}
				}
			} else if p.Min != nil && p.Max != nil && previous.Min != nil && previous.Max != nil {
				minimum, maximum := min(*p.Min, *previous.Min), max(*p.Max, *previous.Max)
				candidate := OptionConstraint{Min: &minimum, Max: &maximum, Step: previous.Step}
				if optionConstraintCovered(candidate, p.Name, routes) {
					previous.Min, previous.Max = &minimum, &maximum
				}
			}
			sources[p.Name] = previous
		}
	}
	hasContract := false
	for _, route := range routes {
		hasContract = hasContract || route.ImageParameters != nil
	}
	if !hasContract {
		return spec
	}
	result := spec
	result.ImageParameters = []protocol.ImageParameter{}
	result.Options = map[string]OptionConstraint{}
	for _, name := range order {
		if conflicts[name] {
			log.Printf("image parameter omitted because route types conflict: %s", name)
			continue
		}
		p := sources[name]
		constraint, selected := spec.Options[name]
		if !selected {
			known := false
			for _, previous := range spec.ImageParameters {
				known = known || previous.Name == name
			}
			if known {
				disabled := false
				p.Enabled = &disabled
				result.ImageParameters = append(result.ImageParameters, p)
				continue
			}
		}
		if selected {
			if len(constraint.Values) > 0 && !isWildcardOptionConstraint(constraint) {
				values := []any{}
				for _, value := range constraint.Values {
					if p.Accepts(imageParameterValue(p, value)) {
						values = append(values, imageParameterValue(p, value))
					}
				}
				if len(values) == 0 {
					continue
				}
				p.Values = values
			}
			if constraint.Min != nil && (p.Min == nil || *constraint.Min > *p.Min) {
				p.Min = constraint.Min
			}
			if constraint.Max != nil && (p.Max == nil || *constraint.Max < *p.Max) {
				p.Max = constraint.Max
			}
			if constraint.Step != nil && (p.Step == nil || *constraint.Step >= *p.Step) {
				p.Step = constraint.Step
			}
			if p.Min != nil && p.Max != nil && *p.Min > *p.Max {
				continue
			}
		}
		if p.Default != nil && !p.Accepts(p.Default) {
			p.Default = nil
			if len(p.Values) > 0 {
				p.Default = p.Values[0]
			}
		}
		p.Binding, p.Models, p.Encoding = "", nil, ""
		result.ImageParameters = append(result.ImageParameters, p)
	}
	result.Options = imageParameterConstraints(result.ImageParameters)
	result.ImageSize = mergeCapabilityImageSize(routes)
	if _, ok := result.Options["size"]; !ok {
		result.ImageSize = nil
	}
	return result
}
