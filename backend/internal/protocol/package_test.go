package protocol

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestParsePluginPackageRejectsBareManifest(t *testing.T) {
	if _, err := ParsePluginPackage([]byte(`{"apiVersion":"yingce.plugin/v1"}`)); err == nil {
		t.Fatal("bare JSON manifest was accepted as a plugin package")
	}
}

func TestParsePluginPackageValidatesWebEntry(t *testing.T) {
	manifest := []byte(`{
        "apiVersion":"yingce.plugin/v1",
        "id":"ui-extension",
        "name":"UI Extension",
        "version":"1.0.0",
        "entry":"web/entry.js",
        "surfaces":["fullscreen"],
        "runtime":{"web":"sandbox"},
        "contributes":{"commands":[{"id":"ui-extension/open","label":"Open UI"}]}
    }`)
	pkg, err := ParsePluginPackage(zipPluginPackage(t, map[string][]byte{"manifest.json": manifest, "web/entry.js": []byte("self.postMessage({type:'ready'})")}))
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Entry != "web/entry.js" || len(pkg.Files["web/entry.js"]) == 0 {
		t.Fatalf("package = %#v", pkg)
	}

	missingEntry := zipPluginPackage(t, map[string][]byte{"manifest.json": manifest})
	if _, err := ParsePluginPackage(missingEntry); err == nil {
		t.Fatal("missing web entry was accepted")
	}

	forbidden := zipPluginPackage(t, map[string][]byte{"manifest.json": manifest, "web/entry.js": []byte("ready"), "server/entry.js": []byte("unsafe")})
	if _, err := ParsePluginPackage(forbidden); err == nil {
		t.Fatal("forbidden package path was accepted")
	}
}

func TestParsePluginPackageAcceptsTaggedRPCBackend(t *testing.T) {
	manifest := []byte(`{
        "apiVersion":"yingce.plugin/v1",
        "id":"tagged-payment",
        "name":"Tagged Payment",
        "version":"1.0.0",
        "author":"Test",
        "enabled":true,
        "runtime":{"backend":"rpc","backendEntry":"backend/provider"},
        "contributes":{"paymentProviders":[{"id":"tagged-pay","label":"Tagged","icon":"brand:test","checkoutMode":"qr_code","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}
    }`)
	pkg, err := ParsePluginPackage(zipPluginPackage(t, map[string][]byte{
		"manifest.json":                 manifest,
		"backend/provider-darwin-arm64": []byte("darwin-provider"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := pkg.Files["backend/provider"]; ok {
		t.Fatal("canonical backend/provider should not be required when a tagged artifact exists")
	}

	if _, err := ParsePluginPackage(zipPluginPackage(t, map[string][]byte{"manifest.json": manifest})); err == nil {
		t.Fatal("rpc package without any backend artifact was accepted")
	}
}

// InspectPluginPackage 只解压清单：结构校验与 ParsePluginPackage 相同（路径白名单、运行时入口），
// 但返回值不携带文件内容，调用方无法把「只校验过结构」的可执行文件写盘。
func TestInspectPluginPackageValidatesStructureWithoutContents(t *testing.T) {
	manifest := []byte(`{
        "apiVersion":"yingce.plugin/v1",
        "id":"tagged-payment",
        "name":"Tagged Payment",
        "version":"1.0.0",
        "author":"Test",
        "enabled":true,
        "runtime":{"backend":"rpc","backendEntry":"backend/provider"},
        "contributes":{"paymentProviders":[{"id":"tagged-pay","label":"Tagged","icon":"brand:test","checkoutMode":"qr_code","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}
    }`)
	info, err := InspectPluginPackage(zipPluginPackage(t, map[string][]byte{"manifest.json": manifest, "backend/provider-linux-amd64": []byte("binary")}))
	if err != nil {
		t.Fatal(err)
	}
	if info.Manifest.Metadata.ID != "tagged-payment" || len(info.ManifestRaw) == 0 {
		t.Fatalf("info = %#v", info)
	}
	if _, err := InspectPluginPackage(zipPluginPackage(t, map[string][]byte{"manifest.json": manifest})); err == nil {
		t.Fatal("rpc package without any backend artifact was accepted by inspection")
	}
	if _, err := InspectPluginPackage(zipPluginPackage(t, map[string][]byte{"manifest.json": manifest, "backend/provider": []byte("x"), "server/evil": []byte("x")})); err == nil {
		t.Fatal("forbidden package path was accepted by inspection")
	}
}

// ParsePluginPackageFiles 只解压选中的条目；未选中的条目以 nil 登记，便于存在性判断。
func TestParsePluginPackageFilesLoadsOnlySelectedEntries(t *testing.T) {
	manifest := []byte(`{"apiVersion":"yingce.plugin/v1","id":"tagged-payment","name":"Tagged Payment","version":"1.0.0","author":"Test","enabled":true,"runtime":{"backend":"rpc","backendEntry":"backend/provider"},"contributes":{"paymentProviders":[{"id":"tagged-pay","label":"Tagged","icon":"brand:test","checkoutMode":"qr_code","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}}`)
	data := zipPluginPackage(t, map[string][]byte{
		"manifest.json":                 manifest,
		"backend/provider-linux-amd64":  []byte("linux"),
		"backend/provider-darwin-arm64": []byte("darwin"),
	})
	pkg, err := ParsePluginPackageFiles(data, func(name string) bool { return name == "backend/provider-linux-amd64" })
	if err != nil {
		t.Fatal(err)
	}
	if string(pkg.Files["backend/provider-linux-amd64"]) != "linux" {
		t.Fatalf("selected entry content = %q", pkg.Files["backend/provider-linux-amd64"])
	}
	if content, listed := pkg.Files["backend/provider-darwin-arm64"]; !listed || content != nil {
		t.Fatalf("unselected entry must be listed with nil content, got listed=%v content=%q", listed, content)
	}
	if len(pkg.ManifestRaw) == 0 {
		t.Fatal("manifest must always be loaded")
	}
}

func zipPluginPackage(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, data := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
