package capability

import (
	"strings"
	"testing"
)

func testDescriptor() Descriptor {
	return Descriptor{
		Type: "  custom  ", Version: "1", Label: "自定义", DefaultWidth: 100, DefaultHeight: 80,
		InputKind: " TEXT ", GenerationMode: " IMAGE ",
		Connection: ConnectionPolicy{CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"image", " TEXT "}, RejectedInputKinds: []string{"audio"}, MaxInputCount: 2},
		CanUpdate:  true, SummaryFields: []string{" prompt ", "prompt", "content"}, DetailFields: []string{"content"},
		PatchFields: map[string]PatchField{
			"title":   {Path: " title ", Kind: " STRING ", Label: " 节点名称 ", Order: 10, Description: " 节点标题 ", MaxRunes: 20},
			"enabled": {Path: "metadata.enabled", Kind: "boolean", Label: "启用状态", Order: 20},
			"weight":  {Path: "metadata.weight", Kind: "number", Label: "权重", Order: 30},
		},
	}
}

func TestRegistryNormalizesAndProtectsDescriptors(t *testing.T) {
	input := testDescriptor()
	registry, err := NewRegistry([]Descriptor{input})
	if err != nil {
		t.Fatal(err)
	}
	input.Connection.AcceptedInputKinds[0] = "video"
	input.PatchFields["title"] = PatchField{Path: "unsafe", Kind: "number"}

	descriptor, ok := registry.Resolve(" CUSTOM ")
	if !ok {
		t.Fatal("normalized type was not resolved")
	}
	if descriptor.Type != "custom" || descriptor.InputKind != "text" || descriptor.GenerationMode != "image" {
		t.Fatalf("descriptor was not normalized: %#v", descriptor)
	}
	if descriptor.Connection.AcceptedInputKinds[0] != "image" {
		t.Fatalf("registry retained caller mutation: %#v", descriptor.Connection.AcceptedInputKinds)
	}
	if descriptor.PatchFields["title"].Path != "title" || descriptor.PatchFields["title"].Kind != "string" || descriptor.PatchFields["title"].Label != "节点名称" || descriptor.PatchFields["title"].Description != "节点标题" {
		t.Fatalf("registry retained caller mutation: %#v", descriptor.PatchFields)
	}

	descriptor.Connection.AcceptedInputKinds[0] = "video"
	descriptor.PatchFields["title"] = PatchField{Path: "changed", Kind: "number"}
	fresh, _ := registry.Resolve("custom")
	if fresh.Connection.AcceptedInputKinds[0] != "image" || fresh.PatchFields["title"].Path != "title" {
		t.Fatal("Resolve returned mutable registry state")
	}
}

func TestRegistryAcceptsExtensibleIdentifiers(t *testing.T) {
	descriptor := testDescriptor()
	descriptor.InputKind = "table_data"
	descriptor.GenerationMode = "table-render"
	descriptor.Connection.AcceptedInputKinds = []string{"table_data", "text"}
	descriptor.Connection.RejectedInputKinds = nil
	registry, err := NewRegistry([]Descriptor{descriptor})
	if err != nil {
		t.Fatalf("extensible kind or mode rejected: %v", err)
	}
	resolved, ok := registry.ResolveGenerationMode(" TABLE-RENDER ")
	if !ok || resolved.Type != "custom" || resolved.InputKind != "table_data" {
		t.Fatalf("generation mode did not resolve descriptor: %#v, %v", resolved, ok)
	}
}

func TestRegistryHashIsStableAndTracksDeclarativeContract(t *testing.T) {
	first := testDescriptor()
	second := testDescriptor()
	second.Connection.AcceptedInputKinds = []string{"text", "image"}
	second.Connection.RejectedInputKinds = []string{"audio"}
	first.CreateMetadata = func(string) map[string]any { return map[string]any{"one": true} }
	second.CreateMetadata = func(string) map[string]any { return map[string]any{"two": true} }

	left, err := NewRegistry([]Descriptor{first})
	if err != nil {
		t.Fatal(err)
	}
	right, err := NewRegistry([]Descriptor{second})
	if err != nil {
		t.Fatal(err)
	}
	if left.Hash() != right.Hash() {
		t.Fatal("factory function changed the capability contract hash")
	}

	reordered, err := NewRegistry([]Descriptor{second, Descriptor{Type: "z", Version: "1", Label: "Z", DefaultWidth: 1, DefaultHeight: 1}})
	if err != nil {
		t.Fatal(err)
	}
	otherOrder, err := NewRegistry([]Descriptor{{Type: "z", Version: "1", Label: "Z", DefaultWidth: 1, DefaultHeight: 1}, second})
	if err != nil {
		t.Fatal(err)
	}
	if reordered.Hash() != otherOrder.Hash() {
		t.Fatal("descriptor registration order changed the contract hash")
	}

	projected := second
	projected.ProjectionKind = "storyboard"
	projected.ProjectionField = "storyboard"
	withProjection, err := NewRegistry([]Descriptor{projected})
	if err != nil {
		t.Fatal(err)
	}
	if withProjection.Hash() == right.Hash() {
		t.Fatal("projection declaration did not change capability contract hash")
	}

	described := second
	field := described.PatchFields["title"]
	field.Description = "不同的字段语义"
	described.PatchFields["title"] = field
	withDescription, err := NewRegistry([]Descriptor{described})
	if err != nil {
		t.Fatal(err)
	}
	if withDescription.Hash() == right.Hash() {
		t.Fatal("patch field description did not change capability contract hash")
	}
}

func TestRegistryRejectsInvalidContracts(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Descriptor)
	}{
		{"invalid input kind", func(d *Descriptor) { d.InputKind = "9table" }},
		{"invalid generation mode", func(d *Descriptor) { d.GenerationMode = "table mode" }},
		{"duplicate generation mode", func(d *Descriptor) {}},
		{"negative max input", func(d *Descriptor) { d.Connection.MaxInputCount = -1 }},
		{"accepted and rejected conflict", func(d *Descriptor) { d.Connection.RejectedInputKinds = []string{"image"} }},
		{"source without kind", func(d *Descriptor) { d.InputKind = "" }},
		{"projection missing field", func(d *Descriptor) { d.ProjectionKind = "storyboard" }},
		{"projection missing kind", func(d *Descriptor) { d.ProjectionField = "storyboard" }},
		{"invalid projection kind", func(d *Descriptor) { d.ProjectionKind, d.ProjectionField = "bad kind", "storyboard" }},
		{"unsafe projection field", func(d *Descriptor) { d.ProjectionKind, d.ProjectionField = "storyboard", "metadata.__proto__" }},
		{"empty patch path", func(d *Descriptor) { d.PatchFields["title"] = PatchField{Kind: "string"} }},
		{"unsafe patch path", func(d *Descriptor) {
			d.PatchFields["title"] = PatchField{Path: "metadata.__proto__.value", Kind: "string"}
		}},
		{"unknown patch kind", func(d *Descriptor) { d.PatchFields["title"] = PatchField{Path: "title", Kind: "object"} }},
		{"negative max runes", func(d *Descriptor) { d.PatchFields["title"] = PatchField{Path: "title", Kind: "string", MaxRunes: -1} }},
		{"missing patch label", func(d *Descriptor) {
			field := d.PatchFields["title"]
			field.Label = ""
			d.PatchFields["title"] = field
		}},
		{"missing patch order", func(d *Descriptor) {
			field := d.PatchFields["title"]
			field.Order = 0
			d.PatchFields["title"] = field
		}},
		{"patch fields without update", func(d *Descriptor) { d.CanUpdate = false }},
		{"update without patch fields", func(d *Descriptor) { d.PatchFields = nil }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			descriptor := testDescriptor()
			test.edit(&descriptor)
			descriptors := []Descriptor{descriptor}
			if test.name == "duplicate generation mode" {
				other := testDescriptor()
				other.Type = "other"
				descriptors = append(descriptors, other)
			}
			if _, err := NewRegistry(descriptors); err == nil {
				t.Fatal("invalid descriptor accepted")
			}
		})
	}
	if _, err := NewRegistry([]Descriptor{testDescriptor(), testDescriptor()}); err == nil {
		t.Fatal("duplicate descriptor accepted")
	}
}

func TestDescriptorConnectionAndPatchContract(t *testing.T) {
	registry, err := NewRegistry([]Descriptor{testDescriptor()})
	if err != nil {
		t.Fatal(err)
	}
	descriptor, _ := registry.Resolve("custom")
	if !descriptor.AllowsInput("IMAGE") || !descriptor.AllowsInput("text") || descriptor.AllowsInput("audio") || descriptor.AllowsInput("video") {
		t.Fatalf("input admission contract is wrong: %#v", descriptor.Connection)
	}
	if descriptor.Connection.MaxInputCount != 2 {
		t.Fatalf("max input count = %d", descriptor.Connection.MaxInputCount)
	}
	for name, patch := range map[string]map[string]any{
		"unknown":      {"missing": "value"},
		"string type":  {"title": true},
		"number type":  {"weight": "1"},
		"boolean type": {"enabled": 1.0},
		"rune limit":   {"title": strings.Repeat("界", 21)},
	} {
		t.Run(name, func(t *testing.T) {
			if err := descriptor.ValidatePatch(patch); err == nil {
				t.Fatal("invalid patch accepted")
			}
		})
	}
	node := map[string]any{"metadata": map[string]any{"untouched": true}}
	patch := map[string]any{"title": "标题", "enabled": true, "weight": 1.5}
	if err := descriptor.ApplyPatch(node, patch); err != nil {
		t.Fatal(err)
	}
	metadata := node["metadata"].(map[string]any)
	if node["title"] != "标题" || metadata["enabled"] != true || metadata["weight"] != 1.5 || metadata["untouched"] != true {
		t.Fatalf("patch was not applied by declared paths: %#v", node)
	}
}

func TestRegistryGenerationModesAreStableAndResolveUniquely(t *testing.T) {
	image := testDescriptor()
	image.Type, image.GenerationMode = "image-node", "image"
	video := testDescriptor()
	video.Type, video.GenerationMode = "video-node", "video"
	registry, err := NewRegistry([]Descriptor{video, image})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(registry.GenerationModeNames(), ","); got != "image,video" {
		t.Fatalf("generation modes = %s", got)
	}
	if !registry.SupportsGenerationMode(" VIDEO ") || registry.SupportsGenerationMode("audio") {
		t.Fatal("generation mode support is wrong")
	}
	resolved, ok := registry.ResolveGenerationMode("image")
	if !ok || resolved.Type != "image-node" {
		t.Fatalf("resolved generation descriptor = %#v, %v", resolved, ok)
	}
}

func TestBuiltinMediaCapabilitiesUpdateDraftWithoutOverwritingGeneratedAssets(t *testing.T) {
	registry := BuiltinRegistry()
	for _, nodeType := range []string{"image", "video", "audio"} {
		t.Run(nodeType, func(t *testing.T) {
			descriptor, ok := registry.Resolve(nodeType)
			if !ok || !descriptor.CanUpdate {
				t.Fatalf("media capability is not updateable: %#v", descriptor)
			}
			if descriptor.PatchFields["content"].Path != "metadata.composerContent" || descriptor.PatchFields["title"].Path != "title" {
				t.Fatalf("unsafe media update paths: %#v", descriptor.PatchFields)
			}

			node := map[string]any{
				"title": "旧标题",
				"metadata": map[string]any{
					"content":         "resource:generated-result",
					"prompt":          "已提交提示词",
					"composerContent": "旧草稿",
					"status":          "success",
				},
			}
			if err := descriptor.ApplyPatch(node, map[string]any{"title": "新标题", "content": "下一版提示词"}); err != nil {
				t.Fatal(err)
			}
			metadata := node["metadata"].(map[string]any)
			if node["title"] != "新标题" || metadata["composerContent"] != "下一版提示词" {
				t.Fatalf("media draft was not updated: %#v", node)
			}
			if metadata["content"] != "resource:generated-result" || metadata["prompt"] != "已提交提示词" || metadata["status"] != "success" {
				t.Fatalf("media result or submission snapshot was overwritten: %#v", metadata)
			}

			created := descriptor.Metadata("初始草稿")
			if created["content"] != "" || created["prompt"] != "初始草稿" || created["composerContent"] != "初始草稿" || created["status"] != "idle" {
				t.Fatalf("media draft metadata is incomplete: %#v", created)
			}
		})
	}
}

func TestRegistryResolveUnknownTypeFailsClosed(t *testing.T) {
	registry, err := NewRegistry([]Descriptor{testDescriptor()})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := registry.Resolve("table"); ok {
		t.Fatal("unknown capability resolved")
	}
	if _, ok := registry.ResolveGenerationMode("table"); ok {
		t.Fatal("unknown generation mode resolved")
	}
}
