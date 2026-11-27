package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/protocol"
	paymentplugins "yingce/backend/payment-plugins"
)

func TestMembershipPaidLifecycle(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user, err := s.repo.User("user")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureDefaultUserGroup(); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"vip", "studio"} {
		if _, err := s.CreateUserGroup(admin, UserGroupRequest{Code: code, Name: code, RatioBasisPoints: 8000, AllChannels: true}); err != nil {
			t.Fatal(err)
		}
	}
	in := model.MembershipCardInput{Enabled: true, MembershipGroup: "vip", Currency: "CNY", AmountFen: 100, CreditsMicrocredits: 500 * CreditScale}
	if err := s.SaveMembershipCard(user, "month", in); err == nil {
		t.Fatal("non-admin changed card")
	}
	for _, term := range []string{"week", "month", "quarter", "year"} {
		if err := s.SaveMembershipCard(admin, term, in); err != nil {
			t.Fatal(err)
		}
	}
	private, err := s.TopupProducts(user)
	if err != nil || len(private) != 0 {
		t.Fatalf("sales default: %v %v", private, err)
	}
	if err := s.SetMembershipSales(admin, true); err != nil {
		t.Fatal(err)
	}
	cards, err := s.TopupProducts(user)
	if err != nil || len(cards) != 4 {
		t.Fatalf("available cards: %v %v", cards, err)
	}

	// 使用真实易支付适配器生成收银台并查单，隔离的本地网关返回支付凭据。
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("out_trade_no")
		if r.URL.Path != "/api.php" || id == "" {
			http.Error(w, "unknown order", 400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "status": 1, "trade_no": "trade-" + id, "out_trade_no": id, "money": "1.00"})
	}))
	defer gateway.Close()
	provider := paymentplugins.NewEpayProvider(gateway.Client())
	desc := provider.Descriptor()
	s.paymentRegistry, err = payment.NewRegistry(provider)
	if err != nil {
		t.Fatal(err)
	}
	s.pluginRuntime = &pluginRuntime{plugins: map[string]pluginRecord{desc.PluginID: {Metadata: protocol.Metadata{ID: desc.PluginID, Version: desc.PluginVersion}, Status: "enabled", Source: PluginOriginOfficial}}}
	config, err := json.Marshal(payment.Config{"pid": "local", "key": "test", "gateway": gateway.URL, "publicBaseUrl": "https://example.invalid", "submitMode": "submit", "payTypes": "alipay"})
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := s.encryptSettingSecret(string(config))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.CreatePaymentProviderConfig(&model.PaymentProviderConfig{ID: "test-config", ProviderID: desc.ID, PluginID: desc.PluginID, PluginVersion: desc.PluginVersion, ConfigCipher: cipher, Enabled: true, CloseAfterMinutes: 30}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PluginPlatformState{PluginID: desc.PluginID, Available: true}).Error; err != nil {
		t.Fatal(err)
	}
	buy := func(term string) (*PaymentOrderView, error) {
		p, err := s.repo.TopupProduct("membership-" + term)
		if err != nil {
			return nil, err
		}
		return s.CreatePaymentOrder(t.Context(), user, CreatePaymentOrderRequest{ProductID: p.ID, ProviderID: desc.ID, IdempotencyKey: newID(), MembershipVersion: p.UpdatedAt.Format(time.RFC3339Nano)})
	}
	pay := func(order *PaymentOrderView) *PaymentOrderView {
		paid, err := s.QueryPaymentOrder(t.Context(), user, order.ID)
		if err != nil || paid.Status != model.PaymentOrderCredited || paid.MembershipStartsAt == nil || paid.MembershipEndsAt == nil {
			t.Fatalf("pay: %+v %v", paid, err)
		}
		return paid
	}
	first, err := buy("month")
	if err != nil {
		t.Fatal(err)
	}
	first = pay(first)
	renew, err := buy("month")
	if err != nil {
		t.Fatal(err)
	}
	renew = pay(renew)
	if !renew.MembershipStartsAt.Equal(*first.MembershipEndsAt) || renew.MembershipEndsAt.Sub(*renew.MembershipStartsAt) != 30*24*time.Hour {
		t.Fatal("renewal did not append 30 days")
	}
	in.MembershipGroup = "studio"
	in.CreditsMicrocredits = 0
	if err := s.SaveMembershipCard(admin, "year", in); err != nil {
		t.Fatal(err)
	}
	change, err := buy("year")
	if err != nil {
		t.Fatal(err)
	}
	in.MembershipGroup = "vip"
	in.CreditsMicrocredits = 3 * CreditScale
	if err := s.SaveMembershipCard(admin, "year", in); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMembershipSales(admin, false); err != nil {
		t.Fatal(err)
	}
	if _, err := buy("month"); err == nil {
		t.Fatal("sale after shutdown")
	}
	change = pay(change)
	if !change.MembershipStartsAt.Equal(*renew.MembershipEndsAt) || change.MembershipGroup != "studio" || change.CreditsMicrocredits != 0 || change.MembershipEndsAt.Sub(*change.MembershipStartsAt) != 365*24*time.Hour {
		t.Fatalf("change snapshot: %+v", change)
	}
	// 重复确认从与通知、对账相同的完成入口进入。
	if _, err := s.applyPaymentResult(desc.ID, payment.Result{MerchantOrderNo: first.MerchantOrderNo, Paid: true, ProviderTradeNo: "trade-" + first.MerchantOrderNo, AmountFen: 100, Currency: "CNY"}); err != nil {
		t.Fatal(err)
	}
	actor, err := s.repo.User("user")
	if err != nil {
		t.Fatal(err)
	}
	if actor.UserGroup != "" || actor.MembershipUntil == nil || !actor.MembershipUntil.Equal(*change.MembershipEndsAt) {
		t.Fatalf("base group or expiry changed: %+v", actor)
	}
	status, err := s.MembershipStatus(actor)
	if err != nil || status.SalesEnabled || len(status.Periods) != 3 {
		t.Fatalf("schedule: %+v %v", status, err)
	}
	if g := s.PublicUserGroupFor(actor); g == nil || g.Code != "vip" {
		t.Fatalf("session: %+v", g)
	}
	quote, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}})
	if err != nil || quote.AmountMicrocredits != 80 {
		t.Fatalf("membership price: %+v %v", quote, err)
	}
	atSwitch, _, err := s.effectiveMembershipGroup(actor, *change.MembershipStartsAt)
	if err != nil || atSwitch.Code != "studio" {
		t.Fatalf("switch: %+v %v", atSwitch, err)
	}
	// 用管理员业务入口修改基础组，最后一张卡到期时取新基础组。
	base := "vip"
	if _, err := s.UpdateUser(admin, user.ID, UpdateUserRequest{UserGroup: &base}); err != nil {
		t.Fatal(err)
	}
	actor, err = s.repo.User(user.ID)
	if err != nil || actor.MembershipUntil == nil || !actor.MembershipUntil.Equal(*change.MembershipEndsAt) {
		t.Fatalf("lost paid entitlement: %+v %v", actor, err)
	}
	expired, end, err := s.effectiveMembershipGroup(actor, *change.MembershipEndsAt)
	if err != nil || expired.Code != base || end != nil {
		t.Fatalf("restore: %+v %v", expired, err)
	}
	var bonuses []model.CreditLedgerEntry
	if err := db.Where("type = ?", model.CreditLedgerMembershipBonus).Find(&bonuses).Error; err != nil || len(bonuses) != 2 {
		t.Fatalf("bonuses: %v %v", len(bonuses), err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 10000+1000*CreditScale {
		t.Fatalf("wallet: %+v %v", account, err)
	}
	if _, err := s.CreateTopupProduct(admin, TopupProductRequest{Name: "积分包", Kind: model.TopupProductKindCredits, Currency: "CNY", AmountFen: 100, CreditsMicrocredits: CreditScale, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	products, err := s.TopupProducts(user)
	if err != nil || len(products) != 1 || products[0].Kind != model.TopupProductKindCredits {
		t.Fatalf("independent packs: %v %v", products, err)
	}
	pack, err := s.CreatePaymentOrder(t.Context(), user, CreatePaymentOrderRequest{ProductID: products[0].ID, ProviderID: desc.ID, IdempotencyKey: newID()})
	if err != nil {
		t.Fatal(err)
	}
	settled, err := s.QueryPaymentOrder(t.Context(), user, pack.ID)
	if err != nil || settled.Status != model.PaymentOrderCredited || settled.MembershipEndsAt != nil {
		t.Fatalf("pack: %+v %v", settled, err)
	}
}
