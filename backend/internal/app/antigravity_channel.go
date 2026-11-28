// Antigravity 系统渠道：模型目录格式为 antigravity 的 Key 分组由服务器上的官方 agy 程序执行。
//
// 渠道模型照常登记为文本模型（能力、协议、价格由管理员在模型编辑里设置），模型选择、计费和
// 画布 Agent 判定与普通渠道一致；真正发请求时 resolveProviderConfig 带上 agy 资料目录，
// 文本任务和 Agent 模型步不论登记的文本协议，都改走 agy。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/antigravity"
	"yingce/backend/internal/model"
)

const antigravityAPIFormat = model.AntigravityAPIFormat

func (s *Service) antigravityManager() *antigravity.Manager {
	s.antigravityOnce.Do(func() {
		s.antigravity = antigravity.New(s.dataDir)
	})
	return s.antigravity
}

func antigravityProfile(channel model.ModelChannel) antigravity.Profile {
	return antigravity.Profile{ChannelID: channel.ID, APIKey: channel.APIKey, ProxyURL: channel.ProxyURL}
}

// AntigravityChannelStatus 是后台 Key 分组里 Antigravity 连接面板的数据。
type AntigravityChannelStatus struct {
	Runtime     antigravity.RuntimeStatus `json:"runtime"`
	AuthMethod  antigravity.AuthMethod    `json:"authMethod"`
	GCPProject  string                    `json:"gcpProject"`
	GCPLocation string                    `json:"gcpLocation"`
	HasAPIKey   bool                      `json:"hasApiKey"`
	Connection  *antigravity.Inspection   `json:"connection,omitempty"`
	Login       antigravity.LoginState    `json:"login"`
}

type AntigravitySettingsRequest struct {
	AuthMethod  string `json:"authMethod"`
	APIKey      string `json:"apiKey"`
	GCPProject  string `json:"gcpProject"`
	GCPLocation string `json:"gcpLocation"`
}

type AntigravityLoginCodeRequest struct {
	Code string `json:"code"`
}

func (s *Service) adminAntigravityChannel(actor *model.User, channelID string) (*model.ModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	if channel.APIFormat != antigravityAPIFormat {
		return nil, BadAuthRequest("该 Key 分组不是 Antigravity 渠道")
	}
	return channel, nil
}

func (s *Service) antigravityStatus(channel *model.ModelChannel) (*AntigravityChannelStatus, error) {
	manager := s.antigravityManager()
	runtime, err := manager.RuntimeStatus()
	if err != nil {
		return nil, err
	}
	settings, err := manager.Settings(channel.ID)
	if err != nil {
		return nil, err
	}
	status := &AntigravityChannelStatus{Runtime: runtime, AuthMethod: settings.Auth.Type, HasAPIKey: channel.APIKey != "", Login: manager.LoginState(channel.ID)}
	if settings.GCP != nil {
		status.GCPProject, status.GCPLocation = settings.GCP.Project, settings.GCP.Location
	}
	if inspection, ok := manager.CachedInspection(channel.ID); ok {
		status.Connection = &inspection
	}
	return status, nil
}

// AdminAntigravityStatus 返回连接面板状态；refresh 时启动一次 agy 重新检查登录和模型。
func (s *Service) AdminAntigravityStatus(ctx context.Context, actor *model.User, channelID string, refresh bool) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	if refresh {
		if _, err := s.antigravityManager().Inspect(ctx, antigravityProfile(*channel)); err != nil {
			return nil, BadAuthRequest("检查 Antigravity 连接失败：" + err.Error())
		}
	}
	return s.antigravityStatus(channel)
}

// InstallAdminAntigravityRuntime 下载或更新服务器上托管的官方 agy。
func (s *Service) InstallAdminAntigravityRuntime(ctx context.Context, actor *model.User) (*antigravity.RuntimeStatus, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	status, err := s.antigravityManager().InstallRuntime(ctx)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return &status, nil
}

// SaveAdminAntigravitySettings 保存登录方式；API Key 留空时保留原值，只以渠道密文保存。
func (s *Service) SaveAdminAntigravitySettings(actor *model.User, channelID string, req AntigravitySettingsRequest) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	method, err := antigravity.ParseAuthMethod(req.AuthMethod)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	apiKey := strings.TrimSpace(req.APIKey)
	project, location := strings.TrimSpace(req.GCPProject), strings.TrimSpace(req.GCPLocation)
	hasKey := apiKey != "" || channel.APIKey != ""
	switch method {
	case antigravity.AuthGeminiAPIKey:
		if !hasKey {
			return nil, BadAuthRequest("Gemini API Key 登录方式需要填写 API Key")
		}
	case antigravity.AuthBusiness:
		if project == "" || location == "" {
			return nil, BadAuthRequest("Gemini Enterprise 登录需要填写 GCP 项目和区域")
		}
	case antigravity.AuthAgentPlatform:
		if !hasKey && (project == "" || location == "") {
			return nil, BadAuthRequest("Agent Platform 需要 API Key，或 GCP 项目和区域")
		}
	}
	manager := s.antigravityManager()
	manager.CancelLogin(channel.ID)
	settings := antigravity.Settings{GCP: &antigravity.GCPSettings{Project: project, Location: location}}
	settings.Auth.Type = method
	if err := manager.SaveSettings(channel.ID, settings); err != nil {
		return nil, err
	}
	if apiKey != "" {
		channel.APIKey = apiKey
		if err := s.encryptSystemChannelSecrets(channel); err != nil {
			return nil, err
		}
		if err := s.repo.Save(channel); err != nil {
			return nil, err
		}
		if err := s.decryptSystemChannelSecrets(channel); err != nil {
			return nil, err
		}
		s.invalidateRouteCatalog()
	}
	return s.antigravityStatus(channel)
}

// StartAdminAntigravityLogin 启动 Google 登录并返回登录链接。
func (s *Service) StartAdminAntigravityLogin(ctx context.Context, actor *model.User, channelID string) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	if _, err := s.antigravityManager().StartLogin(ctx, antigravityProfile(*channel)); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return s.antigravityStatus(channel)
}

// SubmitAdminAntigravityLoginCode 提交授权码；登录成功后立即检查一次连接并读取模型。
func (s *Service) SubmitAdminAntigravityLoginCode(ctx context.Context, actor *model.User, channelID string, req AntigravityLoginCodeRequest) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	manager := s.antigravityManager()
	state, err := manager.SubmitLoginCode(ctx, channel.ID, req.Code)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if state.Phase == antigravity.LoginSucceeded {
		if _, err := manager.Inspect(ctx, antigravityProfile(*channel)); err != nil {
			return nil, BadAuthRequest("已登录，但检查 Antigravity 连接失败：" + err.Error())
		}
	}
	return s.antigravityStatus(channel)
}

func (s *Service) CancelAdminAntigravityLogin(actor *model.User, channelID string) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	s.antigravityManager().CancelLogin(channel.ID)
	return s.antigravityStatus(channel)
}

// LogoutAdminAntigravity 让 agy 清除该 Key 分组保存的 Google 登录。
func (s *Service) LogoutAdminAntigravity(ctx context.Context, actor *model.User, channelID string) (*AntigravityChannelStatus, error) {
	channel, err := s.adminAntigravityChannel(actor, channelID)
	if err != nil {
		return nil, err
	}
	if err := s.antigravityManager().Logout(ctx, antigravityProfile(*channel)); err != nil {
		return nil, BadAuthRequest("退出 Antigravity 登录失败：" + err.Error())
	}
	return s.antigravityStatus(channel)
}

// antigravityCatalogModels 以当前登录账号在 agy 里可选的模型作为渠道目录。
func (s *Service) antigravityCatalogModels(ctx context.Context, channel *model.ModelChannel) ([]string, error) {
	inspection, err := s.antigravityManager().Inspect(ctx, antigravityProfile(*channel))
	if err != nil {
		return nil, BadAuthRequest("读取 Antigravity 模型失败：" + err.Error())
	}
	if !inspection.SignedIn {
		return nil, BadAuthRequest("Antigravity 尚未登录，请先在 Key 分组的 Antigravity 面板里登录")
	}
	names := make([]string, 0, len(inspection.Models))
	for _, item := range inspection.Models {
		names = append(names, item.ID)
	}
	return names, nil
}

// adminChannelCatalogModels 按渠道目录格式读取上游模型列表。
func (s *Service) adminChannelCatalogModels(ctx context.Context, actor *model.User, channel *model.ModelChannel) ([]string, error) {
	if channel.APIFormat == antigravityAPIFormat {
		return s.antigravityCatalogModels(ctx, channel)
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}
	return s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, ProxyURL: channel.ProxyURL, Headers: headers})
}

// newCatalogChannelModel 是从上游目录新建的模型记录，默认停用、待定价。
// Antigravity 模型都是文本模型，展示名取 agy 给出的名称；其余渠道仍待管理员分类。
func (s *Service) newCatalogChannelModel(channel *model.ModelChannel, id, name string) model.ChannelModel {
	item := model.ChannelModel{ID: id, ChannelID: channel.ID, ModelKey: name, ProviderModelKey: name, DisplayName: "未分类", BillingMode: "fixed_request", Enabled: false, PriceConfigured: false, PriceVersion: 1}
	if channel.APIFormat != antigravityAPIFormat {
		return item
	}
	item.Capability = "text"
	if inspection, ok := s.antigravityManager().CachedInspection(channel.ID); ok {
		for _, entry := range inspection.Models {
			if entry.ID == name && entry.Name != "" {
				item.DisplayName = entry.Name
			}
		}
	}
	return item
}

func (s *Service) removeAntigravityProfile(channel *model.ModelChannel) error {
	if channel.APIFormat != antigravityAPIFormat {
		return nil
	}
	return s.antigravityManager().RemoveProfile(channel.ID)
}

// runAntigravityTextTask 执行普通文本任务：系统提示词、历史和本次输入转写为一次 agy 调用。
func runAntigravityTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("Antigravity 渠道暂不支持参考视频或音频，请换用其他文本模型")
	}
	turns := make([]antigravity.Turn, 0, len(input.TextHistory)+1)
	for _, message := range validatedTextHistory(input.TextHistory) {
		turns = append(turns, antigravity.Turn{Role: stringField(message, "role"), Parts: []antigravity.Part{{Text: stringField(message, "content")}}})
	}
	parts := []antigravity.Part{{Text: input.Prompt}}
	for _, image := range input.ReferenceImages {
		part, err := antigravityMediaPart(image)
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	turns = append(turns, antigravity.Turn{Role: "user", Parts: parts})
	result, err := input.Config.antigravity.Complete(ctx, input.Config.antigravityProfile, antigravity.CompletionRequest{
		Model: input.Config.Model, SystemPrompt: input.Config.SystemPrompt, Turns: turns,
		OnText: input.OnTextDelta, OnReasoning: input.OnReasoningDelta,
	})
	if err != nil {
		return nil, err
	}
	return providerTextTaskResult(providerTextResult{Text: result.Text, Reasoning: result.Reasoning}), nil
}

// runAntigravityAgentTask 执行画布 Agent 的一个模型步，输入取 Chat Completions 形式的会话与工具。
func runAntigravityAgentTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.AgentRequests == nil || input.AgentRequests.ChatCompletion == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	body := input.AgentRequests.ChatCompletion
	var system []string
	turns := []antigravity.Turn{}
	for _, value := range interfaceSlice(body["messages"]) {
		message, _ := value.(map[string]interface{})
		role := stringField(message, "role")
		parts, err := antigravityContentParts(message["content"])
		if err != nil {
			return nil, err
		}
		switch role {
		case "system":
			for _, part := range parts {
				if text := strings.TrimSpace(part.Text); text != "" {
					system = append(system, text)
				}
			}
		case "user", "assistant", "tool":
			turn := antigravity.Turn{Role: role, Parts: parts, ToolCallID: stringField(message, "tool_call_id")}
			for _, raw := range interfaceSlice(message["tool_calls"]) {
				call, _ := raw.(map[string]interface{})
				function, _ := call["function"].(map[string]interface{})
				turn.ToolCalls = append(turn.ToolCalls, antigravity.ToolCall{ID: stringField(call, "id"), Name: stringField(function, "name"), Arguments: antigravityArguments(function["arguments"])})
			}
			turns = append(turns, turn)
		}
	}
	tools := []antigravity.Tool{}
	for _, value := range interfaceSlice(body["tools"]) {
		tool, _ := value.(map[string]interface{})
		function, _ := tool["function"].(map[string]interface{})
		schema, _ := function["parameters"].(map[string]interface{})
		if schema == nil {
			schema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		tools = append(tools, antigravity.Tool{Name: stringField(function, "name"), Description: stringField(function, "description"), InputSchema: schema})
	}
	result, err := input.Config.antigravity.Complete(ctx, input.Config.antigravityProfile, antigravity.CompletionRequest{
		Model: input.Config.Model, SystemPrompt: strings.Join(system, "\n\n"), Turns: turns, Tools: tools,
		OnText: input.OnTextDelta, OnReasoning: input.OnReasoningDelta,
	})
	if err != nil {
		return nil, err
	}
	calls := make([]interface{}, 0, len(result.ToolCalls))
	for _, call := range result.ToolCalls {
		calls = append(calls, map[string]interface{}{"id": call.ID, "type": "function", "function": map[string]interface{}{"name": call.Name, "arguments": call.Arguments}})
	}
	payload := map[string]interface{}{"mode": "text", "text": result.Text, "toolCalls": calls}
	// agy 的思考内容只用于展示，不能回传给下一步，所以不标记回传线格式。
	if result.Reasoning != "" {
		payload["reasoning"] = result.Reasoning
	}
	if result.Text == "" && len(calls) == 0 {
		return nil, agentModelFailure(agentModelFailureEmpty, errors.New("Antigravity 没有返回内容"))
	}
	return payload, nil
}

func antigravityContentParts(content interface{}) ([]antigravity.Part, error) {
	switch value := content.(type) {
	case nil:
		return nil, nil
	case string:
		return []antigravity.Part{{Text: value}}, nil
	case []interface{}:
		parts := make([]antigravity.Part, 0, len(value))
		for _, raw := range value {
			item, _ := raw.(map[string]interface{})
			switch stringField(item, "type") {
			case "text":
				parts = append(parts, antigravity.Part{Text: stringField(item, "text")})
			case "image_url":
				image, _ := item["image_url"].(map[string]interface{})
				part, err := antigravityMediaPart(providerMedia{URL: stringField(image, "url")})
				if err != nil {
					return nil, err
				}
				parts = append(parts, part)
			default:
				return nil, fmt.Errorf("Antigravity 渠道不支持 %s 类型的消息内容", stringField(item, "type"))
			}
		}
		return parts, nil
	}
	return nil, errors.New("画布 Agent 消息内容格式无效")
}

func antigravityMediaPart(media providerMedia) (antigravity.Part, error) {
	value, err := openAIImageInputURL(media)
	if err != nil {
		return antigravity.Part{}, err
	}
	if mimeType, data, ok := splitDataURL(value); ok {
		return antigravity.Part{ImageMIME: mimeType, ImageData: data}, nil
	}
	return antigravity.Part{URL: value}, nil
}

func antigravityArguments(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err != nil || value == nil {
		return "{}"
	}
	return string(encoded)
}
