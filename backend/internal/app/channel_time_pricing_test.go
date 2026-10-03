package app

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestChannelTimePricingWindowBoundaries(t *testing.T) {
	pricing := &model.ChannelTimePricing{Timezone: "Asia/Shanghai", Periods: []model.ChannelTimePricingPeriod{
		{StartTime: "09:00", EndTime: "12:00:30", Multiplier: 1.5},
		{StartTime: "18:00", EndTime: "00:00", Multiplier: 0.5},
	}}
	for _, tc := range []struct {
		at   string
		want int64
	}{
		{"2026-10-01T00:59:59Z", 10_000},
		{"2026-10-01T01:00:00Z", 15_000},
		{"2026-10-01T04:00:29Z", 15_000},
		{"2026-10-01T04:00:30Z", 10_000},
		{"2026-10-01T10:00:00Z", 5_000},
		{"2026-10-01T15:59:59Z", 5_000},
		{"2026-10-01T16:00:00Z", 10_000},
	} {
		at, _ := time.Parse(time.RFC3339, tc.at)
		got, err := channelTimePricingMultiplier(pricing, at)
		if err != nil || got != tc.want {
			t.Fatalf("at %s got %d, %v; want %d", tc.at, got, err, tc.want)
		}
	}
}

func TestChannelTimePricingValidation(t *testing.T) {
	for _, tc := range []struct {
		name, zone, start, end string
		multiplier             float64
		extra                  *model.ChannelTimePricingPeriod
	}{
		{name: "missing zone", start: "09:00", end: "18:00", multiplier: 1},
		{name: "invalid zone", zone: "Invalid/Zone", start: "09:00", end: "18:00", multiplier: 1},
		{name: "host local zone", zone: "Local", start: "09:00", end: "18:00", multiplier: 1},
		{name: "cross midnight", zone: "UTC", start: "18:00", end: "09:00", multiplier: 1},
		{name: "same boundary", zone: "UTC", start: "09:00", end: "09:00", multiplier: 1},
		{name: "short hour", zone: "UTC", start: "9:00", end: "18:00", multiplier: 1},
		{name: "invalid hour", zone: "UTC", start: "25:00", end: "18:00", multiplier: 1},
		{name: "zero multiplier", zone: "UTC", start: "09:00", end: "18:00", multiplier: 0},
		{name: "large multiplier", zone: "UTC", start: "09:00", end: "18:00", multiplier: 101},
		{name: "excess precision", zone: "UTC", start: "09:00", end: "18:00", multiplier: 1.001},
		{name: "nan", zone: "UTC", start: "09:00", end: "18:00", multiplier: math.NaN()},
		{name: "infinite", zone: "UTC", start: "09:00", end: "18:00", multiplier: math.Inf(1)},
		{name: "overlap", zone: "UTC", start: "09:00", end: "18:00", multiplier: 1, extra: &model.ChannelTimePricingPeriod{StartTime: "17:00", EndTime: "19:00", Multiplier: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pricing := &model.ChannelTimePricing{Timezone: tc.zone, Periods: []model.ChannelTimePricingPeriod{{StartTime: tc.start, EndTime: tc.end, Multiplier: tc.multiplier}}}
			if tc.extra != nil {
				pricing.Periods = append(pricing.Periods, *tc.extra)
			}
			if err := validateChannelTimePricing(pricing); err == nil {
				t.Fatal("invalid pricing accepted")
			}
		})
	}
	pricing := &model.ChannelTimePricing{Timezone: "UTC", Periods: []model.ChannelTimePricingPeriod{{StartTime: "00:00", EndTime: "09:00", Multiplier: .01}, {StartTime: "09:00", EndTime: "00:00", Multiplier: 100}}}
	if err := validateChannelTimePricing(pricing); err != nil {
		t.Fatal(err)
	}
}

func TestChannelTimePricingSaveRoundTripAndClear(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	channel := model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true, ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	req := ChannelModelRequest{ModelKey: "model", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "model"), PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, TimePricing: &model.ChannelTimePricing{Timezone: " Asia/Shanghai ", Periods: []model.ChannelTimePricingPeriod{{StartTime: " 09:00 ", EndTime: "18:00", Multiplier: 1.2}}}}}}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	var tier model.ChannelModelPriceTier
	if err := db.First(&tier, "id = ?", saved.PriceTiers[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if tier.TimePricing == nil || tier.TimePricing.Timezone != "Asia/Shanghai" || tier.TimePricing.Periods[0].StartTime != "09:00" || tier.TimePricing.Periods[0].Multiplier != 1.2 {
		t.Fatalf("round trip: %#v", tier.TimePricing)
	}
	if req.PriceTiers[0].TimePricing.Timezone != " Asia/Shanghai " {
		t.Fatal("normalization mutated request")
	}
	req.PriceTiers[0].TimePricing.Periods = nil
	saved, err = svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	tier = model.ChannelModelPriceTier{}
	if err := db.First(&tier, "id = ?", saved.PriceTiers[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if tier.TimePricing != nil {
		t.Fatalf("empty periods did not clear pricing: %#v", tier.TimePricing)
	}
	req.PriceTiers[0].TimePricing = &model.ChannelTimePricing{Timezone: "UTC", Periods: []model.ChannelTimePricingPeriod{{StartTime: "18:00", EndTime: "09:00", Multiplier: 1}}}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err == nil {
		t.Fatal("invalid schedule saved")
	}
}

func TestChannelTimePricingOrderSnapshotAndAudioSettlement(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	pricing := &model.ChannelTimePricing{Timezone: "UTC", Periods: []model.ChannelTimePricingPeriod{{StartTime: "09:00", EndTime: "10:00", Multiplier: 1.5}}}
	item := model.ChannelModel{ID: "audio-model", ChannelID: "channel", ModelKey: "audio", Capability: "audio", Protocol: model.ChannelInterfaceOpenAIAudio, Enabled: true}
	tier := model.ChannelModelPriceTier{ID: "tier", ChannelModelID: item.ID, SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*", BillingMode: "per_second", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true, TimePricing: pricing}
	for _, row := range []any{&item, &tier, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 10_000}, &model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: `{"defaultMultiplierBasisPoints":20000,"modelMultiplierBasisPoints":{"audio":12500}}`}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	pricingAt := time.Date(2026, 10, 1, 9, 30, 0, 0, time.UTC)
	order, err := svc.newBillingOrderWithPriceTierAt("user", "task", "test", "channel", "audio", "audio", "test", 2, tokenBillingEstimate{}, tier.ID, pricingAt)
	if err != nil {
		t.Fatal(err)
	}
	if order.MultiplierBasisPoints != 18_750 || order.AmountMicrocredits != 375 || !order.CreatedAt.Equal(pricingAt) {
		t.Fatalf("unexpected snapshot: %#v", order)
	}
	outside, err := svc.newBillingOrderWithPriceTierAt("user", "", "outside", "channel", "audio", "audio", "test", 2, tokenBillingEstimate{}, tier.ID, pricingAt.Add(time.Hour))
	if err != nil || outside.AmountMicrocredits != 250 {
		t.Fatalf("outside: %#v %v", outside, err)
	}
	if err := svc.repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	// Editing the schedule after reservation must not change settlement.
	if err := db.Model(&tier).Update("time_pricing", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SettleBillingOrderWithAudioDuration(order.ID, "", 2_100); err != nil {
		t.Fatal(err)
	}
	settled, err := svc.repo.BillingOrder(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.ActualAmountMicrocredits != 563 || settled.MultiplierBasisPoints != 18_750 || !settled.CreatedAt.Equal(pricingAt) {
		t.Fatalf("settlement changed snapshot: %#v", settled)
	}
}

func TestChannelTimePricingVideoQuoteMatchesTaskOrder(t *testing.T) {
	svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
	encoded, _ := json.Marshal(&model.ChannelTimePricing{Timezone: "UTC", Periods: []model.ChannelTimePricingPeriod{{StartTime: "00:00", EndTime: "00:00", Multiplier: 1.5}}})
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Update("time_pricing", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
	quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	if err != nil {
		t.Fatal(err)
	}
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_video", "")
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.taskBillingOrder("quote-user", &model.Task{ID: "video-task", Type: "canvas_video"}, resolved)
	if err != nil {
		t.Fatal(err)
	}
	if quote.AmountMicrocredits != 2_851_200 || order.AmountMicrocredits != quote.AmountMicrocredits || order.MultiplierBasisPoints != 15_000 {
		t.Fatalf("quote=%#v order=%#v", quote, order)
	}
	assertVideoQuoteHasNoFinancialWrites(t, db)
}

func TestCombineMultiplierBasisPoints(t *testing.T) {
	for _, tc := range []struct{ base, additional, want int64 }{{12_500, 15_000, 18_750}, {1, 100, 1}, {1_000_000, 1_000_000, 100_000_000}} {
		got, err := combineMultiplierBasisPoints(tc.base, tc.additional)
		if err != nil || got != tc.want {
			t.Fatalf("combine %d %d: %d %v", tc.base, tc.additional, got, err)
		}
	}
	for _, pair := range [][2]int64{{0, 1}, {1, 0}, {math.MaxInt64, 2}, {math.MaxInt64, 1}} {
		if _, err := combineMultiplierBasisPoints(pair[0], pair[1]); err == nil {
			t.Fatal("invalid multiplier accepted")
		}
	}
}

func TestChannelTimePricingRouteSwitchUsesOriginalOrderTime(t *testing.T) {
	svc, db, channel, channelModel, profile := newVideoTokenQuoteFixture(t)
	if err := db.AutoMigrate(&model.RouteAttempt{}); err != nil {
		t.Fatal(err)
	}
	// Place the original order twelve hours away from the current time so
	// recalculating the window with time.Now would produce a different price.
	pricingAt := time.Now().UTC().Add(-12 * time.Hour).Truncate(time.Hour)
	pricing := &model.ChannelTimePricing{Timezone: "UTC", Periods: []model.ChannelTimePricingPeriod{{StartTime: pricingAt.Format("15:04"), EndTime: pricingAt.Add(time.Hour).Format("15:04"), Multiplier: 1.5}}}
	encodedPricing, _ := json.Marshal(pricing)
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", channelModel.ID).Update("time_pricing", string(encodedPricing)).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, _ := json.Marshal(spec)
	logical := model.LogicalModel{ID: "logical", Code: "video-product", Capability: "video", Enabled: true, ActiveRevisionID: "revision", PricePolicy: "channel"}
	revision := model.LogicalModelRevision{ID: "revision", LogicalModelID: logical.ID, Version: 1, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: `{"vquality":"720p","size":"16:9","videoSeconds":5,"videoGenerateAudio":true}`}
	route := model.LogicalModelRoute{ID: "backup", LogicalModelRevisionID: revision.ID, ChannelModelID: channelModel.ID, Enabled: true, Weight: 1}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5, "videoGenerateAudio": true}}
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	input, err = svc.resolveSystemChannelModelSelection(input, "canvas_video", "")
	if err != nil {
		t.Fatal(err)
	}
	inputJSON, _ := json.Marshal(input)
	order, err := svc.newBillingOrderWithPriceTierAt("quote-user", "task", "route-test", channel.ID, channelModel.ModelKey, "video", "test", 5, estimateTaskBillingTokens(input, "video"), "video-audio", pricingAt, intent)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task", UserID: "quote-user", Type: "canvas_video", Status: model.TaskStatusRunning, LogicalModelID: logical.ID, LogicalModelRevisionID: revision.ID, ChannelModelID: channelModel.ID, RouteID: "first", InputJSON: string(inputJSON), BillingOrderID: order.ID}
	for _, row := range []any{&logical, &revision, &route, &task} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	attempt, err := svc.switchTaskToNextRoute(&task, []model.RouteAttempt{{RouteID: "first"}})
	if err != nil {
		t.Fatal(err)
	}
	if attempt.RouteID != route.ID {
		t.Fatalf("unexpected route: %#v", attempt)
	}
	updated, err := svc.repo.BillingOrder(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.MultiplierBasisPoints != 15_000 || updated.AmountMicrocredits != order.AmountMicrocredits || !updated.CreatedAt.Equal(pricingAt) {
		t.Fatalf("route switch changed time snapshot: %#v", updated)
	}
}
