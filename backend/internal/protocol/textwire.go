package protocol

import "strings"

// 宿主自己能流式解析、能补思考参数/输出上限/工具选择/用量统计的文本线格式。
// 插件声明的 create 或 agent 路径以对应端点结尾时，就按这个格式处理；
// 其他路径（如 Cohere /v2/chat、Ollama /api/chat）仍完全按插件自己的请求和响应映射执行。
const (
	TextWireChatCompletion = "chat-completion"
	TextWireResponses      = "responses"
	TextWireClaude         = "claude-api"
)

// TextWireForPath 按声明路径的末段端点识别文本线格式，识别不出时返回空字符串。
// 路径里的 {{model}} 等模板变量和版本前缀不影响结果。
func TextWireForPath(path string) string {
	path = strings.ToLower(strings.TrimSpace(path))
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	path = strings.TrimRight(path, "/")
	switch {
	case strings.HasSuffix(path, "/chat/completions"):
		return TextWireChatCompletion
	case strings.HasSuffix(path, "/responses"):
		return TextWireResponses
	case strings.HasSuffix(path, "/messages"):
		return TextWireClaude
	default:
		return ""
	}
}

// TextWireForOperation 解析 "METHOD /path" 形式的操作摘要；文本请求只认 POST。
func TextWireForOperation(summary string) string {
	method, path, ok := strings.Cut(strings.TrimSpace(summary), " ")
	if !ok || !strings.EqualFold(strings.TrimSpace(method), "POST") {
		return ""
	}
	return TextWireForPath(path)
}

// OperationPath 返回操作摘要里的路径部分；摘要缺少方法或路径时返回空字符串。
func OperationPath(summary string) string {
	_, path, ok := strings.Cut(strings.TrimSpace(summary), " ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(path)
}

// AnthropicWireForBaseURL 判断一个文本上游的 Base URL 是否走 Anthropic Messages 线。
// 社区里 Anthropic 兼容端点有两种形态：原生 https://api.anthropic.com（打 /v1/messages），
// 和中转的 .../anthropic 前缀（如 DeepSeek https://api.deepseek.com/anthropic、部分网关的
// /claude 或 /anthropic/v1 路径）。OpenAI 系（api.openai.com、/v1、/openai 前缀）不受影响。
func AnthropicWireForBaseURL(baseURL string) bool {
	u := strings.ToLower(strings.TrimSpace(baseURL))
	if u == "" {
		return false
	}
	if strings.Contains(u, "api.anthropic.com") {
		return true
	}
	if strings.Contains(u, "/anthropic") || strings.Contains(u, "/claude") {
		return true
	}
	return false
}

func hasCapability(capabilities []Capability, capability Capability) bool {
	for _, item := range capabilities {
		if item == capability {
			return true
		}
	}
	return false
}
