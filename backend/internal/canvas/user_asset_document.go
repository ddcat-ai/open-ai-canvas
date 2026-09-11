package canvas

import (
	"bytes"
	"encoding/json"
	"infinite-canvas/backend/internal/kernel"
	"math"
	"strings"
)

var userAssetKinds = map[string]struct{}{
	"text":   {},
	"image":  {},
	"video":  {},
	"audio":  {},
	"model":  {},
	"entity": {},
}

func validateUserAssetDocument(raw json.RawMessage) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return kernel.BadAuthRequest("素材数据格式错误")
	}
	kind, err := requiredJSONStringField(object, "kind")
	if err != nil {
		return err
	}
	kind = strings.TrimSpace(kind)
	if _, ok := userAssetKinds[kind]; !ok {
		return kernel.BadAuthRequest("不支持的素材类型")
	}
	if _, err := requiredJSONStringField(object, "title"); err != nil {
		return err
	}
	if _, err := requiredJSONStringField(object, "coverUrl"); err != nil {
		return err
	}
	if err := validateUserAssetTags(object); err != nil {
		return err
	}
	data, err := requiredJSONObjectField(object, "data")
	if err != nil {
		return err
	}
	return validateUserAssetData(kind, data)
}

func validateUserAssetTags(object map[string]json.RawMessage) error {
	raw, ok := object["tags"]
	if !ok {
		return kernel.BadAuthRequest("素材缺少 tags 字段")
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return kernel.BadAuthRequest("素材 tags 必须是字符串数组")
	}
	var tags []string
	if err := json.Unmarshal(raw, &tags); err != nil {
		return kernel.BadAuthRequest("素材 tags 必须是字符串数组")
	}
	return nil
}

func validateUserAssetData(kind string, data map[string]json.RawMessage) error {
	switch kind {
	case "text":
		_, err := requiredJSONStringField(data, "content")
		return err
	case "image":
		if err := requireMediaLocator(data, "dataUrl", "图片"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "width"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "height"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "video":
		if err := requireMediaLocator(data, "url", "视频"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "width"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "height"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "audio":
		if err := requireMediaLocator(data, "url", "音频"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "mimeType")
	case "model":
		if err := requireMediaLocator(data, "url", "模型"); err != nil {
			return err
		}
		if _, err := requiredJSONNumberField(data, "bytes"); err != nil {
			return err
		}
		if err := requireNonEmptyJSONString(data, "mimeType"); err != nil {
			return err
		}
		return requireNonEmptyJSONString(data, "fileName")
	case "entity":
		return requireJSONObjectFieldPresent(data, "definition")
	default:
		return kernel.BadAuthRequest("不支持的素材类型")
	}
}

func requireMediaLocator(data map[string]json.RawMessage, primaryKey string, label string) error {
	primary, err := optionalJSONStringField(data, primaryKey)
	if err != nil {
		return err
	}
	storageKey, err := optionalJSONStringField(data, "storageKey")
	if err != nil {
		return err
	}
	if strings.TrimSpace(primary) == "" && strings.TrimSpace(storageKey) == "" {
		return kernel.BadAuthRequest(label + "素材缺少 " + primaryKey + " 或 storageKey")
	}
	return nil
}

func requiredJSONStringField(object map[string]json.RawMessage, key string) (string, error) {
	raw, ok := object[key]
	if !ok {
		return "", kernel.BadAuthRequest("素材缺少 " + key + " 字段")
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", kernel.BadAuthRequest("素材字段 " + key + " 必须是字符串")
	}
	return value, nil
}

func optionalJSONStringField(object map[string]json.RawMessage, key string) (string, error) {
	raw, ok := object[key]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", kernel.BadAuthRequest("素材字段 " + key + " 必须是字符串")
	}
	return value, nil
}

func requireNonEmptyJSONString(object map[string]json.RawMessage, key string) error {
	value, err := requiredJSONStringField(object, key)
	if err != nil {
		return err
	}
	if strings.TrimSpace(value) == "" {
		return kernel.BadAuthRequest("素材字段 " + key + " 不能为空")
	}
	return nil
}

func requiredJSONNumberField(object map[string]json.RawMessage, key string) (float64, error) {
	raw, ok := object[key]
	if !ok {
		return 0, kernel.BadAuthRequest("素材缺少 " + key + " 字段")
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, kernel.BadAuthRequest("素材字段 " + key + " 必须是数字")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, kernel.BadAuthRequest("素材字段 " + key + " 必须是非负数字")
	}
	return value, nil
}

func requiredJSONObjectField(object map[string]json.RawMessage, key string) (map[string]json.RawMessage, error) {
	raw, ok := object[key]
	if !ok {
		return nil, kernel.BadAuthRequest("素材缺少 " + key + " 字段")
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(raw, &nested); err != nil || nested == nil {
		return nil, kernel.BadAuthRequest("素材字段 " + key + " 必须是对象")
	}
	return nested, nil
}

func requireJSONObjectFieldPresent(object map[string]json.RawMessage, key string) error {
	_, err := requiredJSONObjectField(object, key)
	return err
}
