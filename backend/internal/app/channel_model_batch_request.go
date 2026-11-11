package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// BatchChannelModelUpdate exposes only the fields supported by the bulk editor.
type BatchChannelModelUpdate struct {
	ModelID           string                   `json:"modelId"`
	PriceVersion      int64                    `json:"priceVersion"`
	CapabilityVersion int64                    `json:"capabilityVersion"`
	UpdatedAt         string                   `json:"updatedAt"`
	Changes           BatchChannelModelChanges `json:"changes"`
}

type BatchChannelModelChanges struct {
	Capability         *string                       `json:"capability,omitempty"`
	Protocol           *string                       `json:"protocol,omitempty"`
	DisplayName        *string                       `json:"displayName,omitempty"`
	Description        *string                       `json:"description,omitempty"`
	Enabled            *bool                         `json:"enabled,omitempty"`
	PricingEnabled     *bool                         `json:"pricingEnabled,omitempty"`
	CapabilityTemplate *BatchModelCapabilityTemplate `json:"capabilityTemplate,omitempty"`
	PricingTemplate    *BatchModelPricingTemplate    `json:"pricingTemplate,omitempty"`
}

type BatchModelCapabilityTemplate struct {
	// Legacy clients may still send protocol; only changes.protocol can select it.
	Protocol         string                 `json:"protocol,omitempty"`
	CapabilityConfig *ModelCapabilityConfig `json:"capabilityConfig"`
}

type BatchModelPricingTemplate struct {
	PriceCurrency         string                         `json:"priceCurrency"`
	ReferenceVideoBilling bool                           `json:"referenceVideoBilling"`
	PriceTiers            []ChannelModelPriceTierRequest `json:"priceTiers"`
	// Presence is retained only for decoded JSON: a missing amount is not free.
	tierFields []map[string]json.RawMessage
}

func decodeBatchObject(data []byte, target any, required ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("批量修改需要 JSON 对象")
	}
	for key, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, fmt.Errorf("字段 %s 不能为 null", key)
		}
	}
	for _, key := range required {
		if _, ok := fields[key]; !ok {
			return nil, fmt.Errorf("缺少字段 %s", key)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("请求只能包含一个 JSON 对象")
	}
	return fields, nil
}

func (r *BatchChannelModelUpdate) UnmarshalJSON(data []byte) error {
	type plain BatchChannelModelUpdate
	_, err := decodeBatchObject(data, (*plain)(r), "modelId", "priceVersion", "capabilityVersion", "updatedAt", "changes")
	return err
}

func (r *BatchChannelModelChanges) UnmarshalJSON(data []byte) error {
	type plain BatchChannelModelChanges
	_, err := decodeBatchObject(data, (*plain)(r))
	return err
}

func (r *BatchModelCapabilityTemplate) UnmarshalJSON(data []byte) error {
	type plain BatchModelCapabilityTemplate
	fields, err := decodeBatchObject(data, (*plain)(r), "capabilityConfig")
	if err != nil {
		return err
	}
	return rejectBatchScalarNull(fields["capabilityConfig"], reflect.TypeOf(ModelCapabilityConfig{}))
}

// Capability configs legitimately encode absent optional arrays/objects as
// null, but null must never silently become a numeric/boolean zero value.
func rejectBatchScalarNull(data json.RawMessage, kind reflect.Type) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		switch kind.Kind() {
		case reflect.Pointer, reflect.Slice, reflect.Map, reflect.Interface:
			return nil
		default:
			return fmt.Errorf("能力参数的标量字段不能为 null")
		}
	}
	if kind.Kind() == reflect.Pointer {
		return rejectBatchScalarNull(data, kind.Elem())
	}
	switch kind.Kind() {
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		for i := 0; i < kind.NumField(); i++ {
			field := kind.Field(i)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if raw, ok := fields[name]; ok {
				if err := rejectBatchScalarNull(raw, field.Type); err != nil {
					return err
				}
			}
		}
	case reflect.Slice:
		var values []json.RawMessage
		if err := json.Unmarshal(data, &values); err != nil {
			return err
		}
		for _, value := range values {
			if err := rejectBatchScalarNull(value, kind.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		for _, value := range fields {
			if err := rejectBatchScalarNull(value, kind.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *BatchModelPricingTemplate) UnmarshalJSON(data []byte) error {
	var values any
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	if err := rejectBatchPricingNull(values); err != nil {
		return err
	}
	type plain BatchModelPricingTemplate
	fields, err := decodeBatchObject(data, (*plain)(r), "priceCurrency", "referenceVideoBilling", "priceTiers")
	if err != nil {
		return err
	}
	var tiers []json.RawMessage
	if err := json.Unmarshal(fields["priceTiers"], &tiers); err != nil {
		return err
	}
	r.tierFields = make([]map[string]json.RawMessage, len(tiers))
	for i, data := range tiers {
		var tier ChannelModelPriceTierRequest
		fields, err := decodeBatchObject(data, &tier, "billingMode", "priceConfigured", "enabled")
		if err != nil {
			return fmt.Errorf("价格档 %d：%w", i+1, err)
		}
		r.tierFields[i] = fields
	}
	return nil
}

func rejectBatchPricingNull(value any) error {
	switch value := value.(type) {
	case nil:
		return fmt.Errorf("积分模板字段不能为 null，空金额不等于免费")
	case map[string]any:
		for _, child := range value {
			if err := rejectBatchPricingNull(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range value {
			if err := rejectBatchPricingNull(child); err != nil {
				return err
			}
		}
	}
	return nil
}
