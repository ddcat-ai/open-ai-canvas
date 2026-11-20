package repository

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestReferenceVideoLedgerNote(t *testing.T) {
	for _, test := range []struct {
		order model.BillingOrder
		want  string
	}{
		{order: model.BillingOrder{}, want: ""},
		{order: model.BillingOrder{ReferenceVideoCount: 1, ReferenceVideoMillis: 8_000, ReferenceVideoBilled: true}, want: "参考视频 8 秒已计费"},
		{order: model.BillingOrder{ReferenceVideoCount: 2, ReferenceVideoMillis: 7_250}, want: "参考视频 7.2 秒未计费"},
		{order: model.BillingOrder{ReferenceVideoCount: 2}, want: "参考视频 2 个未计费"},
	} {
		if got := referenceVideoLedgerNote(test.order); got != test.want {
			t.Fatalf("referenceVideoLedgerNote(%#v) = %q, want %q", test.order, got, test.want)
		}
	}
	// 参考视频不计费的视频 Token 订单不读上游 usage（含参考视频），按生成时长公式快照结算。
	usage, source, err := tokenSettlementUsage(nil, model.BillingOrder{Capability: "video", ReferenceVideoCount: 1, VideoFormulaTokens: 108_000})
	if err != nil || source != billingUsageSourceVideoFormula || usage.OutputTokens != 108_000 {
		t.Fatalf("tokenSettlementUsage() = %#v %q %v", usage, source, err)
	}
	if got := joinLedgerNotes("视频按实际输出时长结算", "", "参考视频 8 秒已计费"); got != "视频按实际输出时长结算；参考视频 8 秒已计费" {
		t.Fatalf("joinLedgerNotes() = %q", got)
	}
}
