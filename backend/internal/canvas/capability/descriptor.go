package capability

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

const (
	patchKindString  = "string"
	patchKindNumber  = "number"
	patchKindBoolean = "boolean"
)

type ConnectionPolicy struct {
	CanSource          bool
	CanTarget          bool
	CanReference       bool
	AcceptedInputKinds []string
	RejectedInputKinds []string
	MaxInputCount      int
}

type PatchField struct {
	Path        string
	Kind        string
	Label       string
	Order       int
	Description string
	MaxRunes    int
}

// Descriptor is the server-owned canvas contract. Agent tools, creation,
// persistence and state projection all consume this registry; no caller owns a
// second node allow-list.
type Descriptor struct {
	Type            string
	Version         string
	Label           string
	Purpose         string
	GoodFor         []string
	NotIdealFor     []string
	Tradeoffs       []string
	Actions         []string
	DefaultWidth    float64
	DefaultHeight   float64
	InputKind       string
	GenerationMode  string
	Connection      ConnectionPolicy
	CanUpdate       bool
	SummaryFields   []string
	DetailFields    []string
	ProjectionKind  string
	ProjectionField string
	PatchFields     map[string]PatchField
	CreateMetadata  func(content string) map[string]any
}

func (d Descriptor) Metadata(content string) map[string]any {
	if d.CreateMetadata != nil {
		return d.CreateMetadata(content)
	}
	return map[string]any{"content": content, "status": "idle"}
}

func (d Descriptor) AllowsInput(kind string) bool {
	if !d.Connection.CanTarget {
		return false
	}
	kind = normalizeType(kind)
	for _, rejected := range d.Connection.RejectedInputKinds {
		if rejected == kind {
			return false
		}
	}
	if len(d.Connection.AcceptedInputKinds) == 0 {
		return true
	}
	for _, accepted := range d.Connection.AcceptedInputKinds {
		if accepted == kind {
			return true
		}
	}
	return false
}

func (d Descriptor) ValidatePatch(patch map[string]any) error {
	if !d.CanUpdate {
		return fmt.Errorf("%s 节点不支持更新", d.Label)
	}
	if len(patch) == 0 {
		return fmt.Errorf("%s 节点更新内容不能为空", d.Label)
	}
	for key, value := range patch {
		field, allowed := d.PatchFields[key]
		if !allowed {
			return fmt.Errorf("%s 节点不支持更新字段 %s", d.Label, key)
		}
		switch field.Kind {
		case "string":
			text, ok := value.(string)
			if !ok {
				return fmt.Errorf("%s 字段 %s 必须是字符串", d.Label, key)
			}
			if field.MaxRunes > 0 && len([]rune(text)) > field.MaxRunes {
				return fmt.Errorf("%s 字段 %s 超出长度限制", d.Label, key)
			}
		case "number":
			if _, ok := value.(float64); !ok {
				return fmt.Errorf("%s 字段 %s 必须是数字", d.Label, key)
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("%s 字段 %s 必须是布尔值", d.Label, key)
			}
		default:
			return fmt.Errorf("%s 字段 %s 的类型契约无效", d.Label, key)
		}
	}
	return nil
}

func (d Descriptor) ApplyPatch(node map[string]any, patch map[string]any) error {
	if err := d.ValidatePatch(patch); err != nil {
		return err
	}
	for key, value := range patch {
		field := d.PatchFields[key]
		parts := strings.Split(field.Path, ".")
		target := node
		for _, part := range parts[:len(parts)-1] {
			child, ok := target[part].(map[string]any)
			if !ok {
				child = map[string]any{}
				target[part] = child
			}
			target = child
		}
		target[parts[len(parts)-1]] = value
	}
	return nil
}

func (d Descriptor) ValidateConnection(fromKind string) error {
	if !d.Connection.CanTarget {
		return fmt.Errorf("%s 节点不能接收参考输入", d.Label)
	}
	if !d.AllowsInput(fromKind) {
		return fmt.Errorf("%s生成节点不接受%s输入", d.Label, inputKindLabel(fromKind))
	}
	return nil
}

func inputKindLabel(kind string) string {
	switch kind {
	case "image":
		return "图片"
	case "video":
		return "视频"
	case "audio":
		return "音频"
	default:
		return "文本"
	}
}

func normalizeType(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func normalizeInputKind(value string) (string, error) {
	return normalizeCapabilityIdentifier(value, "canvas input kind")
}

func normalizeGenerationMode(value string) (string, error) {
	return normalizeCapabilityIdentifier(value, "canvas generation mode")
}

func normalizeProjectionKind(value string) (string, error) {
	return normalizeCapabilityIdentifier(value, "canvas projection kind")
}

func normalizeCapabilityIdentifier(value, label string) (string, error) {
	value = normalizeType(value)
	if value == "" {
		return "", nil
	}
	for index, r := range value {
		if index == 0 {
			if r < 'a' || r > 'z' {
				return "", fmt.Errorf("invalid %s %q", label, value)
			}
			continue
		}
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return "", fmt.Errorf("invalid %s %q", label, value)
		}
	}
	return value, nil
}

func normalizeConnectionKinds(values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		kind, err := normalizeInputKind(value)
		if err != nil {
			return nil, err
		}
		if kind == "" {
			return nil, fmt.Errorf("canvas connection input kind cannot be empty")
		}
		if _, exists := seen[kind]; exists {
			return nil, fmt.Errorf("duplicate canvas connection input kind %q", kind)
		}
		seen[kind] = struct{}{}
		out = append(out, kind)
	}
	sort.Strings(out)
	return out, nil
}

func validatePatchPath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("canvas patch field path cannot be empty")
	}
	for _, segment := range strings.Split(path, ".") {
		if segment == "" || segment == "." || segment == ".." || segment == "__proto__" || segment == "constructor" || segment == "prototype" {
			return fmt.Errorf("invalid canvas patch field path %q", path)
		}
		for index, r := range segment {
			if index == 0 {
				if r != '_' && !unicode.IsLetter(r) {
					return fmt.Errorf("invalid canvas patch field path %q", path)
				}
				continue
			}
			if r != '_' && r != '-' && !unicode.IsLetter(r) && !unicode.IsDigit(r) {
				return fmt.Errorf("invalid canvas patch field path %q", path)
			}
		}
	}
	return nil
}

func normalizePatchFields(fields map[string]PatchField) (map[string]PatchField, error) {
	out := make(map[string]PatchField, len(fields))
	for key, field := range fields {
		key = strings.TrimSpace(key)
		if key == "" {
			return nil, fmt.Errorf("canvas patch field key cannot be empty")
		}
		if _, exists := out[key]; exists {
			return nil, fmt.Errorf("duplicate canvas patch field %q", key)
		}
		field.Path = strings.TrimSpace(field.Path)
		if err := validatePatchPath(field.Path); err != nil {
			return nil, err
		}
		field.Kind = normalizeType(field.Kind)
		field.Label = strings.TrimSpace(field.Label)
		field.Description = strings.TrimSpace(field.Description)
		if field.Label == "" {
			return nil, fmt.Errorf("canvas patch field %q requires a user-facing label", key)
		}
		if field.Order <= 0 {
			return nil, fmt.Errorf("canvas patch field %q requires a positive display order", key)
		}
		switch field.Kind {
		case patchKindString, patchKindNumber, patchKindBoolean:
		default:
			return nil, fmt.Errorf("unsupported canvas patch field kind %q", field.Kind)
		}
		if field.MaxRunes < 0 {
			return nil, fmt.Errorf("canvas patch field %q has invalid max runes", key)
		}
		out[key] = field
	}
	return out, nil
}
