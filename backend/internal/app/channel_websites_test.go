package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestChannelWebsiteVersionsSurviveMicrosecondRoundTrip(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	clock := time.Date(2035, 11, 8, 12, 0, 0, 123456789, time.UTC)
	db.NowFunc = func() time.Time { return clock }
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	req := ChannelWebsiteRequest{Name: "Website", BaseURL: "http://127.0.0.1:18486/v1", APIFormat: "openai"}
	site, err := svc.SaveAdminChannelWebsite(admin, "", req)
	if err != nil {
		t.Fatal(err)
	}
	created := site.CreatedAt
	initialVersion := site.UpdatedAt
	if site.UpdatedAt.Nanosecond()%1000 != 0 || created.Nanosecond()%1000 != 0 {
		t.Fatalf("creation returned sub-microsecond timestamps: created=%v updated=%v", created, site.UpdatedAt)
	}
	for _, name := range []string{"Same clock", "Clock rolled back"} {
		// PostgreSQL persists only microsecond precision. Simulate that storage
		// round trip, while the next request uses the previous JSON response.
		if err := db.Model(&model.ChannelWebsite{}).Where("id = ?", site.ID).UpdateColumn("updated_at", site.UpdatedAt.Truncate(time.Microsecond)).Error; err != nil {
			t.Fatal(err)
		}
		response, err := json.Marshal(site)
		if err != nil {
			t.Fatal(err)
		}
		var previous AdminChannelWebsite
		if err := json.Unmarshal(response, &previous); err != nil {
			t.Fatal(err)
		}
		req.Name, req.ExpectedUpdatedAt = name, previous.UpdatedAt
		site, err = svc.SaveAdminChannelWebsite(admin, site.ID, req)
		if err != nil {
			t.Fatalf("response version rejected after microsecond round trip: %v", err)
		}
		if !site.UpdatedAt.After(previous.UpdatedAt) || site.UpdatedAt.Nanosecond()%1000 != 0 || !site.CreatedAt.Equal(created) {
			t.Fatalf("version not consumed with stable precision: previous=%v next=%v", previous.UpdatedAt, site.UpdatedAt)
		}
		stored, err := svc.repo.ChannelWebsite(site.ID)
		if err != nil || !stored.UpdatedAt.Equal(site.UpdatedAt) || stored.Name != name {
			t.Fatalf("response differs from persisted website: %#v %v", stored, err)
		}
		clock = clock.Add(-time.Hour)
	}

	req.Name, req.ExpectedUpdatedAt = "Stale overwrite", initialVersion
	if _, err := svc.SaveAdminChannelWebsite(admin, site.ID, req); err == nil || !strings.Contains(err.Error(), "已被修改") {
		t.Fatalf("old response version accepted: %v", err)
	}
	stored, err := svc.repo.ChannelWebsite(site.ID)
	if err != nil || stored.Name != site.Name || !stored.UpdatedAt.Equal(site.UpdatedAt) {
		t.Fatalf("rejected edit changed website: %#v %v", stored, err)
	}
}

func TestChannelWebsiteKeysUpdateAndIsolation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	site, err := svc.SaveAdminChannelWebsite(admin, "", ChannelWebsiteRequest{Name: "Website", BaseURL: "http://127.0.0.1:18486/v1", APIFormat: "gemini"})
	if err != nil {
		t.Fatal(err)
	}
	a, err := svc.CreateSystemChannel(admin, ChannelRequest{WebsiteID: site.ID, Name: "Key A", APIKey: "fixture-a", Headers: []OutboundHeader{{Name: "X-Token", Value: "private-a"}}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.CreateSystemChannel(admin, ChannelRequest{WebsiteID: site.ID, Name: "Key B", APIKey: "fixture-b"})
	if err != nil {
		t.Fatal(err)
	}
	if a.WebsiteID != b.WebsiteID || a.APIFormat != "gemini" {
		t.Fatal("website connection not applied")
	}
	_, err = svc.SaveAdminChannelWebsite(admin, site.ID, ChannelWebsiteRequest{Name: "Website", BaseURL: "http://127.0.0.1:18486/tenant", APIFormat: "openai", Headers: []OutboundHeader{{Name: "Anthropic-Version", Value: "2023-06-01"}}, ExpectedUpdatedAt: site.UpdatedAt})
	if err != nil {
		t.Fatal(err)
	}
	var stored model.ModelChannel
	if err := db.First(&stored, "id = ?", a.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored.HeadersJSON, "private-a") || !strings.Contains(stored.HeadersJSON, "2023-06-01") || stored.BaseURL != "http://127.0.0.1:18486/tenant" {
		t.Fatal("website update dropped private headers or missed child")
	}
	if err := svc.DeleteAdminChannelWebsite(admin, site.ID); err == nil {
		t.Fatal("deleted nonempty website")
	}
	detached, err := svc.UpdateSystemChannel(admin, a.ID, ChannelRequest{ExpectedUpdatedAt: stored.UpdatedAt, BaseURL: "http://127.0.0.1:18486/other"})
	if err != nil {
		t.Fatal(err)
	}
	if detached.WebsiteID == a.WebsiteID || detached.WebsiteID == "" {
		t.Fatal("connection edit did not detach")
	}
	other, err := svc.adminSystemChannel(b.ID)
	if err != nil || other.APIKey != "fixture-b" || other.BaseURL != "http://127.0.0.1:18486/tenant" {
		t.Fatal("sibling connection or credential changed")
	}
	if _, err := svc.AdminChannelWebsites(&model.User{ID: "user"}); err == nil {
		t.Fatal("non-admin read accepted")
	}
	if _, err := svc.SaveAdminChannelWebsite(admin, "", ChannelWebsiteRequest{Name: "Bad", BaseURL: "http://127.0.0.1", Headers: []OutboundHeader{{Name: "Authorization", Value: "private"}}}); err == nil {
		t.Fatal("credential promoted to shared header")
	}
}

func TestChannelCatalogDiffFailureAndSourceChanges(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	mode := "first"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-a" && mode != "keychange" {
			t.Error("wrong key")
		}
		w.Header().Set("Content-Type", "application/json")
		switch mode {
		case "first":
			_, _ = w.Write([]byte(`{"data":[{"id":"a"},{"id":"b"}]}`))
		case "second":
			_, _ = w.Write([]byte(`{"data":[{"id":"b"},{"id":"c"}]}`))
		case "failure":
			_, _ = w.Write([]byte(`{"unexpected":true}`))
		case "race":
			db.Model(&model.ModelChannel{}).Where("id = ?", "channel").UpdateColumn("api_key", "changed-during-read")
			_, _ = w.Write([]byte(`{"data":[{"id":"wrong"}]}`))
		case "keychange":
			_, _ = w.Write([]byte(`{"data":[{"id":"new-key-model"}]}`))
		}
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "A", BaseURL: upstream.URL + "/v1", APIKey: "fixture-a", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	first, err := svc.ReadAdminChannelCatalog(context.Background(), admin, channel.ID)
	if err != nil || !first.FirstRead || len(first.Added) != 2 {
		t.Fatalf("first read: %#v %v", first, err)
	}
	mode = "second"
	second, err := svc.ReadAdminChannelCatalog(context.Background(), admin, channel.ID)
	if err != nil || strings.Join(second.Added, ",") != "c" || strings.Join(second.Missing, ",") != "a" || strings.Join(second.Retained, ",") != "b" {
		t.Fatalf("diff: %#v %v", second, err)
	}
	mode = "failure"
	if _, err := svc.ReadAdminChannelCatalog(context.Background(), admin, channel.ID); err == nil {
		t.Fatal("invalid catalog accepted")
	}
	mode = "race"
	if _, err := svc.ReadAdminChannelCatalog(context.Background(), admin, channel.ID); err == nil || !strings.Contains(err.Error(), "读取期间") {
		t.Fatalf("stale read accepted: %v", err)
	}
	snapshot, err := svc.repo.ChannelCatalogSnapshot(channel.ID)
	if err != nil || !snapshot.ReadAt.Equal(second.ReadAt) {
		t.Fatal("failed read replaced baseline")
	}
	mode = "keychange"
	reset, err := svc.ReadAdminChannelCatalog(context.Background(), admin, channel.ID)
	if err != nil || !reset.BaselineReset || len(reset.Missing) != 0 {
		t.Fatalf("wrong reset: %#v %v", reset, err)
	}
}

func TestChannelCatalogUsesProxyAndCompletePagination(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, _ := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	requests := 0
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("proxy request missing group credential")
		}
		if r.URL.Query().Get("after") == "" {
			_, _ = w.Write([]byte(`{"data":[{"id":"a"}],"has_more":true}`))
		} else {
			_, _ = w.Write([]byte(`{"data":[{"id":"b"}],"has_more":false}`))
		}
	}))
	defer proxy.Close()
	items, err := svc.FetchChannelModels(context.Background(), admin, ChannelModelsRequest{BaseURL: "http://127.0.0.1:1/v1", APIKey: "fixture", ProxyURL: proxy.URL})
	if err != nil || strings.Join(items, ",") != "a,b" || requests != 2 {
		t.Fatalf("proxy/pagination: %#v %v %d", items, err, requests)
	}
}

func TestChannelProtocolSelectionOnlyExplicitChangesAndSiteScope(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	site := model.ChannelWebsite{ID: "site", Scope: model.ChannelScopeSystem, Name: "Site", BaseURL: "https://example.com/v1", APIFormat: "openai", HeadersJSON: "[]"}
	if err := db.Create(&site).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		if err := db.Create(&model.ModelChannel{ID: id, WebsiteID: site.ID, Scope: model.ChannelScopeSystem, Name: id, BaseURL: site.BaseURL, APIFormat: "openai", APIKey: "fixture"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	disabled := false
	req := ChannelModelRequest{ModelKey: "same", ProviderModelKey: "same", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), Enabled: &disabled}
	req.CapabilityConfig = DefaultModelCapabilityConfigForModel(req.Protocol, req.ProviderModelKey)
	item, err := svc.SaveAdminChannelModel(admin, "a", "", req)
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.AdminChannelProtocolSuggestion(admin, "b", "same", "text")
	if err != nil || first.Source != "selection" || first.Protocol != req.Protocol {
		t.Fatalf("suggestion: %#v %v", first, err)
	}
	var before int64
	db.Model(&model.ChannelProtocolSelection{}).Count(&before)
	req.DisplayName = "Renamed"
	req.ExpectedUpdatedAt, req.ExpectedPriceVersion = item.UpdatedAt, item.PriceVersion
	if _, err := svc.SaveAdminChannelModel(admin, "a", item.ID, req); err != nil {
		t.Fatal(err)
	}
	var after int64
	db.Model(&model.ChannelProtocolSelection{}).Count(&after)
	if before != after {
		t.Fatal("unchanged protocol refreshed selection")
	}
	req.ProtocolSelectionExplicit = &disabled
	if _, err := svc.SaveAdminChannelModel(admin, "b", "", req); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.ChannelProtocolSelection{}).Count(&after)
	if before != after {
		t.Fatal("automatic prefill refreshed selection")
	}
	if _, err := svc.UpdateAdminChannelModelsProtocol(admin, "a", []string{item.ID}, req.Protocol); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.ChannelProtocolSelection{}).Count(&after)
	if before != after {
		t.Fatal("same batch protocol refreshed selection")
	}
	// A failure after model writes must also roll back the explicit selection.
	if err := db.Migrator().DropTable(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminChannelModelsProtocol(admin, "a", []string{item.ID}, string(model.ChannelInterfaceOpenAIResponse)); err == nil {
		t.Fatal("audit failure accepted")
	}
	rolledBack, err := svc.repo.ChannelModelByID("a", item.ID)
	if err != nil || rolledBack.Protocol != model.ChannelInterfaceChatCompletion {
		t.Fatal("failed batch committed model")
	}
	db.Model(&model.ChannelProtocolSelection{}).Count(&after)
	if before != after {
		t.Fatal("failed batch committed selection")
	}
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminChannelModelsProtocol(admin, "a", []string{item.ID}, string(model.ChannelInterfaceOpenAIResponse)); err != nil {
		t.Fatal(err)
	}
	latest, err := svc.AdminChannelProtocolSuggestion(admin, "b", "same", "text")
	if err != nil || latest.Protocol != string(model.ChannelInterfaceOpenAIResponse) {
		t.Fatal("batch selection not remembered")
	}
	if err := db.Create(&model.ChannelProtocolSelection{WebsiteID: site.ID, ProviderModelKey: "invalid", Capability: "text", Protocol: "missing-plugin"}).Error; err != nil {
		t.Fatal(err)
	}
	invalid, err := svc.AdminChannelProtocolSuggestion(admin, "b", "invalid", "text")
	if err != nil || invalid.Source != "invalid" || invalid.Protocol != "" {
		t.Fatal("invalid plugin was suggested")
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "b").UpdateColumn("website_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	suggestion, err := svc.AdminChannelProtocolSuggestion(admin, "b", "unknown", "text")
	if err != nil || suggestion.Source != "none" {
		data, _ := json.Marshal(suggestion)
		t.Fatalf("cross site leak: %s %v", data, err)
	}
}
