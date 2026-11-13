package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/protocol"
)

const dramaReferenceBindingsKey = "dramaReferenceBindings"

// 这些布局均对应仓库中的协议清单；协议新增或改变媒体槽位时应同步此合同和真实 payload 测试。
var dramaReferenceProtocolLayouts = map[string]string{
	string(model.ChannelInterfaceVolcengineArkVideo):          "content",
	string(model.ChannelInterfaceVolcengineArkAgentPlanVideo): "content",
	string(model.ChannelInterfaceMiniMaxVideo):                "content",
	"metaso-h3":        "content",
	"legacy-ark-video": "content",
	string(model.ChannelInterfaceNewAPIChannel1):        "input-media",
	"dashscope-minimax-video":                           "input-media",
	"dashscope-wan3-video":                              "input-media",
	"lxmone-wan-channel-s":                              "input-media",
	"dashscope-wan-video":                               "input-reference-images",
	string(model.ChannelInterfaceNewAPIChannel2):        "image-urls",
	string(model.ChannelInterfaceVolcengineJiMengVideo): "image-urls",
	string(model.ChannelInterfaceXAIVideo):              "reference-images",
	"seedance-mini1":                                    "reference-images",
	"lxmone-seedance-videos":                            "reference-images",
	"lxmone-h3-max-videos":                              "reference-images",
	"lxmone-grok-videos":                                "reference-images",
	"rolldek-wan-video":                                 "role-reference-images",
	"lxmone-wan-videos":                                 "role-reference-images",
	string(model.ChannelInterfaceAgnesVideo):            "images",
	"seedance-videos-compatible":                        "images",
	"lxmone-sd-videos":                                  "images",
	"maxforai-videos":                                   "images",
	"maxforai-video-generations":                        "images",
	"km-kemei-video":                                    "role-images",
	"lxmone-h3-workflow":                                "input-reference",
	string(model.ChannelInterfaceNewAPIVideo):           "openai-files",
	"coolhs-wan3-relay":                                 "media-tokens",
	"legacy-seedance-video":                             "seedance-legacy",
}

func unsupportedDramaReferenceProtocol(interfaceType string) error {
	return fmt.Errorf("视频协议 %s 尚无可核对的参考图编号规则，请更换协议；或移除本段参考图片及正文编号，改用纯文字生成", interfaceType)
}

type dramaReferenceBinding struct {
	Label   string `json:"label"`
	MediaID string `json:"mediaId"`
}

func dramaReferenceMediaID(reference DramaSegmentReference) string {
	if reference.CastID != "" {
		return "cast:" + reference.CastID
	}
	return "resource:" + reference.ResourceID
}

func dramaReferenceBindings(references []DramaSegmentReference) []dramaReferenceBinding {
	bindings := []dramaReferenceBinding{}
	for _, reference := range references {
		if reference.Sent {
			bindings = append(bindings, dramaReferenceBinding{Label: reference.Label, MediaID: dramaReferenceMediaID(reference)})
		}
	}
	return bindings
}

func dramaPromptReferenceLabels(prompt string) []string {
	return production.UnknownReferenceTokens(production.RewriteReferenceTokens(prompt, nil), 0)
}

// 逻辑编号只用于编辑；媒体 ID 贯穿资源解析、上传与协议组装。普通画布没有此元数据，保持原提示词。
// 预检先于上传，不能把已知缺图或损坏的引用提交给上游后才报错。
func validateDramaReferenceInputs(input canvasGenerationInput, request protocol.GenerationRequest) (map[string]string, error) {
	raw, exists := input.Metadata[dramaReferenceBindingsKey]
	if !exists || (input.Mode != "video" && input.Mode != "") {
		return nil, nil
	}
	labels := dramaPromptReferenceLabels(input.Prompt)
	if len(labels) == 0 {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, errors.New("短剧参考图绑定无效，请重新提交本段")
	}
	var bindings []dramaReferenceBinding
	if err := json.Unmarshal(data, &bindings); err != nil {
		return nil, errors.New("短剧参考图绑定无效，请重新提交本段")
	}
	byLabel := make(map[string]string, len(bindings))
	for _, binding := range bindings {
		label := production.RewriteReferenceTokens(binding.Label, nil)
		if binding.MediaID == "" || label == "" || byLabel[label] != "" {
			return nil, errors.New("短剧参考图绑定不完整或重复，请重新提交本段")
		}
		byLabel[label] = binding.MediaID
	}
	images := make(map[string]bool, len(request.Images))
	for _, image := range request.Images {
		if _, exists := images[image.ID]; image.ID == "" || exists {
			return nil, errors.New("短剧参考图媒体标识缺失或重复，请重新提交本段")
		}
		images[image.ID] = image.URL != "" || image.DataURL != "" || stringValue(image.Metadata[protocol.MediaUploadIDKey]) != ""
	}
	required := make(map[string]string, len(labels))
	for _, label := range labels {
		id := byLabel[label]
		if id == "" || !images[id] {
			return nil, fmt.Errorf("提示词引用的 %s 没有可发送的图片，请补齐图片或修改该引用", label)
		}
		required[label] = id
	}
	return required, nil
}

type dramaReferenceSlot struct {
	value   string
	mediaID string
	role    string
	token   string
}

type dramaReferenceLayout struct {
	slots       []dramaReferenceSlot
	promptBody  map[string]any
	promptKey   string
	tokenPrefix string
}

// compileDramaReferenceRequest 在最终请求上核对图片槽位，而不是假设 adapter 保留了输入顺序。
// 所有编号同时改写，避免参考图1→2→10 的级联替换；原任务中的编辑正文与逻辑编号保持不变。
func compileDramaReferenceRequest(input canvasGenerationInput, request protocol.GenerationRequest, spec *protocol.RequestSpec, interfaceType string) error {
	required, err := validateDramaReferenceInputs(input, request)
	if err != nil || len(required) == 0 {
		return err
	}
	body, err := requestAsMap(spec.Body)
	if err != nil {
		return fmt.Errorf("无法核对视频请求中的参考图：%w", err)
	}
	layout, err := dramaReferenceRequestLayout(body, spec.Files, interfaceType)
	if err != nil {
		return err
	}
	prompt, ok := layout.promptBody[layout.promptKey].(string)
	if !ok || strings.TrimSpace(prompt) != strings.TrimSpace(input.Prompt) {
		return errors.New("视频协议改变了提示词结构，无法安全对应参考图编号，请检查协议配置")
	}
	images := append([]protocol.MediaReference(nil), request.Images...)
	sort.SliceStable(images, func(i, j int) bool { return images[i].Order < images[j].Order })
	used := make([]bool, len(images))
	byID := make(map[string]string, len(layout.slots))
	tokens := make(map[string]bool, len(layout.slots))
	for index, slot := range layout.slots {
		token := firstNonEmpty(slot.token, fmt.Sprintf("%s%d", layout.tokenPrefix, index+1))
		if tokens[token] {
			return fmt.Errorf("视频协议重复使用参考图标识 %s，请检查协议配置", token)
		}
		tokens[token] = true
		matched := false
		for imageIndex, image := range images {
			if used[imageIndex] || (slot.mediaID != "" && image.ID != slot.mediaID) ||
				(slot.role != "" && firstNonEmpty(image.Role, "reference_image") != slot.role) {
				continue
			}
			if slot.value == "" || (slot.value != image.URL && slot.value != image.DataURL && slot.value != stringValue(image.Metadata[protocol.MediaUploadIDKey])) {
				continue
			}
			used[imageIndex] = true
			byID[image.ID] = token
			matched = true
			break
		}
		if !matched {
			return fmt.Errorf("视频协议第 %d 个参考图片槽位无法对应本段资产，请检查协议配置", index+1)
		}
	}
	replacements := make(map[string]string, len(required))
	for _, label := range dramaPromptReferenceLabels(prompt) {
		modelLabel := byID[required[label]]
		if modelLabel == "" {
			return fmt.Errorf("%s 未包含在视频模型实际发送的参考图片中，请调整参考图或更换视频协议", label)
		}
		replacements[label] = modelLabel
	}
	compiled := production.RewriteReferenceTokens(prompt, replacements)
	if input.VideoCapability != nil {
		if err := validateModelPromptLength("视频", compiled, input.VideoCapability.References.PromptMaxChars); err != nil {
			return err
		}
	}
	layout.promptBody[layout.promptKey] = compiled
	spec.Body = body
	return nil
}

// 这里只读取已确认的线格式。首尾帧独立的协议按 reference_image 计数；统一图片数组按实际数组计数。
// 未知格式拒绝带逻辑编号的短剧请求，不能猜测图片位置后发出计费生成。
func dramaReferenceRequestLayout(body map[string]any, files []protocol.RequestFilePart, interfaceType string) (dramaReferenceLayout, error) {
	layout := dramaReferenceLayout{promptBody: body, promptKey: "prompt", tokenPrefix: "参考图"}
	interfaceType = strings.TrimSpace(interfaceType)
	format, known := dramaReferenceProtocolLayouts[interfaceType]
	if !known {
		return layout, unsupportedDramaReferenceProtocol(interfaceType)
	}
	addArray := func(value any, role string) error {
		if value == nil {
			return nil
		}
		items, ok := value.([]any)
		if !ok {
			return errors.New("视频协议参考图字段不是图片数组，请检查协议配置")
		}
		for _, item := range items {
			value, ok := item.(string)
			if !ok {
				image, object := item.(map[string]any)
				if !object {
					return errors.New("视频协议参考图数组格式无效，请检查协议配置")
				}
				value = stringField(image, "url")
			}
			layout.slots = append(layout.slots, dramaReferenceSlot{value: value, role: role})
		}
		return nil
	}
	switch format {
	case "content":
		items, ok := body["content"].([]any)
		if !ok {
			return layout, errors.New("视频协议缺少 content 图片列表，无法核对参考图编号")
		}
		texts := 0
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			switch stringField(item, "type") {
			case "text":
				texts++
				layout.promptBody, layout.promptKey = item, "text"
			case "image_url":
				if stringField(item, "role") == "reference_image" {
					image, _ := item["image_url"].(map[string]any)
					layout.slots = append(layout.slots, dramaReferenceSlot{value: stringField(image, "url"), role: "reference_image"})
				}
			}
		}
		if texts != 1 {
			return layout, errors.New("视频协议提示词内容块不唯一，无法核对参考图编号")
		}
	case "input-media":
		input, ok := body["input"].(map[string]any)
		if !ok {
			return layout, errors.New("视频协议缺少 input，无法核对参考图编号")
		}
		layout.promptBody = input
		media, _ := input["media"].([]any)
		kind := "reference_image"
		if interfaceType == "dashscope-minimax-video" {
			kind = "image_url"
		}
		for _, raw := range media {
			item, _ := raw.(map[string]any)
			if stringField(item, "type") == kind {
				layout.slots = append(layout.slots, dramaReferenceSlot{value: stringField(item, "url"), role: "reference_image"})
			}
		}
	case "image-urls":
		if err := addArray(body["image_urls"], ""); err != nil {
			return layout, err
		}
	case "reference-images":
		role := ""
		if interfaceType == string(model.ChannelInterfaceXAIVideo) {
			role = "reference_image"
		}
		if interfaceType == "seedance-mini1" {
			layout.tokenPrefix = "@Image"
		}
		if interfaceType == "lxmone-grok-videos" && body["reference_images"] == nil {
			if image, ok := body["image"].(map[string]any); ok {
				layout.slots = append(layout.slots, dramaReferenceSlot{value: stringField(image, "url")})
			}
		}
		if err := addArray(body["reference_images"], role); err != nil {
			return layout, err
		}
	case "images":
		if strings.HasPrefix(interfaceType, "maxforai-") {
			layout.tokenPrefix = "@image"
		}
		if err := addArray(body["images"], ""); err != nil {
			return layout, err
		}
	case "input-reference-images":
		input, ok := body["input"].(map[string]any)
		if !ok {
			return layout, errors.New("视频协议缺少 input，无法核对参考图编号")
		}
		layout.promptBody = input
		if err := addArray(input["reference_images"], "reference_image"); err != nil {
			return layout, err
		}
	case "input-reference":
		if err := addArray(body["input_reference"], "reference_image"); err != nil {
			return layout, err
		}
	case "media-tokens":
		media, _ := body["media"].([]any)
		for _, raw := range media {
			item, _ := raw.(map[string]any)
			if stringField(item, "kind") != "image" || stringField(item, "role") != "ref" {
				continue
			}
			token := stringField(item, "token")
			if token == "" {
				return layout, errors.New("视频协议的参考图片缺少 token，无法对应提示词引用")
			}
			layout.slots = append(layout.slots, dramaReferenceSlot{value: stringField(item, "id"), role: "reference_image", token: token})
		}
	case "role-images", "role-reference-images":
		field := "images"
		if format == "role-reference-images" {
			field = "reference_images"
		}
		items, _ := body[field].([]any)
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			if role := stringField(item, "role"); role != "" && role != "reference_image" {
				return layout, errors.New("当前视频协议混合首尾帧时的参考图编号规则不明确，请改用纯参考图生成")
			}
		}
		if err := addArray(body[field], "reference_image"); err != nil {
			return layout, err
		}
	case "openai-files":
		for _, file := range files {
			if file.Name == "input_reference" || file.Name == "input_reference[]" {
				layout.slots = append(layout.slots, dramaReferenceSlot{value: firstNonEmpty(file.Reference.URL, file.Reference.DataURL), mediaID: file.Reference.ID})
			}
		}
		if len(layout.slots) == 0 {
			if err := addArray(body["input_reference"], ""); err != nil {
				return layout, err
			}
		}
	case "seedance-legacy":
		if body["image_urls"] != nil {
			if err := addArray(body["image_urls"], ""); err != nil {
				return layout, err
			}
		} else if err := addArray(body["reference_image_urls"], "reference_image"); err != nil {
			return layout, err
		}
	default:
		return layout, unsupportedDramaReferenceProtocol(interfaceType)
	}
	return layout, nil
}
