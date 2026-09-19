package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAllVideoProtocolsQuoteReserveAndSettleWithoutProviderUsage(t *testing.T) {
	for _, protocol := range []model.ChannelInterfaceType{"newapi-channel-2", "newapi-video", "custom-video"} {
		t.Run(string(protocol), func(t *testing.T) {
			svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
			if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("protocol", protocol).Error; err != nil {
				t.Fatal(err)
			}
			intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5}}
			quote, err := svc.QuoteChannelModel(ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
			if err != nil {
				t.Fatal(err)
			}
			assertVideoTokenQuote(t, quote, 1_900_800)
			input := quoteInput(intent, channelModel.ModelKey)
			input["config"].(map[string]any)["channelId"] = channel.ID
			input, err = svc.resolveSystemChannelModelSelection(input, "canvas_video", "")
			if err != nil {
				t.Fatal(err)
			}
			order, err := svc.taskBillingOrder("quote-user", &model.Task{ID: "generic-video", Type: "canvas_video"}, input)
			if err != nil {
				t.Fatal(err)
			}
			if order.VideoFormulaTokens != 108_000 || order.AmountMicrocredits != quote.AmountMicrocredits {
				t.Fatalf("quote/order disagree: %#v / %#v", quote, order)
			}
			if err := svc.repo.ReserveBillingOrder(order); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if err := svc.SettleBilling(order.ID, "completed-video"); err != nil {
					t.Fatal(err)
				}
			}
			settled, err := svc.repo.BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			if settled.Status != model.BillingStatusSettled || settled.UsageSource != "video_formula" || settled.UsageAvailable || settled.OutputTokens != 108_000 || settled.ActualAmountMicrocredits != 1_728_000 || settled.RefundedAmountMicrocredits != 172_800 {
				t.Fatalf("wrong formula settlement: %#v", settled)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", "quote-user").Error; err != nil {
				t.Fatal(err)
			}
			if account.AvailableMicrocredits != 10_000_000-1_728_000 || account.ReservedMicrocredits != 250_000 {
				t.Fatalf("incorrect balance after idempotent settlement: %#v", account)
			}
		})
	}
}

func TestGenericVideoTokenDimensions(t *testing.T) {
	for _, test := range []struct {
		resolution, size string
		width, height    int64
	}{
		{"1440p", "16:9", 2560, 1440},
		{"2K", "9:16", 1440, 2560},
		{"960p", "4:3", 1280, 960},
		{"768p竖", "9:16", 768, 1366},
		{"720p", "2:1", 1440, 720},
		{"", "1280x720", 1280, 720},
		{"", "", 1280, 720},
	} {
		t.Run(test.resolution+"/"+test.size, func(t *testing.T) {
			got := estimateArkVideoTokens(map[string]any{"config": map[string]any{
				"model": "generic-video", "vquality": test.resolution, "size": test.size, "videoSeconds": 5,
			}})
			if got.Err != nil || got.Video.OutputWidth != test.width || got.Video.OutputHeight != test.height {
				t.Fatalf("dimensions=%#v error=%v", got.Video, got.Err)
			}
		})
	}
}
