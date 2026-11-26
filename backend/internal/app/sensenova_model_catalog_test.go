package app

import (
	"encoding/json"
	"testing"
)

func TestSenseNovaCatalogOriginBoundary(t *testing.T) {
	for _, baseURL := range []string{"https://token.sensenova.cn", "https://token.sensenova.cn/v1", "https://token.sensenova.cn/v1/", "https://token.sensenova.cn:443/v1"} {
		if !isSenseNovaModelCatalog(baseURL, "openai") {
			t.Fatalf("official catalog origin rejected: %s", baseURL)
		}
	}
	for _, baseURL := range []string{"http://token.sensenova.cn/v1", "https://token.sensenova.cn.evil.test/v1", "https://proxy.test/sensenova/v1", "https://token.sensenova.cn:8443/v1", "https://token.sensenova.cn/custom/v1", "https://user@token.sensenova.cn/v1", "https://token.sensenova.cn/v1?tenant=test"} {
		if isSenseNovaModelCatalog(baseURL, "openai") {
			t.Fatalf("nonofficial catalog origin accepted: %s", baseURL)
		}
	}
	if isSenseNovaModelCatalog("https://token.sensenova.cn/v1", "gemini") {
		t.Fatal("non-OpenAI directory format accepted")
	}
}

func TestSenseNovaCatalogModalitiesProjection(t *testing.T) {
	for _, test := range []struct {
		model, inputs, outputs, capability string
		images                             bool
		maxImages                          int
	}{
		{senseNovaImageModel, `["text","image"]`, `["image"]`, "image", true, 5},
		{"sensenova-6.8-flash", `["text","image"]`, `["text"]`, "text", true, -1},
		{"glm-5.3", `["text"]`, `["text"]`, "text", false, 0},
		{"kimi-k3", `["text","image"]`, `["text"]`, "text", true, -1},
		{"new-model", `["text"]`, `["image"]`, "image", false, 0},
	} {
		t.Run(test.model, func(t *testing.T) {
			entry := ChannelModelCatalogItem{ID: test.model, ModelType: "text"}
			item := channelModelItem{InputModalities: json.RawMessage(test.inputs), OutputModalities: json.RawMessage(test.outputs)}
			if err := applySenseNovaCatalogModalities(item, &entry); err != nil {
				t.Fatal(err)
			}
			if entry.ModelType != test.capability || entry.SupportsImages == nil || *entry.SupportsImages != test.images {
				t.Fatalf("projected entry = %#v", entry)
			}
			if test.maxImages < 0 && entry.MaxImages != nil || test.maxImages >= 0 && (entry.MaxImages == nil || *entry.MaxImages != test.maxImages) {
				t.Fatalf("unadvertised text reference ceiling must not be invented: %#v", entry)
			}
		})
	}
}

func TestSenseNovaCatalogRejectsMalformedModalities(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `"text"`, `["text","text"]`, `["unknown"]`, `["TEXT"]`, `[1]`} {
		if _, err := parseSenseNovaModalities(json.RawMessage(raw)); err == nil {
			t.Fatalf("malformed modalities accepted: %s", raw)
		}
	}
	entry := ChannelModelCatalogItem{ID: senseNovaImageModel}
	if err := applySenseNovaCatalogModalities(channelModelItem{InputModalities: json.RawMessage(`["text"]`)}, &entry); err == nil {
		t.Fatal("partial metadata accepted")
	}
	if err := applySenseNovaCatalogModalities(channelModelItem{}, &entry); err != nil {
		t.Fatal("unadvertised optional metadata must not invent an error", err)
	}
}

func TestSenseNovaCatalogPreservesTighterReferenceLimits(t *testing.T) {
	item := channelModelItem{InputModalities: json.RawMessage(`["text","image"]`), OutputModalities: json.RawMessage(`["image"]`)}
	entry := ChannelModelCatalogItem{ID: senseNovaImageModel, MaxImages: ptr(2)}
	if err := applySenseNovaCatalogModalities(item, &entry); err != nil || *entry.MaxImages != 2 {
		t.Fatalf("tighter directory limit expanded: %#v, %v", entry, err)
	}
	entry = ChannelModelCatalogItem{ID: senseNovaImageModel, MinImages: ptr(6), MaxImages: ptr(10)}
	if err := applySenseNovaCatalogModalities(item, &entry); err == nil {
		t.Fatal("minimum above the known model ceiling accepted")
	}
}
