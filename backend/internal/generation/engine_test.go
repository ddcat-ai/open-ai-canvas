package generation_test

import (
	"testing"

	"yingce/backend/internal/generation"
)

func TestGenerationPackageHasEngineAndOfficialRegistry(t *testing.T) {
	engine := generation.NewEngine(generation.Deps{})
	if engine == nil {
		t.Fatal("NewEngine returned nil")
	}
	if name, ok := generation.OfficialDeclarativeImageInterface("openai-image"); !ok || name == "" {
		t.Fatalf("openai-image whitelist = %q %v", name, ok)
	}
	if name, ok := generation.OfficialDeclarativeVideoInterface("volcengine-ark-seedance-25"); !ok || name != "火山方舟" {
		t.Fatalf("volcengine-ark-seedance-25 whitelist = %q %v", name, ok)
	}
	registry := generation.LoadOfficialFallbackRegistry()
	if registry == nil {
		t.Fatal("LoadOfficialFallbackRegistry returned nil")
	}
}
