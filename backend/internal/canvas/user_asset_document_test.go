package canvas

import (
	"encoding/json"
	"testing"
)

func TestUserAssetBytesRequiresNonNegativeNumber(t *testing.T) {
	for _, kind := range []string{"image", "video", "audio", "model"} {
		for _, raw := range []string{"null", " null ", `"12"`, "-1", "true", "{}", "[]", "1e400", "0", "12"} {
			t.Run(kind+"/"+raw, func(t *testing.T) {
				data := map[string]json.RawMessage{
					"dataUrl": json.RawMessage(`"https://example.com/file"`),
					"url":     json.RawMessage(`"https://example.com/file"`),
					"width":   json.RawMessage("1"), "height": json.RawMessage("1"),
					"mimeType": json.RawMessage(`"application/octet-stream"`),
					"fileName": json.RawMessage(`"file.glb"`),
					"bytes":    json.RawMessage(raw),
				}
				err := validateUserAssetData(kind, data)
				valid := raw == "0" || raw == "12"
				if (err == nil) != valid {
					t.Fatalf("bytes=%s: error=%v, want valid=%v", raw, err, valid)
				}
				delete(data, "bytes")
				if err := validateUserAssetData(kind, data); err == nil {
					t.Fatal("missing bytes accepted")
				}
			})
		}
	}
}
