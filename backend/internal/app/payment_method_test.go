package app

import "testing"

func TestResolvePaymentTypeUsesConfiguredChannelOnly(t *testing.T) {
	cases := []struct {
		id     string
		values map[string]string
		want   string
	}{
		{"wechat-native", nil, "wechat"},
		{"alipay-page-pay", nil, "alipay"},
		{"epay", map[string]string{"payType": "wxpay"}, "wechat"},
		{"zhifufm-pay", map[string]string{"payType": "aloop"}, "alipay"},
		{"zhifufm-pay", map[string]string{"payType": "tloop"}, "wechat"},
		{"epay", map[string]string{"payType": "qqpay"}, "qq"},
		{"xunhupay-aggregate", nil, ""},
		{"epay", map[string]string{"payType": ""}, ""},
		{"epay", map[string]string{"payType": "custom"}, "custom"},
	}
	for _, tc := range cases {
		if got := resolvePaymentType(tc.id, tc.values); got != tc.want {
			t.Fatalf("%s %v: %q, want %q", tc.id, tc.values, got, tc.want)
		}
	}
}
