package protocol

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type VideoReferenceContract struct {
	Layout               string          `json:"layout"`
	Token                string          `json:"token,omitempty"`
	Models               map[string]int  `json:"models,omitempty"`
	MaxImagesByOperation map[string]*int `json:"maxImagesByOperation,omitempty"`
}

type videoImageSlot struct {
	value, mediaID, role, token string
}

type videoWirePrompt struct {
	body  map[string]any
	key   string
	slots []videoImageSlot
}

type videoReferenceReader func(map[string]any, []RequestFilePart) (videoWirePrompt, error)

var videoReferenceReaders = map[string]videoReferenceReader{
	"content":                     contentReferences,
	"input-media":                 inputMediaReferences("reference_image"),
	"input-image-media":           inputMediaReferences("image_url"),
	"image-urls":                  arrayReferences("", "image_urls", "", false),
	"legacy-reference-image-urls": arrayReferences("", "reference_image_urls", "reference_image", false),
	"reference-images":            arrayReferences("", "reference_images", "", false),
	"reference-only-images":       arrayReferences("", "reference_images", "reference_image", false),
	"images":                      arrayReferences("", "images", "", false),
	"input-reference-images":      arrayReferences("input", "reference_images", "reference_image", false),
	"input-reference":             arrayReferences("", "input_reference", "reference_image", false),
	"role-images":                 arrayReferences("", "images", "reference_image", true),
	"role-reference-images":       arrayReferences("", "reference_images", "reference_image", true),
	"image-or-reference-images":   singleOrArrayReferences,
	"inputs-images":               inputsImagesReferences,
	"multipart-references":        multipartReferences,
	"media-tokens":                explicitTokenReferences,
	"indexed-images":              indexedReferences,
}

func (rule VideoReferenceContract) valid() bool {
	for operation, limit := range rule.MaxImagesByOperation {
		if operation == "" || limit != nil && *limit < 0 {
			return false
		}
	}
	for model, capacity := range rule.Models {
		if strings.TrimSpace(model) == "" || capacity <= 0 {
			return false
		}
	}
	if rule.Layout == "media-tokens" {
		return rule.Token == ""
	}
	return videoReferenceReaders[rule.Layout] != nil && strings.Count(rule.Token, "{n}") == 1
}

func (rule *VideoReferenceContract) CheckNumbering(provider, model string) error {
	if rule == nil {
		return fmt.Errorf("视频协议 %s 未声明参考图编号规则，请更换协议或调整本段参考图和正文", provider)
	}
	if len(rule.Models) > 0 && rule.Models[model] == 0 {
		return fmt.Errorf("视频协议 %s 的工作流 %s 未声明可编号的参考图，请改选支持多图参考的工作流或调整本段参考图和正文", provider, model)
	}
	return nil
}

func (rule *VideoReferenceContract) ImageLimit(model, operation string) (int, bool) {
	if rule == nil {
		return 0, false
	}
	capacity, limited := rule.Models[model]
	if len(rule.MaxImagesByOperation) > 0 {
		limit, supported := rule.MaxImagesByOperation[defaultValue(operation, "image_to_video")]
		if !supported {
			return 0, true
		}
		if limit != nil && (!limited || *limit < capacity) {
			return *limit, true
		}
	}
	return capacity, limited
}

type BoundVideoPrompt struct {
	Tokens map[string]string
	field  map[string]any
	key    string
}

func (prompt BoundVideoPrompt) Set(text string) { prompt.field[prompt.key] = text }

func (rule VideoReferenceContract) Bind(request GenerationRequest, spec *RequestSpec) (BoundVideoPrompt, error) {
	reader := videoReferenceReaders[rule.Layout]
	if reader == nil {
		return BoundVideoPrompt{}, fmt.Errorf("无法核对视频协议的参考图布局 %q", rule.Layout)
	}
	body, ok := spec.Body.(map[string]any)
	if !ok {
		return BoundVideoPrompt{}, errors.New("视频请求缺少可核对的正文")
	}
	wire, err := reader(body, spec.Files)
	if err != nil {
		return BoundVideoPrompt{}, err
	}
	text, ok := wire.body[wire.key].(string)
	if !ok || strings.TrimSpace(text) != strings.TrimSpace(request.Prompt) {
		return BoundVideoPrompt{}, errors.New("视频协议未发送本段原提示词，无法对应参考图编号，请检查工作流配置")
	}
	images := append([]MediaReference(nil), request.Images...)
	sort.SliceStable(images, func(left, right int) bool { return images[left].Order < images[right].Order })
	byID := make(map[string]string, len(wire.slots))
	tokens := make(map[string]bool, len(wire.slots))
	for index, slot := range wire.slots {
		token := slot.token
		if token == "" {
			token = strings.Replace(rule.Token, "{n}", strconv.Itoa(index+1), 1)
		}
		if tokens[token] {
			return BoundVideoPrompt{}, fmt.Errorf("视频协议重复使用参考图标识 %s，请检查协议配置", token)
		}
		tokens[token] = true
		matched := false
		for _, image := range images {
			if byID[image.ID] != "" || slot.mediaID != "" && image.ID != slot.mediaID || slot.role != "" && defaultValue(image.Role, "reference_image") != slot.role {
				continue
			}
			if slot.value != "" && (slot.value == image.URL || slot.value == image.DataURL || slot.value == manifestString(image.Metadata[MediaUploadIDKey])) {
				byID[image.ID] = token
				matched = true
				break
			}
		}
		if !matched {
			return BoundVideoPrompt{}, fmt.Errorf("视频协议第 %d 个参考图片槽位无法对应本段资产，请检查协议配置", index+1)
		}
	}
	return BoundVideoPrompt{Tokens: byID, field: wire.body, key: wire.key}, nil
}

func arrayReferences(parent, field, role string, rejectFrames bool) videoReferenceReader {
	return func(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
		if parent != "" {
			body, _ = body[parent].(map[string]any)
		}
		wire := videoWirePrompt{body: body, key: "prompt"}
		if body[field] == nil {
			return wire, nil
		}
		items, ok := body[field].([]any)
		if !ok {
			return wire, fmt.Errorf("视频协议的 %s 不是参考图片数组", field)
		}
		for _, item := range items {
			value, ok := item.(string)
			if !ok {
				image, _ := item.(map[string]any)
				imageRole, _ := image["role"].(string)
				if rejectFrames && imageRole != "" && imageRole != "reference_image" {
					return wire, errors.New("当前视频协议混合首尾帧时的参考图编号规则不明确，请改用纯参考图生成")
				}
				value, _ = image["url"].(string)
			}
			wire.slots = append(wire.slots, videoImageSlot{value: value, role: role})
		}
		return wire, nil
	}
}

func contentReferences(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
	wire := videoWirePrompt{key: "text"}
	items, _ := body["content"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		switch item["type"] {
		case "text":
			if wire.body != nil {
				return wire, errors.New("视频协议提示词内容块不唯一，无法核对参考图编号")
			}
			wire.body = item
		case "image_url":
			if item["role"] == "reference_image" {
				image, _ := item["image_url"].(map[string]any)
				value, _ := image["url"].(string)
				wire.slots = append(wire.slots, videoImageSlot{value: value, role: "reference_image"})
			}
		}
	}
	return wire, nil
}

func inputMediaReferences(kind string) videoReferenceReader {
	return func(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
		input, _ := body["input"].(map[string]any)
		wire := videoWirePrompt{body: input, key: "prompt"}
		items, _ := input["media"].([]any)
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			if item["type"] == kind {
				value, _ := item["url"].(string)
				wire.slots = append(wire.slots, videoImageSlot{value: value, role: "reference_image"})
			}
		}
		return wire, nil
	}
}

func singleOrArrayReferences(body map[string]any, files []RequestFilePart) (videoWirePrompt, error) {
	if body["reference_images"] == nil {
		if image, ok := body["image"].(map[string]any); ok {
			value, _ := image["url"].(string)
			return videoWirePrompt{body: body, key: "prompt", slots: []videoImageSlot{{value: value}}}, nil
		}
	}
	return arrayReferences("", "reference_images", "", false)(body, files)
}

func inputsImagesReferences(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
	wire, err := arrayReferences("inputs", "images", "reference_image", false)(body, nil)
	wire.body, _ = body["params"].(map[string]any)
	return wire, err
}

func explicitTokenReferences(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
	wire := videoWirePrompt{body: body, key: "prompt"}
	items, _ := body["media"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["kind"] != "image" || item["role"] != "ref" {
			continue
		}
		token, _ := item["token"].(string)
		if token == "" {
			return wire, errors.New("视频协议的参考图片缺少 token，无法对应提示词引用")
		}
		value, _ := item["id"].(string)
		wire.slots = append(wire.slots, videoImageSlot{value: value, role: "reference_image", token: token})
	}
	return wire, nil
}

func multipartReferences(body map[string]any, files []RequestFilePart) (videoWirePrompt, error) {
	wire := videoWirePrompt{body: body, key: "prompt"}
	for _, file := range files {
		if file.Name == "input_reference" || file.Name == "input_reference[]" {
			wire.slots = append(wire.slots, videoImageSlot{value: defaultValue(file.Reference.URL, file.Reference.DataURL), mediaID: file.Reference.ID})
		}
	}
	return wire, nil
}

func indexedReferences(body map[string]any, _ []RequestFilePart) (videoWirePrompt, error) {
	wire := videoWirePrompt{body: body, key: "prompt"}
	for field := range body {
		if strings.HasPrefix(field, "ref_image_") {
			wire.slots = append(wire.slots, videoImageSlot{})
		}
	}
	for index := range wire.slots {
		field := "ref_image_" + strconv.Itoa(index)
		value, ok := body[field].(string)
		if !ok || value == "" {
			return wire, fmt.Errorf("视频工作流的参考图片槽位 %s 缺失或无效", field)
		}
		wire.slots[index].value = value
	}
	return wire, nil
}
