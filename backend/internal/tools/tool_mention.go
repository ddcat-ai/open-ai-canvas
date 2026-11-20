package tools

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

var toolMentionPattern = regexp.MustCompile(`@\[tool:(style|motion|nine_grid|effect):(\d+):[^:\]]+:[^\]]+\]`)

// ResolveToolMentionTokens validates every tool before expanding it. Labels and
// icons are presentation only; neither grants access to a private tool.
func (s *Service) ResolveToolMentionTokens(userID, mode, prompt string) (string, error) {
	if !strings.Contains(prompt, "@[tool:") {
		return prompt, nil
	}
	if strings.TrimSpace(userID) == "" {
		return "", kernel.Unauthorized("请先登录")
	}
	if strings.Contains(toolMentionPattern.ReplaceAllString(prompt, ""), "@[tool:") {
		return "", kernel.BadAuthRequest("工具标签无效，请重新选择工具")
	}
	prompts := make(map[string]string)
	for _, match := range toolMentionPattern.FindAllStringSubmatch(prompt, -1) {
		if _, ok := prompts[match[0]]; ok {
			continue
		}
		id, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || id <= 0 {
			return "", kernel.BadAuthRequest("工具 ID 无效")
		}
		tool, err := s.repo.ToolForUser(userID, id)
		if err != nil {
			tool, err = s.resolveLegacyBuiltinTool(userID, match[1], id, err)
		}
		if err != nil {
			return "", err
		}
		if !tool.Enabled || tool.Type != match[1] {
			return "", kernel.BadAuthRequest("工具已停用或类型不匹配")
		}
		imageTool := tool.Type == ToolTypeStyle || tool.Type == ToolTypeNineGrid
		if (imageTool && mode != "image") || (!imageTool && mode != "video") {
			return "", kernel.BadAuthRequest("工具不适用于当前生成类型")
		}
		if strings.TrimSpace(tool.Prompt) == "" || strings.Contains(tool.Prompt, "@[tool:") {
			return "", kernel.BadAuthRequest("工具提示词为空或包含嵌套工具标签")
		}
		prompts[match[0]] = tool.Prompt
	}
	return toolMentionPattern.ReplaceAllStringFunc(prompt, func(token string) string { return prompts[token] }), nil
}

// resolveLegacyBuiltinTool 处理旧版本内置故事板写进提示词的旧编号：只有该编号确实是已停用的内置故事板时
// 才改用新编号，同编号的用户工具仍按原有可见性返回“不存在或不可见”。
func (s *Service) resolveLegacyBuiltinTool(userID, toolType string, id int64, lookupErr error) (model.Tool, error) {
	var appErr *kernel.AppError
	item, ok := legacyBuiltinTool(toolType, id)
	if !ok || !errors.As(lookupErr, &appErr) || appErr.Status != 404 {
		return model.Tool{}, lookupErr
	}
	legacy, err := s.repo.IsLegacyBuiltinTool(item)
	if err != nil {
		return model.Tool{}, err
	}
	if !legacy {
		return model.Tool{}, lookupErr
	}
	return s.repo.ToolForUser(userID, item.ReplacementID)
}
