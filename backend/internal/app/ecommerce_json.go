package app

import (
	"encoding/json"
	"errors"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

var (
	ecommerceListSeparators = regexp.MustCompile(`[、，,；;\n]+`)
)

// ecommerceParseJSON decodes model output into out without failing on the type
// drift fast models produce: numbers or booleans written as strings, a list
// written as one sentence, a sentence written as a list, a wrapper object
// around the expected array, Markdown fences and trailing commas. Only text
// that is not JSON at all is rejected.
func ecommerceParseJSON(raw string, out any) error {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)
	candidates := []string{raw}
	if start, end := strings.IndexAny(raw, "{["), strings.LastIndexAny(raw, "}]"); start >= 0 && end > start {
		candidates = append(candidates, raw[start:end+1])
	}
	for _, candidate := range candidates {
		for _, text := range []string{candidate, ecommerceRepairJSONSyntax(candidate)} {
			var value any
			if json.Unmarshal([]byte(text), &value) != nil {
				continue
			}
			target := reflect.ValueOf(out)
			if target.Kind() != reflect.Pointer || target.IsNil() {
				return errors.New("解析目标无效")
			}
			ecommerceCoerce(target.Elem(), value)
			return nil
		}
	}
	return errors.New("模型返回不是合法 JSON")
}

// Repair only unambiguous syntax errors without changing text inside strings.
// Do not complete truncated structures or guess at unescaped quotes.
func ecommerceRepairJSONSyntax(raw string) string {
	const hex = "0123456789abcdef"
	var result strings.Builder
	result.Grow(len(raw))
	inString, escaped := false, false
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if inString {
			if escaped {
				result.WriteByte(c)
				escaped = false
				continue
			}
			if c == '\\' {
				result.WriteByte(c)
				escaped = true
				continue
			}
			if c == '"' {
				inString = false
			} else if c < 0x20 {
				result.WriteString(`\u00`)
				result.WriteByte(hex[c>>4])
				result.WriteByte(hex[c&15])
				continue
			}
		} else {
			if c == '"' {
				inString = true
			} else if c == ',' {
				j := i + 1
				for j < len(raw) && (raw[j] == ' ' || raw[j] == '\n' || raw[j] == '\r' || raw[j] == '\t') {
					j++
				}
				if j < len(raw) && (raw[j] == '}' || raw[j] == ']') {
					continue
				}
			}
		}
		result.WriteByte(c)
	}
	return result.String()
}

// The directions model can omit the closing brace of the last recommendation
// immediately before the final ]}. Only repair that exact terminal shape;
// all earlier structural errors and unfinished strings remain failures.
func ecommerceRepairDirectionsTerminalObject(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	stack := make([]byte, 0, 8)
	inString, escaped := false, false
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if inString {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, c)
		case '}', ']':
			if len(stack) == 0 {
				return "", false
			}
			open := stack[len(stack)-1]
			if (open == '{' && c == '}') || (open == '[' && c == ']') {
				stack = stack[:len(stack)-1]
				continue
			}
			if c == ']' && len(stack) == 3 && string(stack) == "{[{" && strings.TrimSpace(raw[i:]) == "]}" {
				candidate := raw[:i] + "}" + raw[i:]
				if json.Valid([]byte(candidate)) {
					return candidate, true
				}
			}
			return "", false
		}
	}
	return "", false
}

var jsonUnmarshalerType = reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()

// ecommerceCoerce assigns src into dst, converting compatible shapes and
// leaving the field at its zero value when no sensible conversion exists.
func ecommerceCoerce(dst reflect.Value, src any) {
	if src == nil || !dst.CanSet() {
		return
	}
	if dst.Kind() != reflect.Pointer && dst.CanAddr() && dst.Addr().Type().Implements(jsonUnmarshalerType) {
		if raw, err := json.Marshal(src); err == nil {
			_ = dst.Addr().Interface().(json.Unmarshaler).UnmarshalJSON(raw)
		}
		return
	}
	switch dst.Kind() {
	case reflect.Pointer:
		next := reflect.New(dst.Type().Elem())
		ecommerceCoerce(next.Elem(), src)
		dst.Set(next)
	case reflect.Interface:
		if value := reflect.ValueOf(src); value.Type().AssignableTo(dst.Type()) {
			dst.Set(value)
		}
	case reflect.String:
		dst.SetString(ecommerceText(src))
	case reflect.Bool:
		switch v := src.(type) {
		case bool:
			dst.SetBool(v)
		case float64:
			dst.SetBool(v != 0)
		case string:
			parsed, err := strconv.ParseBool(strings.TrimSpace(v))
			dst.SetBool(err == nil && parsed || strings.TrimSpace(v) == "是")
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if number, ok := ecommerceNumber(src); ok {
			dst.SetInt(int64(number))
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if number, ok := ecommerceNumber(src); ok && number >= 0 {
			dst.SetUint(uint64(number))
		}
	case reflect.Float32, reflect.Float64:
		if number, ok := ecommerceNumber(src); ok {
			dst.SetFloat(number)
		}
	case reflect.Slice:
		items, ok := src.([]any)
		if !ok {
			if object, isObject := src.(map[string]any); isObject && dst.Type().Elem().Kind() != reflect.Struct {
				items = ecommerceOnlyArray(object)
			} else if object, isObject := src.(map[string]any); isObject {
				if wrapped := ecommerceOnlyArray(object); wrapped != nil {
					items = wrapped
				} else {
					items = []any{object}
				}
			} else if text, isText := src.(string); isText && dst.Type().Elem().Kind() == reflect.String {
				for _, part := range ecommerceListSeparators.Split(text, -1) {
					if part = strings.TrimSpace(part); part != "" {
						items = append(items, part)
					}
				}
			} else {
				items = []any{src}
			}
		}
		slice := reflect.MakeSlice(dst.Type(), 0, len(items))
		for _, item := range items {
			element := reflect.New(dst.Type().Elem()).Elem()
			ecommerceCoerce(element, item)
			slice = reflect.Append(slice, element)
		}
		dst.Set(slice)
	case reflect.Map:
		object, ok := src.(map[string]any)
		if !ok || dst.Type().Key().Kind() != reflect.String {
			return
		}
		result := reflect.MakeMapWithSize(dst.Type(), len(object))
		for key, item := range object {
			element := reflect.New(dst.Type().Elem()).Elem()
			ecommerceCoerce(element, item)
			result.SetMapIndex(reflect.ValueOf(key).Convert(dst.Type().Key()), element)
		}
		dst.Set(result)
	case reflect.Struct:
		object, ok := src.(map[string]any)
		if !ok {
			return
		}
		ecommerceCoerceStruct(dst, object)
	}
}

func ecommerceCoerceStruct(dst reflect.Value, object map[string]any) {
	lower := make(map[string]string, len(object))
	for key := range object {
		lower[strings.ToLower(key)] = key
	}
	used := map[string]bool{}
	var emptyLists []reflect.Value
	for i := 0; i < dst.NumField(); i++ {
		field := dst.Type().Field(i)
		if !field.IsExported() {
			continue
		}
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name == "-" {
			continue
		}
		if field.Anonymous && name == "" && field.Type.Kind() == reflect.Struct {
			ecommerceCoerceStruct(dst.Field(i), object)
			continue
		}
		if name == "" {
			name = field.Name
		}
		key, found := name, false
		if _, found = object[name]; !found {
			key, found = lower[strings.ToLower(name)]
		}
		if !found {
			if field.Type.Kind() == reflect.Slice && field.Type.Elem().Kind() == reflect.Struct {
				emptyLists = append(emptyLists, dst.Field(i))
			}
			continue
		}
		used[key] = true
		ecommerceCoerce(dst.Field(i), object[key])
	}
	// A model that renamed the one list it was asked for ("directions" instead of
	// "recommendations") still delivered it; give the single unclaimed list to
	// the first missing list field, which is the primary one by declaration order.
	if len(emptyLists) > 0 {
		var candidate []any
		count := 0
		for key, value := range object {
			if items, ok := value.([]any); ok && !used[key] && len(items) > 0 {
				if _, isObject := items[0].(map[string]any); isObject {
					candidate, count = items, count+1
				}
			}
		}
		if count == 1 {
			ecommerceCoerce(emptyLists[0], candidate)
		}
	}
}

// ecommerceOnlyArray returns the single array inside a wrapper object such as
// {"recommendations":[...]}; nil when there is not exactly one.
func ecommerceOnlyArray(object map[string]any) []any {
	var found []any
	count := 0
	for _, value := range object {
		if items, ok := value.([]any); ok {
			found, count = items, count+1
		}
	}
	if count == 1 {
		return found
	}
	return nil
}

func ecommerceText(src any) string {
	switch v := src.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if text := strings.TrimSpace(ecommerceText(item)); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "、")
	case map[string]any:
		raw, _ := json.Marshal(v)
		return string(raw)
	}
	return ""
}

func ecommerceNumber(src any) (float64, bool) {
	switch v := src.(type) {
	case float64:
		return v, true
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	case string:
		text := strings.TrimSuffix(strings.TrimSpace(v), "%")
		number, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		if strings.HasSuffix(strings.TrimSpace(v), "%") {
			number /= 100
		}
		return number, true
	}
	return 0, false
}

// ecommerceLogExcerpt keeps a valid UTF-8 prefix of model output for logs.
func ecommerceLogExcerpt(text string, limit int) string {
	text = strings.ToValidUTF8(text, "")
	runes := []rune(text)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
