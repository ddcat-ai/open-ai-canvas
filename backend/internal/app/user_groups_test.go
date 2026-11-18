package app

import (
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestGuestModelCatalogUsesDefaultGroupVisibilityAndPricing(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	user, err := s.repo.User("user")
	if err != nil {
		t.Fatal(err)
	}
	guest, err := s.ModelCatalogForGuest()
	if err != nil {
		t.Fatal(err)
	}
	member, err := s.ModelCatalogForUser(user, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(guest.Channels) == 0 {
		t.Fatal("guest should see configured default-group models")
	}
	// 可用率统计带计算时间，只比较目录权限和计价字段。
	for i := range guest.Channels {
		for j := range guest.Channels[i].Models {
			guest.Channels[i].Models[j].Availability = nil
			member.Channels[i].Models[j].Availability = nil
		}
	}
	if !reflect.DeepEqual(guest, member) {
		t.Fatal("guest must share default-group catalog pricing")
	}
	group, err := s.repo.UserGroupByCode(model.DefaultUserGroupCode)
	if err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "catalog-admin", Role: model.UserRoleAdmin}
	if _, err := s.UpdateUserGroup(admin, group.ID, UserGroupRequest{Name: "默认分组", RatioBasisPoints: 10_000, PointsPerUSD: 7 * CreditScale, PointsPerCNY: CreditScale}); err != nil {
		t.Fatal(err)
	}
	restricted, err := s.ModelCatalogForGuest()
	if err != nil || len(restricted.Channels) != 0 {
		t.Fatalf("guest must not bypass channel visibility: %#v, %v", restricted, err)
	}
	if _, err := s.ModelCatalogForUser(nil, nil); err == nil {
		t.Fatal("guest access must not weaken authenticated entry points")
	}
}

// 分组 -> 渠道 -> 模型：可见性、分组折扣、模型倍率和货币换算在目录、报价与账单中必须一致。
func TestUserGroupChannelVisibilityDiscountAndCurrencyPricing(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	quote := func() (int64, error) {
		result, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}})
		if err != nil {
			return 0, err
		}
		return result.AmountMicrocredits, nil
	}
	catalogUnitPrice := func() (int64, bool) {
		user, err := s.repo.User("user")
		if err != nil {
			t.Fatal(err)
		}
		catalog, err := s.ModelCatalogForUser(user, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, channel := range catalog.Channels {
			for _, item := range channel.Models {
				if channel.ID == "channel" && item.ModelKey == "text-test" && len(item.PriceTiers) > 0 {
					return item.PriceTiers[0].UnitPriceMicrocredits, true
				}
			}
		}
		return 0, false
	}

	if amount, err := quote(); err != nil || amount != 100 {
		t.Fatalf("default group quote = %d, %v; want 100", amount, err)
	}

	vip, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "vip", Name: "VIP", BadgeLabel: "VIP", BadgeStyle: "vip", RatioBasisPoints: 8_000, PointsPerUSD: 7 * CreditScale, PointsPerCNY: CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	group := "vip"
	if _, err := s.UpdateUser(admin, "user", UpdateUserRequest{UserGroup: &group}); err != nil {
		t.Fatal(err)
	}
	if _, visible := catalogUnitPrice(); visible {
		t.Fatal("unbound channel must be hidden from the vip catalog")
	}
	if _, err := quote(); err == nil {
		t.Fatal("quote on an unbound channel must fail closed")
	}

	update := UserGroupRequest{Name: "VIP", BadgeLabel: "VIP", BadgeStyle: "vip", RatioBasisPoints: 8_000, PointsPerUSD: 7 * CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"},
		ModelOverrides: []model.UserGroupModelOverride{{ModelKey: "text-test", RatioBasisPoints: 5_000}}}
	if _, err := s.UpdateUserGroup(admin, vip.ID, update); err != nil {
		t.Fatal(err)
	}
	if amount, err := quote(); err != nil || amount != 40 {
		t.Fatalf("vip quote = %d, %v; want 100 x 0.8 x 0.5 = 40", amount, err)
	}
	if price, visible := catalogUnitPrice(); !visible || price != 40 {
		t.Fatalf("vip catalog price = %d (visible %v); want 40", price, visible)
	}

	// 100 微美元 × 7 积分/美元 = 700 微积分，再乘 0.4 倍率。
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("price_currency", model.PriceCurrencyUSD).Error; err != nil {
		t.Fatal(err)
	}
	if amount, err := quote(); err != nil || amount != 280 {
		t.Fatalf("usd quote = %d, %v; want 280", amount, err)
	}
	if price, _ := catalogUnitPrice(); price != 280 {
		t.Fatalf("usd catalog price = %d; want 280", price)
	}
	order, err := s.newBillingOrder("user", "task", "group-test", "channel", "text-test", "text", "test", 1, tokenBillingEstimate{})
	if err != nil {
		t.Fatal(err)
	}
	if order.UserGroup != "vip" || order.PriceCurrency != model.PriceCurrencyUSD || order.CurrencyRateMicrocredits != 7*CreditScale || order.UnitPriceMicrocredits != 700 || order.MultiplierBasisPoints != 4_000 || order.AmountMicrocredits != 280 {
		t.Fatalf("billing snapshot = %+v", order)
	}

	if err := s.DeleteUserGroup(admin, vip.ID); err == nil {
		t.Fatal("group with users must not be deletable")
	}
}
