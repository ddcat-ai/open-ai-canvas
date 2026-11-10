package protocol

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
)

// ImageParameter is the image input contract shared by plugins, model
// configuration and generation. Binding is interpreted only at the provider
// boundary; names and values are never inferred from a model's display name.
type ImageParameter struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
	Values      []any    `json:"values,omitempty"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
	Step        *float64 `json:"step,omitempty"`
	MaxLength   int      `json:"maxLength,omitempty"`
	Default     any      `json:"default,omitempty"`
	Required    bool     `json:"required,omitempty"`
	Pricing     bool     `json:"pricing,omitempty"`
	Binding     string   `json:"binding,omitempty"`
	Encoding    string   `json:"encoding,omitempty"`
	Models      []string `json:"models,omitempty"`
	Enabled     *bool    `json:"enabled,omitempty"`
}

func (p ImageParameter) IsEnabled() bool { return p.Enabled == nil || *p.Enabled }
func (p ImageParameter) AppliesTo(model string) bool {
	return len(p.Models) == 0 || slices.Contains(p.Models, strings.TrimPrefix(strings.TrimSpace(model), "models/"))
}

var imageParameterName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

func ValidateImageParameters(parameters []ImageParameter) error {
	seen := map[string]bool{}
	bindings := map[string]bool{}
	for _, p := range parameters {
		if !imageParameterName.MatchString(p.Name) || seen[p.Name] || strings.TrimSpace(p.Label) == "" {
			return fmt.Errorf("invalid or duplicate image parameter %q", p.Name)
		}
		seen[p.Name] = true
		if p.Encoding != "" && (p.Binding != "aspectRatio" || p.Encoding != "pixels" && p.Encoding != "ratio") {
			return fmt.Errorf("image parameter %s has invalid encoding", p.Name)
		}
		switch p.Type {
		case "string", "number", "integer", "boolean":
		default:
			return fmt.Errorf("image parameter %s has unsupported type %s", p.Name, p.Type)
		}
		if p.Min != nil && (!finite(*p.Min) || p.Max != nil && *p.Min > *p.Max) || p.Max != nil && !finite(*p.Max) || p.Step != nil && (!finite(*p.Step) || *p.Step <= 0) || p.MaxLength < 0 {
			return fmt.Errorf("image parameter %s has invalid bounds", p.Name)
		}
		if p.Binding != "" {
			if !validImageParameterBinding(p.Binding) || bindings[p.Binding] {
				return fmt.Errorf("image parameter %s has invalid or duplicate binding", p.Name)
			}
			bindings[p.Binding] = true
		}
		for _, value := range p.Values {
			constraint := p
			constraint.Values = nil
			if !constraint.Accepts(value) {
				return fmt.Errorf("image parameter %s has invalid enum value", p.Name)
			}
		}
		if p.Default != nil && !p.Accepts(p.Default) {
			return fmt.Errorf("image parameter %s default is outside its constraints", p.Name)
		}
	}
	return nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func (p ImageParameter) Accepts(value any) bool {
	if value == nil {
		return !p.Required
	}
	switch p.Type {
	case "string":
		text, ok := value.(string)
		if !ok || p.MaxLength > 0 && len([]rune(text)) > p.MaxLength {
			return false
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return false
		}
	case "number", "integer":
		number, ok := imageParameterNumber(value)
		if !ok || !finite(number) || p.Type == "integer" && math.Trunc(number) != number {
			return false
		}
		if p.Min != nil && number < *p.Min || p.Max != nil && number > *p.Max {
			return false
		}
		if p.Step != nil {
			base := 0.0
			if p.Min != nil {
				base = *p.Min
			}
			steps := (number - base) / *p.Step
			if math.Abs(steps-math.Round(steps)) > 1e-8 {
				return false
			}
		}
	default:
		return false
	}
	if len(p.Values) == 0 {
		return true
	}
	for _, candidate := range p.Values {
		if ImageParameterValuesEqual(candidate, value) {
			return true
		}
	}
	return false
}

// CanonicalValue 返回声明里的原始写法：字符串枚举不区分大小写，比较通过后仍按 1K/2K/4K 下发，
// 避免把用户输入的小写透传给只认声明值的上游。
func (p ImageParameter) CanonicalValue(value any) any {
	text, ok := value.(string)
	if !ok || p.Type != "string" {
		return value
	}
	for _, candidate := range p.Values {
		if declared, isString := candidate.(string); isString && strings.EqualFold(strings.TrimSpace(declared), strings.TrimSpace(text)) {
			return declared
		}
	}
	return value
}

func imageParameterNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	default:
		return 0, false
	}
}

func ImageParameterValuesEqual(left, right any) bool {
	// 字符串枚举按声明值比较，不区分大小写；数字与布尔仍走严格比较。
	if l, lok := left.(string); lok {
		if r, rok := right.(string); rok {
			return strings.EqualFold(l, r)
		}
	}
	l, lok := imageParameterNumber(left)
	r, rok := imageParameterNumber(right)
	if lok || rok {
		return lok && rok && l == r
	}
	lb, _ := json.Marshal(left)
	rb, _ := json.Marshal(right)
	return string(lb) == string(rb)
}

func validImageParameterBinding(binding string) bool {
	switch binding {
	case "aspectRatio", "resolution", "quality", "imageCount", "transparentBackground":
		return true
	}
	parts := strings.Split(binding, ".")
	return len(parts) == 3 && parts[0] == "providerOptions" && validManifestIdentifier(parts[1]) && imageParameterName.MatchString(parts[2])
}

// CommonImageParameter defines host semantics, not provider capability limits.
// Model configuration owns values/ranges; bindings remain controlled here.
func CommonImageParameter(name string) (ImageParameter, bool) {
	p := ImageParameter{Name: name, Type: "string", Pricing: true}
	switch name {
	case "size":
		p.Label, p.Binding = "画幅 / 尺寸", "aspectRatio"
	case "imageResolution":
		p.Label, p.Binding = "分辨率", "resolution"
	case "quality":
		p.Label, p.Binding = "图片质量", "quality"
	case "count":
		minimum, step := 1.0, 1.0
		p.Label, p.Binding, p.Type, p.Min, p.Step = "生成数量", "imageCount", "integer", &minimum, &step
	case "transparentBackground":
		p.Label, p.Binding, p.Type = "透明背景", "transparentBackground", "boolean"
	default:
		return ImageParameter{}, false
	}
	return p, true
}

// ResolveImageParameters preserves configured common capabilities while private
// extensions remain restricted to the installed plugin's bindings and bounds.
func ResolveImageParameters(definitions, configured []ImageParameter, model string) ([]ImageParameter, error) {
	if err := ValidateImageParameters(definitions); err != nil {
		return nil, err
	}
	settings := map[string]ImageParameter{}
	for _, p := range configured {
		if _, duplicate := settings[p.Name]; duplicate {
			return nil, fmt.Errorf("duplicate image parameter %s", p.Name)
		}
		settings[p.Name] = p
	}
	definitions = append([]ImageParameter(nil), definitions...)
	for _, setting := range configured {
		common, ok := CommonImageParameter(setting.Name)
		if !ok {
			continue
		}
		found := false
		for _, definition := range definitions {
			found = found || definition.Name == setting.Name
		}
		if !found {
			common.Encoding = setting.Encoding
			definitions = append(definitions, common)
		}
	}
	result := make([]ImageParameter, 0, len(definitions))
	for _, definition := range definitions {
		setting, configured := settings[definition.Name]
		common, isCommon := CommonImageParameter(definition.Name)
		if !definition.AppliesTo(model) && !(isCommon && configured) {
			continue
		}
		if isCommon && configured {
			if setting.Type != "" && setting.Type != common.Type {
				return nil, fmt.Errorf("%s has invalid type", common.Label)
			}
			p := definition
			p.Type, p.Binding, p.Models, p.Pricing = common.Type, common.Binding, nil, true
			p.Enabled, p.Default = setting.Enabled, setting.Default
			p.Values, p.Min, p.Max, p.Step, p.MaxLength = setting.Values, setting.Min, setting.Max, setting.Step, setting.MaxLength
			if p.Name == "count" {
				if p.Min == nil {
					p.Min = common.Min
				}
				if *p.Min < 1 {
					return nil, fmt.Errorf("生成数量最小值必须为正整数")
				}
				if p.Step == nil {
					p.Step = common.Step
				}
			}
			if !p.IsEnabled() && p.Required {
				return nil, fmt.Errorf("%s is required", p.Label)
			}
			delete(settings, p.Name)
			result = append(result, p)
			continue
		}
		p := definition
		if setting, ok := settings[p.Name]; ok {
			p.Enabled = setting.Enabled
			if !p.IsEnabled() && p.Required {
				return nil, fmt.Errorf("%s is required", p.Label)
			}
			if setting.Values != nil {
				for _, value := range setting.Values {
					if !definition.Accepts(value) {
						return nil, fmt.Errorf("%s value exceeds plugin constraints", p.Label)
					}
				}
				if len(setting.Values) == 0 && len(definition.Values) > 0 && p.IsEnabled() {
					return nil, fmt.Errorf("%s requires supported values", p.Label)
				}
				p.Values = setting.Values
			}
			if setting.Min != nil {
				if definition.Min != nil && *setting.Min < *definition.Min {
					return nil, fmt.Errorf("%s minimum exceeds plugin constraints", p.Label)
				}
				p.Min = setting.Min
			}
			if setting.Max != nil {
				if definition.Max != nil && *setting.Max > *definition.Max {
					return nil, fmt.Errorf("%s maximum exceeds plugin constraints", p.Label)
				}
				p.Max = setting.Max
			}
			if setting.Step != nil {
				if definition.Step != nil && (math.Abs(*setting.Step / *definition.Step - math.Round(*setting.Step / *definition.Step)) > 1e-8 || *setting.Step < *definition.Step) {
					return nil, fmt.Errorf("%s step exceeds plugin constraints", p.Label)
				}
				p.Step = setting.Step
			}
			if definition.Step != nil && p.Min != nil {
				base := 0.0
				if definition.Min != nil {
					base = *definition.Min
				}
				steps := (*p.Min - base) / *definition.Step
				if math.Abs(steps-math.Round(steps)) > 1e-8 {
					return nil, fmt.Errorf("%s minimum does not align with plugin step", p.Label)
				}
			}
			p.Default = setting.Default
			delete(settings, p.Name)
		}
		result = append(result, p)
	}
	for _, p := range configured {
		name := p.Name
		if _, exists := settings[name]; !exists {
			continue
		}
		if p.IsEnabled() {
			return nil, fmt.Errorf("图片扩展参数 %s 缺少目标协议的安全映射", name)
		}
		result = append(result, p)
	}
	return result, ValidateImageParameters(result)
}

// ApplyImageParameters runs before building a request. It preserves false and
// zero, rejects undeclared values, and maps only plugin-declared destinations.
func ApplyImageParameters(request GenerationRequest, definitions []ImageParameter) (GenerationRequest, error) {
	if request.Capability != CapabilityImage || request.ImageParameters == nil {
		return request, nil
	}
	allowed := map[string]ImageParameter{}
	for _, p := range definitions {
		if p.AppliesTo(request.Model) {
			allowed[p.Name] = p
		}
	}
	if request.ProviderOptions == nil {
		request.ProviderOptions = map[string]map[string]any{}
	}
	if request.Extra == nil {
		request.Extra = map[string]any{}
	}
	for name, value := range request.ImageParameters {
		p, ok := allowed[name]
		if common, exists := CommonImageParameter(name); exists {
			// Model admission already validates configured ranges. Plugin enum
			// recommendations must not override them at the request boundary.
			common.Encoding = p.Encoding
			p, ok = common, true
		}
		if !ok || !p.Accepts(value) {
			return request, fmt.Errorf("unsupported image parameter %s", name)
		}
		if value == nil {
			continue
		}
		switch p.Binding {
		case "aspectRatio":
			// The app may have already encoded a ratio + resolution using its
			// saved pixel preset. Keep that exact outbound size.
			if !(p.Encoding == "pixels" && strings.Contains(fmt.Sprint(value), ":") && strings.Contains(request.AspectRatio, "x")) {
				request.AspectRatio = fmt.Sprint(value)
			}
		case "resolution":
			request.Resolution = fmt.Sprint(value)
		case "quality":
			request.Quality = fmt.Sprint(value)
		case "imageCount":
			n, _ := imageParameterNumber(value)
			request.ImageCount = int(n)
		case "transparentBackground":
			request.Extra["transparentBackground"] = fmt.Sprint(value)
		default:
			parts := strings.Split(p.Binding, ".")
			if len(parts) != 3 || parts[0] != "providerOptions" {
				return request, fmt.Errorf("image parameter %s has no request binding", name)
			}
			if request.ProviderOptions[parts[1]] == nil {
				request.ProviderOptions[parts[1]] = map[string]any{}
			}
			request.ProviderOptions[parts[1]][parts[2]] = value
		}
	}
	return request, nil
}
