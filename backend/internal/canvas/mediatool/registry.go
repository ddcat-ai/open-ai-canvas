// Package mediatool 定义画布和 Agent 共用的公开媒体工具合同，不包含供应商配置。
package mediatool

import (
	"encoding/json"
	"fmt"
)

type Parameter struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Enum        []any  `json:"enum,omitempty"`
	Minimum     *int   `json:"minimum,omitempty"`
	Maximum     *int   `json:"maximum,omitempty"`
	Capability  string `json:"capability,omitempty"`
}

type Input struct {
	MediaType string `json:"mediaType"`
	Count     int    `json:"count"`
	Role      string `json:"role"`
}

type Definition struct {
	ID          string               `json:"id"`
	Operation   string               `json:"operation"`
	Label       string               `json:"label"`
	Description string               `json:"description"`
	Mode        string               `json:"mode"`
	Input       Input                `json:"input"`
	Output      string               `json:"output"`
	Executor    string               `json:"executor"`
	SideEffect  string               `json:"sideEffect"`
	Parameters  map[string]Parameter `json:"parameters"`
}

// Parameters 只保存用户可恢复的参数；resolution 沿用生成合同 options.resolution。
type Parameters struct {
	FPS          *int    `json:"fps,omitempty"`
	BitrateLevel *string `json:"bitrateLevel,omitempty"`
	Bitrate      *int    `json:"bitrate,omitempty"`
}

func number(value int) *int { return &value }

var definitions = []Definition{
	{ID: "enhanceVideo", Operation: "enhance", Label: "画质增强", Description: "增强源视频画质，可选择输出分辨率、帧率和码率", Parameters: map[string]Parameter{
		"resolution":   {Type: "string", Title: "分辨率", Capability: "video.resolutions"},
		"fps":          {Type: "integer", Title: "帧率", Capability: "video.processing.fpsOptions"},
		"bitrateLevel": {Type: "string", Title: "码率档位", Enum: []any{"low", "medium", "high"}},
		"bitrate":      {Type: "integer", Title: "精确码率", Description: "单位 kbps", Minimum: number(10), Maximum: number(150000)},
	}},
	{ID: "depthVideo", Operation: "depth", Label: "相对深度", Description: "根据单个源视频生成相对深度视频"},
	{ID: "upscaleVideo", Operation: "upscale", Label: "视频超分", Description: "对单个源视频进行 AI 超分"},
	{ID: "removeVideoSubtitles", Operation: "remove_subtitles", Label: "去字幕", Description: "去除单个源视频中的字幕"},
}

func init() {
	for i := range definitions {
		d := &definitions[i]
		d.Mode, d.Input, d.Output, d.Executor, d.SideEffect = "video", Input{MediaType: "video", Count: 1, Role: "reference"}, "video", "video-processing", "media"
		if d.Parameters == nil {
			d.Parameters = map[string]Parameter{}
		}
	}
	if err := Validate(definitions); err != nil {
		panic(err)
	}
}

func Validate(items []Definition) error {
	seen := map[string]bool{}
	operations := map[string]bool{}
	for _, d := range items {
		if d.ID == "" || d.Operation == "" || seen[d.ID] || operations[d.Operation] {
			return fmt.Errorf("媒体工具标识或操作重复/为空")
		}
		seen[d.ID], operations[d.Operation] = true, true
		if d.Executor != "video-processing" || d.Mode != "video" || d.Input.MediaType != "video" || d.Input.Count != 1 || d.Input.Role != "reference" || d.Output != "video" || d.SideEffect != "media" {
			return fmt.Errorf("媒体工具执行器或输入输出合同无效: %s", d.ID)
		}
		for name, p := range d.Parameters {
			// 执行器只实现这些公开参数；声明成功必须同时保证表单、解码与供应商映射可执行。
			var kind, capability string
			switch name {
			case "resolution":
				kind, capability = "string", "video.resolutions"
			case "fps":
				kind, capability = "integer", "video.processing.fpsOptions"
			case "bitrateLevel":
				kind = "string"
			case "bitrate":
				kind = "integer"
			default:
				return fmt.Errorf("执行器不支持参数: %s", name)
			}
			if p.Type != kind || p.Capability != capability || p.Title == "" {
				return fmt.Errorf("媒体工具参数合同无效: %s", name)
			}
			if kind != "integer" && (p.Minimum != nil || p.Maximum != nil) {
				return fmt.Errorf("文本参数不能声明数值范围: %s", name)
			}
			if p.Minimum != nil && p.Maximum != nil && *p.Minimum > *p.Maximum {
				return fmt.Errorf("参数范围无效: %s", name)
			}
			if capability != "" && len(p.Enum) > 0 {
				return fmt.Errorf("模型能力字段不能覆盖动态枚举: %s", name)
			}
			if name == "bitrate" && (p.Minimum == nil || p.Maximum == nil || *p.Minimum < 10 || *p.Maximum > 150000 || len(p.Enum) > 0) {
				return fmt.Errorf("码率范围超出执行器支持")
			}
			if name == "bitrateLevel" {
				if len(p.Enum) == 0 {
					return fmt.Errorf("码率档位必须声明枚举")
				}
				for _, value := range p.Enum {
					if value != "low" && value != "medium" && value != "high" {
						return fmt.Errorf("不支持的码率档位")
					}
				}
			}
		}
	}
	return nil
}

func Definitions() []Definition {
	// 返回深拷贝，调用方收窄模型能力时不能修改全局注册。
	raw, _ := json.Marshal(definitions)
	var result []Definition
	_ = json.Unmarshal(raw, &result)
	return result
}

func Lookup(operation string) (Definition, bool) {
	for _, d := range Definitions() {
		if d.Operation == operation {
			return d, true
		}
	}
	return Definition{}, false
}
func Operations() []string {
	result := []string{}
	for _, d := range definitions {
		result = append(result, d.Operation)
	}
	return result
}

func ParameterSchema() map[string]any {
	properties := map[string]any{}
	for _, d := range Definitions() {
		for name, p := range d.Parameters {
			if name == "resolution" {
				continue
			}
			raw, _ := json.Marshal(p)
			var field map[string]any
			_ = json.Unmarshal(raw, &field)
			delete(field, "capability")
			properties[name] = field
		}
	}
	return map[string]any{"type": "object", "additionalProperties": false, "properties": properties}
}

func ValidateParameters(operation string, parameters *Parameters) error {
	d, ok := Lookup(operation)
	if !ok {
		return fmt.Errorf("未知媒体处理操作")
	}
	if parameters == nil {
		return nil
	}
	raw, _ := json.Marshal(parameters)
	values := map[string]any{}
	_ = json.Unmarshal(raw, &values)
	for name, value := range values {
		p, allowed := d.Parameters[name]
		if !allowed {
			return fmt.Errorf("%s 不接受参数 %s", d.Label, name)
		}
		if p.Minimum != nil && value.(float64) < float64(*p.Minimum) || p.Maximum != nil && value.(float64) > float64(*p.Maximum) {
			return fmt.Errorf("参数 %s 超出允许范围", name)
		}
		if len(p.Enum) > 0 {
			valid := false
			for _, item := range p.Enum {
				if item == value {
					valid = true
				}
			}
			if !valid {
				return fmt.Errorf("参数 %s 取值无效", name)
			}
		}
	}
	return nil
}

func TypeScriptDeclaration() string {
	raw, _ := json.MarshalIndent(Definitions(), "", "  ")
	return "// Generated by go generate ./internal/canvas/contract. Do not edit.\nexport type ProcessingParameters = import(\"./generation-contract.generated\").Parameters;\nexport const MEDIA_TOOLS = " + string(raw) + " as const;\nexport type MediaToolDefinition = (typeof MEDIA_TOOLS)[number];\nexport type MediaProcessingOperation = MediaToolDefinition[\"operation\"];\n"
}
