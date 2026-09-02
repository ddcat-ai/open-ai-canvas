package payment

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRPCProviderUsesPaymentV1Contract(t *testing.T) {
	dir := t.TempDir()
	entry := filepath.Join(dir, "provider")
	program := "#!/bin/sh\nread request\nprintf '%s\\n' '{\"ok\":true,\"data\":{\"mode\":\"qr_code\",\"value\":\"https://pay.example/qr\"}}'\n"
	if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin", CheckoutMode: "qr_code"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	provider.command = entry
	checkout, err := provider.CreateOrder(context.Background(), Config{"merchantId": "m"}, CreateRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || checkout.Value != "https://pay.example/qr" {
		t.Fatalf("checkout = %#v", checkout)
	}
}
