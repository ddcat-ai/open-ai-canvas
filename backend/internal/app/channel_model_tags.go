package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

func normalizeChannelModelTags(input []model.ChannelModelTag) ([]model.ChannelModelTag, error) {
	if len(input) > 5 {
		return nil, BadAuthRequest("每个模型最多配置 5 个标签")
	}
	tags := make([]model.ChannelModelTag, 0, len(input))
	seen := make(map[string]bool)
	for _, tag := range input {
		tag.Text = strings.TrimSpace(tag.Text)
		if len([]rune(tag.Text)) == 0 || len([]rune(tag.Text)) > 12 {
			return nil, BadAuthRequest("标签文字须为 1–12 字")
		}
		if seen[tag.Text] {
			return nil, BadAuthRequest("标签文字不能重复")
		}
		switch tag.Color {
		case "purple", "blue", "green", "gold", "orange", "pink":
		default:
			return nil, BadAuthRequest("请选择有效的标签颜色")
		}
		seen[tag.Text] = true
		tags = append(tags, tag)
	}
	return tags, nil
}
