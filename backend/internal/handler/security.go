package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

var (
	runtimeService            *service.Service
	geminiGeneratePath        = regexp.MustCompile(`^/models/([^/:]+):(generateContent|streamGenerateContent)$`)
	customGeminiRelayPath     = regexp.MustCompile(`(?:^|/)models/[^/:]+:(generateContent|streamGenerateContent|predictLongRunning)$`)
	customVideoTaskPath       = regexp.MustCompile(`(?:^|/)video/generations/[^/]+$`)
	customXAIVideoTaskPath    = regexp.MustCompile(`(?:^|/)videos/[^/]+$`)
	customVideoContentPath    = regexp.MustCompile(`(?:^|/)videos/[^/]+/content$`)
	customArkVideoTaskPath    = regexp.MustCompile(`(?:^|/)contents/generations/tasks/[^/]+$`)
	customGeminiOperationPath = regexp.MustCompile(`(?:^|/)(?:models/[^/]+/)?operations/[^/]+$`)
	openAIPostEndpoints       = map[string]bool{
		"/responses": true, "/chat/completions": true, "/images/generations": true, "/images/edits": true,
		"/audio/speech": true,
	}
)

func ConfigureRuntime(svc *service.Service) {
	runtimeService = svc
}

func authorizeCustomRelay(method string, target *url.URL, apiFormat string, contentType string) error {
	requestPath, err := normalizedCustomRelayPath(target.EscapedPath())
	if err != nil {
		return err
	}
	query, err := url.ParseQuery(target.RawQuery)
	if err != nil {
		return errors.New("自定义渠道查询参数无效")
	}
	for key := range query {
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "key", "api_key", "access_token", "token":
			return errors.New("自定义渠道地址不允许在查询参数中携带密钥")
		}
	}

	apiFormat = strings.ToLower(strings.TrimSpace(apiFormat))
	if apiFormat != "openai" && apiFormat != "gemini" {
		return errors.New("自定义渠道调用格式无效")
	}
	if method == http.MethodGet {
		allowed := requestPath == "/models" || strings.HasSuffix(requestPath, "/models")
		if apiFormat == "openai" {
			allowed = allowed || customVideoTaskPath.MatchString(requestPath) || customXAIVideoTaskPath.MatchString(requestPath) || customVideoContentPath.MatchString(requestPath) || customArkVideoTaskPath.MatchString(requestPath)
		} else {
			allowed = allowed || customGeminiOperationPath.MatchString(requestPath)
		}
		if len(query) != 0 || !allowed {
			return errors.New("自定义渠道不允许访问该上游接口")
		}
		return nil
	}
	if method != http.MethodPost {
		return errors.New("自定义渠道不允许使用该请求方法")
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return errors.New("自定义渠道生成请求类型无效")
	}
	if apiFormat == "openai" {
		multipartAllowed := mediaType == "multipart/form-data" && (strings.HasSuffix(requestPath, "/images/edits") || strings.HasSuffix(requestPath, "/videos"))
		jsonAllowed := mediaType == "application/json" && (strings.HasSuffix(requestPath, "/responses") || strings.HasSuffix(requestPath, "/chat/completions") || strings.HasSuffix(requestPath, "/images/generations") || strings.HasSuffix(requestPath, "/audio/speech") || strings.HasSuffix(requestPath, "/video/generations") || strings.HasSuffix(requestPath, "/videos/generations") || strings.HasSuffix(requestPath, "/videos") || strings.HasSuffix(requestPath, "/contents/generations/tasks"))
		if len(query) != 0 || (!multipartAllowed && !jsonAllowed) {
			return errors.New("自定义渠道不允许访问该上游接口")
		}
		return nil
	}
	if mediaType != "application/json" {
		return errors.New("Gemini 自定义渠道生成请求必须使用 application/json")
	}
	if !customGeminiRelayPath.MatchString(requestPath) {
		return errors.New("自定义渠道不允许访问该上游接口")
	}
	if len(query) == 0 {
		return nil
	}
	if len(query) == 1 && len(query["alt"]) == 1 && query.Get("alt") == "sse" && strings.HasSuffix(requestPath, ":streamGenerateContent") {
		return nil
	}
	return errors.New("自定义渠道不允许使用该查询参数")
}

func normalizedCustomRelayPath(value string) (string, error) {
	if len(value) > 2048 {
		return "", errors.New("自定义渠道请求路径过长")
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || strings.Contains(decoded, "\\") || strings.Contains(decoded, "\x00") {
		return "", errors.New("自定义渠道请求路径无效")
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(decoded, "/"))
	if cleaned != decoded && cleaned != "/"+strings.TrimPrefix(decoded, "/") {
		return "", errors.New("自定义渠道请求路径无效")
	}
	return cleaned, nil
}

func enforceRateLimit(c *gin.Context, key string, limit int, window time.Duration) bool {
	if runtimeService == nil {
		fail(c, http.StatusServiceUnavailable, errors.New("请求协调器尚未初始化"))
		return false
	}
	allowed, err := runtimeService.AllowRequest(c.Request.Context(), key, limit, window)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, errors.New("请求协调服务暂时不可用"))
		return false
	}
	if allowed {
		return true
	}
	c.Header("Retry-After", "60")
	fail(c, http.StatusTooManyRequests, errors.New("请求过于频繁，请稍后再试"))
	return false
}

func loadRuntimePolicy(c *gin.Context, svc *service.Service) (service.RuntimePolicySetting, bool) {
	policy, err := svc.RuntimePolicy()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, errors.New("读取运行时策略失败："+err.Error()))
		return service.RuntimePolicySetting{}, false
	}
	return policy, true
}

func authorizeSystemProxy(channel *model.ModelChannel, protocol model.ChannelInterfaceType, method string, requestPath string, contentType string, body []byte) error {
	requestPath, err := normalizedProxyPath(requestPath)
	if err != nil {
		return err
	}
	if method == http.MethodGet && requestPath == "/models" {
		return nil
	}
	if protocol == model.ChannelInterfaceGeminiVeo {
		matches := geminiGeneratePath.FindStringSubmatch(requestPath)
		if method != http.MethodPost || len(matches) != 3 {
			return errors.New("系统渠道不允许访问该上游接口")
		}
		modelName, err := url.PathUnescape(matches[1])
		if err != nil || !channelAllowsModel(channel, modelName) {
			return errors.New("当前系统渠道未授权该模型")
		}
		return nil
	}
	if method != http.MethodPost || !openAIPostEndpoints[requestPath] {
		return errors.New("系统渠道不允许访问该上游接口")
	}
	if protocol != "" && !interfaceAllowsProxyPath(protocol, requestPath) {
		return errors.New("当前接口类型不允许访问该上游接口")
	}
	modelName := proxyRequestModel(contentType, body)
	if modelName == "" || !channelAllowsModel(channel, modelName) {
		return errors.New("当前系统渠道未授权该模型")
	}
	return nil
}

func interfaceAllowsProxyPath(interfaceType model.ChannelInterfaceType, requestPath string) bool {
	switch interfaceType {
	case model.ChannelInterfaceChatCompletion:
		return requestPath == "/chat/completions"
	case model.ChannelInterfaceOpenAIResponse:
		return requestPath == "/responses"
	case model.ChannelInterfaceOpenAIImage:
		return requestPath == "/images/generations" || requestPath == "/images/edits"
	case model.ChannelInterfaceVolcengineArkImage:
		return requestPath == "/images/generations"
	case model.ChannelInterfaceOpenAIAudio:
		return requestPath == "/audio/speech"
	case model.ChannelInterfaceAsyncAudio, model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo, model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineJiMengImage, model.ChannelInterfaceVolcengineJiMengVideo, model.ChannelInterfaceGeminiVeo:
		return false
	default:
		return true
	}
}

func normalizedProxyPath(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil || strings.Contains(decoded, "\\") || strings.Contains(decoded, "\x00") {
		return "", errors.New("系统渠道请求路径无效")
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(decoded, "/"))
	if cleaned != decoded && cleaned != "/"+strings.TrimPrefix(decoded, "/") {
		return "", errors.New("系统渠道请求路径无效")
	}
	return cleaned, nil
}

func channelAllowsModel(channel *model.ModelChannel, requested string) bool {
	requested = strings.TrimPrefix(strings.TrimSpace(requested), "models/")
	var models []string
	_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	for _, configured := range models {
		if strings.TrimPrefix(strings.TrimSpace(configured), "models/") == requested {
			return true
		}
	}
	return false
}

func proxyRequestModel(contentType string, body []byte) string {
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if strings.HasPrefix(mediaType, "multipart/") {
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				return ""
			}
			if part.FormName() == "model" {
				value, _ := io.ReadAll(io.LimitReader(part, 1024))
				return strings.TrimSpace(string(value))
			}
			_ = part.Close()
		}
	}
	var payload map[string]interface{}
	if json.Unmarshal(body, &payload) != nil {
		return ""
	}
	modelName, _ := payload["model"].(string)
	return strings.TrimSpace(modelName)
}

func proxyRequestModelForPath(requestPath string, contentType string, body []byte) string {
	if matches := geminiGeneratePath.FindStringSubmatch(requestPath); len(matches) == 3 {
		modelName, err := url.PathUnescape(matches[1])
		if err == nil {
			return strings.TrimPrefix(strings.TrimSpace(modelName), "models/")
		}
	}
	return proxyRequestModel(contentType, body)
}

func proxyRequestVideoSeconds(contentType string, body []byte) int64 {
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if strings.HasPrefix(mediaType, "multipart/") {
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				return 0
			}
			if part.FormName() == "seconds" || part.FormName() == "duration" {
				value, _ := io.ReadAll(io.LimitReader(part, 32))
				seconds, _ := strconv.ParseInt(strings.TrimSpace(string(value)), 10, 64)
				return seconds
			}
			_ = part.Close()
		}
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return 0
	}
	for _, key := range []string{"seconds", "duration"} {
		value, exists := payload[key]
		if !exists {
			continue
		}
		seconds, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return seconds
	}
	return 0
}
