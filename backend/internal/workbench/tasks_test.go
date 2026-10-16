package workbench

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestResolveVideoTaskOperationUsesReferenceRoles(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	for _, resource := range []model.Resource{
		{ID: "first", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "last", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "reference", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "video", UserID: "user", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "audio", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	first := TaskReference{ResourceID: "first", Kind: "image", Role: "first_frame"}
	last := TaskReference{ResourceID: "last", Kind: "image", Role: "last_frame"}
	reference := TaskReference{ResourceID: "reference", Kind: "image", Role: "reference"}
	video := TaskReference{ResourceID: "video", Kind: "video"}
	audio := TaskReference{ResourceID: "audio", Kind: "audio"}
	for _, tc := range []struct {
		name string
		refs []TaskReference
		want string
	}{
		{name: "text", want: "text_to_video"},
		{name: "first frame", refs: []TaskReference{first}, want: "image_to_video"},
		{name: "last frame", refs: []TaskReference{last}, want: "image_to_video"},
		{name: "frames in reverse order", refs: []TaskReference{last, first}, want: "image_to_video"},
		{name: "reference image", refs: []TaskReference{reference}, want: "reference_to_video"},
		{name: "unlabelled image", refs: []TaskReference{{ResourceID: "reference", Kind: "image"}}, want: "reference_to_video"},
		{name: "frame and reference", refs: []TaskReference{first, reference}, want: "reference_to_video"},
		{name: "video", refs: []TaskReference{video}, want: "reference_to_video"},
		{name: "audio", refs: []TaskReference{audio}, want: "audio_to_video"},
		{name: "frame with audio", refs: []TaskReference{first, audio}, want: "image_to_video"},
		{name: "reference with audio", refs: []TaskReference{reference, audio}, want: "reference_to_video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resolved, err := s.ResolveTask("user", TaskInput{Kind: KindVideo, Prompt: "Animate the subject", Model: "video-model", ChannelID: "channel", References: tc.refs})
			if err != nil {
				t.Fatal(err)
			}
			if resolved.Operation != tc.want {
				t.Fatalf("operation = %q, want %q", resolved.Operation, tc.want)
			}
			metadata := resolved.Input["metadata"].(map[string]any)
			if metadata["videoEditOperation"] != tc.want {
				t.Fatalf("provider operation = %v, want %q", metadata["videoEditOperation"], tc.want)
			}
			for _, ref := range tc.refs {
				key := map[string]string{"first_frame": "videoStartFrameNodeId", "last_frame": "videoEndFrameNodeId"}[ref.Role]
				if key != "" && metadata[key] != ref.ResourceID {
					t.Fatalf("%s = %v, want %q", key, metadata[key], ref.ResourceID)
				}
			}
		})
	}
}

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
