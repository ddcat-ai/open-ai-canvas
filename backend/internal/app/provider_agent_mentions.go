package app

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var agentToolMentionPattern = regexp.MustCompile(`@\[tool:(\w+):(\d+):([^:\]]+):([^\]]+)\]`)

// readableAgentToolMentions 把发给模型的文本里 @[tool:type:ID:label:icon] 的标签从
// encodeURIComponent 形式还原成可读文字。部分 Claude 中转（Kiro）会把百分号编码的中文
// 标签误判为非法工具参数名并整单 400；令牌结构所需的 % : ] 以及 JSON 文本里的 " \ 仍保持转义，
// 还原后的令牌照样能被前后端解析。
func readableAgentToolMentions(text string) string {
	return agentToolMentionPattern.ReplaceAllStringFunc(text, func(token string) string {
		match := agentToolMentionPattern.FindStringSubmatch(token)
		label, err := url.PathUnescape(match[3])
		if err != nil {
			return token
		}
		var readable strings.Builder
		for _, r := range label {
			if r < 0x20 || strings.ContainsRune(`%:]"\`, r) {
				fmt.Fprintf(&readable, "%%%02X", r)
				continue
			}
			readable.WriteRune(r)
		}
		return fmt.Sprintf("@[tool:%s:%s:%s:%s]", match[1], match[2], readable.String(), match[4])
	})
}

func readableAgentMessages(messages []map[string]interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, len(messages))
	for index, message := range messages {
		copied := make(map[string]interface{}, len(message))
		for key, value := range message {
			copied[key] = value
		}
		switch content := message["content"].(type) {
		case string:
			copied["content"] = readableAgentToolMentions(content)
		case []interface{}:
			parts := make([]interface{}, len(content))
			for partIndex, value := range content {
				part, _ := value.(map[string]interface{})
				if stringField(part, "type") != "text" {
					parts[partIndex] = value
					continue
				}
				copiedPart := make(map[string]interface{}, len(part))
				for key, item := range part {
					copiedPart[key] = item
				}
				copiedPart["text"] = readableAgentToolMentions(stringField(part, "text"))
				parts[partIndex] = copiedPart
			}
			copied["content"] = parts
		}
		result[index] = copied
	}
	return result
}
