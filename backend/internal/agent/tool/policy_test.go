package tool

import (
	"reflect"
	"sort"
	"testing"
)

// 迁移前散落在 app 包里的分类表，逐字抄录用于证明注册表推导结果等价。
var (
	legacyWrite      = []string{"canvas_apply_ops", "canvas_arrange_nodes", "generate_media", "image_layer_split", "canvas_create_storyboard", "canvas_edit_storyboard", "canvas_edit_batch_table", "canvas_create_character", "previs_scene_create", "previs_apply_patch", "drama_adopt_canvas_media"}
	legacyCacheable  = []string{"agent_profile_read", "canvas_get_state", "canvas_read_storyboard", "previs_scene_read", "skill_read_file", "model_list"}
	legacyReadOnly   = []string{"agent_profile_read", "canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "previs_scene_read", "canvas_read_batch_table", "canvas_list_node_types", "skill_read_file", "skill_search", "skill_market_search", "model_list", "task_get", "drama_get_context"}
	legacyCanvasRev  = []string{"canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "previs_scene_read"}
	legacyOffsetNorm = []string{"skill_read_file", "canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "canvas_read_batch_table"}
	legacyMedia      = []string{"generate_media", "image_layer_split"}
)

func pick(pred func(Policy) bool) []string {
	out := []string{}
	for _, name := range Names() {
		if pred(Of(name)) {
			out = append(out, name)
		}
	}
	return out
}

func sorted(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func TestRegistryMatchesLegacyClassification(t *testing.T) {
	cases := []struct {
		name string
		want []string
		pred func(Policy) bool
	}{
		{"write", legacyWrite, Policy.Write},
		{"cacheable", legacyCacheable, func(p Policy) bool { return p.Cacheable }},
		{"readOnly", legacyReadOnly, Policy.ReadOnly},
		{"canvasRevision", legacyCanvasRev, func(p Policy) bool { return p.CacheScope == CacheCanvasRevision }},
		{"offsetDefaults", legacyOffsetNorm, func(p Policy) bool { return len(p.OffsetDefaults) > 0 }},
		{"media", legacyMedia, Policy.Media},
	}
	for _, tc := range cases {
		if got := pick(tc.pred); !reflect.DeepEqual(got, sorted(tc.want)) {
			t.Errorf("%s: got %v want %v", tc.name, got, sorted(tc.want))
		}
	}
}

func TestCacheableToolsAreReadOnly(t *testing.T) {
	for _, name := range Names() {
		p := Of(name)
		if p.Cacheable && !p.ReadOnly() {
			t.Errorf("%s 可缓存但不是只读工具", name)
		}
	}
}
