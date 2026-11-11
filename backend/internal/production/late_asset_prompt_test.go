package production

import (
	"strings"
	"testing"
)

func TestParseAssetBibleAllowsPropsAndScenesOnly(t *testing.T) {
	bible, err := ParseAssetBible(`{"characters":[],"props":[{"name":"铜壳收音机","description":"待修","appearance":"黄铜外壳"}],"scenes":[{"name":"县招待所大堂","appearance":"大理石地面"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.Characters) != 0 || len(bible.Props) != 1 || bible.Props[0].Name != "铜壳收音机" || bible.Scenes[0].Name != "县招待所大堂" {
		t.Fatalf("props and scenes only must parse: %+v", bible)
	}
	if _, err := ParseBible(`{"characters":[],"props":[{"name":"铜壳收音机"}]}`); err == nil {
		t.Fatal("full bible parse must still require a character")
	}
}

func TestLateAssetPromptListsTargetsAndForbidsInvention(t *testing.T) {
	prompt := LateAssetPrompt("从1985修家电开始", Settings{StylePrompt: "1985市井", Language: "中文"}, []LateAsset{
		{Kind: "character", Name: "张维民"},
		{Kind: "prop", Name: "铜壳收音机"},
		{Kind: "scene", Name: "县招待所大堂"},
	}, []Chapter{{Index: 2, Title: "第二章", Text: "张维民身材魁梧，穿藏青色中山装。"}}, "镜1 场景=县招待所大堂 人物=张维民", nil)
	for _, want := range []string{"张维民", "铜壳收音机", "县招待所大堂", "appearance 必须留空", "不要凭名字或身份编造", "【本集原文】", "【本集分镜】", "藏青色中山装"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q: %s", want, prompt)
		}
	}
}
