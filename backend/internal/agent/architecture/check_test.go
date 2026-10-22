package architecture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testBackend(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	files["go.mod"] = "module yingce/backend\n\ngo 1.25.0\n"
	for path, body := range files {
		path = filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func hasRule(findings []Finding, rule string) bool {
	for _, finding := range findings {
		if finding.Rule == rule {
			return true
		}
	}
	return false
}

func TestRejectsAgentToAppAndServiceImports(t *testing.T) {
	root := testBackend(t, map[string]string{"internal/agent/bad/bad.go": `package bad
import (
 _ "yingce/backend/internal/app"
 _ "yingce/backend/internal/service/nested"
)
`})
	findings, err := Check(root, Baseline{Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 2 || !hasRule(findings, "dependency") {
		t.Fatalf("dependency imports not caught: %+v", findings)
	}
}

func TestRejectsAliasedProtocolMapsAndAllowsRawMessage(t *testing.T) {
	root := testBackend(t, map[string]string{"internal/agent/dto/dto.go": `package dto
import "encoding/json"
type hidden = map[string]interface{}
type Response struct { Payload hidden }
func Send(value hidden) {}
type Request struct { Raw json.RawMessage; Fields map[string]json.RawMessage }
func Accept(value Request) json.RawMessage { return value.Raw }
`})
	findings, err := Check(root, Baseline{Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 2 || !hasRule(findings, "untyped_protocol_map") {
		t.Fatalf("want only Response.Payload and Send to fail: %+v", findings)
	}
}

func TestRejectsProtocolMapsBehindImportedAlias(t *testing.T) {
	root := testBackend(t, map[string]string{
		"internal/agent/a/type.go": `package a; type Payload map[string]any`,
		"internal/agent/b/type.go": `package b; import "yingce/backend/internal/agent/a"; func Send(value a.Payload) {}`,
	})
	findings, err := Check(root, Baseline{Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 2 {
		t.Fatalf("imported aliases bypassed boundary: %+v", findings)
	}
}

func TestSizeAndComplexityGuardCatchesNewDebt(t *testing.T) {
	root := testBackend(t, map[string]string{"internal/agent/bad/bad.go": "package bad\nfunc long(x bool) {\n" + strings.Repeat("if x {}\n", 125) + "}\n" + strings.Repeat("\n", 480)})
	findings, err := Check(root, Baseline{Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range []string{"file_lines", "function_lines", "complexity"} {
		if !hasRule(findings, rule) {
			t.Errorf("missed %s: %+v", rule, findings)
		}
	}
}

func TestBaselineCannotHideGrowthAndMustRatchetDown(t *testing.T) {
	root := testBackend(t, map[string]string{"internal/agent/bad/bad.go": "package bad\n" + strings.Repeat("\n", 610)})
	metrics, err := Scan(root)
	if err != nil || len(metrics) != 1 {
		t.Fatalf("metrics=%+v err=%v", metrics, err)
	}
	baseline := Baseline{Version: 1, Allowances: []Allowance{{ID: metrics[0].ID, Max: metrics[0].Value, Reason: "existing file, reviewed"}}}
	if findings, err := Check(root, baseline); err != nil || len(findings) != 0 {
		t.Fatalf("reviewed unchanged baseline should pass: %+v (%v)", findings, err)
	}
	baseline.Allowances[0].Max--
	if findings, _ := Check(root, baseline); len(findings) == 0 {
		t.Fatal("growth passed ratchet")
	}
	baseline.Allowances[0].Max += 2
	if findings, _ := Check(root, baseline); !hasRule(findings, "stale_baseline") {
		t.Fatalf("reduction must lower baseline: %+v", findings)
	}
}

func TestWorkspaceArchitecture(t *testing.T) {
	body, err := os.ReadFile("baseline.json")
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := DecodeBaseline(body)
	if err != nil {
		t.Fatal(err)
	}
	findings, err := Check(filepath.Join("..", "..", ".."), baseline)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) > 0 {
		t.Fatal("Agent architecture check failed:\n" + FormatFindings(findings))
	}
}

func TestBaselineRejectsBlanketOrDuplicateExceptions(t *testing.T) {
	for _, body := range []string{`{"version":0}`, `{"version":1,"allowances":[{"id":"*","max":0}]}`, `{"version":1,"allowances":[{"id":"same","max":1,"reason":"r"},{"id":"same","max":1,"reason":"r"}]}`} {
		if _, err := DecodeBaseline([]byte(body)); err == nil {
			t.Errorf("invalid baseline accepted: %s", body)
		}
	}
	if _, err := json.Marshal(Baseline{Version: 1}); err != nil {
		t.Fatal(err)
	}
}
