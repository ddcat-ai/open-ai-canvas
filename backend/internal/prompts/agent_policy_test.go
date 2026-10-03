package prompts

import (
	"strings"
	"testing"
)

func TestLoadAgentPoliciesUsesDocumentMetadata(t *testing.T) {
	system, media, err := LoadAgentPolicies()
	if err != nil {
		t.Fatal(err)
	}
	if system.ID != "cloud-agent-system" || system.Version != 13 || media.ID != "cloud-agent-media" || media.Version != 5 {
		t.Fatalf("unexpected policy metadata: system=%+v media=%+v", system, media)
	}
	if strings.Contains(system.Text, "id: cloud-agent-system") || !strings.HasPrefix(system.Text, "# Cloud Agent") {
		t.Fatalf("metadata leaked into compiled policy body: %q", system.Text)
	}
	for _, phrase := range []string{
		"auto 只豁免其他画布修改，不豁免媒体生成",
		"所有权限模式都必须等待界面独立审批",
		"authorizedChargeMicrocredits / chargeLimitMicrocredits 是预授权或上限，不是实际消费",
	} {
		if !strings.Contains(media.Text, phrase) {
			t.Fatalf("media policy lost required contract phrase %q", phrase)
		}
	}
}

func TestParsePolicyDocumentRejectsInvalidMetadata(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
	}{
		{"missing header", "# policy"},
		{"unclosed header", "---\nid: policy\nversion: 1\n# body"},
		{"missing id", "---\nversion: 1\n---\n# body"},
		{"invalid version", "---\nid: policy\nversion: latest\n---\n# body"},
		{"duplicate field", "---\nid: policy\nid: other\nversion: 1\n---\n# body"},
		{"unknown field", "---\nid: policy\nversion: 1\nowner: app\n---\n# body"},
		{"empty body", "---\nid: policy\nversion: 1\n---"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, _, _, err := parsePolicyDocument(test.raw); err == nil {
				t.Fatal("invalid policy document was accepted")
			}
		})
	}
}
