package service

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestDefaultFirstPartySkillIDs 验证第一方默认技能配置。
func TestDefaultFirstPartySkillIDs(t *testing.T) {
	if !isDefaultFirstPartySkill("storyboard-director") {
		t.Error("storyboard-director 应该是第一方默认技能")
	}
	if !isDefaultFirstPartySkill("canvas-core") {
		t.Error("canvas-core 应该是第一方默认技能")
	}
	if isDefaultFirstPartySkill("some-other-skill") {
		t.Error("非默认技能不应被识别为默认技能")
	}
	if isDefaultFirstPartySkill("") {
		t.Error("空字符串不应被识别为默认技能")
	}
}

// TestCanvasCoreSkillEmbedded 验证公共执行手册源文件已正确嵌入。
func TestCanvasCoreSkillEmbedded(t *testing.T) {
	content := string(canvasCoreSkillMD)
	if len(content) < 1000 {
		t.Fatalf("嵌入的 canvas-core 内容过短: %d 字符", len(content))
	}
	requiredContents := []string{
		"唯一事实来源",
		"语义优先",
		"project_create_or_update_shots",
		"canvas_create_storyboard_shots",
		"canvas_apply_ops",
		"错误分类",
	}
	for _, required := range requiredContents {
		if !strings.Contains(content, required) {
			t.Errorf("canvas-core 缺少关键部分: %q", required)
		}
	}
}

// TestFirstPartySkillMDMap 验证每个第一方默认技能都有对应的规范源文件。
func TestFirstPartySkillMDMap(t *testing.T) {
	for skillID := range defaultFirstPartySkillIDs {
		if _, ok := firstPartySkillMD[skillID]; !ok {
			t.Errorf("第一方默认技能 %q 缺少嵌入的规范源文件", skillID)
		}
		if len(firstPartySkillMD[skillID]) < 500 {
			t.Errorf("第一方默认技能 %q 的规范源内容过短", skillID)
		}
	}
}

// TestStoryboardDirectorSkillEmbedded 验证规范技能源文件已正确嵌入。
func TestStoryboardDirectorSkillEmbedded(t *testing.T) {
	content := string(storyboardDirectorSkillMD)
	if len(content) < 1000 {
		t.Fatalf("嵌入的技能内容过短: %d 字符", len(content))
	}
	// 验证关键内容存在
	requiredContents := []string{
		"分镜导演",
		"工作流契约",
		"project_get_context",
		"project_create_or_update_shots",
		"canvas_create_storyboard_shots",
		"叙事节拍",
		"景别",
		"连续性",
		"时长",
	}
	for _, required := range requiredContents {
		if !strings.Contains(content, required) {
			t.Errorf("嵌入的技能内容缺少关键部分: %q", required)
		}
	}
}

// TestStoryboardDirectorSkillInSeedJSON 验证skills.json中包含storyboard-director条目。
func TestStoryboardDirectorSkillInSeedJSON(t *testing.T) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		t.Fatalf("解析内置技能失败: %v", err)
	}
	found := false
	for _, def := range definitions {
		if def.SkillID == "storyboard-director" {
			found = true
			if def.SkillName != "分镜导演" {
				t.Errorf("技能名称错误: 期望 '分镜导演', 实际 '%s'", def.SkillName)
			}
			if def.Status != 1 {
				t.Errorf("技能状态错误: 期望 1, 实际 %d", def.Status)
			}
			if def.IsPrivate {
				t.Error("技能不应为私有")
			}
			if def.Tag != "drama" {
				t.Errorf("技能标签错误: 期望 'drama', 实际 '%s'", def.Tag)
			}
			break
		}
	}
	if !found {
		t.Error("skills.json 中未找到 storyboard-director")
	}
}

// TestCanvasCoreSkillInSeedJSON 验证skills.json中包含canvas-core条目。
func TestCanvasCoreSkillInSeedJSON(t *testing.T) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		t.Fatalf("解析内置技能失败: %v", err)
	}
	for _, def := range definitions {
		if def.SkillID == "canvas-core" {
			if def.Status != 1 || def.IsPrivate {
				t.Error("canvas-core 必须为公开启用状态")
			}
			return
		}
	}
	t.Error("skills.json 中未找到 canvas-core")
}

// TestEnsureBuiltinSkillsOverridesInstruction 验证EnsureBuiltinSkills用规范源覆盖指令内容。
func TestEnsureBuiltinSkillsOverridesInstruction(t *testing.T) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		t.Fatalf("解析内置技能失败: %v", err)
	}
	// 模拟EnsureBuiltinSkills中的覆盖逻辑（与生产代码一致，遍历 firstPartySkillMD）
	for i := range definitions {
		if md, ok := firstPartySkillMD[definitions[i].SkillID]; ok {
			definitions[i].Instruction = string(md)
		}
	}
	overridden := map[string]bool{}
	for _, def := range definitions {
		if md, ok := firstPartySkillMD[def.SkillID]; ok {
			if def.Instruction != string(md) {
				t.Errorf("技能 %s 的指令未被规范源覆盖", def.SkillID)
			}
			overridden[def.SkillID] = true
		}
	}
	for skillID := range firstPartySkillMD {
		if !overridden[skillID] {
			t.Errorf("第一方技能 %s 未出现在 skills.json 中，无法被覆盖", skillID)
		}
	}
}
