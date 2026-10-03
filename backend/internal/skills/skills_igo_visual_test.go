package skills

import (
	"strings"
	"testing"
)

func TestBuiltinIGOVisualDesignIsIsolatedEcommerceSkill(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range packages {
		if item.skill.ID != "igo-visual-design" {
			continue
		}
		if item.skill.Name != "电商视觉设计" || item.skill.Tag != "ecommerce" || item.skill.SourceType != "builtin" {
			t.Fatalf("skill metadata = %+v", item.skill)
		}
		body := string(item.archive.Files["SKILL.md"])
		for _, marker := range []string{"agentSurfaces: [\"creation\"]", "commerce_plan_submit", "目标语言", "中文审核", "竞品", "整套"} {
			if !strings.Contains(body, marker) {
				t.Fatalf("skill missing %q", marker)
			}
		}
		return
	}
	t.Fatal("电商视觉设计未进入内置技能目录")
}
