package ecommerceagent

import (
	"strings"
	"testing"
)

func TestProductStyleSelectionAndPersistence(t *testing.T) {
	seenProducts := map[string]bool{}
	for _, p := range ProductDesignProfiles {
		styles := ProductStyleLibrary(p.Subject)
		if len(styles) != 20 {
			t.Fatalf("%s: %d library options", p.Subject, len(styles))
		}
		ids := map[string]bool{}
		for _, preset := range styles {
			if ids[preset.Key] {
				t.Fatalf("duplicate option %s", preset.Key)
			}
			ids[preset.Key] = true
			if !CompleteStyleRecommendation(preset.Recommendation()) {
				t.Fatalf("incomplete %s", preset.Key)
			}
			stored, ok := StylePresetByKey(preset.Key)
			if !ok {
				t.Fatalf("cannot select %s", preset.Key)
			}
			stored = AdaptStylePreset(stored, p.Subject)
			if stored.Visual.Scene != preset.Visual.Scene || stored.Label != preset.Label || stored.Visual.Typography != preset.Visual.Typography {
				t.Fatalf("selection changed style %s", preset.Key)
			}
		}
		if seenProducts[styles[0].Key] {
			t.Fatalf("%s reused another product's shortlist", p.Subject)
		}
		seenProducts[styles[0].Key] = true
	}
	juicer := ProductStyleLibrary("便携榨汁机")
	if !strings.Contains(juicer[0].Visual.Scene, "厨房") || !strings.Contains(juicer[0].Visual.Narrative, "鲜果") {
		t.Fatal("juicer story lost preparation and scene")
	}
	if ProductDesignFor("blender").Key != "juicer" {
		t.Fatal("English product not recognized")
	}
}

func TestProductDesignLibraryDoesNotMutateSharedStyles(t *testing.T) {
	original, _ := StylePresetByKey("quiet-healing")
	_ = ProductStyleLibrary("榨汁机")
	after, _ := StylePresetByKey("quiet-healing")
	if original.Visual.Scene != after.Visual.Scene || original.Label != after.Label {
		t.Fatal("product adaptation mutated shared preset")
	}
}
