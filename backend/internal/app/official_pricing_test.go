package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestOfficialPricingSalePersonalAndHistoricalSnapshot(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.BillingOrder{}, &model.UserGroupRates{}, &model.AdminAuditEvent{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "reference-channel", Scope: model.ChannelScopeSystem, Name: "Reference", Enabled: true, ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	req := ChannelModelRequest{ModelKey: "reference-model", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "reference-model"), PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 8_000_000, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 5_000_000}, OfficialPricing: model.OfficialPricing{Configured: true, UnitPriceMicrocredits: 10_000_000}}}}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	view, err := svc.AdminModelDisplayGroups(admin)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminModelDisplayGroups(admin, ModelDisplayGroupsRequest{ExpectedSnapshot: view.Snapshot, Groups: []ModelDisplayGroup{{ID: "enterprise", Name: "Enterprise", ModelIDs: []string{saved.ID}}}}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserGroupRates{UserID: "enterprise-user", RatesJSON: `{"enterprise":9000}`, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "text"}
	for _, tc := range []struct {
		user string
		want int64
	}{{"ordinary-user", 8_000_000}, {"enterprise-user", 7_200_000}} {
		quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: saved.ModelKey, Intent: intent}, tc.user)
		if err != nil {
			t.Fatal(err)
		}
		order, err := svc.newBillingOrder(tc.user, "task-"+tc.user, "request-"+tc.user, channel.ID, saved.ModelKey, "text", "test", 1, tokenBillingEstimate{})
		if err != nil {
			t.Fatal(err)
		}
		if order.AmountMicrocredits != tc.want || quote.AmountMicrocredits != tc.want || quote.RegularAmountMicrocredits == nil || *quote.RegularAmountMicrocredits != 8_000_000 || quote.OriginalAmountMicrocredits == nil || *quote.OriginalAmountMicrocredits != 10_000_000 || order.CostPricing.UnitPriceMicrocredits != 5_000_000 {
			t.Fatalf("incorrect quote/order: %+v %+v", quote, order)
		}
		if err := db.Create(&model.CreditAccount{UserID: tc.user, AvailableMicrocredits: 100_000_000}).Error; err != nil {
			t.Fatal(err)
		}
		if err := svc.repo.ReserveBillingOrder(order); err != nil {
			t.Fatal(err)
		}
		if err := svc.repo.SettleBillingOrder(order.ID, "test-provider"); err != nil {
			t.Fatal(err)
		}
		var account model.CreditAccount
		var settled model.BillingOrder
		if err := db.First(&account, "user_id = ?", tc.user).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&settled, "id = ?", order.ID).Error; err != nil {
			t.Fatal(err)
		}
		if account.AvailableMicrocredits != 100_000_000-tc.want || account.ReservedMicrocredits != 0 || settled.ActualAmountMicrocredits != tc.want || settled.CostPricing.UnitPriceMicrocredits != 5_000_000 {
			t.Fatalf("actual deduction or cost mismatch: %+v %+v", account, settled)
		}
	}
	req.PriceTiers[0].OfficialPricing.UnitPriceMicrocredits = 20_000_000
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatal(err)
	}
	var old model.BillingOrder
	if err := db.First(&old, "user_id = ?", "enterprise-user").Error; err != nil {
		t.Fatal(err)
	}
	if old.OfficialPricing.UnitPriceMicrocredits != 10_000_000 || old.AmountMicrocredits != 7_200_000 {
		t.Fatal("historical snapshot changed")
	}
	req.PriceTiers[0].OfficialPricing = model.OfficialPricing{}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, req); err != nil {
		t.Fatal(err)
	}
	quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: saved.ModelKey, Intent: intent}, "enterprise-user")
	if err != nil || quote.OriginalAmountMicrocredits != nil || quote.AmountMicrocredits != 7_200_000 {
		t.Fatalf("missing original changed sale: %+v %v", quote, err)
	}
}

func TestOfficialPricingSameUsageAndNoFakeOriginal(t *testing.T) {
	for _, mode := range []string{"fixed_request", "per_second", "token"} {
		order := &model.BillingOrder{BillingMode: mode, Quantity: 3, UnitPriceMicrocredits: 8_000_000, InputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 16_000_000, CachedTokenPriceMicrocredits: 4_000_000, MultiplierBasisPoints: 9000}
		estimate := tokenBillingEstimate{InputTokens: 100_000, OutputTokens: 200_000}
		q := quoteFromOrder("", order, estimate)
		if q.OriginalAmountMicrocredits != nil {
			t.Fatal("sale was presented as official price")
		}
		order.OfficialPricing = model.OfficialPricing{Configured: true, UnitPriceMicrocredits: 10_000_000, InputTokenPriceMicrocredits: 10_000_000, OutputTokenPriceMicrocredits: 20_000_000, CachedTokenPriceMicrocredits: 5_000_000}
		q = quoteFromOrder("", order, estimate)
		want := int64(30_000_000)
		if mode == "token" {
			want = 5_000_000
		}
		if q.OriginalAmountMicrocredits == nil || *q.OriginalAmountMicrocredits != want {
			t.Fatalf("%s original: %+v", mode, q)
		}
	}
	for _, price := range []int64{-1, 1_000_000_000_001} {
		err := validateChannelModelTierPricing("text", model.ChannelInterfaceChatCompletion, "fixed_request", ChannelModelPriceTierRequest{OfficialPricing: model.OfficialPricing{Configured: true, UnitPriceMicrocredits: price}})
		if err == nil {
			t.Fatal("invalid official price accepted")
		}
	}
}
