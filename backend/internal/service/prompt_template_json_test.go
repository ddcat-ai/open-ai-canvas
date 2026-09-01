package service

import (
	"strings"
	"testing"
)

func TestExtractJSONTextSkipsProseAndMarkdownFence(t *testing.T) {
	raw := "先说明一下，{这不是有效 JSON}。\n```json\n{\"characters\":[{\"name\":\"林夏\",\"aliases\":[]}]}\n```\n"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","aliases":[]}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

func TestExtractJSONTextHandlesBracesInJSONString(t *testing.T) {
	raw := "```json\n{\"characters\":[{\"name\":\"林夏\",\"role\":\"拿着{小夜灯}的租客\"}]}\n```"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","role":"拿着{小夜灯}的租客"}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

const characterCardJSON = `{"name":"林夏","aliases":["夏夏"],"role":"女主角","appearance":"短发","clothing":"白衬衫","physique":"纤细","personality":"冷静","props":"小夜灯","consistencyPrompt":"c","multiViewPrompt":"m","voiceLanguage":"中文","voiceAge":"青年","voiceTimbre":"清亮"}`

// TestValidatePromptTemplateResultCharacterRootShapes 覆盖模型返回角色卡时的各种顶层形态。
// 这些形态都违反 character-breakdown/v1 的顶层 object 契约，但内容本身可用，应当被接受；
// 真正无内容或缺字段的输入则必须报出可读的业务错误，而不是 Go 的类型错误。
func TestValidatePromptTemplateResultCharacterRootShapes(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		wantErr string
	}{
		{name: "标准对象形态", text: `{"characters":[` + characterCardJSON + `]}`},
		{name: "顶层角色卡数组", text: `[` + characterCardJSON + `]`},
		{name: "单元素包 characters", text: `[{"characters":[` + characterCardJSON + `]}]`},
		{name: "多元素各包 characters", text: `[{"characters":[` + characterCardJSON + `]},{"characters":[` + characterCardJSON + `]}]`},
		{name: "数组外再包一层", text: `[[` + characterCardJSON + `]]`},
		{name: "数组混入非角色对象", text: `[{"index":1},` + characterCardJSON + `]`},
		{name: "markdown 代码块包裹数组", text: "```json\n[" + characterCardJSON + "]\n```"},
		{name: "正文先列角色名数组", text: "本章角色：[\"林夏\",\"陈默\"]\n\n{\"characters\":[" + characterCardJSON + "]}"},
		{name: "characters 写成以角色名为键的对象", text: `{"characters":{"林夏":` + characterCardJSON + `}}`},
		{name: "空数组", text: `[]`, wantErr: "没有识别到任何角色"},
		{name: "不相关数组", text: `["林夏","陈默"]`, wantErr: "没有识别到任何角色"},
		{name: "角色缺少必填字段", text: `[{"name":"林夏"}]`, wantErr: "第 1 个角色缺少字段 aliases"},
		// characters 位于契约位置时不做元素过滤，缺 name 也要报出具体字段而不是被当成空结果。
		{name: "契约位置内角色缺少 name", text: `{"characters":[{"role":"女主角"}]}`, wantErr: "第 1 个角色缺少字段 name"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePromptTemplateResult(promptOperationCharacterExtract, map[string]interface{}{"text": tc.text})
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("validatePromptTemplateResult() error = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validatePromptTemplateResult() error = nil, want %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("validatePromptTemplateResult() error = %q, want containing %q", err.Error(), tc.wantErr)
			}
			// 形态问题必须收敛成业务语言，不能把 Go 的类型错误抛给用户。
			if strings.Contains(err.Error(), "cannot unmarshal") {
				t.Fatalf("validatePromptTemplateResult() leaked Go type error: %v", err)
			}
		})
	}
}

// TestValidatePromptTemplateResultScopesCharacterRelaxation 确认形态放宽只作用于角色卡提取。
// 其余 JSON 操作只要求能取出一个合法 JSON 值，不套用 characters 契约，因此顶层数组对它们依旧无意义。
func TestValidatePromptTemplateResultScopesCharacterRelaxation(t *testing.T) {
	if err := validatePromptTemplateResult(promptOperationStoryboardPlan, map[string]interface{}{"text": `[{"name":"林夏"}]`}); err != nil {
		t.Fatalf("validatePromptTemplateResult() error = %v, want nil for non-character JSON operation", err)
	}
	if err := validatePromptTemplateResult(promptOperationStoryboardPlan, map[string]interface{}{"text": "完全没有 JSON 内容"}); err == nil {
		t.Fatal("validatePromptTemplateResult() error = nil, want contract error for non-character operation")
	}
	err := validatePromptTemplateResult(promptOperationCharacterExtract, map[string]interface{}{"text": "完全没有 JSON 内容"})
	if err == nil || !strings.Contains(err.Error(), "受保护 JSON 契约") {
		t.Fatalf("validatePromptTemplateResult() error = %v, want contract error for character extract", err)
	}
}
