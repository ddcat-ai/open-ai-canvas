package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestReferenceTransportInheritanceAndValidation(t *testing.T) {
	channel := &ReferenceMediaTransport{Image: "url", Audio: "base64", Video: "url"}
	got := resolveReferenceMediaTransport(channel, &ReferenceMediaTransport{Image: "base64", Audio: "inherit", Video: "protocol"})
	if got.Image != "base64" || got.Audio != "base64" || got.Video != "" {
		t.Fatalf("inheritance=%#v", got)
	}
	if resolveReferenceMediaTransport(nil, nil) != (ReferenceMediaTransport{}) {
		t.Fatal("empty settings changed defaults")
	}
	if _, err := normalizeReferenceMediaTransport(&ReferenceMediaTransport{Video: "automatic-retry"}); err == nil {
		t.Fatal("invalid transport accepted")
	}
	for _, pair := range []struct{ capability, protocol string }{{"text", "chat-completion"}, {"image", "openai-image"}, {"video", "xai-video"}} {
		config := DefaultModelCapabilityConfigForModel(pair.protocol, "synthetic-model")
		config.MediaTransport = channel
		normalized, err := NormalizeModelCapabilityConfigForModel(pair.capability, pair.protocol, "synthetic-model", config)
		if err != nil || normalized.MediaTransport == nil || *normalized.MediaTransport != *channel {
			t.Fatalf("normalization lost settings: %s %v", pair.capability, err)
		}
	}
}

func TestReferenceTransportChannelPersistenceAtomicityAndAdminAuthority(t *testing.T) {
	s, db := newChannelModelTestService(t)
	s.dataDir = t.TempDir()
	admin := &model.User{ID: "synthetic-admin", Role: model.UserRoleAdmin}
	channel, err := s.CreateSystemChannel(admin, ChannelRequest{Name: "Synthetic transport", BaseURL: "https://8.8.8.8/v1", APIKey: "synthetic-key", MediaTransport: &ReferenceMediaTransport{Image: "url", Audio: "base64"}})
	if err != nil {
		t.Fatal(err)
	}
	if channel.MediaTransport == nil || channel.MediaTransport.Image != "url" {
		t.Fatal("created response lost policy")
	}
	if _, err = s.UpdateSystemChannel(admin, channel.ID, ChannelRequest{Name: "Synthetic renamed"}); err != nil {
		t.Fatal(err)
	}
	value, err := s.channelMediaTransport(channel.ID)
	if err != nil || value.Image != "url" {
		t.Fatal("unrelated edit cleared policy", err)
	}
	if _, err = s.UpdateSystemChannel(&model.User{ID: "synthetic-user", Role: model.UserRoleUser}, channel.ID, ChannelRequest{MediaTransport: &ReferenceMediaTransport{Image: "base64"}}); err == nil {
		t.Fatal("non-admin changed policy")
	}
	duplicate, err := s.DuplicateSystemChannel(admin, channel.ID)
	if err != nil || duplicate.MediaTransport.Image != "url" {
		t.Fatal("duplicate lost policy", err)
	}
	exported, err := s.ExportSystemChannels(admin, []string{channel.ID})
	if err != nil || exported.Channels[0].MediaTransport.Audio != "base64" {
		t.Fatal("export lost policy", err)
	}
	marker := errors.New("synthetic policy persistence failure")
	if err = db.Callback().Update().Before("gorm:update").Register("synthetic:transport-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "system_settings" {
			tx.AddError(marker)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateSystemChannel(admin, channel.ID, ChannelRequest{Name: "Must roll back", MediaTransport: &ReferenceMediaTransport{Image: "base64"}}); !errors.Is(err, marker) {
		t.Fatal("expected transactional error", err)
	}
	db.Callback().Update().Remove("synthetic:transport-failure")
	stored, err := s.repo.AdminSystemChannel(channel.ID)
	if err != nil || stored.Name != "Synthetic renamed" {
		t.Fatal("channel changed without its policy", err)
	}
	if _, err = s.UpdateSystemChannel(admin, channel.ID, ChannelRequest{MediaTransport: &ReferenceMediaTransport{}}); err != nil {
		t.Fatal(err)
	}
	value, err = s.channelMediaTransport(channel.ID)
	if err != nil || *value != (ReferenceMediaTransport{}) {
		t.Fatal("explicit reset failed", err)
	}
}

func TestReferenceTransportResolutionDoesNotTrustTaskConfig(t *testing.T) {
	s, _ := newChannelModelTestService(t)
	s.dataDir = t.TempDir()
	admin := &model.User{ID: "synthetic-admin", Role: model.UserRoleAdmin}
	channelID := seedTransferChannel(t, s, admin)
	if _, err := s.UpdateSystemChannel(admin, channelID, ChannelRequest{MediaTransport: &ReferenceMediaTransport{Image: "url", Audio: "base64"}}); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{ChannelID: channelID, Model: "gpt-test", CapabilityConfig: &ModelCapabilityConfig{MediaTransport: &ReferenceMediaTransport{Image: "base64"}}}
	resolved, err := s.resolveProviderConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.mediaTransport.Image != "url" || resolved.mediaTransport.Audio != "base64" {
		t.Fatal("client bypassed channel policy")
	}
	var decoded providerConfig
	if err = json.Unmarshal([]byte(`{"mediaTransport":{"image":"url"}}`), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.mediaTransport != (ReferenceMediaTransport{}) {
		t.Fatal("internal policy deserialized from task")
	}
}

func TestReferenceTransportLocalResourceURLBase64AndOwnership(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.com")
	s := newResourceTestService(t)
	payload := []byte("synthetic image content")
	resource, _, err := s.storeResource("synthetic-owner", "image", "reference.png", "image/png", int64(len(payload)), 1, 1, 0, bytes.NewReader(payload), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	original := providerMedia{StorageKey: "resource:" + resource.ID, URL: "https://wrong.example.com/stale.png", DataURL: "data:image/png;base64,c3RhbGU="}
	input := canvasGenerationInput{Mode: "image", Config: providerConfig{mediaTransport: ReferenceMediaTransport{Image: "url"}}, ReferenceImages: []providerMedia{original}}
	if err = s.hydrateGenerationMedia("synthetic-owner", &input, providerMediaHydrationPolicy{}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(input.ReferenceImages[0].URL, "https://canvas.example.com/api/public/resources/") || input.ReferenceImages[0].DataURL != "" {
		t.Fatal("local resource did not become a signed URL")
	}
	input.Config.mediaTransport.Image = "base64"
	input.ReferenceImages = []providerMedia{original}
	if err = s.hydrateGenerationMedia("synthetic-owner", &input, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatal(err)
	}
	media := input.ReferenceImages[0]
	if media.URL != "" || media.DataURL != dataURL("image/png", payload) {
		t.Fatal("Base64 used stale URL or caller-supplied pixels")
	}
	if err = s.hydrateProviderMedia("synthetic-other-user", &media, providerMediaHydrationPolicy{forceBase64: true}); err == nil {
		t.Fatal("resource ownership bypassed")
	}
}

func TestReferenceTransportIndependentKindsAndNoPaidFallback(t *testing.T) {
	s := &Service{}
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{mediaTransport: ReferenceMediaTransport{Image: "base64", Audio: "base64"}}, ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL, URL: "https://example.com/stale"}}, ReferenceAudios: []providerMedia{{DataURL: "data:audio/wav;base64,YQ==", URL: "https://example.com/stale.wav"}}}
	if err := s.hydrateGenerationMedia("synthetic-user", &input, providerMediaHydrationPolicy{}); err != nil {
		t.Fatal(err)
	}
	if input.ReferenceImages[0].URL != "" || input.ReferenceAudios[0].URL != "" {
		t.Fatal("wrong media representation won")
	}
	if _, err := referenceMediaPolicy(providerMediaHydrationPolicy{requireURL: true}, "base64", false); err == nil {
		t.Fatal("URL-only protocol accepted Base64")
	}
	if _, err := referenceMediaPolicy(providerMediaHydrationPolicy{}, "url", true); err == nil {
		t.Fatal("mask file protocol accepted forced URL")
	}
	if err := validateMediaTransportRequest(protocol.RequestSpec{ContentType: "multipart/form-data"}, input); err == nil {
		t.Fatal("multipart silently overrode setting")
	}
	if err := validateMediaTransportRequest(protocol.RequestSpec{ContentType: "application/json"}, input); err != nil {
		t.Fatal(err)
	}
	if err := validateReferenceTransportProtocol(context.Background(), canvasGenerationInput{}); err != nil {
		t.Fatal("default protocol was restricted")
	}
}
