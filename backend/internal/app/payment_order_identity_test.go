package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPaymentOrderIdentityOnlyInAdminList(t *testing.T) {
	base := PaymentOrderView{ID: "order", UserID: "user", MerchantOrderNo: "merchant"}
	ordinary, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ordinary), `"user":`) || strings.Contains(string(ordinary), `"email":`) {
		t.Fatalf("ordinary response includes identity: %s", ordinary)
	}
	admin, err := json.Marshal(AdminPaymentOrderView{PaymentOrderView: base, User: &AdminPaymentOrderUser{ID: "user", Username: "alice", DisplayName: "小林", Email: "alice@example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ID   string                 `json:"id"`
		User *AdminPaymentOrderUser `json:"user"`
	}
	if err := json.Unmarshal(admin, &result); err != nil {
		t.Fatal(err)
	}
	if result.ID != "order" || result.User == nil || result.User.Email != "alice@example.com" {
		t.Fatalf("invalid admin response: %s", admin)
	}
	missing, err := json.Marshal(AdminPaymentOrderView{PaymentOrderView: base})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(missing), `"user":null`) || !strings.Contains(string(missing), `"userId":"user"`) {
		t.Fatalf("missing user loses original identity: %s", missing)
	}
}
