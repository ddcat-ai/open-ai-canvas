package protocol

import "strings"

// TextWire 是宿主认识的三家文字请求/事件形状。
//
// 插件不声明 wire：宿主只看插件已经声明的 create 请求地址，地址形状决定请求体字段名、
// SSE 事件解析方式和流式用量字段。内置协议（chat-completion / openai-response /
// claude-api）的协议 ID 与 wire 同名，仍按协议 ID 直接映射。
type TextWire string

const (
	TextWireUnknown        TextWire = ""
	TextWireChatCompletion TextWire = "chat-completion"
	TextWireResponses      TextWire = "responses"
	TextWireClaudeAPI      TextWire = "claude-api"
)

// TextWireForCreatePath 从插件声明的 create 请求地址推出文字格式：
// 以 /chat/completions 结尾是 chat 格式，/responses 是 responses 格式，/messages 是 claude 格式。
// 其它地址（Gemini generateContent、Cohere /v2/chat、Ollama /api/chat 等）返回空，
// 表示宿主不认识该请求形状，继续由插件自己的请求映射与响应映射解析。
//
// 入参既可以是裸地址（"/v1/chat/completions"），也可以是带方法前缀的操作摘要
// （"POST /v1/chat/completions"），因为 Metadata.Create 保存的是后者。
func TextWireForCreatePath(create string) TextWire {
	path := strings.TrimSpace(create)
	if path == "" {
		return TextWireUnknown
	}
	if index := strings.IndexAny(path, " \t"); index >= 0 {
		// 去掉 "POST " 之类的方法前缀；地址本身不会包含空格。
		path = strings.TrimSpace(path[index+1:])
	}
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	path = strings.TrimRight(strings.ToLower(path), "/")
	switch {
	case strings.HasSuffix(path, "/chat/completions"):
		return TextWireChatCompletion
	case strings.HasSuffix(path, "/responses"):
		return TextWireResponses
	case strings.HasSuffix(path, "/messages"):
		return TextWireClaudeAPI
	default:
		return TextWireUnknown
	}
}

// TextOutputLimitField 返回该格式用于声明输出上限的请求字段名。
func TextOutputLimitField(wire TextWire) string {
	if wire == TextWireResponses {
		return "max_output_tokens"
	}
	return "max_tokens"
}

// TextWireRequiresChatStreamUsage 表示该格式用 stream_options.include_usage 索取流式用量。
func TextWireRequiresChatStreamUsage(wire TextWire) bool {
	return wire == TextWireChatCompletion
}
