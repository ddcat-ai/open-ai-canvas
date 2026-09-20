package assets

import "encoding/json"

func DocumentAssetIDs(raw string) (map[string]struct{}, error) {
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	ids := map[string]struct{}{}
	var visit func(any)
	visit = func(value any) {
		switch item := value.(type) {
		case map[string]any:
			for key, child := range item {
				if key == "assetId" {
					if id, ok := child.(string); ok && id != "" {
						ids[id] = struct{}{}
					}
				} else {
					visit(child)
				}
			}
		case []any:
			for _, child := range item {
				visit(child)
			}
		}
	}
	visit(value)
	return ids, nil
}
