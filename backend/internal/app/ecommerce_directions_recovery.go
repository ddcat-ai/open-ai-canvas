package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/ecommerceagent"
)

// Preserve only fully decoded observations. An unfinished string, partial
// object, or absent brief is never completed by guessing product facts.
func ecommerceRecoverDirections(raw string, draft EcommerceDraft) (ecommerceagent.Analysis, bool) {
	var result ecommerceagent.Analysis
	start := strings.Index(raw, "{")
	if start < 0 {
		return result, false
	}
	decoder := json.NewDecoder(strings.NewReader(raw[start:]))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return result, false
	}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		name, ok := token.(string)
		if !ok {
			break
		}
		if name == "recommendations" || name == "directions" {
			if token, err = decoder.Token(); err != nil || token != json.Delim('[') {
				break
			}
			for decoder.More() {
				var value json.RawMessage
				if decoder.Decode(&value) != nil {
					break
				}
				var rec ecommerceagent.Recommendation
				if ecommerceParseJSON(string(value), &rec) == nil && ecommerceagent.CompleteStyleRecommendation(rec) {
					result.Recommendations = append(result.Recommendations, rec)
				}
			}
			if _, err = decoder.Token(); err != nil {
				break
			}
		} else {
			var value json.RawMessage
			if decoder.Decode(&value) != nil {
				break
			}
			if name == "brief" {
				_ = ecommerceParseJSON(string(value), &result.Brief)
			}
		}
	}
	return ecommerceCompleteDirections(result, draft)
}

func ecommerceCompleteDirections(result ecommerceagent.Analysis, draft EcommerceDraft) (ecommerceagent.Analysis, bool) {
	category := strings.TrimSpace(result.Brief.Category)
	if category == "" || category == "未知" || category == "非商品图" {
		return result, false
	}
	if len(result.Recommendations) > 4 {
		result.Recommendations = result.Recommendations[:4]
	}
	seen := map[string]bool{}
	for _, rec := range result.Recommendations {
		seen[rec.Label] = true
	}
	for _, preset := range ecommerceagent.ProductStyleLibrary(category) {
		if len(result.Recommendations) == 4 {
			break
		}
		rec := preset.Recommendation()
		if seen[rec.Label] {
			continue
		}
		seen[rec.Label] = true
		rec.Pages = draft.Count
		rec.AspectRatio = draft.Ratio
		result.Recommendations = append(result.Recommendations, rec)
	}
	return result, len(result.Recommendations) == 4
}
