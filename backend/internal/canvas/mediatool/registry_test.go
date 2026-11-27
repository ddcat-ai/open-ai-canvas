package mediatool

import (
	"strings"
	"testing"
)

func TestRegisteredDefinitionProjectsToEveryPublicContract(t *testing.T) {
	// 用现有执行器注册新操作，验证所有投影只依赖同一注册源。
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	fixture := Definitions()[0]
	fixture.ID, fixture.Operation = "fixture-tool", "fixture-operation"
	definitions = append(definitions, fixture)
	if err := Validate(definitions); err != nil {
		t.Fatal(err)
	}
	if _, ok := Lookup(fixture.Operation); !ok {
		t.Fatal("new operation missing from lookup")
	}
	if !strings.Contains(TypeScriptDeclaration(), fixture.Operation) {
		t.Fatal("new operation missing from canvas projection")
	}
	found := false
	for _, operation := range Operations() {
		if operation == fixture.Operation {
			found = true
		}
	}
	if !found {
		t.Fatal("new operation missing from agent enum")
	}
	fps := 60
	if err := ValidateParameters(fixture.Operation, &Parameters{FPS: &fps}); err != nil {
		t.Fatal(err)
	}
	if len(ParameterSchema()["properties"].(map[string]any)) == 0 {
		t.Fatal("parameter schema missing")
	}
}

func TestRegistryRejectsInvalidPublicDefinitions(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Definition)
	}{
		{"executor", func(d *Definition) { d.Executor = "arbitrary-code" }},
		{"input", func(d *Definition) { d.Input.Count = 2 }},
		{"type", func(d *Definition) { d.Parameters["unsupported"] = Parameter{Type: "object"} }},
		{"boolean", func(d *Definition) { d.Parameters["unsupported"] = Parameter{Type: "boolean"} }},
		{"unknown_name", func(d *Definition) { d.Parameters["text"] = Parameter{Type: "string", Title: "文本"} }},
		{"unknown_capability", func(d *Definition) {
			d.Parameters["fps"] = Parameter{Type: "integer", Title: "帧率", Capability: "unknown"}
		}},
		{"wrong_parameter_type", func(d *Definition) {
			d.Parameters["fps"] = Parameter{Type: "string", Title: "帧率", Capability: "video.processing.fpsOptions"}
		}},
		{"out_of_executor_range", func(d *Definition) {
			d.Parameters["bitrate"] = Parameter{Type: "integer", Title: "码率", Minimum: number(0), Maximum: number(150000)}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			definition := Definitions()[0]
			test.change(&definition)
			if err := Validate([]Definition{definition}); err == nil {
				t.Fatal("invalid definition accepted")
			}
		})
	}
	definition := Definitions()[0]
	if err := Validate([]Definition{definition, definition}); err == nil {
		t.Fatal("duplicate tool accepted")
	}
}
