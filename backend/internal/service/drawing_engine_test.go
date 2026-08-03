package service

import "testing"

func TestDefaultDrawingEngineUsesExcalidraw(t *testing.T) {
	setting := defaultDrawingEngineSetting()
	if setting.DefaultEngine != DrawingEngineExcalidraw {
		t.Fatalf("default engine = %q, want %q", setting.DefaultEngine, DrawingEngineExcalidraw)
	}
}

func TestValidateDrawingEngineSetting(t *testing.T) {
	for _, engine := range []string{DrawingEngineTldraw, DrawingEngineExcalidraw} {
		if err := validateDrawingEngineSetting(DrawingEngineSetting{DefaultEngine: engine}); err != nil {
			t.Fatalf("validate engine %q: %v", engine, err)
		}
	}
	if err := validateDrawingEngineSetting(DrawingEngineSetting{DefaultEngine: "unknown"}); err == nil {
		t.Fatal("validate unknown engine = nil")
	}
}
