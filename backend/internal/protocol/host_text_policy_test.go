package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func hostTextPolicyManifest(t *testing.T, policy string, capabilities []Capability) []byte {
	t.Helper()
	manifest := Manifest{
		APIVersion: "yingce.plugin/v1",
		Metadata:   Metadata{ID: "text-policy-test", Name: "Text policy test", Version: "1.0.0", Documentation: "# Test", Enabled: true},
		Contributes: ManifestContributions{Providers: []ManifestProvider{{
			ID: "text-policy-test", Label: "Test", Capabilities: capabilities, Scopes: []Surface{SurfaceAgent}, HostTextPolicy: policy,
			Create:          ManifestOperation{Method: "POST", Path: "/chat/completions"},
			Agent:           &ManifestOperation{Method: "POST", Path: "/chat/completions", Body: map[string]any{"model": map[string]any{"$ref": "bindings.selected"}}},
			AgentResponse:   &ManifestAgentResponse{TextPaths: []string{"choices.0.message.content"}},
			RequestBindings: []ManifestBinding{{Name: "selected", Value: map[string]any{"$ref": "request.model"}}},
			Validations:     []ManifestValidation{{Assert: map[string]any{"$eq": []any{map[string]any{"$ref": "bindings.selected"}, "allowed"}}, Message: "Unsupported model"}},
		}}},
	}
	body, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestHostTextPolicyValidationAndProjection(t *testing.T) {
	for _, tc := range []struct {
		name         string
		policy       string
		capabilities []Capability
		valid        bool
	}{
		{"legacy", "", []Capability{CapabilityText}, true},
		{"before-mapping", HostTextPolicyBeforeMapping, []Capability{CapabilityText}, true},
		{"unknown", "after_mapping", []Capability{CapabilityText}, false},
		{"image", HostTextPolicyBeforeMapping, []Capability{CapabilityImage}, false},
		{"mixed", HostTextPolicyBeforeMapping, []Capability{CapabilityText, CapabilityImage}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter, err := LoadManifest(hostTextPolicyManifest(t, tc.policy, tc.capabilities))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if err == nil && adapter.Metadata().HostTextPolicy != tc.policy {
				t.Fatal("hostTextPolicy was not projected into runtime metadata")
			}
		})
	}
}

func TestHostTextPolicyAgentSharesBindingsAndValidation(t *testing.T) {
	adapter, err := LoadManifest(hostTextPolicyManifest(t, HostTextPolicyBeforeMapping, []Capability{CapabilityText}))
	if err != nil {
		t.Fatal(err)
	}
	agent := adapter.(AgentAdapter)
	spec, err := agent.BuildAgent(context.Background(), AgentRequestContext{Model: "allowed"})
	if err != nil {
		t.Fatal(err)
	}
	if body, ok := spec.Body.(map[string]any); !ok || body["model"] != "allowed" {
		t.Fatalf("Agent bindings not evaluated: %#v", spec.Body)
	}
	if _, err := agent.BuildAgent(context.Background(), AgentRequestContext{Model: "unsupported"}); err == nil {
		t.Fatal("Agent bypassed shared validation")
	}
}
