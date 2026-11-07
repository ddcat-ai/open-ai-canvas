package production

import (
	"encoding/json"
	"strings"
)

type bibleJSONToken struct {
	raw   string
	value string
}

// repairBibleJSON 只恢复作品圣经中可确定的分隔符错误。先完整分词，再校验整份结果，
// 不截取合法前缀、不补全截断内容，也不让重复字段静默覆盖已有角色或设定。
func repairBibleJSON(raw string) (string, bool) {
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return "", false
	}
	tokens, ok := tokenizeBibleJSON(raw[start : end+1])
	if !ok {
		return "", false
	}
	type frame struct {
		open byte
		name string
	}
	var stack []frame
	var result strings.Builder
	changed := false
	for i, token := range tokens {
		text := token.raw
		// 实际模型输出会把 description 的末尾与 appearance 字段名粘在同一个字符串里。
		// 只在本应结束字符串值、却紧跟冒号的非法位置拆开这两个已知字段。
		if i >= 2 && i+1 < len(tokens) && tokens[i-2].value == "description" && tokens[i-1].raw == ":" && tokens[i+1].raw == ":" && strings.HasSuffix(text, `appearance"`) {
			at := len(text) - len(`appearance"`)
			if at > 1 {
				text = text[:at] + `","` + text[at:]
				changed = true
			}
		}
		switch token.raw {
		case "{", "[":
			name := ""
			if i >= 2 && tokens[i-1].raw == ":" {
				name = tokens[i-2].value
			}
			stack = append(stack, frame{open: token.raw[0], name: name})
			if len(stack) > 64 {
				return "", false
			}
		case "}", "]":
			if len(stack) == 0 {
				return "", false
			}
			top := stack[len(stack)-1]
			if (top.open == '{' && token.raw != "}") || (top.open == '[' && token.raw != "]") {
				return "", false
			}
			// [{...}],"name":...}] 是提前结束数组并漏掉下一项的左花括号。
			// 仅在已知的具名资产列表中恢复为 [{...},{"name":...}]。
			if token.raw == "]" && isBibleAssetArray(top.name) && i > 0 && tokens[i-1].raw == "}" && i+3 < len(tokens) && tokens[i+1].raw == "," && tokens[i+2].value == "name" && tokens[i+3].raw == ":" {
				text = ""
				tokens[i+1].raw = ",{" // 左括号已计入栈，下一轮只写出。
				stack = append(stack, frame{open: '{'})
				changed = true
			} else {
				stack = stack[:len(stack)-1]
			}
		case ",":
			if i+1 < len(tokens) && (tokens[i+1].raw == "}" || tokens[i+1].raw == "]") {
				text = ""
				changed = true
			}
		}
		result.WriteString(text)
	}
	candidate := result.String()
	if !changed || len(stack) != 0 || !json.Valid([]byte(candidate)) || !bibleJSONHasUniqueKeys(json.NewDecoder(strings.NewReader(candidate)), 0) {
		return "", false
	}
	return candidate, true
}

func isBibleAssetArray(name string) bool {
	return name == "characters" || name == "props" || name == "scenes" || name == "looks"
}

func tokenizeBibleJSON(raw string) ([]bibleJSONToken, bool) {
	tokens := []bibleJSONToken{}
	for i := 0; i < len(raw); {
		if strings.ContainsRune(" \t\r\n", rune(raw[i])) {
			i++
			continue
		}
		start := i
		if strings.ContainsRune("{}[],:", rune(raw[i])) {
			i++
			tokens = append(tokens, bibleJSONToken{raw: raw[start:i]})
			continue
		}
		if raw[i] == '"' {
			i++
			closed := false
			for i < len(raw) {
				c := raw[i]
				i++
				if c == '\\' {
					i++
				} else if c == '"' {
					closed = true
					break
				}
			}
			if !closed || i > len(raw) {
				return nil, false
			}
			var value string
			if json.Unmarshal([]byte(raw[start:i]), &value) != nil {
				return nil, false
			}
			tokens = append(tokens, bibleJSONToken{raw: raw[start:i], value: value})
			continue
		}
		for i < len(raw) && !strings.ContainsRune(" \t\r\n{}[],:\"", rune(raw[i])) {
			i++
		}
		if i == start || !json.Valid([]byte(raw[start:i])) {
			return nil, false
		}
		tokens = append(tokens, bibleJSONToken{raw: raw[start:i]})
	}
	return tokens, true
}

func bibleJSONHasUniqueKeys(decoder *json.Decoder, depth int) bool {
	if depth > 64 {
		return false
	}
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	delim, container := token.(json.Delim)
	if !container {
		return true
	}
	seen := map[string]bool{}
	for decoder.More() {
		if delim == '{' {
			key, err := decoder.Token()
			name, ok := key.(string)
			if err != nil || !ok || seen[name] {
				return false
			}
			seen[name] = true
		}
		if !bibleJSONHasUniqueKeys(decoder, depth+1) {
			return false
		}
	}
	_, err = decoder.Token()
	return err == nil
}
