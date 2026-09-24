package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestResolveScenarioPreRouting(t *testing.T) {
	// 夹具技能的 ID 用种子 market 的 skill_id（与 skills.json 对齐），
	// 验证路由匹配按 ID 精确命中，而不是按名称或目录 slug。
	skills := []cloudAgentSkill{
		{
			ID:          "14811816983052",
			Name:        "故事开发",
			Description: "从零开发故事：定位声明、logline、节拍",
			Files: map[string]string{
				"SKILL.md": "# 故事开发\n...",
			},
		},
		{
			ID:          "14811816970508",
			Name:        "叙事短片导演分镜",
			Description: "导演意图书、九列分镜表与逐 Clip 提示词",
			Files: map[string]string{
				"SKILL.md": "# 叙事短片导演分镜\n...",
			},
		},
	}

	// 1. 结构与大纲
	resStructure := resolveScenarioPreRouting("请帮我设计一个20集的都市战神短剧故事大纲，要有开篇卡点", skills)
	if resStructure == nil || resStructure.ScenarioID != "drama_structure" {
		t.Fatalf("未能识别短剧大纲场景: %+v", resStructure)
	}
	if len(resStructure.MatchedSkillFiles) == 0 {
		t.Fatalf("未能匹配已启用的结构卡片")
	}
	guide := formatScenarioRoutingGuide(resStructure)
	if !strings.Contains(guide, "短剧结构策划与节奏卡点") || !strings.Contains(guide, "14811816983052") {
		t.Fatalf("生成的场景导语不符合预期: %s", guide)
	}

	// 2. 镜头分镜调度
	resShot := resolveScenarioPreRouting("给这一幕设计分镜，注意机位轴线和景深特写", skills)
	if resShot == nil || resShot.ScenarioID != "cinematography_directing" {
		t.Fatalf("未能识别分镜机位调度场景: %+v", resShot)
	}
	if !strings.Contains(resShot.Principles, "180度机位轴线") {
		t.Fatalf("视听原则缺失关键要义: %s", resShot.Principles)
	}

	// 3. 冲突与反转
	resTwist := resolveScenarioPreRouting("这段戏情绪不够强烈，需要设计身份错位和意想不到的爽点反转", skills)
	if resTwist == nil || resTwist.ScenarioID != "dramatic_twist" {
		t.Fatalf("未能识别反转场景: %+v", resTwist)
	}

	// 4. 角色与对白
	resCharacter := resolveScenarioPreRouting("这个主角的人设立不住，台词也太空，帮我打磨对白和潜台词", skills)
	if resCharacter == nil || resCharacter.ScenarioID != "character_dialogue" {
		t.Fatalf("未能识别角色对白场景: %+v", resCharacter)
	}

	// 5. 空白与无关输入
	if resEmpty := resolveScenarioPreRouting("", skills); resEmpty != nil {
		t.Fatalf("空输入不应返回场景结果")
	}
	if resGeneric := resolveScenarioPreRouting("今天天气真好，1+1等于几", skills); resGeneric != nil {
		t.Fatalf("无关闲聊不应误判场景: %+v", resGeneric)
	}

	// 6. 推荐位全部是种子 skill_id 形态（防止再引入目录 slug）
	for _, rule := range builtinScenarioRules {
		for _, rec := range rule.RecommendedSkills {
			if strings.ContainsAny(rec, "-_") {
				t.Fatalf("规则 %s 的推荐位不是种子 skill_id: %s", rule.ID, rec)
			}
		}
		// 6b. 关键词不得含单字泛词（裸「第」「集」会命中「第一次」「集合」造成误路由）
		for _, kw := range rule.Keywords {
			if utf8.RuneCountInString(kw) < 2 {
				t.Fatalf("规则 %s 的关键词含单字泛词: %q", rule.ID, kw)
			}
		}
	}

	// 7. judian 工位技能已进对应规则推荐位（与同批上架的种子对齐）
	ruleByID := map[string][]string{}
	for _, rule := range builtinScenarioRules {
		ruleByID[rule.ID] = rule.RecommendedSkills
	}
	for ruleID, want := range map[string][]string{
		"drama_structure":          {"16000000000115"},
		"dramatic_twist":           {"16000000000115"},
		"cinematography_directing": {"16000000000115", "16000000000117"},
		"character_dialogue":       {"16000000000116"},
	} {
		got := ruleByID[ruleID]
		for _, w := range want {
			found := false
			for _, g := range got {
				if g == w {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("规则 %s 的推荐位缺少工位技能 %s: %v", ruleID, w, got)
			}
		}
	}
}
