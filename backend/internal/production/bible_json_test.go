package production

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseBibleRecoversPrematureAssetArrayClosures(t *testing.T) {
	raw := `{"logline":"完整设定","characters":[{"name":"甲","appearance":"白衣","looks":[{"name":"夜行","appearance":"黑衣"}]}],"name":"乙","appearance":"红衣","looks":[]}],"name":"丙","appearance":"青衣","looks":[]}],"props":[{"name":"钥匙","description":"保存文字 ],\"name\": 与 { }","appearance":"铜制"}],"scenes":[{"name":"庭院","appearance":"石阶"}]}`
	bible, err := ParseBible(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.Characters) != 3 || bible.Characters[0].Name != "甲" || bible.Characters[1].Name != "乙" || bible.Characters[2].Name != "丙" || len(bible.Characters[0].Looks) != 1 {
		t.Fatalf("recovery must retain all characters and looks: %+v", bible)
	}
	if len(bible.Props) != 1 || bible.Props[0].Description != `保存文字 ],"name": 与 { }` || len(bible.Scenes) != 1 || bible.Scenes[0].Name != "庭院" {
		t.Fatalf("recovery must preserve the remaining assets and string contents: %+v", bible)
	}
}

func TestParseBibleRecoversJoinedDescriptionAppearance(t *testing.T) {
	raw := `{"characters":[{"name":"甲","appearance":"白衣"}],"props":[{"name":"车","description":"出行工具。appearance":"黑色车身。"}],"scenes":[]}`
	bible, err := ParseBible(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.Props) != 1 || bible.Props[0].Description != "出行工具。" || bible.Props[0].Appearance != "黑色车身。" {
		t.Fatalf("known adjacent fields must remain separate: %+v", bible.Props)
	}
}

func TestBibleJSONRecoveryRejectsIncompleteOrAmbiguousContent(t *testing.T) {
	for _, raw := range []string{
		`没有 JSON`,
		`{"characters":[{"name":"甲"}],"props":[{"name":"未写完`,
		`{"characters":[{"name":"甲"}],"props":[{"name":"车"}`,
		`{"characters":[{"name":"甲"}]} {"characters":[{"name":"乙"}]}`,
		`{"characters":[{"name":"甲","name":"乙",}]}`,
		`{"characters":[{"name":"甲"}],"props":[{"name":"车","description":"用途appearance":"颜色","appearance":"另一颜色"}]}`,
		`{"characters":[{"name":"甲"}],"unknown":[{"name":"一"}],"name":"二"}]}`,
	} {
		if result, ok := repairBibleJSON(raw); ok {
			t.Fatalf("must not manufacture or discard content: %q => %q", raw, result)
		}
	}
}

func TestBibleJSONRecoveryPreservesEscapesAndRemovesTrailingCommas(t *testing.T) {
	raw := `{"characters":[{"name":"甲","appearance":"引号\"、反斜杠\\、逗号,]与,}",}],}`
	bible, err := ParseBible(raw)
	if err != nil || len(bible.Characters) != 1 || bible.Characters[0].Appearance != "引号\"、反斜杠\\、逗号,]与,}" {
		t.Fatalf("string contents changed: %+v %v", bible, err)
	}
}

func TestBiblePromptUsesValidJSONAndEmptyDefaultLooks(t *testing.T) {
	prompt := BiblePrompt("测试", Settings{}, nil, 1000, nil)
	for _, line := range strings.Split(prompt, "\n") {
		if strings.HasPrefix(line, `{"logline"`) {
			if !json.Valid([]byte(line)) {
				t.Fatal("schema example must itself be valid JSON")
			}
			bible, err := ParseBible(line)
			if err != nil || len(bible.Characters[0].Looks) != 0 {
				t.Fatalf("the default example must not introduce a duplicate outfit: %+v %v", bible, err)
			}
			return
		}
	}
	t.Fatal("missing JSON example")
}
