package app

import (
	"encoding/json"
	"testing"
)

func TestPaginationJSONUsesPageSizeCamelCase(t *testing.T) {
	payloads := []any{
		SkillList{TotalCount: 3, HasMore: true, NextOffset: 20, Page: 1, PageSize: 20},
		AdminUserPage{Total: 1, Page: 1, Limit: 20},
		WalletSummary{Total: 1, Page: 1, Limit: 30},
		APICallLogPage{Total: 1, Page: 1, Limit: 50},
	}
	for _, payload := range payloads {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		var object map[string]json.RawMessage
		if err := json.Unmarshal(body, &object); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"page_size", "total_count", "has_more", "next_offset", "limit"} {
			if _, found := object[key]; found {
				t.Fatalf("%T still encodes %s: %s", payload, key, body)
			}
		}
		if _, found := object["pageSize"]; !found {
			t.Fatalf("%T missing pageSize: %s", payload, body)
		}
	}
}
