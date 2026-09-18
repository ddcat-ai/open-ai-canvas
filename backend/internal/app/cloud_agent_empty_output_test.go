package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentEmptyModelOutputDetection(t *testing.T) {
	cases := []struct {
		name string
		task *model.Task
		want bool
	}{
		{"空回合 → 可恢复", &model.Task{Status: model.TaskStatusFailed, Error: "画布 Agent 接口没有返回内容"}, true},
		{"成功的任务不算空回合", &model.Task{Status: model.TaskStatusSucceeded, Error: ""}, false},
		{"别的失败原因不该被吞", &model.Task{Status: model.TaskStatusFailed, Error: "上游 429 限流"}, false},
		{"nil 安全", nil, false},
	}
	for _, c := range cases {
		if got := cloudAgentEmptyModelOutput(c.task); got != c.want {
			t.Fatalf("%s：cloudAgentEmptyModelOutput = %v, want %v", c.name, got, c.want)
		}
	}
	if cloudAgentMaxEmptyOutputNudges <= 0 || cloudAgentMaxEmptyOutputNudges > 3 {
		t.Fatalf("空回合催促上限应在 1..3 之间，got %d", cloudAgentMaxEmptyOutputNudges)
	}
}

func TestCloudAgentTruncatedToolArguments(t *testing.T) {
	if !cloudAgentTruncatedToolArguments(&model.Task{Error: "工具参数不是完整 JSON"}) {
		t.Fatal("截断的工具参数应判为可恢复")
	}
	if cloudAgentTruncatedToolArguments(&model.Task{Error: "上游 429 限流"}) {
		t.Fatal("其它失败原因不该被当成截断")
	}
}

func TestCloudAgentOutputViolation(t *testing.T) {
	if got := cloudAgentOutputViolation(stringsRepeat("x", 32001), 1); got == "" {
		t.Fatal("超长正文应判定违规")
	}
	if got := cloudAgentOutputViolation("ok", 9); got == "" {
		t.Fatal("超过 8 个工具调用应判定违规")
	}
	if got := cloudAgentOutputViolation("ok", 2); got != "" {
		t.Fatalf("合规输出不应违规：%s", got)
	}
}

func stringsRepeat(value string, count int) string {
	out := make([]byte, 0, len(value)*count)
	for i := 0; i < count; i++ {
		out = append(out, value...)
	}
	return string(out)
}
