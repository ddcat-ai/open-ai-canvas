package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/prompts"
)

func TestChapterAssetsPromptContract(t *testing.T) {
	if !json.Valid([]byte(prompts.ChapterAssetsJSONSchema)) {
		t.Fatal("invalid chapter assets schema")
	}
	for _, tc := range []struct {
		text  string
		valid bool
	}{
		{`{"characters":[],"scenes":[{"name":"车站","description":"空旷站台","prompt":"夜间站台"}],"props":[{"name":"信封","description":"牛皮纸信封","prompt":"信封特写"}]}`, true},
		{`{"characters":[],"scenes":[],"props":[]}`, true},
		{`{"characters":[]}`, false},
		{`{"characters":[],"scenes":[{"name":"车站"}],"props":[]}`, false},
		{`{"characters":[{"name":"张三"}],"scenes":[],"props":[]}`, false},
	} {
		err := validatePromptTemplateResult(promptOperationChapterAssetsExtract, map[string]interface{}{"text": tc.text})
		if (err == nil) != tc.valid {
			t.Fatalf("valid=%v err=%v", tc.valid, err)
		}
	}
}
