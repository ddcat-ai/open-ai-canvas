package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceAgentTaskView struct {
	Run          *model.EcommerceAgentRun     `json:"task"`
	Pages        []model.EcommerceAgentPage   `json:"pages"`
	PosterCanvas *ecommerceagent.PosterCanvas `json:"posterCanvas,omitempty"`
}
type EcommerceAgentCanvasView struct {
	PosterCanvas *ecommerceagent.PosterCanvas        `json:"posterCanvas"`
	Versions     []model.EcommerceAgentCanvasVersion `json:"versions"`
}
type EcommerceAgentError struct{ Code, Message string }

func (e *EcommerceAgentError) Error() string { return e.Message }
func ecommerceErr(code, message string) error {
	return &EcommerceAgentError{Code: code, Message: message}
}

func validateEcommerceAgentRequest(req ecommerceagent.Request, generate bool) (ecommerceagent.Platform, error) {
	p, ok := ecommerceagent.PlatformFor(req.Platform)
	if !ok {
		return p, ecommerceErr("INVALID_INPUT", "不支持的电商平台")
	}
	if len(req.FileInfoList) < 1 || len(req.FileInfoList) > 5 {
		return p, ecommerceErr("INVALID_INPUT", "请提供 1 至 5 张商品图")
	}
	for _, f := range req.FileInfoList {
		if len(f.URL) > 2048 || strings.TrimSpace(f.URL) == "" {
			return p, ecommerceErr("INVALID_INPUT", "商品图地址无效")
		}
	}
	if len(req.Query) > 4000 || len(req.UserSellingPoints) > 2000 {
		return p, ecommerceErr("INVALID_INPUT", "描述过长")
	}
	if !generate {
		return p, nil
	}
	if req.GenerateType != 100 && req.GenerateType != 101 && req.GenerateType != 102 && req.GenerateType != 103 && req.GenerateType != 200 && req.GenerateType != 400 {
		return p, ecommerceErr("INVALID_INPUT", "生成类型无效")
	}
	if req.ImageCount < 1 || req.ImageCount > 15 || (req.GenerateType == 200 && (req.ImageCount < 5 || req.ImageCount > 15)) {
		return p, ecommerceErr("INVALID_INPUT", "页数不符合生成类型要求")
	}
	if len(req.IdempotencyKey) > 150 {
		return p, ecommerceErr("INVALID_INPUT", "幂等键过长")
	}
	if req.Channel != "" && req.Channel != "promotion" && req.Channel != "premium" {
		return p, ecommerceErr("INVALID_INPUT", "出图通道无效")
	}
	return p, nil
}

func (s *Service) ecommerceReference(userID, rawURL string) (string, []byte, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", nil, "", ecommerceErr("INVALID_INPUT", "商品图地址无效")
	}
	var id string
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) == 4 && parts[0] == "api" && parts[1] == "resources" && parts[3] == "file" {
		id = parts[2]
	}
	if id == "" {
		if u.Scheme != "https" || u.Host == "" {
			return "", nil, "", ecommerceErr("INVALID_INPUT", "仅支持已上传素材或 HTTPS 商品图")
		}
		resource, importErr := s.ImportResourceURL(userID, rawURL, "image", 0, 0, 0)
		if importErr != nil {
			return "", nil, "", importErr
		}
		id = resource.ID
	}
	resource, stream, err := s.OpenResource(userID, id)
	if err != nil {
		return "", nil, "", err
	}
	defer stream.Close()
	if resource.Kind != "image" || resource.Size > 10<<20 {
		return "", nil, "", ecommerceErr("INVALID_INPUT", "商品图须为不超过 10 MB 的图片")
	}
	mime := resource.MimeType
	if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
		return "", nil, "", ecommerceErr("INVALID_INPUT", "商品图格式须为 PNG、JPEG 或 WebP")
	}
	raw, err := io.ReadAll(io.LimitReader(stream, 10<<20+1))
	if err != nil {
		return "", nil, "", err
	}
	if len(raw) > 10<<20 {
		return "", nil, "", ecommerceErr("INVALID_INPUT", "商品图超过 10 MB")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw), raw, mime, nil
}

func (s *Service) AnalyzeEcommerceAgent(ctx context.Context, userID string, req ecommerceagent.Request) (*ecommerceagent.Analysis, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	p, err := validateEcommerceAgentRequest(req, false)
	if err != nil {
		return nil, err
	}
	cfg := ecommerceConfig()
	// Recognition and style recommendations use the administrator's
	// recognition model, the same one the /ecommerce directions stage uses.
	cfg, err = s.ecommerceVisionText(userID, cfg)
	if err != nil {
		return nil, err
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	signatureInput, _ := json.Marshal([]any{req.FileInfoList, req.Query, req.Platform, req.Language, req.Brand, cfg.Mode, cfg.TextModel})
	signature := fmt.Sprintf("%x", sha256.Sum256(signatureInput))
	if cfg.Mode == "live" {
		if cached, e := s.repo.EcommerceAgentAnalysis(userID, signature); e == nil && time.Since(cached.CreatedAt) < time.Hour {
			var result ecommerceagent.Analysis
			if json.Unmarshal([]byte(cached.PayloadJSON), &result) == nil && len(result.Recommendations) >= 4 {
				return &result, nil
			}
		} else if e != nil && !errors.Is(e, gorm.ErrRecordNotFound) {
			return nil, e
		}
	}
	brief := ecommerceagent.MockBrief(req.Query)
	visionVerified := false
	if cfg.Mode == "live" {
		images := make([]string, 0, len(req.FileInfoList))
		for _, f := range req.FileInfoList {
			uri, _, _, e := s.ecommerceReference(userID, f.URL)
			if e != nil {
				return nil, e
			}
			images = append(images, uri)
		}
		prompt := ecommerceagent.BuildVisionPrompt(req)
		if err := s.ecommerceChatJSON(ctx, cfg, "analyze", ecommerceagent.SystemVision, prompt, images, &brief); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			brief = ecommerceagent.MockBrief(req.Query)
			brief.VisualRisks = []string{"视觉理解失败，未核验商品图；材质、结构、性能和商业卖点均待卖家确认"}
		} else {
			visionVerified = true
		}
		if strings.TrimSpace(brief.Category) == "" {
			visionVerified = false
			brief = ecommerceagent.MockBrief(req.Query)
			brief.VisualRisks = []string{"视觉理解未返回商品品类，未核验商品图；材质、结构、性能和商业卖点均待卖家确认"}
		}
	}
	styles := []ecommerceagent.Style{{Name: "极简白底", Desc: "纯白背景、完整商品与均匀影棚光"}, {Name: "场景叙事", Desc: "真实使用环境与自然光"}, {Name: "工艺特写", Desc: "只呈现照片可见的材质和结构"}}
	recs := ecommerceagent.Recommend(brief, p, req.ImageCount)
	if cfg.Mode == "live" {
		var proposed []ecommerceagent.Recommendation
		prompt := ecommerceagent.BuildRecommendPrompt(brief, p, req.Language, styles)
		if err := s.ecommerceChatJSON(ctx, cfg, "recommend", ecommerceagent.SystemRecommend, prompt, nil, &proposed); err == nil && len(proposed) >= 4 && len(proposed) <= 6 {
			valid := true
			for i := range proposed {
				r := &proposed[i]
				r.ID = fmt.Sprintf("r%d", i+1)
				if r.Label == "" || r.Style == "" || r.Why == "" || !safeRecommendationPrompt(r.PreviewPrompt) || r.AspectRatio == "" {
					valid = false
					break
				}
				if r.Pages < 1 || r.Pages > 15 {
					r.Pages = 1
				}
			}
			if valid {
				recs = proposed
			}
		}
	}
	result := &ecommerceagent.Analysis{Brief: brief, Recommendations: recs, StyleLibrary: styles}
	if cfg.Mode == "live" && visionVerified {
		encoded, _ := json.Marshal(result)
		if err := s.repo.SaveEcommerceAgentAnalysis(&model.EcommerceAgentAnalysis{ID: newID(), UserID: userID, Signature: signature, PayloadJSON: string(encoded)}); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func safeRecommendationPrompt(prompt string) bool {
	if !strings.Contains(prompt, "same product as reference image, identical shape/color/logo placement") {
		return false
	}
	lower := strings.ToLower(prompt)
	for _, bad := range []string{"best seller", "no.1", "fda approved", "price", "discount", "certified"} {
		if strings.Contains(lower, bad) {
			return false
		}
	}
	return true
}

func (s *Service) HelpWriteEcommerceAgent(ctx context.Context, userID, text, platform, language string) (map[string]any, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if len(text) > 4000 || strings.TrimSpace(text) == "" {
		return nil, ecommerceErr("INVALID_INPUT", "请输入商品和出图需求")
	}
	if _, ok := ecommerceagent.PlatformFor(platform); !ok {
		return nil, ecommerceErr("INVALID_INPUT", "不支持的电商平台")
	}
	if strings.ContainsAny(text, "\x00\r") {
		return nil, ecommerceErr("INVALID_INPUT", "描述含无效字符")
	}
	if strings.Contains(text, "枪支") || strings.Contains(text, "色情") || strings.Contains(text, "治愈疾病") {
		return map[string]any{"status": "violation", "optimized": "", "reason": "需求包含不适合生成的内容", "alternatives": []any{}}, nil
	}
	if len([]rune(strings.TrimSpace(text))) <= 4 {
		return map[string]any{"status": "vague", "optimized": "", "reason": "请补充商品外观、使用场景和目标平台", "alternatives": []any{}}, nil
	}
	cfg := ecommerceConfig()
	cfg, err := s.ecommerceConfiguredText(userID, cfg)
	if err != nil {
		return nil, err
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	if cfg.Mode == "mock" {
		return map[string]any{"status": "normal", "optimized": text + "；请以真实商品图为准，指定场景、光线和构图，不添加未经确认的参数。", "reason": "补充画面与真实性约束", "alternatives": []map[string]string{{"label": "白底商品", "text": text + "，纯白背景，完整商品"}, {"label": "真实场景", "text": text + "，自然光下的真实使用环境"}}}, nil
	}
	var result map[string]any
	err = s.ecommerceChatJSON(ctx, cfg, "help-write", ecommerceagent.SystemHelpWrite, fmt.Sprintf("【卖家原话】%s\n【平台】%s\n【语言】%s", text, platform, language), nil, &result)
	if err != nil {
		return nil, ecommerceErr("UPSTREAM_ERROR", "提示词优化失败")
	}
	return result, nil
}

func (s *Service) ecommerceAgentOrder(userID, runID, key string, req ecommerceagent.Request, cfg ecommerceProviderConfig, count int) (*model.BillingOrder, int64, error) {
	if cfg.Mode == "mock" {
		unit := int64(32000)
		if req.ModelKey == "gpt-image-2-2K" {
			unit = 61000
		}
		if req.Channel == "premium" {
			unit = unit * 16 / 10
		}
		amount, _, _, chargeErr := ecommerceagent.Charge(unit, count, count)
		if chargeErr != nil {
			return nil, 0, chargeErr
		}
		modelKey := req.ModelKey
		if modelKey == "" {
			modelKey = cfg.ImageModel
		}
		order := &model.BillingOrder{ID: newID(), UserID: userID, TaskID: runID, IdempotencyKey: "ecommerce:" + key, Model: modelKey, Capability: "image", Scene: "ecommerce_agent", BillingMode: "fixed_request", UnitPriceMicrocredits: unit, MultiplierBasisPoints: 10000, Quantity: int64(count), AmountMicrocredits: amount, ReservedAmountMicrocredits: amount, Status: model.BillingStatusReserved}
		return order, unit, nil
	}
	channel := req.Channel
	if channel == "" {
		channel = "promotion"
	}
	channelID := strings.TrimSpace(os.Getenv("ECOMMERCE_" + strings.ToUpper(channel) + "_CHANNEL_ID"))
	if channelID == "" {
		return nil, 0, ecommerceErr("INVALID_INPUT", "尚未配置电商出图通道")
	}
	modelKey := strings.TrimSpace(req.ModelKey)
	if modelKey == "" {
		modelKey = cfg.ImageModel
	}
	intent := ModelRequestIntent{Capability: "image", Operation: "image_to_image", Inputs: map[string]int{"image": 1}, Options: map[string]any{}}
	order, err := s.newBillingOrderWithPriceTier(userID, runID, "ecommerce:"+key, channelID, modelKey, "image", "ecommerce_agent", 1, tokenBillingEstimate{}, "", intent)
	if err != nil {
		return nil, 0, err
	}
	if order.BillingMode != "fixed_request" || order.AmountMicrocredits <= 0 {
		return nil, 0, ecommerceErr("INVALID_INPUT", "电商图像模型须配置单次固定积分价格")
	}
	unit := order.AmountMicrocredits
	amount, _, _, chargeErr := ecommerceagent.Charge(unit, count, count)
	if chargeErr != nil {
		return nil, 0, chargeErr
	}
	order.Quantity = int64(count)
	order.CostQuantity = int64(count)
	order.AmountMicrocredits = amount
	order.ReservedAmountMicrocredits = order.AmountMicrocredits
	order.ChargeLimitSet = true
	order.ChargeLimitMicrocredits = order.AmountMicrocredits
	return order, unit, nil
}

func (s *Service) QuoteEcommerceAgent(userID string, req ecommerceagent.Request) (map[string]any, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureImageWorkbench); err != nil {
		return nil, err
	}
	platform, err := validateEcommerceAgentRequest(req, true)
	if err != nil {
		return nil, err
	}
	cfg := ecommerceConfig()
	if cfg.Mode == "live" {
		cfg, err = s.ecommerceLiveImageConfig(req, cfg)
		if err != nil {
			return nil, err
		}
	}
	if cfg.Mode != "live" && cfg.Mode != "mock" {
		return nil, ecommerceErr("UNAVAILABLE", "电商 Agent 出图尚未配置")
	}
	count := len(ecommerceagent.Plan(req.ImageCount, req.GenerateType, platform, nil, ecommerceagent.Brief{}))
	order, unit, err := s.ecommerceAgentOrder(userID, newID(), newID(), req, cfg, count)
	if err != nil {
		return nil, err
	}
	return map[string]any{"pageCount": count, "unitMicrocredits": unit, "totalMicrocredits": order.AmountMicrocredits, "modelKey": order.Model, "channel": req.Channel}, nil
}

func (s *Service) ecommerceLiveImageConfig(req ecommerceagent.Request, cfg ecommerceProviderConfig) (ecommerceProviderConfig, error) {
	channel := req.Channel
	if channel == "" {
		channel = "promotion"
	}
	channelID := strings.TrimSpace(os.Getenv("ECOMMERCE_" + strings.ToUpper(channel) + "_CHANNEL_ID"))
	if channelID == "" {
		return cfg, ecommerceErr("INVALID_INPUT", "尚未配置电商出图通道")
	}
	modelKey := strings.TrimSpace(req.ModelKey)
	if modelKey == "" {
		modelKey = cfg.ImageModel
	}
	configured, err := s.SystemChannel(channelID)
	if err != nil {
		return cfg, ecommerceErr("INVALID_INPUT", "出图通道不可用")
	}
	if strings.TrimSpace(configured.APIKey) == "" {
		return cfg, ecommerceErr("INVALID_INPUT", "出图通道缺少服务端密钥")
	}
	u, err := url.Parse(strings.TrimSpace(configured.BaseURL))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return cfg, ecommerceErr("INVALID_INPUT", "出图通道地址无效")
	}
	configuredModel, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if err != nil || !configuredModel.Enabled || configuredModel.Capability != "image" {
		return cfg, ecommerceErr("INVALID_INPUT", "图像模型未启用")
	}
	if configuredModel.Protocol != model.ChannelInterfaceOpenAIImage {
		return cfg, ecommerceErr("INVALID_INPUT", "电商 Agent 当前只支持 OpenAI Images 编辑协议的图像渠道")
	}
	profile, err := normalizedChannelModelCapability(configuredModel, s.protocolRegistry())
	if err != nil || profile == nil || profile.Image == nil || profile.Image.References.MaxImages < 1 {
		return cfg, ecommerceErr("INVALID_INPUT", "图像模型未配置商品图编辑能力")
	}
	provider, err := s.resolveProviderConfig(providerConfig{ChannelID: channelID, ChannelModelKey: modelKey, Model: modelKey})
	if err != nil {
		return cfg, ecommerceErr("INVALID_INPUT", "出图渠道配置不可用")
	}
	provider.CapabilityConfig = profile
	cfg.ImageBaseURL = strings.TrimRight(configured.BaseURL, "/")
	cfg.ImageKey = configured.APIKey
	cfg.ImageModel = modelKey
	cfg.ImageProvider = &provider
	if configuredModel.ProviderModelKey != "" {
		cfg.ImageModel = configuredModel.ProviderModelKey
	}
	return cfg, nil
}

func (s *Service) ecommerceAgentGeneratedURL(userID string, data []byte, rawURL, ratio string) (string, error) {
	var err error
	if len(data) == 0 && rawURL != "" {
		_, data, _, err = s.ecommerceReference(userID, rawURL)
		if err != nil {
			return "", err
		}
	}
	if len(data) == 0 {
		return "", errors.New("图像模型没有返回图片")
	}
	data, err = ecommerceagent.PadImageToRatio(data, ratio)
	if err != nil {
		return "", err
	}
	resource, err := s.UploadResourceFile(userID, "ecommerce-agent.png", int64(len(data)), "image", 0, 0, 0, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	return "/api/resources/" + resource.ID + "/file", nil
}

func (s *Service) GenerateEcommerceAgent(ctx context.Context, userID string, req ecommerceagent.Request, emit func(ecommerceagent.Event) error) (view *EcommerceAgentTaskView, err error) {
	key := strings.TrimSpace(req.IdempotencyKey)
	if key != "" {
		if prior, e := s.repo.EcommerceAgentRunByKey(userID, key); e == nil {
			return s.replayEcommerceAgent(userID, prior, emit)
		} else if !errors.Is(e, gorm.ErrRecordNotFound) {
			return nil, e
		}
	} else {
		key = newID()
	}
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureImageWorkbench); err != nil {
		return nil, err
	}
	p, err := validateEcommerceAgentRequest(req, true)
	if err != nil {
		return nil, err
	}
	cfg := ecommerceConfig()
	cfg, err = s.ecommerceConfiguredText(userID, cfg)
	if err != nil {
		return nil, err
	}
	if err = cfg.validate(); err != nil {
		return nil, err
	}
	if cfg.Mode == "live" {
		cfg, err = s.ecommerceLiveImageConfig(req, cfg)
		if err != nil {
			return nil, err
		}
	}
	analysis, err := s.AnalyzeEcommerceAgent(ctx, userID, req)
	if err != nil {
		return nil, err
	}
	var selected *ecommerceagent.Recommendation
	if req.SelectedRecommendationID != "" {
		for i := range analysis.Recommendations {
			if analysis.Recommendations[i].ID == req.SelectedRecommendationID {
				selected = &analysis.Recommendations[i]
				break
			}
		}
		if selected == nil {
			return nil, ecommerceErr("INVALID_INPUT", "设计方向已失效，请重新选择")
		}
	}
	pages := ecommerceagent.Plan(req.ImageCount, req.GenerateType, p, selected, analysis.Brief)
	ecommerceagent.ApplyTextPreference(pages, req.NeedText, req.Language)
	runID := newID()
	projectID := req.ProjectID
	var project *model.EcommerceProject
	if projectID == "" {
		projectID = newID()
		project = &model.EcommerceProject{ID: projectID, UserID: userID, Name: analysis.Brief.Category, Status: "draft", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	}
	order, unit, err := s.ecommerceAgentOrder(userID, runID, key, req, cfg, len(pages))
	if err != nil {
		return nil, err
	}
	if cfg.Mode == "live" {
		pricedModel, loadErr := s.repo.ChannelModel(order.ChannelModelID)
		if loadErr != nil {
			return nil, loadErr
		}
		for _, tier := range pricedModel.PriceTiers {
			if tier.ID == order.PriceTierID && tier.ProviderModelKey != "" {
				cfg.ImageModel = tier.ProviderModelKey
				break
			}
		}
		if cfg.ImageProvider != nil {
			cfg.ImageProvider.Model = cfg.ImageModel
		}
	}
	run := &model.EcommerceAgentRun{ID: runID, UserID: userID, IdempotencyKey: key, ProjectID: projectID, BillingOrderID: order.ID, Status: "running", Mode: cfg.Mode, Platform: req.Platform, Language: req.Language, GenerateType: req.GenerateType, PageCount: len(pages), UnitMicrocredits: unit}
	if err = s.repo.CreateEcommerceAgentRun(run, project, order); err != nil {
		if prior, e := s.repo.EcommerceAgentRunByKey(userID, key); e == nil {
			return s.replayEcommerceAgent(userID, prior, emit)
		}
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, ecommerceErr("INSUFFICIENT_CREDITS", "积分不足")
		}
		return nil, err
	}
	if err = s.MarkBillingRunning(order.ID); err != nil {
		_, _ = s.repo.FinishEcommerceAgentRun(userID, runID, "failed", "UPSTREAM_ERROR")
		return nil, err
	}
	workCtx, cancel := context.WithTimeout(ctx, cfg.GenerateTimeout)
	s.registerActiveTask(runID, cancel)
	defer func() { cancel(); s.unregisterActiveTask(runID) }()
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-workCtx.Done():
				return
			case <-ticker.C:
				run, pollErr := s.repo.EcommerceAgentRun(userID, runID)
				if pollErr == nil && run.CancelRequested {
					cancel()
					return
				}
			}
		}
	}()
	finished := false
	defer func() {
		if !finished {
			status, code := "failed", "UPSTREAM_ERROR"
			if workCtx.Err() != nil {
				if errors.Is(workCtx.Err(), context.DeadlineExceeded) {
					status, code = "failed", "MODEL_TIMEOUT"
				} else {
					status, code = "cancelled", "CANCELLED"
				}
			}
			_, _ = s.repo.FinishEcommerceAgentRun(userID, runID, status, code)
		}
	}()
	if err = emit(ecommerceagent.Event{Event: "workflow_started", TaskID: runID, ConversationID: projectID, Data: map[string]any{"pageCount": len(pages), "charged": float64(order.AmountMicrocredits) / float64(CreditScale), "mode": cfg.Mode}}); err != nil {
		return nil, err
	}
	if err = emit(ecommerceagent.Event{Event: "node_finished", Data: map[string]any{"step": map[string]string{"name": "vision", "label": "分析商品图"}, "outputs": map[string]any{"answer": analysis.Brief}}}); err != nil {
		return nil, err
	}
	copyResult := map[string]any{"oneLinePitch": analysis.Brief.Category, "sellingPoints": []any{}, "complianceNotes": []string{"仅使用已确认的商品事实；生成文案需人工核对"}}
	if cfg.Mode == "live" {
		var proposedCopy map[string]any
		copyPrompt := ecommerceagent.BuildCopyPrompt(analysis.Brief, p, req.Language, req.UserSellingPoints)
		if e := s.ecommerceChatJSON(workCtx, cfg, runID, ecommerceagent.SystemCopy, copyPrompt, nil, &proposedCopy); e == nil {
			// Keep the model's proposed copy outside the published canvas until a
			// seller verifies claims. The canvas only receives neutral headlines.
			copyResult["proposedDraft"] = proposedCopy
			copyResult["requiresReview"] = true
		}
		var proposed []ecommerceagent.Page
		planPrompt := ecommerceagent.BuildPlannerPrompt(copyResult, pages, p, req.Language, analysis.Brief)
		if e := s.ecommerceChatJSON(workCtx, cfg, runID, ecommerceagent.SystemPlanner, planPrompt, nil, &proposed); e == nil && len(proposed) == len(pages) {
			for i := range pages {
				candidate := proposed[i].ImagePrompt
				if safeEcommerceImagePrompt(candidate, req) {
					pages[i].ImagePrompt = candidate
					pages[i].NegativePrompt = proposed[i].NegativePrompt
				}
			}
		}
	}
	answerParts := make([]string, 0, len(analysis.Recommendations))
	for _, r := range analysis.Recommendations {
		answerParts = append(answerParts, "<agent-option>"+r.Label+"</agent-option>")
	}
	if err = emit(ecommerceagent.Event{Event: "node_finished", Data: map[string]any{"step": map[string]string{"name": "plan_done", "label": "分镜完成"}, "outputs": map[string]any{"answer": strings.Join(answerParts, " "), "options": analysis.Recommendations}}}); err != nil {
		return nil, err
	}
	var reference []byte
	var mime string
	if cfg.Mode == "live" {
		_, reference, mime, err = s.ecommerceReference(userID, req.FileInfoList[0].URL)
		if err != nil {
			return nil, err
		}
	}
	type result struct {
		page    ecommerceagent.Page
		latency int64
	}
	results := make(chan result, cfg.MaxConcurrent)
	next, active, done := 0, 0, 0
	persisted := make([]bool, len(pages))
	launch := func(index int) {
		page := pages[index]
		go func() {
			start := time.Now()
			page.Prompt = ecommerceImagePrompt(page, p, req.Brand, analysis.Brief, selected)
			if cfg.Mode == "mock" {
				page.URL = ecommerceagent.MockImage(page, analysis.Brief.Category)
			} else {
				data, upstreamURL, e := ecommerceImage(workCtx, cfg, runID, page.Prompt, page.AspectRatio, mime, reference, unit)
				if e == nil {
					page.URL, e = s.ecommerceAgentGeneratedURL(userID, data, upstreamURL, page.AspectRatio)
				}
				if e != nil {
					page.Error = "出图失败，请重试"
				}
			}
			results <- result{page: page, latency: time.Since(start).Milliseconds()}
		}()
	}
	for done < len(pages) {
		for next < len(pages) && active < cfg.MaxConcurrent && workCtx.Err() == nil {
			launch(next)
			next++
			active++
		}
		if active == 0 {
			break
		}
		select {
		case <-workCtx.Done(): // The workers share this context and will stop before further upstream requests.
			for active > 0 {
				<-results
				active--
			}
			done = len(pages)
		case item := <-results:
			active--
			done++
			page := item.page
			status := "failed"
			if page.URL != "" {
				status = "completed"
			}
			row := &model.EcommerceAgentPage{ID: newID(), RunID: runID, Index: page.Index, Role: page.Role, Title: page.Title, Headline: page.Headline, Prompt: page.Prompt, URL: page.URL, Status: status, Error: page.Error, Ratio: page.AspectRatio, NeedText: page.NeedText, LatencyMs: item.latency}
			if saveErr := s.repo.SaveEcommerceAgentPage(userID, row); saveErr != nil {
				return nil, saveErr
			}
			persisted[page.Index-1] = true
			pages[page.Index-1] = page
			if emitErr := emit(ecommerceagent.Event{Event: "iteration_completed", Data: map[string]any{"page": page, "progress": float64(done) / float64(len(pages))}}); emitErr != nil {
				return nil, emitErr
			}
		}
	}
	if workCtx.Err() != nil {
		code := "CANCELLED"
		if errors.Is(workCtx.Err(), context.DeadlineExceeded) {
			code = "MODEL_TIMEOUT"
		}
		for i := range pages {
			if persisted[i] {
				continue
			}
			page := &pages[i]
			page.Error = code
			row := &model.EcommerceAgentPage{ID: newID(), RunID: runID, Index: page.Index, Role: page.Role, Title: page.Title, Headline: page.Headline, Status: "failed", Error: code, Ratio: page.AspectRatio, NeedText: page.NeedText}
			if saveErr := s.repo.SaveEcommerceAgentPage(userID, row); saveErr != nil {
				return nil, saveErr
			}
		}
		if errors.Is(workCtx.Err(), context.DeadlineExceeded) {
			return nil, ecommerceErr("MODEL_TIMEOUT", "出图超时")
		}
		return nil, ecommerceErr("CANCELLED", "任务已取消")
	}
	canvas := ecommerceagent.BuildCanvas(pages, p)
	briefJSON, _ := json.Marshal(analysis.Brief)
	copyJSON, _ := json.Marshal(copyResult)
	canvasJSON, _ := json.Marshal(canvas)
	if err = s.repo.SaveEcommerceAgentResult(userID, runID, string(briefJSON), string(copyJSON), string(canvasJSON)); err != nil {
		return nil, err
	}
	if _, err = s.repo.SaveEcommerceAgentCanvas(userID, projectID, string(canvasJSON)); err != nil {
		return nil, err
	}
	if run, err = s.repo.FinishEcommerceAgentRun(userID, runID, "completed", ""); err != nil {
		return nil, err
	}
	finished = true
	view, err = s.EcommerceAgentTask(userID, runID)
	if err != nil {
		return nil, err
	}
	if err = emit(ecommerceagent.Event{Event: "node_finished", Data: map[string]any{"outputs": map[string]any{"answer": "出图完成", "files": pages}, "posterCanvas": canvas, "brief": analysis.Brief, "copy": copyResult, "pages": pages, "credit": map[string]any{"charged": float64(run.UnitMicrocredits*int64(run.SuccessPages)) / float64(CreditScale)}, "projectId": projectID}}); err != nil {
		return view, err
	}
	err = emit(ecommerceagent.Event{Event: "message", Data: map[string]any{"done": true}})
	return view, err
}

func safeEcommerceImagePrompt(candidate string, req ecommerceagent.Request) bool {
	if len(candidate) < 40 || len(candidate) > 4000 || !strings.Contains(candidate, "same product as reference image, identical shape/color/logo placement") {
		return false
	}
	lower := strings.ToLower(candidate)
	for _, forbidden := range []string{"best seller", "no.1", "fda approved", "certified", "guaranteed", "price", "discount", "free shipping", "第一", "最好", "认证", "销量"} {
		if strings.Contains(lower, forbidden) {
			return false
		}
	}
	if strings.IndexFunc(candidate, unicode.IsDigit) >= 0 && strings.IndexFunc(req.Query+req.UserSellingPoints, unicode.IsDigit) < 0 {
		return false
	}
	return true
}

func (s *Service) replayEcommerceAgent(userID string, run *model.EcommerceAgentRun, emit func(ecommerceagent.Event) error) (*EcommerceAgentTaskView, error) {
	view, err := s.EcommerceAgentTask(userID, run.ID)
	if err != nil {
		return nil, err
	}
	if err = emit(ecommerceagent.Event{Event: "workflow_started", TaskID: run.ID, ConversationID: run.ProjectID, Data: map[string]any{"pageCount": run.PageCount, "charged": float64(run.UnitMicrocredits*int64(run.PageCount)) / float64(CreditScale), "mode": run.Mode, "replayed": true}}); err != nil {
		return nil, err
	}
	for _, page := range view.Pages {
		if err = emit(ecommerceagent.Event{Event: "iteration_completed", Data: map[string]any{"page": page, "progress": float64(page.Index) / float64(run.PageCount)}}); err != nil {
			return nil, err
		}
	}
	_ = emit(ecommerceagent.Event{Event: "message", Data: map[string]any{"done": run.Status != "running", "replayed": true, "status": run.Status}})
	return view, nil
}

func (s *Service) EcommerceAgentTask(userID, runID string) (*EcommerceAgentTaskView, error) {
	run, err := s.repo.EcommerceAgentRun(userID, runID)
	if err != nil {
		return nil, err
	}
	pages, err := s.repo.EcommerceAgentPages(userID, runID)
	if err != nil {
		return nil, err
	}
	view := &EcommerceAgentTaskView{Run: run, Pages: pages}
	if run.CanvasJSON != "" {
		var canvas ecommerceagent.PosterCanvas
		if json.Unmarshal([]byte(run.CanvasJSON), &canvas) == nil {
			view.PosterCanvas = &canvas
		}
	}
	return view, nil
}

func (s *Service) LatestEcommerceAgentProjectTask(userID, projectID string) (*EcommerceAgentTaskView, error) {
	run, err := s.repo.LatestEcommerceAgentRunByProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	return s.EcommerceAgentTask(userID, run.ID)
}
func (s *Service) CancelEcommerceAgent(userID, runID string) (*EcommerceAgentTaskView, error) {
	run, err := s.repo.EcommerceAgentRun(userID, runID)
	if err != nil {
		return nil, err
	}
	if run.Status == "running" {
		if err := s.repo.RequestEcommerceAgentCancel(userID, runID); err != nil {
			return nil, err
		}
		s.cancelActiveTask(runID)
	}
	return s.EcommerceAgentTask(userID, runID)
}
func (s *Service) SaveEcommerceAgentCanvas(userID, projectID string, canvas ecommerceagent.PosterCanvas) (*model.EcommerceAgentCanvasVersion, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if canvas.CanvasProtocol != "SNAPSHOT" || len(canvas.Objects) > 500 || canvas.Width < 1 || canvas.Height < 1 {
		return nil, ecommerceErr("INVALID_INPUT", "画布格式无效")
	}
	encoded, err := json.Marshal(canvas)
	if err != nil {
		return nil, err
	}
	if len(encoded) > 2<<20 {
		return nil, ecommerceErr("INVALID_INPUT", "画布超过 2 MB")
	}
	return s.repo.SaveEcommerceAgentCanvas(userID, projectID, string(encoded))
}
func (s *Service) EcommerceAgentCanvas(userID, projectID string) (*EcommerceAgentCanvasView, error) {
	versions, err := s.repo.EcommerceAgentCanvas(userID, projectID)
	if err != nil {
		return nil, err
	}
	view := &EcommerceAgentCanvasView{Versions: versions}
	if len(versions) > 0 {
		var canvas ecommerceagent.PosterCanvas
		if err = json.Unmarshal([]byte(versions[0].CanvasJSON), &canvas); err != nil {
			return nil, err
		}
		view.PosterCanvas = &canvas
	}
	return view, nil
}
