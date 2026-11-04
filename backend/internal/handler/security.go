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

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

var (
	runtimeService             *service.Service
	geminiGeneratePath         = regexp.MustCompile(`^/models/([^/:]+):(generateContent|streamGenerateContent)$`)
	customGeminiRelayPath      = regexp.MustCompile(`(?:^|/)models/[^/:]+:(generateContent|streamGenerateContent|predictLongRunning)$`)
	customVideoTaskPath        = regexp.MustCompile(`(?:^|/)video/generations/[^/]+$`)
	customXAIVideoTaskPath     = regexp.MustCompile(`(?:^|/)videos/[^/]+$`)
	customVideoContentPath     = regexp.MustCompile(`(?:^|/)videos/[^/]+/content$`)
	customArkVideoTaskPath     = regexp.MustCompile(`(?:^|/)contents/generations/tasks/[^/]+$`)
	customGeminiOperationPath  = regexp.MustCompile(`(?:^|/)(?:models/[^/]+/)?operations/[^/]+$`)
	customNovitaTaskResultPath = regexp.MustCompile(`(?:^|/)async/task-result$`)
	customMiniMaxTaskPath      = regexp.MustCompile(`(?:^|/)v2/query/video_generation/[^/]+$`)
	systemMiniMaxTaskPath      = regexp.MustCompile(`^/v2/query/video_generation/[^/]+$`)
	openAIPostEndpoints        = map[string]bool{
		"/responses": true, "/chat/completions": true, "/images/generations": true, "/images/edits": true,
		"/audio/speech": true, "/messages": true,
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
	if apiFormat != "openai" && apiFormat != "gemini" && apiFormat != "claude" {
		return errors.New("自定义渠道调用格式无效")
	}
	if method == http.MethodGet {
		if apiFormat == "openai" && requestPath == "/agnesapi" {
			if len(query) == 2 && len(query["video_id"]) == 1 && len(query["model_name"]) == 1 && strings.TrimSpace(query.Get("video_id")) != "" && strings.TrimSpace(query.Get("model_name")) != "" {
				return nil
			}
			return errors.New("Agnes 视频查询必须提供 video_id 和 model_name")
		}
		if customNovitaTaskResultPath.MatchString(requestPath) {
			if len(query) == 1 && len(query["task_id"]) == 1 && strings.TrimSpace(query.Get("task_id")) != "" {
				return nil
			}
			return errors.New("自定义渠道不允许访问该上游接口")
		}
		allowed := requestPath == "/models" || strings.HasSuffix(requestPath, "/models")
		if apiFormat == "openai" {
			allowed = allowed || customVideoTaskPath.MatchString(requestPath) || customXAIVideoTaskPath.MatchString(requestPath) || customVideoContentPath.MatchString(requestPath) || customArkVideoTaskPath.MatchString(requestPath) || customMiniMaxTaskPath.MatchString(requestPath)
		} else if apiFormat == "gemini" {
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
		jsonAllowed := mediaType == "application/json" && (strings.HasSuffix(requestPath, "/responses") || strings.HasSuffix(requestPath, "/chat/completions") || strings.HasSuffix(requestPath, "/images/generations") || strings.HasSuffix(requestPath, "/images/edits") || strings.HasSuffix(requestPath, "/audio/speech") || strings.HasSuffix(requestPath, "/video/generations") || strings.HasSuffix(requestPath, "/videos/generations") || strings.HasSuffix(requestPath, "/videos") || strings.HasSuffix(requestPath, "/contents/generations/tasks") || strings.HasSuffix(requestPath, "/video/create") || strings.HasSuffix(requestPath, "/v2/video_generation"))
		if len(query) != 0 || (!multipartAllowed && !jsonAllowed) {
			return errors.New("自定义渠道不允许访问该上游接口")
		}
		return nil
	}
	if apiFormat == "claude" {
		if mediaType != "application/json" || !strings.HasSuffix(requestPath, "/messages") {
			return errors.New("Claude 自定义渠道只允许 application/json 的 /messages 请求")
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
	wait := runtimeService.RequestRetryAfter(c.Request.Context(), key, window)
	seconds := max(1, int((wait+time.Second-1)/time.Second))
	c.Header("Retry-After", strconv.Itoa(seconds))
	failService(c, service.RateLimited(fmt.Sprintf("请求次数已达上限，请在 %d 秒后重试", seconds)))
	return false
}

func loadRuntimePolicy(c *gin.Context, svc *service.Service) (service.RuntimePolicySetting, bool) {
	policy, err := svc.RuntimePolicy()
	if err != nil {
		failInternal(c, http.StatusServiceUnavailable, err)
		return service.RuntimePolicySetting{}, false
	}
	return policy, true
}

// 本函数里的 Agnes / MiniMax / Gemini 协议名分支是手写内置实现（未装插件时的路由）；
// 只有 isBuiltinProxyProtocol 不认识的协议（插件自定义协议等）才改走插件声明的
// create/poll/cancel/result 路径判定，内置协议的判定一行未改。
func authorizeSystemProxy(channel *model.ModelChannel, protocol model.ChannelInterfaceType, method string, requestPath string, contentType string, body []byte) error {
	requestPath, err := normalizedProxyPath(requestPath)
	if err != nil {
		return err
	}
	if method == http.MethodGet && requestPath == "/models" {
		return nil
	}
	if protocol == model.ChannelInterfaceAgnesVideo {
		if method == http.MethodGet && requestPath == "/agnesapi" {
			return nil
		}
		if method != http.MethodPost || requestPath != "/videos" {
			return errors.New("系统渠道不允许访问该上游接口")
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			return errors.New("Agnes 视频生成请求必须使用 application/json")
		}
		modelName := proxyRequestModel(contentType, body)
		if modelName == "" || !channelAllowsModel(channel, modelName) {
			return errors.New("当前系统渠道未授权该模型")
		}
		return nil
	}
	if protocol == model.ChannelInterfaceMiniMaxVideo {
		if method == http.MethodGet && systemMiniMaxTaskPath.MatchString(requestPath) {
			return nil
		}
		if method != http.MethodPost || requestPath != "/v2/video_generation" {
			return errors.New("系统渠道不允许访问该上游接口")
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			return errors.New("MiniMax 视频生成请求必须使用 application/json")
		}
		modelName := proxyRequestModel(contentType, body)
		if modelName == "" || !channelAllowsModel(channel, modelName) {
			return errors.New("当前系统渠道未授权该模型")
		}
		return nil
	}
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
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
	// 只有内置名单不认识的协议（插件自定义协议等）才改走插件声明。
	// 内置协议（包括官方插件复用内置协议 ID 的那些）一律保持下面的原逻辑。
	if protocol != "" && !isBuiltinProxyProtocol(protocol) && runtimeService != nil {
		if declared, create, matched := runtimeService.DeclaredProxyOperationMatch(string(protocol), method, requestPath); declared {
			return authorizeDeclaredProxyRequest(declared, create, matched, channel, method, contentType, body)
		}
	}
	// 以下是未装插件的内置协议：openAIPostEndpoints + 协议名白名单 + 模型授权，保持原样。
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

// builtinProxyPathRules 是内置协议在系统代理里的路径白名单，是这份名单的唯一定义处：
// interfaceAllowsProxyPath（是否放行某路径）与 isBuiltinProxyProtocol（是否属于内置实现）共用它。
// 规则为 nil 表示该协议在系统代理里一律不允许访问上游路径。
// 声明式插件协议不在这张表里，改由插件声明的 create/poll/cancel/result 判定。
var builtinProxyPathRules = map[model.ChannelInterfaceType]func(string) bool{
	model.ChannelInterfaceChatCompletion: func(p string) bool { return p == "/chat/completions" },
	model.ChannelInterfaceOpenAIResponse: func(p string) bool { return p == "/responses" },
	model.ChannelInterfaceClaudeAPI:      func(p string) bool { return p == "/messages" },
	model.ChannelInterfaceOpenAIImage:    func(p string) bool { return p == "/images/generations" || p == "/images/edits" },
	model.ChannelInterfaceGrokImage:      func(p string) bool { return p == "/images/generations" || p == "/images/edits" },
	model.ChannelInterfaceVolcengineArkImage: func(p string) bool {
		return p == "/images/generations"
	},
	model.ChannelInterfaceVolcengineArkAgentPlanImage: func(p string) bool { return p == "/images/generations" },
	model.ChannelInterfaceOpenAIAudio:                 func(p string) bool { return p == "/audio/speech" },
	model.ChannelInterfaceAsyncAudio:                  nil,
	model.ChannelInterfaceNewAPIVideo:                 nil,
	model.ChannelInterfaceNewAPIChannel1:              nil,
	model.ChannelInterfaceNewAPIChannel2:              nil,
	model.ChannelInterfaceXAIVideo:                    nil,
	model.ChannelInterfaceVolcengineArkVideo:          nil,
	model.ChannelInterfaceVolcengineArkAgentPlanVideo: nil,
	model.ChannelInterfaceVolcengineJiMengImage:       nil,
	model.ChannelInterfaceVolcengineJiMengVideo:       nil,
	model.ChannelInterfaceGeminiVeo:                   nil,
	model.ChannelInterfaceGeminiImage:                 nil,
	model.ChannelInterfaceNovitaVideo:                 nil,
	model.ChannelInterfaceMiniMaxVideo:                nil,
}

// authorDefaultProxyProtocols 是上面规则表之外、但仍由手写内置实现负责的协议：
// Agnes / MiniMax / Gemini Veo·Image 在 authorizeSystemProxy 里有独立分支，
// doubao-streaming-tts 与工作流协议走原来的 default:true（通用 OpenAI 端点）。
// 这些协议的系统代理行为必须与改动前完全一致，不能落到声明式分支。
var authorDefaultProxyProtocols = map[model.ChannelInterfaceType]struct{}{
	model.ChannelInterfaceAgnesVideo:         {},
	model.ChannelInterfaceMiniMaxVideo:       {},
	model.ChannelInterfaceGeminiVeo:          {},
	model.ChannelInterfaceGeminiImage:        {},
	model.ChannelInterfaceDoubaoStreamingTTS: {},
	model.ChannelInterfaceRunningHubImage:    {},
	model.ChannelInterfaceRunningHubVideo:    {},
	model.ChannelInterfaceRunningHubAudio:    {},
}

// isBuiltinProxyProtocol 判定该协议是否属于手写内置实现（名单与 builtinProxyPathRules 同源）。
// 内置协议的系统代理判定完全保持原逻辑；空协议返回 false，但调用方不走声明分支。
func isBuiltinProxyProtocol(protocol model.ChannelInterfaceType) bool {
	if _, ok := builtinProxyPathRules[protocol]; ok {
		return true
	}
	_, ok := authorDefaultProxyProtocols[protocol]
	return ok
}

// interfaceAllowsProxyPath 是未装插件时的内置实现：按内置协议名限制可访问的上游路径。
// 声明式插件已在上游按插件声明判定，这个协议名白名单只服务手写内置实现。
func interfaceAllowsProxyPath(interfaceType model.ChannelInterfaceType, requestPath string) bool {
	rule, ok := builtinProxyPathRules[interfaceType]
	if !ok {
		return true
	}
	if rule == nil {
		return false
	}
	return rule(requestPath)
}

// authorizeDeclaredProxyRequest 只按插件声明的路径放行请求。
// 非 create 操作只允许 GET：取消是 DELETE，但取消由后端任务内部发起，不走系统代理。
// 命中 create 的 POST 请求仍要校验请求体里的 model 已授权；命中 poll/cancel/result 的请求本身不带 model，
// 授权来自 SystemChannelDeclaredOperationProtocol（它只承认渠道里启用且使用该协议的模型）。
// 对内置名单之外的插件协议，POST 只放行声明的 create 路径（比原来可访问 6 个
// openAI 端点更严），并新增声明的 GET 轮询；内置协议的判定完全不变。
func authorizeDeclaredProxyRequest(declared bool, create bool, matched bool, channel *model.ModelChannel, method string, contentType string, body []byte) error {
	if !declared || !matched {
		return errors.New("当前接口类型不允许访问该上游接口")
	}
	if !create || method != http.MethodPost {
		if method != http.MethodGet {
			return errors.New("当前接口类型不允许访问该上游接口")
		}
		return nil
	}
	modelName := proxyRequestModel(contentType, body)
	if modelName == "" || !channelAllowsModel(channel, modelName) {
		return errors.New("当前系统渠道未授权该模型")
	}
	return nil
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
