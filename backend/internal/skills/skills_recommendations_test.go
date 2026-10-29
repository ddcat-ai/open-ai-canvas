package skills

import "testing"

func TestSkillRecommendationsReferenceBuiltinSkills(t *testing.T) {
	if err := ValidateSkillRecommendations(); err != nil {
		t.Fatal(err)
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, industry := range file.Industries {
		if len(industry.Skills) == 0 {
			t.Fatalf("industry %s has no recommended skills", industry.IndustryID)
		}
		seen[industry.IndustryID] = true
	}
	for _, id := range []string{"drama", "ecommerce", "creative", "social"} {
		if !seen[id] {
			t.Fatalf("missing industry %s", id)
		}
	}
}

func TestNormalizeSkillAgentModeDefaultsToAuto(t *testing.T) {
	for input, want := range map[string]string{"": "auto", "auto": "auto", "manual": "manual", "bogus": "auto"} {
		if got := NormalizeSkillAgentMode(input); got != want {
			t.Fatalf("NormalizeSkillAgentMode(%q)=%q want %q", input, got, want)
		}
	}
}
