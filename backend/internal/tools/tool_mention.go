package tools

import (
	"regexp"
	"strconv"
	"strings"
)

// toolMentionPattern 匹配 @[tool:ID:label] 令牌，提取工具 ID 和标签。
var toolMentionPattern = regexp.MustCompile(`@\[tool:(\d+):[^\]]+\]`)

// ResolveToolMentionTokens 将 prompt 中的 @[tool:ID:label] 令牌替换为对应工具的提示词文本。
// 未找到对应工具的令牌保持不变。
func (s *Service) ResolveToolMentionTokens(prompt string) (string, error) {
	matches := toolMentionPattern.FindAllStringSubmatchIndex(prompt, -1)
	if len(matches) == 0 {
		return prompt, nil
	}

	// 收集去重的工具 ID
	toolIDs := make(map[int]struct{})
	for _, match := range matches {
		idStr := prompt[match[2]:match[3]]
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			continue
		}
		toolIDs[int(id)] = struct{}{}
	}

	// 批量获取工具提示词
	promptByToolID := make(map[int]string)
	for id := range toolIDs {
		tool, err := s.repo.ToolByID(int64(id))
		if err != nil {
			continue
		}
		if strings.TrimSpace(tool.Prompt) != "" {
			promptByToolID[id] = tool.Prompt
		}
	}

	// 替换令牌
	result := toolMentionPattern.ReplaceAllStringFunc(prompt, func(token string) string {
		subs := toolMentionPattern.FindStringSubmatch(token)
		if len(subs) < 2 {
			return token
		}
		id, err := strconv.Atoi(subs[1])
		if err != nil {
			return token
		}
		if toolPrompt, ok := promptByToolID[id]; ok {
			return toolPrompt
		}
		return token
	})

	return result, nil
}
