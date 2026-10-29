package prompts

import (
	"strings"
	"testing"
)

func TestPrevisManualTopicsLoadAndCoverEveryFile(t *testing.T) {
	topics := PrevisManualTopics()
	if len(topics) == 0 || topics[0].ID != "rules" {
		t.Fatalf("manual must start with rules: %#v", topics)
	}
	listed := map[string]bool{}
	for _, topic := range topics {
		if topic.Title == "" || topic.When == "" {
			t.Fatalf("topic %q needs title and when", topic.ID)
		}
		item, content, ok := PrevisManual(topic.ID)
		if !ok || item.ID != topic.ID || !strings.HasPrefix(content, "# ") || len(content) < 400 {
			t.Fatalf("topic %q failed to load: ok=%v len=%d", topic.ID, ok, len(content))
		}
		listed[topic.ID+".md"] = true
	}
	entries, err := previsManualFiles.ReadDir("previs-manual")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !listed[entry.Name()] {
			t.Fatalf("manual file %s is not listed in previsManualTopics", entry.Name())
		}
	}
	if _, _, ok := PrevisManual("missing"); ok {
		t.Fatal("unknown topic must not load")
	}
	if _, _, ok := PrevisManual(" rules "); !ok {
		t.Fatal("topic lookup should trim spaces")
	}
}

// 说明书是工具参考资料，不能复制系统策略里的媒体审批、收费规则。
func TestPrevisManualDoesNotCopySystemPolicy(t *testing.T) {
	for _, topic := range PrevisManualTopics() {
		_, content, _ := PrevisManual(topic.ID)
		for _, banned := range []string{"收费", "扣费", "媒体审批", "permissionMode", "自动重提"} {
			if strings.Contains(content, banned) {
				t.Fatalf("manual %s must not restate system policy (%s)", topic.ID, banned)
			}
		}
	}
}
