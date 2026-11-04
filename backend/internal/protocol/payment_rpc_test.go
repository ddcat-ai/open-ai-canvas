package protocol

import "testing"

func TestPaymentRPCBackendCandidatesPreferPlatformTaggedFiles(t *testing.T) {
	darwin := PaymentRPCBackendCandidates("backend/provider", "darwin", "arm64")
	if got, want := darwin[0], "backend/provider-darwin-arm64"; got != want {
		t.Fatalf("darwin candidates[0] = %q, want %q (%v)", got, want, darwin)
	}
	windows := PaymentRPCBackendCandidates("backend/provider", "windows", "amd64")
	if got, want := windows[0], "backend/provider-windows-amd64.exe"; got != want {
		t.Fatalf("windows candidates[0] = %q, want %q (%v)", got, want, windows)
	}
	if windows[len(windows)-1] != "backend/provider" {
		t.Fatalf("windows fallback = %v", windows)
	}
}

func TestHasAnyPaymentRPCBackendAcceptsTaggedArtifacts(t *testing.T) {
	if HasAnyPaymentRPCBackend("backend/provider", map[string][]byte{"backend/provider-darwin-arm64": {1}}) != true {
		t.Fatal("tagged darwin provider should be accepted")
	}
	if HasAnyPaymentRPCBackend("backend/provider", map[string][]byte{"backend/windows-amd64/provider.exe": {1}}) != true {
		t.Fatal("nested windows provider should be accepted")
	}
	if HasAnyPaymentRPCBackend("backend/provider", map[string][]byte{"backend/unrelated": {1}}) {
		t.Fatal("unrelated backend file should not satisfy the payment entry")
	}
}

func TestPaymentProviderMethodsValidation(t *testing.T) {
	base := func() Manifest {
		return Manifest{
			Configuration: ManifestConfiguration{Fields: []ManifestField{{Name: "payTypes", Type: "multiselect"}}},
			Contributes: ManifestContributions{PaymentProviders: []ManifestPaymentProvider{{
				ID: "epay", Label: "易支付", Icon: "assets/icon.svg", CheckoutMode: "redirect",
				ExpiryPolicy: ManifestPaymentExpiryPolicy{DefaultMinutes: 10, MinMinutes: 5, MaxMinutes: 60},
				MethodsField: "payTypes", Methods: []ManifestPaymentMethod{{ID: "alipay", Label: "支付宝"}, {ID: "wxpay", Label: "微信支付"}},
			}}},
		}
	}
	if err := validatePaymentProviderContributions(base()); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Manifest){
		"missing field":  func(m *Manifest) { m.Contributes.PaymentProviders[0].MethodsField = "unknown" },
		"duplicate":      func(m *Manifest) { m.Contributes.PaymentProviders[0].Methods[1].ID = "alipay" },
		"invalid id":     func(m *Manifest) { m.Contributes.PaymentProviders[0].Methods[0].ID = "Ali Pay" },
		"missing label":  func(m *Manifest) { m.Contributes.PaymentProviders[0].Methods[0].Label = " " },
		"leading symbol": func(m *Manifest) { m.Contributes.PaymentProviders[0].Methods[0].ID = "-pay" },
		"too long method": func(m *Manifest) {
			m.Contributes.PaymentProviders[0].Methods[0].ID = "a234567890123456789012345678901234"
		},
	} {
		manifest := base()
		mutate(&manifest)
		if err := validatePaymentProviderContributions(manifest); err == nil {
			t.Fatalf("%s: expected validation error", name)
		}
	}
}
