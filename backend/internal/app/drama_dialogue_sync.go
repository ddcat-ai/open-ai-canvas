package app

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// syncDramaDialogue only patches a uniquely quoted line. Free-form prose is never
// globally replaced: repeated dialogue or a manually rewritten line needs review.
func syncDramaDialogue(prompt, before, after string) (string, error) {
	if strings.TrimSpace(before) == "" {
		return "", fmt.Errorf("新增对白无法定位到原提示词中的台词位置")
	}
	if strings.Count(prompt, before) != 1 {
		return "", fmt.Errorf("原对白在提示词中缺失或出现多次，无法确定要修改哪一句")
	}
	for _, pair := range [][2]string{{"“", "”"}, {"「", "」"}, {"\"", "\""}, {"‘", "’"}} {
		quoted := pair[0] + before + pair[1]
		if strings.Contains(prompt, quoted) {
			replacement := pair[0] + after + pair[1]
			if strings.TrimSpace(after) == "" {
				replacement = "（无对白）"
			}
			return strings.Replace(prompt, quoted, replacement, 1), nil
		}
	}
	return "", fmt.Errorf("原对白不是独立引语，无法安全同步")
}

func dramaShotPromptEdit(segment model.DramaSegment, before model.DramaShot, fields map[string]any, sameDialogueCount, maxChars, headerChars int) map[string]any {
	result := map[string]any{"prompt_status": model.DramaPromptConflict}
	conflict := func(reason string) map[string]any {
		result["prompt_error"] = reason + "。分镜已保存，原提示词已保留；请核对并保存完整提示词，也可选择 AI 重新撰写。"
		return result
	}
	prompt := segment.VideoPromptOverride
	custom := strings.TrimSpace(prompt) != ""
	if !custom {
		prompt = segment.VideoPrompt
	}
	if strings.TrimSpace(prompt) == "" {
		return map[string]any{"prompt_status": "", "prompt_error": ""}
	}
	if segment.PromptStatus == model.DramaPromptConflict || segment.PromptStatus == model.DramaPromptReview {
		return conflict("还有未处理的分镜与提示词冲突")
	}
	if !custom && segment.PromptStatus != model.DramaMediaReady {
		return conflict("现有提示词尚未确认与分镜一致")
	}
	after, onlyDialogue := fields["dialogue"].(string)
	if !onlyDialogue || len(fields) != 1 {
		return conflict("人物、画面、时长或镜头结构发生变化，需要核对提示词")
	}
	if sameDialogueCount > 1 {
		return conflict("本段多个镜头使用相同台词，无法确定提示词中的对应位置")
	}
	next, err := syncDramaDialogue(prompt, before.Dialogue, after)
	if err != nil {
		return conflict(err.Error())
	}
	if utf8.RuneCountInString(next) > 12000 || (maxChars > 0 && utf8.RuneCountInString(next)+headerChars > maxChars) {
		return conflict("同步后的完整提示词超过所选模型字数上限，请精简或切换模型")
	}
	result["prompt_error"] = ""
	if custom {
		result["video_prompt_override"] = next
		// The untouched model draft may contain the old dialogue. Restoring it
		// must not silently bypass review after the custom version was synced.
		result["prompt_status"] = model.DramaMediaStale
	} else {
		result["video_prompt"] = next
		result["prompt_status"] = model.DramaMediaReady
	}
	return result
}
