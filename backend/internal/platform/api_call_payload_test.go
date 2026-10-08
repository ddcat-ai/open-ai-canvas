package platform

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

// 回归测试：截断必须落在 UTF-8 字符边界上，且产出永远是合法 UTF-8，
// 否则调用日志写 PostgreSQL 会报 invalid byte sequence，订单被误标 uncertain。
func TestTruncateAPICallPayloadAlwaysValidUTF8(t *testing.T) {
	cases := []struct {
		name  string
		value string
	}{
		{"短文本原样返回", "你好，世界"},
		{"纯 ASCII 长文", strings.Repeat("a", maxAPICallPayloadBytes+500)},
		{"中文长文（3 字节字符）", strings.Repeat("测", (maxAPICallPayloadBytes+500)/3)},
		{"emoji 长文（4 字节字符）", strings.Repeat("🎬", (maxAPICallPayloadBytes+500)/4)},
		{"中日韩混排", strings.Repeat("测试テスト", (maxAPICallPayloadBytes+500)/18)},
		{"源报文本身含非法 UTF-8", strings.Repeat("ok", 70000) + "\xff\xfe" + strings.Repeat("尾", 100)},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := truncateAPICallPayload(tc.value)
			if !utf8.ValidString(got) {
				t.Fatalf("截断结果含非法 UTF-8")
			}
			if len(tc.value) <= maxAPICallPayloadBytes {
				if got != tc.value {
					t.Fatalf("短文本应原样返回")
				}
				return
			}
			if !strings.HasSuffix(got, fmt.Sprintf("[报文已截断，原始长度 %d 字节]", len(tc.value))) {
				t.Fatalf("缺少截断标记: %q", got[len(got)-60:])
			}
			if len(got) > maxAPICallPayloadBytes+64 {
				t.Fatalf("截断后长度越界: got %d", len(got))
			}
		})
	}
}

func TestSanitizeAPICallPayloadTruncatedJSONIsValidUTF8(t *testing.T) {
	// 中文 prompt + 大报文，走 json.MarshalIndent 格式化后仍超限的路径。
	big := make([]string, 0, 20000)
	for i := 0; i < 20000; i++ {
		big = append(big, `{"prompt":"用参考图画一段夜晚赛博朋克城市的天际线航拍镜头","index":`+fmt.Sprint(i)+`}`)
	}
	data := []byte("[" + strings.Join(big, ",") + "]")
	got := SanitizeAPICallPayload(data, "application/json")
	if !utf8.ValidString(got) {
		t.Fatalf("JSON 载体截断结果含非法 UTF-8")
	}
	if len(data) <= maxAPICallPayloadBytes {
		t.Fatalf("用例应超过截断阈值")
	}
}
