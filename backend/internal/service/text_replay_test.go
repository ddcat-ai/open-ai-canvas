package service

import "testing"

func TestIsTextReplayTaskRequest(t *testing.T) {
	cases := []struct {
		name  string
		input map[string]any
		want  bool
	}{
		{"replay 布尔 true", map[string]any{"replay": true}, true},
		{"replay 字符串 true", map[string]any{"replay": "true"}, true},
		{"replay 字符串 True 大小写", map[string]any{"replay": "TRUE"}, true},
		{"replay 布尔 false", map[string]any{"replay": false}, false},
		{"无 replay 字段", map[string]any{"mode": "text"}, false},
		{"replay 空字符串", map[string]any{"replay": ""}, false},
		{"replay 数字", map[string]any{"replay": 1}, false},
		{"replay nil", map[string]any{"replay": nil}, false},
	}
	for _, tc := range cases {
		if got := isTextReplayTaskRequest(tc.input); got != tc.want {
			t.Errorf("%s: isTextReplayTaskRequest(%v) = %v, want %v", tc.name, tc.input, got, tc.want)
		}
	}
}
