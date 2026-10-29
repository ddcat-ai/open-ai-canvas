package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"testing"

	agenttool "yingce/backend/internal/agent/tool"
)

func TestCloudAgentToolTableMatchesRuntimeDispatch(t *testing.T) {
	registry := cloudAgentRegistry()
	names := registry.Names()
	sortedNames := append([]string(nil), names...)
	sort.Strings(sortedNames)
	if !reflect.DeepEqual(sortedNames, agenttool.Names()) {
		t.Fatalf("schema/executor/policy registry mismatch: %v != %v", sortedNames, agenttool.Names())
	}
	for _, name := range names {
		binding, exists := registry.Lookup(name)
		if !exists || !json.Valid(binding.Definition.Parameters) {
			t.Fatalf("missing execution definition for %s", name)
		}
		h := binding.Handler
		p := agenttool.Of(name)
		switch {
		case p.Media():
			if h.Pipeline != cloudAgentToolMedia {
				t.Errorf("%s must use media approval pipeline", name)
			}
		case p.Vision:
			if h.Pipeline != cloudAgentToolVision {
				t.Errorf("%s must use vision pipeline", name)
			}
		case p.Write():
			if h.Write == nil || h.Preview == nil {
				t.Errorf("%s requires both execution and approval preview", name)
			}
		default:
			if h.Read == nil {
				t.Errorf("%s has no direct handler", name)
			}
		}
	}
}

func TestCloudAgentAdvertisedToolsMatchAuthorization(t *testing.T) {
	for _, permission := range []string{"read_only", "request_approval", "auto"} {
		for _, canvas := range []bool{false, true} {
			for _, skills := range []bool{false, true} {
				for _, vision := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/canvas=%t/skills=%t/vision=%t", permission, canvas, skills, vision), func(t *testing.T) {
						req := CloudAgentRequest{PermissionMode: permission, VisionEnabled: vision}
						if canvas {
							req.ContextScope = []string{"canvas"}
						}
						if skills {
							req.SkillsEnabled = true
							req.MemoryMode = "auto"
						}
						advertised := map[string]bool{}
						for _, definition := range cloudAgentTools(req) {
							function := definition["function"].(map[string]any)
							advertised[function["name"].(string)] = true
						}
						for _, name := range append(CloudAgentSupportedToolNames(), "unknown_tool") {
							if cloudAgentToolAllowed(req, name) != advertised[name] {
								t.Errorf("%s advertisement differs from execution authorization", name)
							}
						}
					})
				}
			}
		}
	}
}
