package model

import (
	"encoding/json"
	"strings"
)

// CanonicalSKUSelector stores selector values as strings so an API number and its
// textual equivalent cannot create two price rows for the same purchasable SKU.
func CanonicalSKUSelector(raw map[string]string) (map[string]string, string, error) {
	selector := make(map[string]string, len(raw))
	for rawKey, rawValue := range raw {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" || value == "" {
			continue
		}
		selector[key] = value
	}
	encoded, err := json.Marshal(selector)
	if err != nil {
		return nil, "", err
	}
	return selector, string(encoded), nil
}

func DecodeSKUSelector(raw string) map[string]string {
	selector := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return selector
	}
	_ = json.Unmarshal([]byte(raw), &selector)
	return selector
}
