package app

import (
	"path/filepath"
	"strings"
)

// AutoDL's complete resolution enum also controls orientation. The bundled
// workflow contract supplies fixed choices; client-supplied fixed values are ignored.
func normalizeAutoDLVideoScreenSpec(profile *VideoCapabilityConfig, modelName string) (*VideoCapabilityConfig, error) {
	dir, err := officialPluginPackageDir()
	if err != nil {
		return nil, BadAuthRequest("无法读取 AutoDL 工作流规格")
	}
	pkg, err := inspectOfficialPluginPackage(filepath.Join(dir, "autodl-comfyui.yingce-plugin"))
	if err != nil {
		return nil, BadAuthRequest("无法读取 AutoDL 工作流规格")
	}
	modelName = strings.TrimPrefix(strings.TrimSpace(modelName), "models/")
	fixed := VideoScreenSpecConfig{Ratios: []string{}, Resolutions: []string{}}
	found := false
	for _, workflow := range pkg.info.Manifest.Contributes.Workflows {
		if workflow.ID != modelName || workflow.ProviderID != "autodl-comfyui" {
			continue
		}
		found = true
		for _, parameter := range workflow.Parameters {
			if parameter.Mapping != "resolution" && parameter.Name != "resolution" {
				continue
			}
			fixed.Resolutions = cleanVideoScreenSpecValues(parameter.Values)
			fixed.DefaultResolution, _ = workflow.Defaults[parameter.Name].(string)
			fixed.DefaultResolution = strings.TrimSpace(fixed.DefaultResolution)
		}
		break
	}
	if !found || len(fixed.Resolutions) == 0 || !containsCapabilityString(fixed.Resolutions, fixed.DefaultResolution) {
		return nil, BadAuthRequest("当前 AutoDL 工作流未声明有效的分辨率列表和默认值")
	}
	value := *profile
	// No AutoDL v2.3 workflow declares an independent aspect-ratio parameter.
	value.Ratios, value.DefaultRatio = []string{}, ""
	value.Resolutions = cleanVideoScreenSpecValues(profile.Resolutions)
	value.DefaultResolution = strings.TrimSpace(profile.DefaultResolution)
	for i, resolution := range value.Resolutions {
		matched := false
		for _, preset := range fixed.Resolutions {
			if strings.EqualFold(resolution, preset) {
				value.Resolutions[i] = preset
				matched = true
				break
			}
		}
		if !matched {
			return nil, BadAuthRequest("分辨率不在当前 AutoDL 工作流的插件预设中：" + resolution)
		}
		if strings.EqualFold(value.Resolutions[i], value.DefaultResolution) {
			value.DefaultResolution = value.Resolutions[i]
		}
	}
	if len(value.Resolutions) == 0 || !containsCapabilityString(value.Resolutions, value.DefaultResolution) {
		return nil, BadAuthRequest("请至少选择一个完整分辨率，并从所选值中设置默认值")
	}
	value.FixedScreenSpec = &fixed
	return &value, nil
}

func cleanVideoScreenSpecValues(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value != "" && !seen[key] {
			result = append(result, value)
			seen[key] = true
		}
	}
	return result
}

func applyAutoDLVideoScreenSpec(input *canvasGenerationInput, profile *VideoCapabilityConfig) {
	if input == nil || profile == nil || profile.FixedScreenSpec == nil {
		return
	}
	input.Config.Size = ""
	resolution := videoResolutionNameRequest(profile, input.Config.VQuality)
	if resolution != "" {
		input.Config.VQuality = resolution
	} else if isAutomaticVideoResolution(input.Config.VQuality) {
		input.Config.VQuality = profile.DefaultResolution
	}
}
