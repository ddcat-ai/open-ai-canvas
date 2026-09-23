package skills

import (
	"strings"
	"testing"
)

func TestSkillPresetsCatalogIsValid(t *testing.T) {
	svc := New(nil, "", nil)
	presets, err := svc.SkillPresets()
	if err != nil {
		t.Fatal(err)
	}
	if len(presets) == 0 {
		t.Fatal("场景预设目录不能为空")
	}
	seeded := make(map[string]struct{}, 128)
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range seedIDs {
		seeded[id] = struct{}{}
	}
	if len(seeded) == 0 {
		t.Fatal("内置种子技能为空，对账失去意义")
	}
	seen := map[string]struct{}{}
	for _, preset := range presets {
		if _, dup := seen[preset.PresetID]; dup {
			t.Fatalf("presetId 重复: %s", preset.PresetID)
		}
		seen[preset.PresetID] = struct{}{}
		if len(preset.SkillIDs) == 0 || len(preset.SkillIDs) > 8 {
			t.Fatalf("%s 技能数 %d 超出 1-8", preset.PresetID, len(preset.SkillIDs))
		}
		for _, skillID := range preset.SkillIDs {
			// v1 硬约束：preset 只允许引用种子市场已上架技能。
			if _, ok := seeded[skillID]; !ok {
				t.Fatalf("%s 引用未上架技能 %s", preset.PresetID, skillID)
			}
		}
		if preset.Rationale == "" {
			t.Fatalf("%s 缺推荐理由", preset.PresetID)
		}
	}
}

func TestSkillPresetsRejectUnseededSkillReference(t *testing.T) {
	// 防回归：preset 引用一个不在种子清单里的 skillId 时必须被校验拦下，
	// 否则用户一键挂载会遇到装不上的技能（v1 明确禁止）。
	original := builtinSkillPresetsJSON
	defer func() { builtinSkillPresetsJSON = original }()
	builtinSkillPresetsJSON = []byte(`{"version":1,"presets":[{"presetId":"bad","name":"坏预设","scene":"drama","skillIds":["16000000000099","99999999999999"],"rationale":"引用了不存在的技能","source":"hand-curated","evidence":"E4","upgrade":""}]}`)
	svc := New(nil, "", nil)
	if _, err := svc.SkillPresets(); err == nil || !strings.Contains(err.Error(), "未上架技能") {
		t.Fatalf("应拒绝未上架技能引用，实际: %v", err)
	}
}

func TestSkillPresetsRejectInvalidSkillSeed(t *testing.T) {
	original := builtinSkillsJSON
	defer func() { builtinSkillsJSON = original }()
	builtinSkillsJSON = []byte(`not-json`)
	if _, err := New(nil, "", nil).SkillPresets(); err == nil || !strings.Contains(err.Error(), "解析内置技能失败") {
		t.Fatalf("应明确报告内置技能种子损坏，实际: %v", err)
	}
}

func TestSkillPresetsIgnoreDisabledOrPrivateSeeds(t *testing.T) {
	original := builtinSkillsJSON
	defer func() { builtinSkillsJSON = original }()
	builtinSkillsJSON = []byte(`[
		{"skill_id":"enabled-public","status":1,"is_private":false},
		{"skill_id":"disabled-public","status":0,"is_private":false},
		{"skill_id":"enabled-private","status":1,"is_private":true}
	]`)

	originalPresets := builtinSkillPresetsJSON
	defer func() { builtinSkillPresetsJSON = originalPresets }()
	builtinSkillPresetsJSON = []byte(`{"version":1,"presets":[{"presetId":"ok","name":"可用预设","scene":"drama","skillIds":["enabled-public"],"rationale":"只引用公开启用技能","source":"hand-curated","evidence":"E4","upgrade":""}]}`)

	if _, err := New(nil, "", nil).SkillPresets(); err != nil {
		t.Fatalf("公开启用种子应可被预设引用: %v", err)
	}

	for _, skillID := range []string{"disabled-public", "enabled-private"} {
		builtinSkillPresetsJSON = []byte(`{"version":1,"presets":[{"presetId":"bad","name":"非法预设","scene":"drama","skillIds":["` + skillID + `"],"rationale":"不应通过校验","source":"hand-curated","evidence":"E4","upgrade":""}]}`)
		if _, err := New(nil, "", nil).SkillPresets(); err == nil || !strings.Contains(err.Error(), "未上架技能") {
			t.Fatalf("%s 不应被视为已上架，实际: %v", skillID, err)
		}
	}
}

func TestSkillPresetsRejectOverBudgetAndTelemetrySource(t *testing.T) {
	original := builtinSkillPresetsJSON
	defer func() { builtinSkillPresetsJSON = original }()
	// 超过 8 个激活位必须被拒（影策每轮最多激活 8 个技能）。
	builtinSkillPresetsJSON = []byte(`{"version":1,"presets":[{"presetId":"big","name":"超大预设","scene":"drama","skillIds":["a","b","c","d","e","f","g","h","i"],"rationale":"超预算","source":"hand-curated","evidence":"E4","upgrade":""}]}`)
	svc := New(nil, "", nil)
	if _, err := svc.SkillPresets(); err == nil || !strings.Contains(err.Error(), "1-8") {
		t.Fatalf("应拒绝超 8 技能预设，实际: %v", err)
	}
	// v1 只允许手工策展：遥测驱动的预设要等 #590 有数据后才放开。
	builtinSkillPresetsJSON = []byte(`{"version":1,"presets":[{"presetId":"tele","name":"遥测预设","scene":"drama","skillIds":["16000000000099"],"rationale":"数据驱动","source":"telemetry","evidence":"E4","upgrade":""}]}`)
	if _, err := svc.SkillPresets(); err == nil || !strings.Contains(err.Error(), "hand-curated") {
		t.Fatalf("应拒绝非手工策展来源，实际: %v", err)
	}
}
