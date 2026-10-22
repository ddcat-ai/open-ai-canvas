package tool

import (
	"encoding/json"
	"testing"
)

func TestRegistryRejectsMissingDuplicateAndUnknownBindings(t *testing.T) {
	all := func() []Binding[string] {
		bindings := []Binding[string]{}
		for _, name := range Names() {
			bindings = append(bindings, Binding[string]{Definition: Definition{Name: name, Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}, Handler: "implementation"})
		}
		return bindings
	}
	if _, err := NewRegistry(all()); err != nil {
		t.Fatal(err)
	}
	missing := all()[1:]
	if _, err := NewRegistry(missing); err == nil {
		t.Fatal("missing policy binding accepted")
	}
	duplicate := all()
	duplicate = append(duplicate, duplicate[0])
	if _, err := NewRegistry(duplicate); err == nil {
		t.Fatal("duplicate binding accepted")
	}
	unknown := all()
	unknown[0].Definition.Name = "not_registered"
	if _, err := NewRegistry(unknown); err == nil {
		t.Fatal("unknown policy accepted")
	}
	invalid := all()
	invalid[0].Definition.Parameters = json.RawMessage(`{`)
	if _, err := NewRegistry(invalid); err == nil {
		t.Fatal("invalid JSON schema accepted")
	}
}

func TestPolicyAndDefinitionCopiesCannotMutateRegistry(t *testing.T) {
	policy := Of(CanvasGetState)
	policy.OffsetDefaults[0] = "poisoned"
	if Of(CanvasGetState).OffsetDefaults[0] != "offset" {
		t.Fatal("mutable policy slice leaked")
	}
	bindings := []Binding[int]{}
	for _, name := range Names() {
		bindings = append(bindings, Binding[int]{Definition: Definition{Name: name, Parameters: json.RawMessage(`{"type":"object"}`)}, Handler: 1})
	}
	r, err := NewRegistry(bindings)
	if err != nil {
		t.Fatal(err)
	}
	bindings[0].Definition.Parameters[0] = '!'
	got, _ := r.Lookup(bindings[0].Definition.Name)
	if !json.Valid(got.Definition.Parameters) {
		t.Fatal("constructor retained caller-owned schema")
	}
	got.Definition.Parameters[0] = '!'
	fresh, _ := r.Lookup(got.Definition.Name)
	if !json.Valid(fresh.Definition.Parameters) {
		t.Fatal("lookup leaked schema bytes")
	}
}

func TestTypedReadSchemasKeepRequiredAndBounds(t *testing.T) {
	var schema struct {
		Type                 string   `json:"type"`
		Required             []string `json:"required"`
		AdditionalProperties bool     `json:"additionalProperties"`
		Properties           map[string]struct {
			Type    string   `json:"type"`
			Minimum *float64 `json:"minimum"`
			Maximum *float64 `json:"maximum"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(SchemaFor[CanvasReadTextArgs](), &schema); err != nil {
		t.Fatal(err)
	}
	if schema.Type != "object" || schema.AdditionalProperties || len(schema.Required) != 1 || schema.Required[0] != "nodeId" {
		t.Fatalf("strict required fields lost: %+v", schema)
	}
	field := schema.Properties["maxChars"]
	if field.Type != "integer" || field.Minimum == nil || *field.Minimum != 1 || field.Maximum == nil || *field.Maximum != 16000 {
		t.Fatalf("read bound lost: %+v", field)
	}
}

func TestScopeAndApprovalDoNotGrantMediaInReadOnlyMode(t *testing.T) {
	readOnly := Scope{Canvas: true, ReadOnly: true, IncludeProfile: true, Skills: true, Vision: true}
	for _, name := range Names() {
		p := Of(name)
		if p.Write() && p.Allowed(readOnly) {
			t.Errorf("%s writable in read_only", name)
		}
		if p.Media() && !p.ApprovalRequired("auto") {
			t.Errorf("%s bypasses media approval in auto", name)
		}
	}
	if Of(CanvasGetState).Allowed(Scope{IncludeProfile: true}) {
		t.Fatal("unbound canvas read allowed")
	}
	if Of(SkillReadFile).Allowed(Scope{Canvas: true, IncludeProfile: true}) {
		t.Fatal("uninstalled skill read allowed")
	}
	if Of(CanvasInspectImage).Allowed(Scope{Canvas: true, IncludeProfile: true}) {
		t.Fatal("vision unavailable but inspection exposed")
	}
}
