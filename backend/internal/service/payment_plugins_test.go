package service

import (
	"testing"

	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/protocol"
)

func TestBundledPaymentPluginsMatchHostProviders(t *testing.T) {
	manifests := bundledPaymentPluginManifests()
	if len(manifests) != 2 {
		t.Fatalf("payment plugin manifests = %d", len(manifests))
	}
	for _, manifest := range manifests {
		if err := protocol.ValidateManifest(manifest); err != nil {
			t.Fatalf("validate %s: %v", manifest.Metadata.ID, err)
		}
		management := pluginManagement(manifest.Metadata.ID, PluginOriginSystem)
		if management.Kind != PluginKindPayment || management.Origin != PluginOriginSystem || management.ActivationScope != PluginScopeSystem {
			t.Fatalf("plugin %s management = %#v", manifest.Metadata.ID, management)
		}
		if len(manifest.Contributes.PaymentProviders) != 1 {
			t.Fatalf("plugin %s payment contributions = %d", manifest.Metadata.ID, len(manifest.Contributes.PaymentProviders))
		}
		contribution := manifest.Contributes.PaymentProviders[0]
		if contribution.ID == "" || contribution.Icon == "" || contribution.CheckoutMode == "" {
			t.Fatalf("plugin %s has incomplete payment contribution: %#v", manifest.Metadata.ID, contribution)
		}
	}
}

func TestBundledPaymentPluginsLoadFromSystemSource(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plugins := make(map[string]PluginView)
	for _, plugin := range center.list() {
		plugins[plugin.Manifest.ID] = plugin
	}
	for _, manifest := range bundledPaymentPluginManifests() {
		plugin, ok := plugins[manifest.Metadata.ID]
		if !ok {
			t.Fatalf("system payment plugin %s is missing", manifest.Metadata.ID)
		}
		if plugin.Source != PluginOriginSystem || !plugin.Manifest.Trusted {
			t.Fatalf("system payment plugin %s = %#v", manifest.Metadata.ID, plugin)
		}
	}
}

func TestSystemPaymentPluginsRegisterRPCProviders(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	registry := center.paymentRegistrySnapshot()
	if registry == nil {
		t.Fatal("payment registry is nil")
	}
	for _, providerID := range []string{PaymentProviderAlipay, PaymentProviderWeChat} {
		provider, ok := registry.Get(providerID)
		if !ok {
			t.Fatalf("payment provider %q is missing", providerID)
		}
		if _, ok := provider.(*payment.RPCProvider); !ok {
			t.Fatalf("payment provider %q has type %T, want *payment.RPCProvider", providerID, provider)
		}
		if provider.Descriptor().PluginID == "" || provider.Descriptor().PluginVersion == "" {
			t.Fatalf("payment provider %q is missing plugin identity: %#v", providerID, provider.Descriptor())
		}
	}
}

func TestPaymentRegistryFailsClosedWhenOfficialPackagesAreMissing(t *testing.T) {
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", t.TempDir())
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	registry := center.paymentRegistrySnapshot()
	if registry == nil {
		t.Fatal("payment registry is nil")
	}
	for _, providerID := range []string{PaymentProviderAlipay, PaymentProviderWeChat} {
		if _, ok := registry.Get(providerID); ok {
			t.Fatalf("payment provider %q unexpectedly came from host fallback", providerID)
		}
	}
	for _, plugin := range center.list() {
		if plugin.Management.Kind == PluginKindPayment && plugin.Status != "invalid" {
			t.Fatalf("missing package payment plugin %q status = %q, want invalid", plugin.Manifest.ID, plugin.Status)
		}
	}
}

func TestTopupProductCreditAmountStaysWithinSafeLimit(t *testing.T) {
	if _, err := topupProductFromRequest("product", "admin", TopupProductRequest{
		Name: "过大积分商品", AmountFen: 1, CreditsMicrocredits: maxTopupCreditsMicrocredits + 1,
	}); err == nil {
		t.Fatal("expected oversized top-up credits to be rejected")
	}
	if _, err := topupProductFromRequest("product", "admin", TopupProductRequest{
		Name: "有效积分商品", AmountFen: 1, CreditsMicrocredits: maxTopupCreditsMicrocredits,
	}); err != nil {
		t.Fatalf("maximum safe top-up credits: %v", err)
	}
}
