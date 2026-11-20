package ecommerceagent

import "testing"

func TestChargeExactPartialRefund(t *testing.T) {
	for _, tc := range []struct {
		pages, success         int
		wantActual, wantRefund int64
	}{{5, 5, 160000, 0}, {10, 3, 96000, 224000}, {10, 0, 0, 320000}} {
		reserved, actual, refund, err := Charge(32000, tc.pages, tc.success)
		if err != nil || reserved != int64(tc.pages)*32000 || actual != tc.wantActual || refund != tc.wantRefund {
			t.Fatalf("charge(%d,%d) = %d,%d,%d,%v", tc.pages, tc.success, reserved, actual, refund, err)
		}
	}
}

func TestChargeRejectsOverflowAndInvalidCount(t *testing.T) {
	if _, _, _, err := Charge(1<<62, 15, 3); err == nil {
		t.Fatal("accepted overflow")
	}
	if _, _, _, err := Charge(32000, 10, 11); err == nil {
		t.Fatal("accepted success greater than pages")
	}
}
