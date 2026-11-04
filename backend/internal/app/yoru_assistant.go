package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

const yoruSettingKey = "yoru_assistant"

// YoruSettings is a separate, fail-closed setting. No provider call is made
// until an administrator chooses a published text route. Each call uses the
// existing text-task price, wallet reservation and settlement path.
type YoruSettings struct {
	Enabled        bool     `json:"enabled"`
	Audience       string   `json:"audience"`
	Name           string   `json:"name"`
	Welcome        string   `json:"welcome"`
	ModelMode      string   `json:"modelMode"`
	ChannelModelID string   `json:"channelModelId"`
	LogicalModelID string   `json:"logicalModelId"`
	SystemPrompt   string   `json:"systemPrompt"`
	Knowledge      string   `json:"knowledge"`
	Questions      []string `json:"questions"`
	Navigation     []string `json:"navigation"`
	// Legacy fields are accepted while older saved settings exist, but Yoru no
	// longer applies a separate daily or per-call quota to paid users.
	DailyCalls            int   `json:"dailyCalls"`
	MaxDailyMicrocredits  int64 `json:"maxDailyMicrocredits"`
	MaxChargeMicrocredits int64 `json:"maxChargeMicrocredits"`
	MaxOutputTokens       int   `json:"maxOutputTokens"`
	AllowGuests           bool  `json:"allowGuests"`
	SaveHistory           bool  `json:"saveHistory"`
	VoiceEnabled          bool  `json:"voiceEnabled"`
	MotionEnabled         bool  `json:"motionEnabled"`
	AvatarSize            int   `json:"avatarSize"`
	DefaultRight          int   `json:"defaultRight"`
	DefaultBottom         int   `json:"defaultBottom"`
}

type YoruMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type YoruChatRequest struct {
	Message         string        `json:"message"`
	History         []YoruMessage `json:"history"`
	Page            string        `json:"page"`
	PublicModelName string        `json:"publicModelName"`
	ErrorText       string        `json:"errorText"`
}

func defaultYoruSettings() YoruSettings {
	return YoruSettings{Name: "小夜", Audience: "admin", Welcome: "你好呀，我是小夜。想了解影策的哪个功能？", Questions: []string{"怎么生成图片？", "我生成的视频在哪里？", "为什么任务一直处理中？"}, Navigation: []string{"图片生成", "视频生成", "灵感大厅", "自由画布", "Agent", "技能", "资产库", "创作历史", "积分中心"}, Knowledge: defaultYoruKnowledge, MaxOutputTokens: 1024, MotionEnabled: true, AvatarSize: 180, DefaultRight: 16, DefaultBottom: 24}
}

func yoruModelMode(value YoruSettings) string {
	if value.ModelMode != "" {
		return value.ModelMode
	}
	if value.LogicalModelID != "" {
		return "smart_route" // Settings saved before direct-channel support.
	}
	return "direct"
}

// The same catalog as the ordinary text composer is the admission source.
// It excludes disabled, test-only, invalid-capability and unpriced models.
func (s *Service) yoruDirectModelForUser(actor *model.User, channelModelID string) (string, string, error) {
	catalog, err := s.ModelCatalogForUser(actor, &ModelRequestIntent{Capability: "text"})
	if err != nil {
		return "", "", err
	}
	for _, channel := range catalog.Channels {
		for _, item := range channel.Models {
			if item.ID == channelModelID {
				if !item.Available {
					return "", "", BadAuthRequest("所选文本模型没有有效价格档")
				}
				return channel.ID, item.ModelKey, nil
			}
		}
	}
	return "", "", BadAuthRequest("所选文本模型已停用或不可用，请重新选择")
}

// Paths are copied from web/src/router.tsx and are also kept in the widget's
// allowlist. An unavailable feature must still be described as unavailable.
const defaultYoruKnowledge = `影策真实页面：图片生成 /toolbox/image（需管理员开放）；视频生成 /toolbox/video（需管理员开放）；AI 文本对话是创作工作台 /create 内的“文本”模式；灵感大厅也嵌在 /create；自由画布 /canvas；Agent 入口在 /create 和画布内；技能 /skills；资产库 /assets；创作历史与任务 /tasks；积分中心 /wallet 会打开积分弹窗。电商 Agent 位于 /ecommerce，支持商品分析、方向选择、逐页策划和图片生成；商品与借鉴图分开上传，历史项目可恢复。图片参考图由图片生成页上传。手机验证码及微信登录在 /login。失败任务可在 /tasks 查看状态和重试；处理中可能是排队、上游运行或媒体保存，不要断言已失败。模型选择与参考图数量应以当前公开模型能力配置为准，未知时明确说明。积分余额及充值入口在 /wallet；不得承诺支付成功或擅自改变余额。`

func (s *Service) YoruSettings() (YoruSettings, error) {
	setting, err := s.repo.SystemSettingOptional(yoruSettingKey)
	if err != nil || setting == nil {
		return defaultYoruSettings(), err
	}
	value := defaultYoruSettings()
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return YoruSettings{}, err
	}
	value.DailyCalls = 0
	value.MaxChargeMicrocredits = 0
	value.MaxDailyMicrocredits = 0
	return value, nil
}

func (s *Service) PublicYoruSettings(actor *model.User) (YoruSettings, error) {
	value, err := s.YoruSettings()
	if err != nil {
		return value, err
	}
	siteEnabled, err := s.FeatureEnabled(FeatureSiteAssistant)
	if err != nil {
		return YoruSettings{}, err
	}
	creditsEnabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return YoruSettings{}, err
	}
	value.Enabled = value.Enabled && siteEnabled && creditsEnabled && yoruAudienceAllows(value.Audience, actor)
	if value.Enabled {
		if yoruModelMode(value) == "direct" {
			_, _, err = s.yoruDirectModelForUser(actor, value.ChannelModelID)
			value.Enabled = err == nil
		} else if value.Audience == "all" {
			value.Enabled, err = s.yoruModelPublishedForUser(actor.ID, value.LogicalModelID)
			if err != nil {
				return YoruSettings{}, err
			}
		}
	}
	value.SystemPrompt = ""
	value.Knowledge = ""
	value.LogicalModelID = ""
	value.ChannelModelID = ""
	value.MaxChargeMicrocredits = 0
	value.MaxDailyMicrocredits = 0
	value.DailyCalls = 0
	return value, nil
}

func (s *Service) yoruModelPublishedForUser(userID, logicalModelID string) (bool, error) {
	actor, err := s.repo.User(userID)
	if err != nil {
		return false, err
	}
	items, err := s.PublicLogicalModelsForUser(actor, &ModelRequestIntent{Capability: "text"})
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if item.ID == logicalModelID && item.Available {
			return true, nil
		}
	}
	return false, nil
}

func yoruAudienceAllows(audience string, actor *model.User) bool {
	if actor == nil || actor.ID == "" {
		return false
	}
	if audience == "all" {
		return true
	}
	return (audience == "" || audience == "admin") && actor.Role == model.UserRoleAdmin
}

func (s *Service) UpdateYoruSettings(actor *model.User, value YoruSettings) (YoruSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return YoruSettings{}, err
	}
	value.Name = strings.TrimSpace(value.Name)
	value.Welcome = strings.TrimSpace(value.Welcome)
	value.SystemPrompt = strings.TrimSpace(value.SystemPrompt)
	value.Knowledge = strings.TrimSpace(value.Knowledge)
	value.LogicalModelID = strings.TrimSpace(value.LogicalModelID)
	value.ChannelModelID = strings.TrimSpace(value.ChannelModelID)
	value.ModelMode = yoruModelMode(value)
	if value.ModelMode != "direct" && value.ModelMode != "smart_route" {
		return YoruSettings{}, BadAuthRequest("小夜聊天模型模式无效")
	}
	if value.Audience == "" {
		value.Audience = "admin"
	}
	if value.Audience != "admin" && value.Audience != "all" {
		return YoruSettings{}, BadAuthRequest("小夜开放范围无效")
	}
	if value.Name == "" || len([]rune(value.Name)) > 40 || len([]rune(value.Welcome)) > 500 || len([]rune(value.SystemPrompt)) > 8000 || len([]rune(value.Knowledge)) > 24000 || len(value.Questions) > 8 || value.AvatarSize < 100 || value.AvatarSize > 240 || value.DefaultRight < 0 || value.DefaultRight > 200 || value.DefaultBottom < 0 || value.DefaultBottom > 200 || value.MaxOutputTokens < 128 || value.MaxOutputTokens > 4096 {
		return YoruSettings{}, BadAuthRequest("小夜配置超出允许范围")
	}
	for _, question := range value.Questions {
		if strings.TrimSpace(question) == "" || len([]rune(question)) > 100 {
			return YoruSettings{}, BadAuthRequest("推荐问题无效")
		}
	}
	allowed := map[string]bool{"图片生成": true, "视频生成": true, "灵感大厅": true, "自由画布": true, "Agent": true, "技能": true, "资产库": true, "创作历史": true, "积分中心": true}
	seen := map[string]bool{}
	for _, name := range value.Navigation {
		if !allowed[name] || seen[name] {
			return YoruSettings{}, BadAuthRequest("导航入口不在已发布路由白名单中")
		}
		seen[name] = true
	}
	// Guest billing has no established wallet identity; never accept it.
	if value.AllowGuests {
		return YoruSettings{}, BadAuthRequest("游客模型调用尚未开放")
	}
	if value.SaveHistory || value.VoiceEnabled {
		return YoruSettings{}, BadAuthRequest("服务端聊天历史与语音功能尚未开放")
	}
	value.DailyCalls = 0
	value.MaxChargeMicrocredits = 0
	value.MaxDailyMicrocredits = 0
	if value.Enabled {
		if value.ModelMode == "direct" {
			if value.ChannelModelID == "" {
				return YoruSettings{}, BadAuthRequest("启用前必须选择现有文本渠道模型")
			}
			if _, _, err := s.yoruDirectModelForUser(actor, value.ChannelModelID); err != nil {
				return YoruSettings{}, err
			}
		} else {
			if value.LogicalModelID == "" {
				return YoruSettings{}, BadAuthRequest("启用前必须选择智能路由逻辑模型")
			}
			access, err := s.userGroupAccessForUser(actor)
			if err != nil {
				return YoruSettings{}, err
			}
			if _, err := s.ResolveLogicalModel(access, value.LogicalModelID, ModelRequestIntent{Capability: "text"}); err != nil {
				return YoruSettings{}, err
			}
		}
	}
	before, err := s.YoruSettings()
	if err != nil {
		return YoruSettings{}, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return YoruSettings{}, err
	}
	setting := &model.SystemSetting{Key: yoruSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return YoruSettings{}, err
	}
	if err := s.appendAdminAudit(actor, "yoru.update", "system_setting", yoruSettingKey, "更新小夜助手配置", map[string]any{"before": before, "after": value}); err != nil {
		return YoruSettings{}, err
	}
	return value, nil
}

func (s *Service) requireYoruChat(actor *model.User) error {
	if actor == nil || actor.ID == "" {
		return Unauthorized("请先登录后使用小夜对话")
	}
	if err := s.RequireFeature(FeatureSiteAssistant); err != nil {
		return err
	}
	settings, err := s.YoruSettings()
	if err != nil {
		return err
	}
	if !settings.Enabled || !yoruAudienceAllows(settings.Audience, actor) {
		return BadAuthRequest("小夜对话尚未由管理员开放")
	}
	creditsEnabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return err
	}
	if !creditsEnabled {
		return BadAuthRequest("积分账本未启用，小夜暂不可对话")
	}
	return nil
}

func (s *Service) CreateYoruChatTask(actor *model.User, request YoruChatRequest) (*model.Task, error) {
	if err := s.requireYoruChat(actor); err != nil {
		return nil, err
	}
	settings, err := s.YoruSettings()
	if err != nil {
		return nil, err
	}
	mode := yoruModelMode(settings)
	channelID, modelKey := "", ""
	if mode == "direct" {
		channelID, modelKey, err = s.yoruDirectModelForUser(actor, settings.ChannelModelID)
		if err != nil {
			return nil, err
		}
	} else if mode == "smart_route" && settings.Audience == "all" {
		published, err := s.yoruModelPublishedForUser(actor.ID, settings.LogicalModelID)
		if err != nil {
			return nil, err
		}
		if !published {
			return nil, BadAuthRequest("当前文本模型尚未向此用户发布")
		}
	} else if mode != "smart_route" || settings.LogicalModelID == "" {
		return nil, BadAuthRequest("小夜文本模型未配置")
	}
	request.Message = strings.TrimSpace(request.Message)
	if request.Message == "" || len([]rune(request.Message)) > 2000 || len(request.History) > 12 || len([]rune(request.ErrorText)) > 500 || len([]rune(request.Page)) > 160 || len([]rune(request.PublicModelName)) > 120 {
		return nil, BadAuthRequest("对话内容超出允许范围")
	}
	for _, item := range request.History {
		if (item.Role != "user" && item.Role != "assistant") || len([]rune(item.Content)) > 2000 {
			return nil, BadAuthRequest("对话历史无效")
		}
	}
	context := "你是影策站内帮助助手小夜。只能解释网站功能与安全操作步骤，不得声称能操作数据库、积分、支付或其他用户资产。信息未知或功能未开放时如实说明；模型能力只依据下面的当前公开配置，不能猜测。不要输出管理操作链接。"
	if settings.SystemPrompt != "" {
		context += "\n管理员说明：" + settings.SystemPrompt
	}
	if settings.Knowledge != "" {
		context += "\n网站知识库：" + settings.Knowledge
	}
	if strings.Contains(strings.ToLower(request.Message), "gpt-image-2") || strings.Contains(request.Message, "参考图") || strings.Contains(request.Message, "模型") {
		catalog, catalogErr := s.ModelCatalogForUser(actor, &ModelRequestIntent{Capability: "image"})
		if catalogErr == nil {
			added := 0
			for _, channel := range catalog.Channels {
				for _, item := range channel.Models {
					if !strings.Contains(strings.ToLower(item.ModelKey+" "+item.DisplayName), "gpt-image-2") {
						continue
					}
					data, _ := json.Marshal(map[string]any{"name": item.DisplayName, "available": item.Available, "capabilityConfig": item.CapabilityConfig})
					if len(data) > 3000 {
						context += "\n当前发布的 GPT-Image-2 能力配置过长，无法安全读取完整字段；请提示用户在模型选择处确认，不要猜测参考图数量。"
						continue
					}
					context += "\n当前发布的 GPT-Image-2 能力：" + string(data)
					added++
					if added >= 3 {
						break
					}
				}
				if added >= 3 {
					break
				}
			}
		}
	}
	context += "\n当前页面：" + request.Page + "\n公开模型名称：" + request.PublicModelName + "\n用户主动提供的错误：" + request.ErrorText
	history := []map[string]any{{"role": "user", "content": context}}
	for _, item := range request.History {
		history = append(history, map[string]any{"role": item.Role, "content": item.Content})
	}
	input := map[string]any{"mode": "text", "prompt": request.Message, "config": map[string]any{}, "textHistory": history, "maxOutputTokens": settings.MaxOutputTokens, "textOptions": map[string]any{"stream": true, "thinking": false, "maxOutputTokens": settings.MaxOutputTokens}}
	if mode == "direct" {
		input["config"] = map[string]any{"channelId": channelID, "model": modelKey}
	}
	// The internal admission marker keeps smart-route access confined to this
	// authenticated endpoint. CreateTask still caps settlement at its own quote.
	taskRequest := CreateTaskRequest{Type: "canvas_text", Operation: "yoru_assistant", Prompt: request.Message, Input: input, admission: &taskAdmission{ID: newID(), MaxCharge: 1<<63 - 1}}
	if mode == "direct" {
		taskRequest.Model = modelKey
	} else {
		taskRequest.LogicalModelID = settings.LogicalModelID
	}
	return s.CreateTask(actor.ID, taskRequest)
}
