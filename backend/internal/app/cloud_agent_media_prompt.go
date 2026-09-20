package app

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var cloudAgentMediaMention = regexp.MustCompile(`@(图片|视频|音频)[0-9]+`)

// Slot labels follow each media array's order, matching the canvas editor and
// provider inputs. Text source edges do not consume a media slot.
func cloudAgentMediaReferencePrompt(prompt string, refs map[string]any) (string, error) {
	type reference struct{ token, title string }
	references := []reference{}
	available := map[string]bool{}
	for _, kind := range []struct{ field, label string }{
		{"referenceImages", "图片"}, {"referenceVideos", "视频"}, {"referenceAudios", "音频"},
	} {
		for index, ref := range creationMaps(refs[kind.field]) {
			token := fmt.Sprintf("@%s%d", kind.label, index+1)
			available[token] = true
			// Transient annotation images have no canvas node to render as a chip.
			if stringValue(ref["storageKey"]) == "" {
				continue
			}
			title := strings.Join(strings.Fields(stringValue(ref["name"])), " ")
			title = strings.ReplaceAll(title, "@", "＠")
			if title == "" {
				title = kind.label + "参考"
			}
			references = append(references, reference{token, title})
		}
	}
	mentioned := map[string]bool{}
	for _, token := range cloudAgentMediaMention.FindAllString(prompt, -1) {
		if !available[token] {
			return "", BadAuthRequest(fmt.Sprintf("提示词中的 %s 没有对应的参考素材；请按 referenceNodeIds 中各媒体类型的顺序修正引用", token))
		}
		mentioned[token] = true
	}
	missing := []string{}
	for _, ref := range references {
		if !mentioned[ref.token] {
			missing = append(missing, ref.title+"："+ref.token)
		}
	}
	if len(missing) > 0 {
		prompt += "\n\n【资产参考】\n" + strings.Join(missing, "\n")
	}
	if count := utf8.RuneCountInString(prompt); count > 16000 {
		return "", BadAuthRequest(fmt.Sprintf("补齐素材引用后的提示词共%d字符，超过16000字符上限；请缩短提示词后重试，不会自动截断", count))
	}
	return prompt, nil
}
