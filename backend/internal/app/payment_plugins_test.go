package app

import (
	"errors"
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
	for _, providerID := range []string{PaymentProviderAlipay, PaymentProviderWeChat, "xunhupay-aggregate"} {
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
		err := provider.ValidateConfig(nil)
		var providerErr *payment.ProviderError
		if !errors.As(err, &providerErr) {
			t.Fatalf("provider %q ValidateConfig() = %T %v, want ProviderError", providerID, err, err)
		}
		if providerErr.Code == "plugin_executable_missing" || providerErr.Code == "plugin_exec_format_error" || providerErr.Code == "plugin_start_failed" {
			t.Fatalf("provider %q failed to start: %#v cause=%v", providerID, providerErr, providerErr.Cause)
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
	for _, providerID := range []string{PaymentProviderAlipay, PaymentProviderWeChat, "xunhupay-aggregate"} {
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

func TestXunHuPayOfficialPackageIsPaymentPlugin(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var plugin PluginView
	for _, item := range center.list() {
		if item.Manifest.ID == "official-payment-xunhupay" {
			plugin = item
			plugin.Management = pluginManagementFromView(item)
			break
		}
	}
	if plugin.Manifest.ID == "" {
		t.Fatal("official-payment-xunhupay is missing")
	}
	if plugin.Management.Kind != PluginKindPayment || plugin.Source != PluginOriginOfficial {
		t.Fatalf("xunhupay plugin = %#v", plugin)
	}
	if len(plugin.Manifest.Contributes.PaymentProviders) != 1 || plugin.Manifest.Contributes.PaymentProviders[0].ID != "xunhupay-aggregate" {
		t.Fatalf("xunhupay contributions = %#v", plugin.Manifest.Contributes.PaymentProviders)
	}
	registry := center.paymentRegistrySnapshot()
	if registry == nil {
		t.Fatal("payment registry is nil")
	}
	provider, ok := registry.Get("xunhupay-aggregate")
	if !ok {
		t.Fatal("xunhupay-aggregate provider is missing")
	}
	if _, ok := provider.(*payment.RPCProvider); !ok {
		t.Fatalf("xunhupay provider type = %T", provider)
	}
}
