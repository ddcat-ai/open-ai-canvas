package app

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

var ecommerceSkillLink = regexp.MustCompile("\\]\\(<?([^\\r\\n)]+)>?\\)|`([^`\\r\\n]+\\.(?:md|markdown|txt))`")

func ecommerceSkillReferences(from, body string, files map[string]bool) []string {
	var result []string
	for _, match := range ecommerceSkillLink.FindAllStringSubmatch(body, -1) {
		raw := strings.Trim(strings.TrimSpace(match[1]+match[2]), "<>")
		if strings.Contains(raw, ":") || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "\\") {
			continue
		}
		raw = strings.SplitN(strings.SplitN(raw, "#", 2)[0], "?", 2)[0]
		raw = strings.Trim(strings.SplitN(raw, " \"", 2)[0], "<>")
		ext := strings.ToLower(path.Ext(raw))
		if ext != ".md" && ext != ".markdown" && ext != ".txt" {
			continue
		}
		resolved := path.Clean(path.Join(path.Dir(from), strings.ReplaceAll(raw, "\\", "/")))
		if resolved == ".." || strings.HasPrefix(resolved, "../") {
			continue
		}
		// Inline code often names a proposed output such as `analysis.md`.
		// Only actual package members are inputs; explicit broken links still fail.
		if match[2] != "" && !files[resolved] {
			continue
		}
		result = append(result, resolved)
	}
	return result
}

// Read only packaged text references. Skills provide creative methods, never executable tools.
func (s *Service) ecommerceSkillContext(userID, id string, entry *SkillPackageFileContent) (string, error) {
	if entry.Binary || strings.TrimSpace(entry.Content) == "" {
		return "", BadAuthRequest("技能缺少可读取的 SKILL.md")
	}
	queue := []string{"SKILL.md"}
	listing, err := s.SkillPackageFiles(userID, id)
	if err != nil {
		return "", err
	}
	files := make(map[string]bool, len(listing))
	for _, file := range listing {
		files[file.Path] = true
	}
	seen := map[string]bool{"SKILL.md": true}
	parts := []string{}
	total := 0
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		file := entry
		if name != "SKILL.md" {
			var err error
			file, err = s.SkillPackageFile(userID, id, name)
			if err != nil {
				return "", BadAuthRequest("Skill 引用的文本无法读取：" + name + "，请检查技能包")
			}
		}
		if file.Binary {
			return "", BadAuthRequest("Skill 引用必须为文本：" + name)
		}
		body := strings.TrimSpace(file.Content)
		total += len(body)
		if total > 32000 {
			return "", BadAuthRequest("Skill 及引用正文超过策划上下文上限，请精简技能包")
		}
		parts = append(parts, fmt.Sprintf("文件 %s：\n%s", name, body))
		for _, ref := range ecommerceSkillReferences(name, body, files) {
			if seen[ref] {
				continue
			}
			if len(seen) >= 12 {
				return "", BadAuthRequest("Skill 引用超过 12 个文本文件，请精简策划方法")
			}
			seen[ref] = true
			queue = append(queue, ref)
		}
	}
	return strings.Join(parts, "\n\n"), nil
}
