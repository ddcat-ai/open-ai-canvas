package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestExternalModelSpecificationProjectsOnlyAcceptedParameters(t *testing.T) {
	for _, tc := range []struct {
		capability, config string
		want               []string
		limitation         bool
	}{
		{"text", `{"text":{"maxOutputTokens":200000}}`, []string{"thinking"}, false},
		{"image", `{"image":{"parameters":[{"name":"size","type":"string","values":["16:9"],"default":"16:9","binding":"aspectRatio"},{"name":"quality","type":"string","enabled":false},{"name":"secret","type":"string","binding":"providerSecret"},{"name":"count","type":"integer","min":1,"max":4,"default":1}]}}`, []string{"aspectRatio", "count"}, false},
		{"video", `{"video":{"references":{"minImages":1},"durationSupported":false,"ratios":["16:9"],"defaultRatio":"16:9","generateAudio":{"supported":true,"default":false}}}`, []string{"aspectRatio", "generateAudio"}, true},
		{"audio", `{}`, []string{"voice", "audioFormat", "audioSpeed"}, false},
	} {
		t.Run(tc.capability, func(t *testing.T) {
			var config map[string]any
			if err := json.Unmarshal([]byte(tc.config), &config); err != nil {
				t.Fatal(err)
			}
			item, err := externalModelSpecification("channel", PublicChannelModel{ModelKey: "model", Capability: tc.capability, CapabilityConfig: config})
			if err != nil {
				t.Fatal(err)
			}
			if len(item.Parameters) != len(tc.want) || (item.Limitation != "") != tc.limitation {
				t.Fatalf("unexpected specification: %+v", item)
			}
			for _, name := range tc.want {
				if _, ok := item.Parameters[name]; !ok {
					t.Fatalf("missing %s", name)
				}
			}
			if tc.capability == "text" && item.OutputTokenLimit != 200000 {
				t.Fatal("model output limit changed")
			}
			raw, _ := json.Marshal(item)
			if strings.Contains(string(raw), "binding") || strings.Contains(string(raw), "providerSecret") || strings.Contains(string(raw), `"minimum":null`) {
				t.Fatalf("internal or absent constraints leaked: %s", raw)
			}
			if tc.capability == "video" && !strings.Contains(string(raw), `"default":false`) {
				t.Fatal("false default lost")
			}
		})
	}
}
