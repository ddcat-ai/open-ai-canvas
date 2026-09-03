package service

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestPaymentRuntimeCacheUsesCompletePackageDigest(t *testing.T) {
	packageA := paymentRuntimePackage(t, []byte("provider-a"))
	packageB := paymentRuntimePackage(t, []byte("provider-b"))
	if pluginHash(packageA) == pluginHash(packageB) {
		t.Fatal("payment packages with different providers have the same digest")
	}

	pkgA, err := protocol.ParsePluginPackage(packageA)
	if err != nil {
		t.Fatal(err)
	}
	pkgB, err := protocol.ParsePluginPackage(packageB)
	if err != nil {
		t.Fatal(err)
	}
	packageDir := t.TempDir()
	runtimeA, err := materializePaymentBackend(packageDir, pluginHash(packageA), pkgA)
	if err != nil {
		t.Fatal(err)
	}
	runtimeB, err := materializePaymentBackend(packageDir, pluginHash(packageB), pkgB)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeA == runtimeB {
		t.Fatalf("different package contents reused runtime path %q", runtimeA)
	}
	assertPaymentRuntimeProvider(t, runtimeA, []byte("provider-a"))
	assertPaymentRuntimeProvider(t, runtimeB, []byte("provider-b"))
}

func TestPaymentRuntimeReplacesInterruptedExtraction(t *testing.T) {
	packageData := paymentRuntimePackage(t, []byte("complete-provider"))
	pkg, err := protocol.ParsePluginPackage(packageData)
	if err != nil {
		t.Fatal(err)
	}
	digest := pluginHash(packageData)
	packageDir := t.TempDir()
	interruptedRoot := filepath.Join(packageDir, "runtime", digest)
	if err := os.MkdirAll(filepath.Join(interruptedRoot, "backend"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(interruptedRoot, "backend", "provider"), []byte("partial-provider"), 0o700); err != nil {
		t.Fatal(err)
	}

	runtimeDir, err := materializePaymentBackend(packageDir, digest, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeDir != interruptedRoot {
		t.Fatalf("runtime directory = %q, want %q", runtimeDir, interruptedRoot)
	}
	assertPaymentRuntimeProvider(t, runtimeDir, []byte("complete-provider"))
	ready, err := os.ReadFile(filepath.Join(runtimeDir, paymentRuntimeReadyFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(ready) != digest+"\n" {
		t.Fatalf("runtime ready marker = %q", ready)
	}
	if err := os.Remove(filepath.Join(runtimeDir, "backend", "provider")); err != nil {
		t.Fatal(err)
	}
	if _, err := materializePaymentBackend(packageDir, digest, pkg); err != nil {
		t.Fatal(err)
	}
	assertPaymentRuntimeProvider(t, runtimeDir, []byte("complete-provider"))
}

func TestBuiltInPaymentPackageUpgradeSelectsNewRuntimeDigest(t *testing.T) {
	oldPackage := paymentRuntimePackage(t, []byte("old-provider"))
	newPackage := paymentRuntimePackage(t, []byte("new-provider"))
	oldDigest := pluginHash(oldPackage)
	newDigest := pluginHash(newPackage)
	oldPkg, err := protocol.ParsePluginPackage(oldPackage)
	if err != nil {
		t.Fatal(err)
	}

	dataDir := t.TempDir()
	packageDir := filepath.Join(dataDir, "plugin-packages")
	if err := os.MkdirAll(packageDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageDir, oldDigest+".yingce-plugin"), oldPackage, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := materializePaymentBackend(packageDir, oldDigest, oldPkg); err != nil {
		t.Fatal(err)
	}
	registry := []pluginRegistryRecord{{
		ID: "test-payment-runtime", Raw: oldPkg.ManifestRaw, Source: PluginOriginOfficial,
		FileName: "test-payment-runtime.yingce-plugin", PackagePath: oldDigest + ".yingce-plugin", PackageSHA256: oldDigest,
	}}
	if err := (&pluginRuntime{registryPath: filepath.Join(dataDir, "plugin_registry.json")}).writeRegistry(registry); err != nil {
		t.Fatal(err)
	}

	officialDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(officialDir, "test-payment-runtime.yingce-plugin"), newPackage, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", officialDir)
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}

	assertPaymentRuntimeProvider(t, filepath.Join(packageDir, "runtime", newDigest), []byte("new-provider"))
	for _, plugin := range center.list() {
		if plugin.Manifest.ID == "test-payment-runtime" {
			if plugin.SHA256 != newDigest {
				t.Fatalf("upgraded plugin digest = %q, want %q", plugin.SHA256, newDigest)
			}
			return
		}
	}
	t.Fatal("upgraded payment plugin is missing")
}

func TestPaymentRuntimeRejectsInvalidDigest(t *testing.T) {
	pkg := protocol.PluginPackage{Files: map[string][]byte{"backend/provider": []byte("provider")}}
	if _, err := materializePaymentBackend(t.TempDir(), "../outside", pkg); err == nil {
		t.Fatal("invalid package digest was accepted")
	}
}

func paymentRuntimePackage(t *testing.T, provider []byte) []byte {
	t.Helper()
	manifest := []byte(`{"apiVersion":"yingce.plugin/v1","id":"test-payment-runtime","version":"1.0.0","name":"Test Payment Runtime","author":"Test","enabled":true,"runtime":{"backend":"rpc","backendEntry":"backend/provider"},"contributes":{"paymentProviders":[{"id":"test-payment","label":"Test Payment","icon":"brand:test","checkoutMode":"redirect","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}}`)
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range map[string][]byte{"manifest.json": manifest, "backend/provider": provider} {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func assertPaymentRuntimeProvider(t *testing.T, runtimeDir string, expected []byte) {
	t.Helper()
	actual, err := os.ReadFile(filepath.Join(runtimeDir, "backend", "provider"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, expected) {
		t.Fatalf("runtime provider = %q, want %q", actual, expected)
	}
}
