package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/ecommerceagent"
)

type ecommerceProviderConfig struct {
	Mode                               string
	TextBaseURL, TextKey, TextModel    string
	ImageBaseURL, ImageKey, ImageModel string
	TextTimeout, ImageTimeout          time.Duration
	GenerateTimeout                    time.Duration
	MaxConcurrent                      int
	TextProvider                       *providerConfig
	ImageProvider                      *providerConfig
}

func ecommerceDuration(name string, fallback int) time.Duration {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n < 1000 || n > 900000 {
		n = fallback
	}
	return time.Duration(n) * time.Millisecond
}
func ecommerceInt(name string, fallback, max int) int {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n < 1 || n > max {
		return fallback
	}
	return n
}
func ecommerceConfig() ecommerceProviderConfig {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("AI_MODE")))
	if mode == "" {
		mode = "disabled"
	}
	textBase := strings.TrimRight(strings.TrimSpace(os.Getenv("TEXT_BASE_URL")), "/")
	if textBase == "" {
		textBase = "https://api.openai.com/v1"
	}
	imageBase := strings.TrimRight(strings.TrimSpace(os.Getenv("IMAGE_BASE_URL")), "/")
	if imageBase == "" {
		imageBase = textBase
	}
	textModel := strings.TrimSpace(os.Getenv("TEXT_MODEL"))
	if textModel == "" {
		textModel = "gpt-4o-mini"
	}
	imageModel := strings.TrimSpace(os.Getenv("IMAGE_MODEL"))
	if imageModel == "" {
		imageModel = "gpt-image-1"
	}
	return ecommerceProviderConfig{Mode: mode, TextBaseURL: textBase, TextKey: os.Getenv("TEXT_API_KEY"), TextModel: textModel, ImageBaseURL: imageBase, ImageKey: os.Getenv("IMAGE_API_KEY"), ImageModel: imageModel, TextTimeout: ecommerceDuration("TEXT_TIMEOUT_MS", 60000), ImageTimeout: ecommerceDuration("IMAGE_TIMEOUT_MS", 180000), GenerateTimeout: ecommerceDuration("GENERATE_TIMEOUT_MS", 300000), MaxConcurrent: ecommerceInt("MAX_CONCURRENT_IMAGES", 2, 4)}
}

func (c ecommerceProviderConfig) validate() error {
	if c.Mode == "mock" {
		return nil
	}
	if c.Mode == "disabled" {
		return ecommerceErr("UNAVAILABLE", "电商 Agent 出图尚未配置")
	}
	if c.Mode != "live" {
		return ecommerceErr("UNAVAILABLE", "AI_MODE 仅支持 mock 或 live")
	}
	if c.TextKey == "" && c.TextProvider == nil {
		return ecommerceErr("UNAVAILABLE", "live 模式缺少服务端文本密钥")
	}
	if c.TextProvider != nil {
		return nil
	}
	for _, raw := range []string{c.TextBaseURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return errors.New("模型服务地址必须是 HTTPS URL")
		}
	}
	return nil
}

// The administrator's planning model is the live text source for copy,
// storyboards and prompts. Its channel owns the credential, protocol and
// upstream model key.
func (s *Service) ecommerceConfiguredText(userID string, cfg ecommerceProviderConfig) (ecommerceProviderConfig, error) {
	if cfg.Mode != "live" || cfg.TextKey != "" {
		return cfg, nil
	}
	setting, err := s.EcommerceAgentSetting()
	if err != nil {
		return cfg, err
	}
	return s.ecommerceConfiguredTextFor(userID, cfg, setting.planningRef(), "策划")
}

// ecommerceVisionText resolves the administrator's recognition model, which
// reads the product images and proposes the style directions. Without a
// separate recognition model it is the planning model.
func (s *Service) ecommerceVisionText(userID string, cfg ecommerceProviderConfig) (ecommerceProviderConfig, error) {
	if cfg.Mode != "live" || cfg.TextKey != "" {
		return cfg, nil
	}
	setting, err := s.EcommerceAgentSetting()
	if err != nil {
		return cfg, err
	}
	return s.ecommerceConfiguredTextFor(userID, cfg, setting.visionRef(), "识图")
}

func (s *Service) ecommerceConfiguredTextFor(userID string, cfg ecommerceProviderConfig, ref EcommerceAgentModelRef, stage string) (ecommerceProviderConfig, error) {
	channelID, modelKey := ref.ChannelID, ref.ModelKey
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return cfg, err
	}
	if ref.ChannelModelID != "" {
		selected, lookupErr := s.repo.ChannelModel(ref.ChannelModelID)
		if lookupErr != nil || !selected.Enabled || selected.DeletedAt.Valid || !selected.PriceConfigured || selected.Capability != "text" || selected.ChannelID != channelID || selected.ModelKey != modelKey {
			return cfg, ecommerceErr("UNAVAILABLE", "已配置的电商 Agent "+stage+"模型已停用或变更，请管理员重新选择")
		}
		channels, channelErr := s.repo.SystemChannelsByIDs([]string{selected.ChannelID}, false)
		if channelErr != nil || len(channels) != 1 || !channels[0].Enabled {
			return cfg, ecommerceErr("UNAVAILABLE", "已配置的电商 Agent "+stage+"渠道不可用，请管理员重新选择")
		}
		// Legacy selections can predate stored capability profiles. Keep their
		// existing behavior; newly configured profiles must remain compatible.
		if strings.TrimSpace(selected.CapabilityConfigJSON) != "" {
			profile, profileErr := normalizedChannelModelCapability(selected, s.protocolRegistry())
			if profileErr != nil || profile == nil || profile.Text == nil || profile.Text.References.MaxImages < 1 {
				return cfg, ecommerceErr("UNAVAILABLE", "已配置的电商 Agent "+stage+"模型不再支持图片输入，请管理员重新选择")
			}
		}
	}
	if ref.LogicalModelID != "" {
		routed, routeErr := s.ResolveLogicalModel(access, ref.LogicalModelID, ModelRequestIntent{Capability: "text", Inputs: map[string]int{"image": 1}})
		if routeErr != nil {
			return cfg, ecommerceErr("UNAVAILABLE", "电商 Agent "+stage+"模型没有可用的图片理解线路")
		}
		channelID, modelKey = routed.ChannelModel.ChannelID, routed.ChannelModel.ModelKey
	}
	if channelID == "" || modelKey == "" {
		return cfg, ecommerceErr("UNAVAILABLE", "请先在后台选择电商 Agent "+stage+"模型")
	}
	if err := access.requireChannel(channelID); err != nil {
		return cfg, err
	}
	resolved, err := s.resolveProviderConfig(providerConfig{ChannelID: channelID, ChannelModelKey: modelKey, Model: modelKey})
	if err != nil {
		return cfg, ecommerceErr("UNAVAILABLE", "电商 Agent "+stage+"渠道不可用")
	}
	cfg.TextProvider = &resolved
	cfg.TextModel = resolved.Model
	return cfg, nil
}

func ecommerceRequest(ctx context.Context, endpoint, key string, timeout time.Duration, body []byte, contentType string, attempts int) ([]byte, int, error) {
	var last error
	for attempt := 0; attempt < attempts; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		req, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			cancel()
			return nil, 0, err
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := (&http.Client{Timeout: timeout}).Do(req)
		if err == nil {
			data, readErr := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
			resp.Body.Close()
			cancel()
			if readErr != nil {
				return nil, resp.StatusCode, readErr
			}
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return data, resp.StatusCode, nil
			}
			last = fmt.Errorf("上游返回 HTTP %d", resp.StatusCode)
			if resp.StatusCode < 500 && resp.StatusCode != 429 {
				return nil, resp.StatusCode, last
			}
		} else {
			cancel()
			last = err
		}
		if ctx.Err() != nil {
			return nil, 0, ctx.Err()
		}
		if attempt+1 < attempts {
			timer := time.NewTimer(time.Duration(400<<attempt) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, 0, ctx.Err()
			case <-timer.C:
			}
		}
	}
	return nil, 0, last
}

func (s *Service) ecommerceChatJSON(ctx context.Context, cfg ecommerceProviderConfig, taskID, system, prompt string, images []string, out any) error {
	if cfg.TextProvider != nil {
		callCtx, cancel := context.WithTimeout(ctx, cfg.TextTimeout)
		defer cancel()
		provider := *cfg.TextProvider
		provider.SystemPrompt = system
		input := canvasGenerationInput{Mode: "text", Prompt: prompt, Config: provider}
		for _, imageURL := range images {
			input.ReferenceImages = append(input.ReferenceImages, providerMedia{DataURL: imageURL})
		}
		started := time.Now()
		result, err := runTextTask(withProtocolRegistry(callCtx, s.protocolRegistry()), input)
		if err != nil {
			slog.Warn("ecommerce agent text failed", "taskId", taskID, "model", provider.Model, "latencyMs", time.Since(started).Milliseconds(), "error", err)
			return err
		}
		content, _ := result["text"].(string)
		slog.Info("ecommerce agent text", "taskId", taskID, "model", provider.Model, "latencyMs", time.Since(started).Milliseconds())
		return ecommerceParseJSON(content, out)
	}
	var content any = prompt
	if len(images) > 0 {
		parts := []any{map[string]any{"type": "text", "text": prompt}}
		for _, u := range images {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": u}})
		}
		content = parts
	}
	payload := map[string]any{"model": cfg.TextModel, "messages": []any{map[string]any{"role": "system", "content": system}, map[string]any{"role": "user", "content": content}}}
	switch out.(type) {
	case *[]ecommerceagent.Page, *[]ecommerceagent.Recommendation:
	default:
		payload["response_format"] = map[string]string{"type": "json_object"}
	}
	body, _ := json.Marshal(payload)
	start := time.Now()
	data, _, err := ecommerceRequest(ctx, cfg.TextBaseURL+"/chat/completions", cfg.TextKey, cfg.TextTimeout, body, "application/json", 3)
	if err != nil {
		slog.Warn("ecommerce agent text failed", "taskId", taskID, "model", cfg.TextModel, "latencyMs", time.Since(start).Milliseconds(), "error", err)
		return err
	}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Total int `json:"total_tokens"`
		} `json:"usage"`
		Model string `json:"model"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return err
	}
	if len(response.Choices) == 0 {
		return errors.New("文本模型未返回内容")
	}
	slog.Info("ecommerce agent text", "taskId", taskID, "model", response.Model, "tokens", response.Usage.Total, "latencyMs", time.Since(start).Milliseconds())
	return ecommerceParseJSON(response.Choices[0].Message.Content, out)
}

func ecommerceImage(ctx context.Context, cfg ecommerceProviderConfig, taskID, prompt, ratio, mime string, reference []byte, estimatedCostMicrocredits int64) ([]byte, string, error) {
	size, err := ecommerceImageSize(cfg, ratio)
	if err != nil {
		return nil, "", err
	}
	// Image edits carry the actual uploaded product pixels. A generations request
	// cannot satisfy the product-identity requirement because it has no image input.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", cfg.ImageModel)
	_ = writer.WriteField("prompt", prompt)
	_ = writer.WriteField("size", size)
	_ = writer.WriteField("n", "1")
	ext := "png"
	if mime == "image/jpeg" {
		ext = "jpg"
	}
	if mime == "image/webp" {
		ext = "webp"
	}
	part, err := writer.CreateFormFile("image", "product."+ext)
	if err != nil {
		return nil, "", err
	}
	if _, err = part.Write(reference); err != nil {
		return nil, "", err
	}
	if err = writer.Close(); err != nil {
		return nil, "", err
	}
	start := time.Now()
	// Image submissions are never replayed after an ambiguous network failure.
	// The upstream may have charged even when its response was lost.
	var data []byte
	var response struct {
		Data []struct {
			URL string `json:"url"`
			B64 string `json:"b64_json"`
		} `json:"data"`
		Usage struct {
			Total int `json:"total_tokens"`
		} `json:"usage"`
	}
	if cfg.ImageProvider != nil {
		provider := *cfg.ImageProvider
		provider.Model = cfg.ImageModel
		callCtx, cancel := context.WithTimeout(ctx, cfg.ImageTimeout)
		defer cancel()
		err = postForm(callCtx, provider, "/images/edits", writer.FormDataContentType(), bytes.NewReader(body.Bytes()), &response)
	} else {
		data, _, err = ecommerceRequest(ctx, cfg.ImageBaseURL+"/images/edits", cfg.ImageKey, cfg.ImageTimeout, body.Bytes(), writer.FormDataContentType(), 1)
	}
	if err != nil {
		slog.Warn("ecommerce agent image failed", "taskId", taskID, "model", cfg.ImageModel, "latencyMs", time.Since(start).Milliseconds(), "error", err)
		return nil, "", err
	}
	if cfg.ImageProvider == nil {
		if err := json.Unmarshal(data, &response); err != nil {
			return nil, "", err
		}
	}
	if len(response.Data) == 0 {
		return nil, "", errors.New("图像模型未返回图片")
	}
	slog.Info("ecommerce agent image", "taskId", taskID, "model", cfg.ImageModel, "tokens", response.Usage.Total, "latencyMs", time.Since(start).Milliseconds(), "estimatedCostMicrocredits", estimatedCostMicrocredits)
	if response.Data[0].B64 != "" {
		raw, err := base64.StdEncoding.DecodeString(response.Data[0].B64)
		return raw, "", err
	}
	if response.Data[0].URL != "" {
		return nil, response.Data[0].URL, nil
	}
	return nil, "", errors.New("图像模型未返回图片")
}

func ecommerceImageSize(cfg ecommerceProviderConfig, ratio string) (string, error) {
	if cfg.ImageProvider != nil && cfg.ImageProvider.CapabilityConfig != nil && cfg.ImageProvider.CapabilityConfig.Image != nil {
		image := cfg.ImageProvider.CapabilityConfig.Image
		if len(image.Size.Presets) > 0 {
			tier := imagePresetDefaultTier(image)
			preset, ok := declaredImageSizePreset(activeImageSizePresets(image), ratio, tier, tier)
			if !ok || preset.Size == "" {
				return "", ecommerceErr("INVALID_INPUT", "图像模型不支持所选画幅")
			}
			return preset.Size, nil
		}
	}
	size := map[string]string{"1:1": "1024x1024", "3:4": "1024x1536", "4:3": "1536x1024", "9:16": "1024x1536", "16:9": "1536x1024"}[ratio]
	if size == "" {
		size = "1024x1024"
	}
	return size, nil
}

func ecommerceImagePrompt(page ecommerceagent.Page, p ecommerceagent.Platform, brand ecommerceagent.Brand, brief ecommerceagent.Brief, selected *ecommerceagent.Recommendation) string {
	parts := []string{brief.Category, "same product as reference image, identical shape, proportion, color and logo placement, no redesign, no added accessories", page.Title}
	if page.ImagePrompt != "" {
		parts = append(parts, page.ImagePrompt)
	}
	parts = append(parts, ecommerceagent.HumanPhotographyKnowledge)
	if selected != nil {
		parts = append(parts, selected.Style, selected.PreviewPrompt)
	}
	if page.Role == "hero" && p.WhiteBG {
		parts = append(parts, fmt.Sprintf("pure white seamless background #FFFFFF, product occupies at least %.0f%% of frame, no text, no watermark, no border, no badge, even studio lighting", p.ProductOccupancy*100))
	}
	parts = append(parts, "aspect ratio "+page.AspectRatio, "commercial product photography, ultra sharp, high detail, 2K, color accurate, no distortion", "no text, no watermark, no invented product features")
	if page.NegativePrompt != "" {
		parts = append(parts, "Negative prompt: "+page.NegativePrompt)
	}
	if brand.StyleDesc != "" {
		parts = append(parts, "brand visual tone: "+brand.StyleDesc)
	}
	if brand.ThemeColors != "" {
		parts = append(parts, "brand palette: "+brand.ThemeColors)
	}
	kind := "secondary"
	if page.Role == "hero" {
		kind = "main"
	}
	parts = append(parts, ecommerceagent.PlatformKnowledgePrompt(p.Label, "", kind, ""))
	return strings.Join(parts, ", ")
}
