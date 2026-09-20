// Package contract owns the credential-free canvas generation contract.
// Provider configuration remains an execution concern; it is never persisted here.
package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"
)

//go:generate go run ./generate

const (
	GenerationVersion   = 1
	MaxNodeTitleRunes   = 240
	MaxPromptRunes      = 16000
	MaxCanvasOperations = 20
)

type ModelSelection struct {
	Kind           string `json:"kind" enum:"logical,channel"`
	LogicalModelID string `json:"logicalModelId,omitempty"`
	ChannelID      string `json:"channelId,omitempty"`
	ModelKey       string `json:"modelKey,omitempty"`
}

// Options contains public user choices, not resolved provider configuration.
// node/task tags are the only mapping between the persisted canvas and task wire names.
type Options struct {
	Size                  *string `json:"size,omitempty" node:"size" task:"size" modes:"image,video"`
	Quality               *string `json:"quality,omitempty" node:"quality" task:"quality" modes:"image"`
	Count                 *int    `json:"count,omitempty" node:"count" task:"count" modes:"image"`
	TransparentBackground *bool   `json:"transparentBackground,omitempty" node:"transparentBackground" task:"transparentBackground" modes:"image"`
	DurationSeconds       *int    `json:"durationSeconds,omitempty" node:"seconds" task:"videoSeconds" modes:"video"`
	Resolution            *string `json:"resolution,omitempty" node:"vquality" task:"vquality" modes:"video"`
	GenerateAudio         *bool   `json:"generateAudio,omitempty" node:"generateAudio" task:"videoGenerateAudio" modes:"video"`
	Watermark             *bool   `json:"watermark,omitempty" node:"watermark" task:"videoWatermark" modes:"video"`
	AudioVoice            *string `json:"audioVoice,omitempty" node:"audioVoice" task:"audioVoice" modes:"audio"`
	AudioFormat           *string `json:"audioFormat,omitempty" node:"audioFormat" task:"audioFormat" modes:"audio"`
	AudioSpeed            *string `json:"audioSpeed,omitempty" node:"audioSpeed" task:"audioSpeed" modes:"audio"`
	AudioInstructions     *string `json:"audioInstructions,omitempty" node:"audioInstructions" task:"audioInstructions" modes:"audio"`
}

type ReferenceBinding struct {
	ID          string `json:"id"`
	NodeID      string `json:"nodeId,omitempty"`
	ResourceID  string `json:"resourceId,omitempty"`
	TransientID string `json:"transientId,omitempty"`
	MediaType   string `json:"mediaType" enum:"image,video,audio,text"`
	Role        string `json:"role" enum:"reference,source-text,first-frame,last-frame,mask"`
	Order       int    `json:"order"`
	Resolution  string `json:"resolution" enum:"latest,snapshot"`
}

type GenerationSpec struct {
	Version           int                `json:"version"`
	Mode              string             `json:"mode" enum:"image,video,audio"`
	Prompt            string             `json:"prompt"`
	ModelSelection    *ModelSelection    `json:"modelSelection,omitempty"`
	Options           Options            `json:"options"`
	ReferenceBindings []ReferenceBinding `json:"referenceBindings"`
	TextInputMode     string             `json:"textInputMode" enum:"prompt-only,append-sources"`
}

type FieldError struct{ Path, Message string }

func (e *FieldError) Error() string      { return e.Path + ": " + e.Message }
func invalid(path, message string) error { return &FieldError{Path: path, Message: message} }

func (s ModelSelection) Validate() error {
	switch s.Kind {
	case "logical":
		if strings.TrimSpace(s.LogicalModelID) == "" || s.ChannelID != "" || s.ModelKey != "" {
			return invalid("modelSelection", "逻辑模型必须且只能指定 logicalModelId")
		}
	case "channel":
		if strings.TrimSpace(s.ChannelID) == "" || strings.TrimSpace(s.ModelKey) == "" || s.LogicalModelID != "" {
			return invalid("modelSelection", "渠道模型必须且只能指定 channelId 和 modelKey")
		}
	default:
		return invalid("modelSelection.kind", "未知模型选择类型")
	}
	return nil
}

func (s GenerationSpec) Validate() error {
	if s.Version != GenerationVersion {
		return invalid("generationSpec.version", "生成合同版本不受支持")
	}
	if s.Mode != "image" && s.Mode != "video" && s.Mode != "audio" {
		return invalid("generationSpec.mode", "未知生成模式")
	}
	if utf8.RuneCountInString(s.Prompt) > MaxPromptRunes {
		return invalid("generationSpec.prompt", "提示词超过长度限制")
	}
	if s.ModelSelection != nil {
		if err := s.ModelSelection.Validate(); err != nil {
			return err
		}
	}
	if s.TextInputMode != "prompt-only" && s.TextInputMode != "append-sources" {
		return invalid("generationSpec.textInputMode", "未知文本输入模式")
	}
	value, typ := reflect.ValueOf(s.Options), reflect.TypeOf(s.Options)
	for i := 0; i < typ.NumField(); i++ {
		if value.Field(i).IsNil() {
			continue
		}
		field := typ.Field(i)
		if !strings.Contains(","+field.Tag.Get("modes")+",", ","+s.Mode+",") {
			return invalid("options."+strings.Split(field.Tag.Get("json"), ",")[0], "该选项不适用于当前生成模式")
		}
	}
	if s.Options.DurationSeconds != nil && *s.Options.DurationSeconds < 0 {
		return invalid("options.durationSeconds", "时长不能为负数")
	}
	if s.Options.Count != nil && *s.Options.Count < 1 {
		return invalid("options.count", "数量必须为正整数")
	}
	ids := map[string]bool{}
	orders := map[int]bool{}
	for i, binding := range s.ReferenceBindings {
		path := fmt.Sprintf("referenceBindings[%d]", i)
		if binding.ID == "" || ids[binding.ID] || binding.Order < 0 || orders[binding.Order] {
			return invalid(path, "引用身份和顺序必须有效且唯一")
		}
		ids[binding.ID], orders[binding.Order] = true, true
		if binding.NodeID == "" && binding.ResourceID == "" && binding.TransientID == "" {
			return invalid(path, "引用缺少来源")
		}
		if binding.TransientID != "" && (binding.NodeID != "" || binding.ResourceID != "") {
			return invalid(path, "临时引用不能混用其他来源")
		}
		if binding.Resolution != "latest" && binding.Resolution != "snapshot" {
			return invalid(path+".resolution", "未知引用解析策略")
		}
		if binding.MediaType != "image" && binding.MediaType != "video" && binding.MediaType != "audio" && binding.MediaType != "text" {
			return invalid(path+".mediaType", "未知参考类型")
		}
		if binding.Role != "reference" && binding.Role != "source-text" && binding.Role != "first-frame" && binding.Role != "last-frame" && binding.Role != "mask" {
			return invalid(path+".role", "未知参考角色")
		}
		if binding.Role == "source-text" && binding.MediaType != "text" {
			return invalid(path+".role", "文本来源必须引用文本")
		}
		if (binding.Role == "first-frame" || binding.Role == "last-frame" || binding.Role == "mask") && binding.MediaType != "image" {
			return invalid(path+".role", "帧和遮罩必须引用图片")
		}
	}
	return nil
}

func Decode(data []byte) (GenerationSpec, error) {
	var spec GenerationSpec
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&spec); err != nil {
		return spec, invalid("generationSpec", err.Error())
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return spec, invalid("generationSpec", "必须是单个对象")
	}
	return spec, spec.Validate()
}

// OptionsFromTaskConfig only copies public fields declared above. Credentials and
// provider routing fields cannot be admitted by adding a task config key.
func OptionsFromTaskConfig(mode string, config map[string]any) (Options, error) {
	options := Options{}
	value, typ := reflect.ValueOf(&options).Elem(), reflect.TypeOf(options)
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if !strings.Contains(","+field.Tag.Get("modes")+",", ","+mode+",") {
			continue
		}
		raw, exists := config[field.Tag.Get("task")]
		if !exists || raw == nil || raw == "" {
			continue
		}
		parsed := reflect.New(field.Type.Elem())
		switch field.Type.Elem().Kind() {
		case reflect.String:
			text, ok := raw.(string)
			if !ok {
				return options, invalid("options."+field.Tag.Get("task"), "必须是字符串")
			}
			parsed.Elem().SetString(text)
		case reflect.Bool:
			boolean, err := strconv.ParseBool(fmt.Sprint(raw))
			if err != nil {
				return options, invalid("options."+field.Tag.Get("task"), "必须是布尔值")
			}
			parsed.Elem().SetBool(boolean)
		case reflect.Int:
			number, err := strconv.Atoi(fmt.Sprint(raw))
			if err != nil {
				return options, invalid("options."+field.Tag.Get("task"), "必须是整数")
			}
			parsed.Elem().SetInt(int64(number))
		}
		value.Field(i).Set(parsed)
	}
	return options, nil
}

func (o Options) TaskConfig() map[string]any {
	result := map[string]any{}
	value, typ := reflect.ValueOf(o), reflect.TypeOf(o)
	for i := 0; i < typ.NumField(); i++ {
		if !value.Field(i).IsNil() {
			result[typ.Field(i).Tag.Get("task")] = fmt.Sprint(value.Field(i).Elem().Interface())
		}
	}
	return result
}

// NodeMetadata projects the editable specification into the existing canvas wire
// format. The mirror fields keep existing renderers working; all conversions live here.
func (s GenerationSpec) NodeMetadata() (map[string]any, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	var stored map[string]any
	if err := json.Unmarshal(encoded, &stored); err != nil {
		return nil, err
	}
	result := map[string]any{"generationSpec": stored, "prompt": s.Prompt, "composerContent": s.Prompt}
	value, typ := reflect.ValueOf(s.Options), reflect.TypeOf(s.Options)
	for i := 0; i < typ.NumField(); i++ {
		if value.Field(i).IsNil() {
			continue
		}
		fieldValue := value.Field(i).Elem().Interface()
		if typ.Field(i).Tag.Get("node") != "count" {
			fieldValue = fmt.Sprint(fieldValue)
		}
		result[typ.Field(i).Tag.Get("node")] = fieldValue
	}
	if selection := s.ModelSelection; selection != nil {
		if selection.Kind == "logical" {
			result["logicalModelId"] = selection.LogicalModelID
		} else {
			result["channelId"], result["channelModelKey"] = selection.ChannelID, selection.ModelKey
			result["model"] = selection.ChannelID + "::" + selection.ModelKey
		}
	}
	return result, nil
}

// NodeGenerationProjection is the explicit dependency read-set of generation.
// Locks, task binding and authorization are checked separately by the caller.
//
// The projection keeps the canonical contract fields and also carries stable
// extension metadata. Canvas presentation fields are deliberately excluded so
// moving/resizing a node does not invalidate a prepared generation, while a
// newly-added generation input cannot silently bypass admission.
func NodeGenerationProjection(metadata map[string]any) (map[string]any, error) {
	result := map[string]any{}
	if raw, exists := metadata["generationSpec"]; exists {
		encoded, err := json.Marshal(raw)
		if err != nil {
			return nil, err
		}
		spec, err := Decode(encoded)
		if err != nil {
			return nil, err
		}
		result["generationSpec"] = spec
	}
	known := map[string]struct{}{
		"generationSpec": {}, "prompt": {}, "composerContent": {}, "model": {},
		"logicalModelId": {}, "channelId": {}, "channelModelKey": {},
		"videoStartFrameNodeId": {}, "videoEndFrameNodeId": {},
		"videoEditOperation": {}, "referenceNodeIds": {},
	}
	typ := reflect.TypeOf(Options{})
	for i := 0; i < typ.NumField(); i++ {
		known[typ.Field(i).Tag.Get("node")] = struct{}{}
	}
	for key, value := range metadata {
		if _, exists := known[key]; exists {
			if key != "generationSpec" {
				result[key] = value
			}
			continue
		}
		if isCanvasPresentationMetadataKey(key) {
			continue
		}
		extensions, _ := result["extensions"].(map[string]any)
		if extensions == nil {
			extensions = map[string]any{}
			result["extensions"] = extensions
		}
		extensions[key] = value
	}
	return result, nil
}

func isCanvasPresentationMetadataKey(key string) bool {
	switch key {
	case "position", "x", "y", "width", "height", "createdAt", "updatedAt", "selected", "collapsed", "zIndex", "color", "background", "displayName", "label", "ui", "presentation", "layout", "screenPosition", "isSelected", "dragging", "resizing":
		return true
	default:
		return false
	}
}
