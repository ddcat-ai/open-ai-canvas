package canvas

import (
	"encoding/json"
	"strings"
)

// mergeCanvasValue merges object fields, keeping arrays and scalar values
// atomic. Missing keys represent deletion. The callback records only actual
// conflicting leaves; target values remain in the automatic result.
func mergeCanvasValue(base, source, target json.RawMessage, path string, deep bool, conflict func(CanvasBranchConflict)) json.RawMessage {
	if rawEqual(base, source) {
		return cloneRaw(target)
	}
	if rawEqual(base, target) || rawEqual(source, target) {
		return cloneRaw(source)
	}
	var b, s, t map[string]json.RawMessage
	object := func(raw json.RawMessage, dst *map[string]json.RawMessage) bool {
		if len(raw) == 0 || string(raw) == "null" {
			*dst = map[string]json.RawMessage{}
			return true
		}
		return json.Unmarshal(raw, dst) == nil && *dst != nil
	}
	if deep && len(source) > 0 && string(source) != "null" && len(target) > 0 && string(target) != "null" && object(base, &b) && object(source, &s) && object(target, &t) {
		keys := map[string]bool{}
		for key := range b {
			keys[key] = true
		}
		for key := range s {
			keys[key] = true
		}
		for key := range t {
			keys[key] = true
		}
		for key := range keys {
			// Paths are consumed by browsers: keep ambiguous or prototype keys
			// inside an atomic object rather than traversing them.
			if strings.Contains(key, ".") || key == "__proto__" || key == "constructor" || key == "prototype" {
				goto atomic
			}
		}
		merged := cloneRawMap(t)
		for key := range keys {
			value := mergeCanvasValue(b[key], s[key], t[key], path+"."+key, true, conflict)
			if len(value) == 0 {
				delete(merged, key)
			} else {
				merged[key] = value
			}
		}
		value, _ := json.Marshal(merged)
		return value
	}
atomic:
	conflict(CanvasBranchConflict{Path: path, Label: path, Base: cloneRaw(base), Source: cloneRaw(source), Target: cloneRaw(target)})
	return cloneRaw(target)
}
