package workbench

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestValidateTaskCapabilitiesInputContract(t *testing.T) {
	capability := map[string]any{
		"referenceKinds": []any{"image", "video"},
		"inputContract": map[string]any{
			"promptRequired": false,
			"slots": []any{
				map[string]any{
					"key":        "subject",
					"name":       "Subject",
					"mediaTypes": []any{"image"},
					"minCount":   float64(1),
					"maxCount":   float64(2),
					"required":   true,
				},
			},
		},
	}

	tests := []struct {
		name string
		refs []TaskReference
		want bool
	}{
		{name: "valid slot reference", refs: []TaskReference{{ResourceID: "image-1", Kind: "image", SlotKey: "subject"}}, want: true},
		{name: "missing required slot", want: false},
		{name: "unknown slot", refs: []TaskReference{{ResourceID: "image-1", Kind: "image", SlotKey: "unknown"}}, want: false},
		{name: "media type mismatch", refs: []TaskReference{{ResourceID: "video-1", Kind: "video", SlotKey: "subject"}}, want: false},
		{name: "slot count exceeded", refs: []TaskReference{{ResourceID: "image-1", Kind: "image", SlotKey: "subject"}, {ResourceID: "image-2", Kind: "image", SlotKey: "subject"}, {ResourceID: "image-3", Kind: "image", SlotKey: "subject"}}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateTaskCapabilities(KindVideo, capability, test.refs)
			if (err == nil) != test.want {
				t.Fatalf("validateTaskCapabilities() error = %v, want success = %t", err, test.want)
			}
		})
	}
}

func TestValidateTaskCapabilitiesLegacyWithoutSlots(t *testing.T) {
	capability := map[string]any{"referenceKinds": []any{"image"}}
	refs := []TaskReference{{ResourceID: "image-1", Kind: "image"}}
	if err := validateTaskCapabilities(KindImage, capability, refs); err != nil {
		t.Fatalf("legacy reference without slot was rejected: %v", err)
	}
}

func TestToolRequiresPromptDefaultsAndOverride(t *testing.T) {
	legacy := &model.WorkbenchTool{CapabilityJSON: `{}`}
	if !toolRequiresPrompt(legacy) {
		t.Fatal("legacy tool must keep requiring a prompt")
	}
	optionalPrompt := &model.WorkbenchTool{CapabilityJSON: `{"inputContract":{"promptRequired":false}}`}
	if toolRequiresPrompt(optionalPrompt) {
		t.Fatal("tool configured for optional prompts must allow an empty prompt")
	}
}
