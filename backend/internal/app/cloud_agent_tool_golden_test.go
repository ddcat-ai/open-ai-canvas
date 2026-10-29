package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// 工具 schema 是模型契约，也是 prompt cache 前缀的第一段。重构（注册表、typed args）
// 必须逐字节保持输出不变；确实需要改契约时用 UPDATE_GOLDEN=1 重新生成并在评审中检查 diff。
func cloudAgentToolGoldenRequests() map[string]CloudAgentRequest {
	full := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillsEnabled: true, MemoryMode: "auto", VisionEnabled: true}
	full.Budget.MaxGenerationTasks = 1
	return map[string]CloudAgentRequest{
		"full":             full,
		"read_only_canvas": {PermissionMode: "read_only", ContextScope: []string{"canvas"}, MemoryMode: "auto"},
		"approval_canvas":  {PermissionMode: "request_approval", ContextScope: []string{"canvas"}, MemoryMode: "review"},
		"no_canvas":        {PermissionMode: "auto"},
	}
}

func TestCloudAgentToolSchemaGolden(t *testing.T) {
	for name, req := range cloudAgentToolGoldenRequests() {
		t.Run(name, func(t *testing.T) {
			raw, err := json.MarshalIndent(cloudAgentTools(req), "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			assertCloudAgentGolden(t, filepath.Join("testdata", "agent_tools", name+".json"), raw)
		})
	}
}

func TestCloudAgentSupportedToolNamesGolden(t *testing.T) {
	raw, err := json.MarshalIndent(CloudAgentSupportedToolNames(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	assertCloudAgentGolden(t, filepath.Join("testdata", "agent_tools", "supported_names.json"), raw)
}

func assertCloudAgentGolden(t *testing.T, path string, got []byte) {
	t.Helper()
	got = append(got, '\n')
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("缺少 golden 文件 %s（UPDATE_GOLDEN=1 生成）：%v", path, err)
	}
	if !bytes.Equal(want, got) {
		t.Fatalf("%s 与当前输出不一致；确认是有意改契约后用 UPDATE_GOLDEN=1 更新", path)
	}
}
