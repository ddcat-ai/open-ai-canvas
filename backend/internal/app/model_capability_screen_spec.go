package app

import (
	"path/filepath"
	"strings"
)

// autoDLGenericWorkflowID is the manifest workflow that supplies preset values
// for workflow IDs the plugin does not declare; the model ID itself is passed through.
const autoDLGenericWorkflowID = "*"

const (
	maxAutoDLResolutionValues = 32
	maxAutoDLResolutionRunes  = 40
)

// AutoDL's complete resolution label also controls orientation. The bundled
// workflow contract supplies preset choices (exact workflow first, then the
// generic "*" entry); administrators may add labels the upstream accepts.
// Client-supplied fixedScreenSpec values are ignored.
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
	if modelName == "" {
		return nil, BadAuthRequest("请填写 AutoDL 上游工作流 ID")
	}
	var exact, generic *VideoScreenSpecConfig
	for _, workflow := range pkg.info.Manifest.Contributes.Workflows {
		if workflow.ProviderID != "autodl-comfyui" || (workflow.ID != modelName && workflow.ID != autoDLGenericWorkflowID) {
			continue
		}
		spec := VideoScreenSpecConfig{Ratios: []string{}, Resolutions: []string{}}
		for _, parameter := range workflow.Parameters {
			if parameter.Mapping != "resolution" && parameter.Name != "resolution" {
				continue
			}
			spec.Resolutions = cleanVideoScreenSpecValues(parameter.Values)
			spec.DefaultResolution, _ = workflow.Defaults[parameter.Name].(string)
			spec.DefaultResolution = strings.TrimSpace(spec.DefaultResolution)
		}
		if workflow.ID == modelName {
			exact = &spec
		} else {
			generic = &spec
		}
	}
	fixed := exact
	if fixed == nil {
		fixed = generic
	}
	if fixed == nil || len(fixed.Resolutions) == 0 || !containsCapabilityString(fixed.Resolutions, fixed.DefaultResolution) {
		return nil, BadAuthRequest("AutoDL 插件未声明有效的默认分辨率预设，请更新插件")
	}
	value := *profile
	// AutoDL workflows do not declare an independent aspect-ratio parameter.
	value.Ratios, value.DefaultRatio = []string{}, ""
	value.Resolutions = cleanVideoScreenSpecValues(profile.Resolutions)
	value.DefaultResolution = strings.TrimSpace(profile.DefaultResolution)
	if len(value.Resolutions) > maxAutoDLResolutionValues {
		return nil, BadAuthRequest("AutoDL 分辨率最多配置 32 个")
	}
	for i, resolution := range value.Resolutions {
		if len([]rune(resolution)) > maxAutoDLResolutionRunes {
			return nil, BadAuthRequest("AutoDL 分辨率标签不能超过 40 个字符：" + resolution)
		}
		// Preset labels keep their original spelling; custom labels are kept as entered.
		for _, preset := range fixed.Resolutions {
			if strings.EqualFold(resolution, preset) {
				value.Resolutions[i] = preset
				break
			}
		}
		if strings.EqualFold(value.Resolutions[i], value.DefaultResolution) {
			value.DefaultResolution = value.Resolutions[i]
		}
	}
	if len(value.Resolutions) == 0 || !containsCapabilityString(value.Resolutions, value.DefaultResolution) {
		return nil, BadAuthRequest("请至少选择一个完整分辨率，并从所选值中设置默认值")
	}
	value.FixedScreenSpec = fixed
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
