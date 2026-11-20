package app

import (
	"encoding/json"
	"errors"
	"fmt"

	"yingce/backend/internal/production"
	"yingce/backend/internal/protocol"
)

const dramaReferenceBindingsKey = "dramaReferenceBindings"

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

type dramaReferencePlan struct {
	required []dramaReferenceBinding
	rule     *protocol.VideoReferenceContract
}

func prepareDramaReferencePlan(input canvasGenerationInput, request protocol.GenerationRequest, provider protocol.Metadata) (dramaReferencePlan, error) {
	var plan dramaReferencePlan
	raw, exists := input.Metadata[dramaReferenceBindingsKey]
	if !exists || (input.Mode != "video" && input.Mode != "") {
		return plan, nil
	}
	labels := dramaPromptReferenceLabels(input.Prompt)
	if len(labels) == 0 {
		return plan, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return plan, errors.New("短剧参考图绑定无效，请重新提交本段")
	}
	var bindings []dramaReferenceBinding
	if err := json.Unmarshal(data, &bindings); err != nil {
		return plan, errors.New("短剧参考图绑定无效，请重新提交本段")
	}
	byLabel := make(map[string]string, len(bindings))
	for _, binding := range bindings {
		label := production.RewriteReferenceTokens(binding.Label, nil)
		if binding.MediaID == "" || label == "" || byLabel[label] != "" {
			return plan, errors.New("短剧参考图绑定不完整或重复，请重新提交本段")
		}
		byLabel[label] = binding.MediaID
	}
	images := make(map[string]bool, len(request.Images))
	for _, image := range request.Images {
		if _, exists := images[image.ID]; image.ID == "" || exists {
			return plan, errors.New("短剧参考图媒体标识缺失或重复，请重新提交本段")
		}
		images[image.ID] = image.URL != "" || image.DataURL != "" || stringValue(image.Metadata[protocol.MediaUploadIDKey]) != ""
	}
	for _, label := range labels {
		id := byLabel[label]
		if id == "" || !images[id] {
			return plan, fmt.Errorf("提示词引用的 %s 没有可发送的图片，请补齐图片或修改该引用", label)
		}
		plan.required = append(plan.required, dramaReferenceBinding{Label: label, MediaID: id})
	}
	plan.rule = provider.VideoReferences
	return plan, plan.rule.CheckNumbering(provider.ID, request.Model)
}

func (plan dramaReferencePlan) compile(request protocol.GenerationRequest, spec *protocol.RequestSpec, capability *VideoCapabilityConfig) error {
	if len(plan.required) == 0 {
		return nil
	}
	prompt, err := plan.rule.Bind(request, spec)
	if err != nil {
		return err
	}
	replacements := make(map[string]string, len(plan.required))
	for _, binding := range plan.required {
		token := prompt.Tokens[binding.MediaID]
		if token == "" {
			return fmt.Errorf("%s 未包含在视频模型实际发送的参考图片中，请调整参考图或更换视频协议", binding.Label)
		}
		replacements[binding.Label] = token
	}
	compiled := production.RewriteReferenceTokens(request.Prompt, replacements)
	if capability != nil {
		if err := validateModelPromptLength("视频", compiled, capability.References.PromptMaxChars); err != nil {
			return err
		}
	}
	prompt.Set(compiled)
	return nil
}

func compileLegacyDramaReferences(input canvasGenerationInput, body any, layout string) (any, error) {
	request := protocolRequestFromInput(input)
	provider := protocol.Metadata{ID: input.Config.InterfaceType, VideoReferences: &protocol.VideoReferenceContract{Layout: layout, Token: "参考图{n}"}}
	plan, err := prepareDramaReferencePlan(input, request, provider)
	if err != nil || len(plan.required) == 0 {
		return body, err
	}
	payload, err := requestAsMap(body)
	if err != nil {
		return nil, err
	}
	spec := protocol.RequestSpec{Body: payload}
	return payload, plan.compile(request, &spec, input.VideoCapability)
}
