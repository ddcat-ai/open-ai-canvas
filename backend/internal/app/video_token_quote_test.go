package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func TestVideoTokenChannelQuoteAgreesWithTaskBilling(t *testing.T) {
	for _, test := range []struct {
		name      string
		audio     any
		free      bool
		wantTier  string
		wantPrice int64
		wantCost  int64
	}{
		{name: "audio default", wantTier: "video-audio", wantPrice: 16_000_000, wantCost: 1_900_800},
		{name: "explicit audio", audio: true, wantTier: "video-audio", wantPrice: 16_000_000, wantCost: 1_900_800},
		{name: "silent", audio: false, wantTier: "video-silent", wantPrice: 8_000_000, wantCost: 950_400},
		{name: "configured free", audio: true, free: true, wantTier: "video-audio"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
			if test.free {
				if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", test.wantTier).Update("output_token_price_microcredits", 0).Error; err != nil {
					t.Fatal(err)
				}
			}
			intent := ModelRequestIntent{Capability: "video", Options: map[string]any{
				"vquality": "720p", "size": "16:9", "videoSeconds": 5,
			}}
			if test.audio != nil {
				intent.Options["videoGenerateAudio"] = test.audio
			}
			quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
			if err != nil {
				t.Fatalf("QuoteChannelModel() error = %v", err)
			}
			assertVideoTokenQuote(t, quote, test.wantCost)
			assertVideoQuoteHasNoFinancialWrites(t, db)

			input := quoteInput(intent, channelModel.ModelKey)
			input["config"].(map[string]any)["channelId"] = channel.ID
			resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_video", "")
			if err != nil {
				t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
			}
			order, err := svc.taskBillingOrder("quote-user", &model.Task{ID: "video-task", Type: "canvas_video"}, resolved)
			if err != nil {
				t.Fatalf("taskBillingOrder() error = %v", err)
			}
			if order == nil || order.PriceTierID != test.wantTier || order.OutputTokenPriceMicrocredits != test.wantPrice || order.InputTokenPriceMicrocredits != 0 || order.CachedTokenPriceMicrocredits != 0 {
				t.Fatalf("wrong video price tier: %#v", order)
			}
			if order.AmountMicrocredits != quote.AmountMicrocredits || order.ReservedAmountMicrocredits != quote.AmountMicrocredits || order.Quantity != quote.Quantity {
				t.Fatalf("quote and task reservation disagree: quote=%#v order=%#v", quote, order)
			}
			assertVideoQuoteHasNoFinancialWrites(t, db)
		})
	}
}

func TestVideoTokenLogicalQuoteAgreesWithSystemChannel(t *testing.T) {
	for _, policy := range []string{"channel", "unified"} {
		t.Run(policy, func(t *testing.T) {
			svc, db, channel, channelModel, profile := newVideoTokenQuoteFixture(t)
			spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
			if err != nil {
				t.Fatal(err)
			}
			specJSON, err := json.Marshal(spec)
			if err != nil {
				t.Fatal(err)
			}
			logical := model.LogicalModel{
				ID: "logical-video", Code: "seedance-video", Capability: "video", Enabled: true,
				ActiveRevisionID: "video-revision", PricePolicy: policy, BillingMode: "token", OutputPriceMicrocredits: 16_000_000,
			}
			revision := model.LogicalModelRevision{
				ID: logical.ActiveRevisionID, LogicalModelID: logical.ID, Version: 1,
				CapabilitySpecJSON: string(specJSON),
				DefaultOptionsJSON: `{"vquality":"720p","size":"16:9","videoSeconds":5,"videoGenerateAudio":true}`,
			}
			route := model.LogicalModelRoute{
				ID: "video-route", LogicalModelRevisionID: revision.ID, ChannelModelID: channelModel.ID, Enabled: true, Weight: 1,
			}
			for _, row := range []any{&logical, &revision, &route} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			intent := ModelRequestIntent{Capability: "video"}
			logicalQuote, err := svc.QuoteLogicalModel(logical.ID, intent)
			if err != nil {
				t.Fatalf("QuoteLogicalModel() error = %v", err)
			}
			assertVideoTokenQuote(t, logicalQuote, 1_900_800)
			if logicalQuote.LogicalModelID != logical.ID {
				t.Fatalf("logicalModelId = %q, want %q", logicalQuote.LogicalModelID, logical.ID)
			}
			channelQuote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
			if err != nil {
				t.Fatal(err)
			}
			if logicalQuote.AmountMicrocredits != channelQuote.AmountMicrocredits || logicalQuote.Quantity != channelQuote.Quantity || !reflect.DeepEqual(logicalQuote.VideoTokenEstimate, channelQuote.VideoTokenEstimate) {
				t.Fatalf("logical and channel quote disagree: logical=%#v channel=%#v", logicalQuote, channelQuote)
			}
			assertVideoQuoteHasNoFinancialWrites(t, db)
		})
	}
}

func TestVideoTokenChannelQuoteRejectsUnavailableChannel(t *testing.T) {
	for _, test := range []struct {
		name  string
		field string
		value any
	}{
		{name: "disabled channel", field: "enabled", value: false},
		{name: "private channel", field: "scope", value: model.ChannelScopeUser},
		{name: "disabled model", field: "enabled", value: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
			row, id := any(&model.ModelChannel{}), channel.ID
			if test.name == "disabled model" {
				row, id = &model.ChannelModel{}, channelModel.ID
			}
			if err := db.Model(row).Where("id = ?", id).Update(test.field, test.value).Error; err != nil {
				t.Fatal(err)
			}
			quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: ModelRequestIntent{Capability: "video"}})
			if err == nil || quote != nil {
				t.Fatalf("unavailable channel/model must be rejected: quote=%#v error=%v", quote, err)
			}
			assertVideoQuoteHasNoFinancialWrites(t, db)
		})
	}
}

func TestVideoTokenQuoteRejectsInvalidReferenceCounts(t *testing.T) {
	for _, count := range []int{-1, 129, int(^uint(0) >> 1)} {
		for _, kind := range []string{"image", "video", "audio"} {
			t.Run(fmt.Sprintf("%s/%d", kind, count), func(t *testing.T) {
				intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{kind: count}}
				// A nil repository verifies counts fail before allocation, lookup, or routing.
				svc := &Service{}
				if quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: "system-video", ModelKey: "video", Intent: intent}); err == nil || quote != nil {
					t.Fatalf("channel quote must reject invalid count: quote=%#v error=%v", quote, err)
				}
				if quote, err := svc.QuoteLogicalModel("logical-video", intent); err == nil || quote != nil {
					t.Fatalf("logical quote must reject invalid count: quote=%#v error=%v", quote, err)
				}
			})
		}
	}
}

func newVideoTokenQuoteFixture(t *testing.T) (*Service, *gorm.DB, model.ModelChannel, model.ChannelModel, *ModelCapabilityConfig) {
	t.Helper()
	const providerModel = "doubao-seedance-1-5-pro-251215"
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), providerModel)
	profile.Video.Duration.Default = 5
	tiers := []model.ChannelModelPriceTier{
		{ID: "video-audio", SelectorKey: `{"videoGenerateAudio":"true"}`, SelectorJSON: `{"videoGenerateAudio":"true"}`, ProviderModelKey: providerModel, BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000, PriceConfigured: true, Enabled: true},
		{ID: "video-silent", SelectorKey: `{"videoGenerateAudio":"false"}`, SelectorJSON: `{"videoGenerateAudio":"false"}`, ProviderModelKey: providerModel, BillingMode: "token", OutputTokenPriceMicrocredits: 8_000_000, PriceConfigured: true, Enabled: true},
	}
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceVolcengineArkVideo, profile, tiers)
	channelModel.ProviderModelKey = providerModel
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("provider_model_key", providerModel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	account := model.CreditAccount{UserID: "quote-user", AvailableMicrocredits: 10_000_000, ReservedMicrocredits: 250_000, Version: 7}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, channel, channelModel, profile
}

func assertVideoTokenQuote(t *testing.T, quote *LogicalModelQuote, amount int64) {
	t.Helper()
	if quote == nil || quote.BillingMode != "token" || !quote.Estimated || quote.Quantity != 118_800 || quote.AmountMicrocredits != amount {
		t.Fatalf("unexpected video quote: %#v, want 118800 tokens and %d microcredits", quote, amount)
	}
	want := VideoTokenEstimate{
		FormulaTokens: 108_000, ReservedTokens: 118_800, OutputWidth: 1280, OutputHeight: 720,
		FramesPerSecond: 24, OutputSeconds: 5, ReservationMarginPercent: 10,
	}
	if quote.VideoTokenEstimate == nil || *quote.VideoTokenEstimate != want {
		t.Fatalf("video estimate = %#v, want %#v", quote.VideoTokenEstimate, want)
	}
}

func assertVideoQuoteHasNoFinancialWrites(t *testing.T, db *gorm.DB) {
	t.Helper()
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "quote-user").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 10_000_000 || account.ReservedMicrocredits != 250_000 || account.Version != 7 {
		t.Fatalf("read-only quote changed the credit account: %#v", account)
	}
	for _, row := range []any{&model.BillingOrder{}, &model.CreditLedgerEntry{}, &model.Task{}} {
		var count int64
		if err := db.Model(row).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("read-only quote created %d records of %T", count, row)
		}
	}
}
