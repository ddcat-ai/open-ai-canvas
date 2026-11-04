package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/protocol"
)

func TestPaymentRateParsingIsExactAndBounded(t *testing.T) {
	for input, want := range map[string]int64{"": 0, "7.2": 7_200_000, "7.123456": 7_123_456, "0.000001": 1, "10000": 10_000_000_000, " 6.90 ": 6_900_000} {
		got, err := parsePaymentRate(input)
		if err != nil || got != want {
			t.Fatalf("parsePaymentRate(%q) = %d, %v; want %d", input, got, err, want)
		}
	}
	for _, input := range []string{"0", "-1", "1e3", "7.1234567", "10000.000001", "abc", ".5", "5.", "100000"} {
		if _, err := parsePaymentRate(input); err == nil {
			t.Fatalf("parsePaymentRate(%q) should fail", input)
		}
	}
	if formatPaymentRate(7_200_000) != "7.2" || formatPaymentRate(7_000_000) != "7" || formatPaymentRate(0) != "" {
		t.Fatal("formatPaymentRate must drop trailing zeros")
	}
}

func TestPaymentSettingsDefaultToUSD(t *testing.T) {
	settings, err := normalizePaymentSettings(PaymentSettings{})
	if err != nil || settings.DefaultCurrency != model.PriceCurrencyUSD || settings.UsdCnyRate != "" {
		t.Fatalf("settings = %#v, %v", settings, err)
	}
	settings, err = normalizePaymentSettings(PaymentSettings{DefaultCurrency: "cny", UsdCnyRate: "7.20"})
	if err != nil || settings.DefaultCurrency != model.PriceCurrencyCNY || settings.UsdCnyRate != "7.2" {
		t.Fatalf("settings = %#v, %v", settings, err)
	}
}

func TestConvertPaymentAmountRoundsToMinorUnit(t *testing.T) {
	cases := []struct {
		amount     int64
		from, to   string
		rate, want int64
	}{
		{999, model.PriceCurrencyUSD, model.PriceCurrencyCNY, 7_200_000, 7193}, // 71.928 → 71.93
		{1000, model.PriceCurrencyCNY, model.PriceCurrencyUSD, 7_200_000, 139}, // 1.3888 → 1.39
		{100_000_000, model.PriceCurrencyUSD, model.PriceCurrencyCNY, 10_000_000_000, 1_000_000_000_000},
		{500, model.PriceCurrencyCNY, model.PriceCurrencyCNY, 0, 500},
	}
	for _, item := range cases {
		got, rate, err := convertPaymentAmount(item.amount, item.from, item.to, item.rate)
		if err != nil || got != item.want {
			t.Fatalf("convert %d %s→%s = %d, %v; want %d", item.amount, item.from, item.to, got, err, item.want)
		}
		if item.from == item.to && rate != 0 {
			t.Fatal("same-currency orders must not record an exchange rate")
		}
	}
	if _, _, err := convertPaymentAmount(999, model.PriceCurrencyUSD, model.PriceCurrencyCNY, 0); err == nil {
		t.Fatal("cross-currency order without a configured rate must fail")
	}
	if _, _, err := convertPaymentAmount(1, model.PriceCurrencyCNY, model.PriceCurrencyUSD, 10_000_000_000); err == nil {
		t.Fatal("conversion rounding to zero must fail")
	}
}

func TestPaymentProviderMethodsFollowConfigAndCatalog(t *testing.T) {
	contribution := protocol.ManifestPaymentProvider{
		MethodsField: "payTypes",
		Methods:      []protocol.ManifestPaymentMethod{{ID: "alipay", Label: "支付宝", Icon: "brand:alipay"}, {ID: "wxpay", Label: "微信支付", Icon: "brand:wechat-pay"}},
	}
	methods, err := paymentProviderMethods(contribution, payment.Config{"payTypes": "wxpay， alipay:支付宝扫码\nbank:网银, wxpay"})
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 3 || methods[0] != (PaymentMethodView{ID: "wxpay", Name: "微信支付", Icon: "brand:wechat-pay"}) ||
		methods[1] != (PaymentMethodView{ID: "alipay", Name: "支付宝扫码", Icon: "brand:alipay"}) || methods[2] != (PaymentMethodView{ID: "bank", Name: "网银"}) {
		t.Fatalf("methods = %#v", methods)
	}
	if methods, err := paymentProviderMethods(contribution, payment.Config{}); err != nil || len(methods) != 0 {
		t.Fatalf("empty config should leave method selection to the plugin: %#v, %v", methods, err)
	}
	if _, err := paymentProviderMethods(contribution, payment.Config{"payTypes": "alipay,Bad Type"}); err == nil {
		t.Fatal("invalid method IDs must be rejected")
	}
	catalogOnly, err := paymentProviderMethods(protocol.ManifestPaymentProvider{Methods: contribution.Methods}, payment.Config{})
	if err != nil || len(catalogOnly) != 2 {
		t.Fatalf("catalog without methodsField enables every method: %#v, %v", catalogOnly, err)
	}
}

func TestResolvePaymentMethod(t *testing.T) {
	methods := []PaymentMethodView{{ID: "alipay"}, {ID: "wxpay"}}
	if got, err := resolvePaymentMethod(methods, "wxpay"); err != nil || got != "wxpay" {
		t.Fatalf("resolve = %q, %v", got, err)
	}
	if _, err := resolvePaymentMethod(methods, ""); err == nil {
		t.Fatal("multiple methods require an explicit choice")
	}
	if _, err := resolvePaymentMethod(methods, "qqpay"); err == nil {
		t.Fatal("disabled method must be rejected")
	}
	if got, err := resolvePaymentMethod(methods[:1], ""); err != nil || got != "alipay" {
		t.Fatalf("single method should be selected automatically: %q, %v", got, err)
	}
	if _, err := resolvePaymentMethod(nil, "alipay"); err == nil {
		t.Fatal("providers without methods must reject a method")
	}
}

func TestPaymentSettlementCurrency(t *testing.T) {
	if currency, err := paymentSettlementCurrency(payment.Config{}); err != nil || currency != model.PriceCurrencyCNY {
		t.Fatalf("default settlement = %q, %v", currency, err)
	}
	if currency, err := paymentSettlementCurrency(payment.Config{"settlementCurrency": "usd"}); err != nil || currency != model.PriceCurrencyUSD {
		t.Fatalf("usd settlement = %q, %v", currency, err)
	}
	if _, err := paymentSettlementCurrency(payment.Config{"settlementCurrency": "EUR"}); err == nil {
		t.Fatal("unsupported settlement currency must be rejected")
	}
}

func TestPaymentCreateRequestUsesChargeSnapshot(t *testing.T) {
	order := &model.PaymentOrder{ID: "o1", MerchantOrderNo: "m1", ProviderID: "epay", AmountFen: 999, Currency: "USD", ChargeAmountFen: 7193, ChargeCurrency: "CNY", PaymentMethod: "wxpay"}
	request := paymentCreateRequest(order, "100 积分", payment.Config{"publicBaseUrl": "https://pay.example/"}, "cfg")
	if request.AmountFen != 7193 || request.Currency != "CNY" || request.Method != "wxpay" ||
		request.NotifyURL != "https://pay.example/api/payments/notify/epay/cfg" || request.ReturnURL != "https://pay.example/api/payments/return/epay?orderId=o1" {
		t.Fatalf("request = %#v", request)
	}
}
