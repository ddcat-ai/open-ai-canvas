package app

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOfficialPluginInspectionCachesOnlyMetadataAndIsolatesCallers(t *testing.T) {
	data := officialCacheTestPackage(t, "Original", bytes.Repeat([]byte("provider payload"), 128<<10))
	source := writeOfficialCacheTestSource(t, data)
	first, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if first.hash != pluginHash(data) {
		t.Fatal("inspection digest does not cover the complete package")
	}
	originalRaw := bytes.Clone(first.info.ManifestRaw)
	first.info.Manifest.Metadata.Name = "Changed"
	first.info.Manifest.Contributes.PaymentProviders[0].Label = "Changed"
	first.info.ManifestRaw[0] = '!'

	second, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if second.info.Manifest.Metadata.Name != "Original" || second.info.Manifest.Contributes.PaymentProviders[0].Label != "Test Payment" || !bytes.Equal(second.info.ManifestRaw, originalRaw) {
		t.Fatal("cold inspection exposed shared manifest state")
	}
	second.info.Manifest.Metadata.Name = "Changed again"
	second.info.Manifest.Contributes.PaymentProviders[0].Label = "Changed again"
	second.info.ManifestRaw[0] = '!'
	third, err := inspectOfficialPluginPackage(source)
	if err != nil || third.info.Manifest.Metadata.Name != "Original" || third.info.Manifest.Contributes.PaymentProviders[0].Label != "Test Payment" || !bytes.Equal(third.info.ManifestRaw, originalRaw) {
		t.Fatalf("warm inspection exposed shared manifest state: %v", err)
	}

	officialPluginPackageCache.Lock()
	cached := officialPluginPackageCache.entries[source]
	officialPluginPackageCache.Unlock()
	if cached.manifest != string(originalRaw) || len(cached.manifest) >= len(data)/100 {
		t.Fatal("inspection cache retained more than the small manifest payload")
	}
}

func TestOfficialPluginInspectionReplacesMetadataForUpdatedSource(t *testing.T) {
	oldData := officialCacheTestPackage(t, "Original", []byte("old-provider"))
	newData := officialCacheTestPackage(t, "Replaced", []byte("new-provider"))
	source := writeOfficialCacheTestSource(t, oldData)
	original, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	// 原子发布可能保留长度与 mtime，缓存还必须识别源文件身份变化。
	if len(oldData) != len(newData) {
		t.Fatal("fixture packages must have matching lengths")
	}
	replacement := filepath.Join(filepath.Dir(source), "replacement.yingce-plugin")
	if err := os.WriteFile(replacement, newData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, original.source.ModTime(), original.source.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, source); err != nil {
		t.Fatal(err)
	}
	updated, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if updated.hash != pluginHash(newData) || updated.hash == original.hash || updated.info.Manifest.Metadata.Name != "Replaced" {
		t.Fatal("updated official source reused stale metadata")
	}
	officialPluginPackageCache.Lock()
	cached := officialPluginPackageCache.entries[source]
	officialPluginPackageCache.Unlock()
	if cached.hash != updated.hash {
		t.Fatal("updated source did not replace the cached entry")
	}
}

func TestOfficialPluginInspectionRejectsCorruptReplacement(t *testing.T) {
	source := writeOfficialCacheTestSource(t, officialCacheTestPackage(t, "Original", []byte("provider")))
	if _, err := inspectOfficialPluginPackage(source); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("invalid zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectOfficialPluginPackage(source); err == nil {
		t.Fatal("corrupt replacement bypassed package validation")
	}
	officialPluginPackageCache.Lock()
	_, retained := officialPluginPackageCache.entries[source]
	officialPluginPackageCache.Unlock()
	if retained {
		t.Fatal("invalid source left stale inspection metadata cached")
	}
}

func TestOfficialPluginInspectionConcurrentCallersRemainIsolated(t *testing.T) {
	data := officialCacheTestPackage(t, "Original", bytes.Repeat([]byte("provider"), 1024))
	source := writeOfficialCacheTestSource(t, data)
	var group sync.WaitGroup
	for range 16 {
		group.Go(func() {
			for range 4 {
				pkg, err := inspectOfficialPluginPackage(source)
				if err != nil {
					t.Error(err)
					return
				}
				if pkg.hash != pluginHash(data) || pkg.info.Manifest.Contributes.PaymentProviders[0].Label != "Test Payment" || pkg.info.ManifestRaw[0] != '{' {
					t.Error("concurrent caller received modified inspection data")
					return
				}
				pkg.info.Manifest.Contributes.PaymentProviders[0].Label = "Changed"
				pkg.info.ManifestRaw[0] = '!'
			}
		})
	}
	group.Wait()
}

func TestOfficialPluginPackageCacheLinksSourceAndReusesDestination(t *testing.T) {
	data := officialCacheTestPackage(t, "Original", []byte("provider"))
	source := writeOfficialCacheTestSource(t, data)
	pkg, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), pkg.hash+".yingce-plugin")
	if err := cachePluginPackage(target, pkg); err != nil {
		t.Fatal(err)
	}
	linked, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(pkg.source, linked) {
		t.Fatal("same-filesystem cache did not reuse the inspected source")
	}
	actual, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("cached package differs from inspected source: %v", err)
	}
	if err := cachePluginPackage(target, pkg); err != nil {
		t.Fatal(err)
	}
	again, err := os.Stat(target)
	if err != nil || !os.SameFile(linked, again) {
		t.Fatalf("existing content-addressed package was unnecessarily replaced: %v", err)
	}
}

func TestOfficialPluginPackageCacheCopiesAndVerifiesWhenLinkUnavailable(t *testing.T) {
	data := officialCacheTestPackage(t, "Original", bytes.Repeat([]byte("provider"), 1024))
	source := writeOfficialCacheTestSource(t, data)
	pkg, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), pkg.hash+".yingce-plugin")
	// 错误大小的现有文件使硬链接返回 EEXIST，确定性覆盖与跨文件系统相同的复制分支。
	if err := os.WriteFile(target, []byte("incomplete"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := cachePluginPackage(target, pkg); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("streamed package differs from inspected source: %v", err)
	}
	copied, err := os.Stat(target)
	if err != nil || os.SameFile(pkg.source, copied) || copied.Mode().Perm() != 0o600 {
		t.Fatalf("copy did not publish an independent private file: %v", err)
	}
}

func TestOfficialPluginPackageCacheRejectsChangedSource(t *testing.T) {
	data := officialCacheTestPackage(t, "Original", []byte("provider"))
	source := writeOfficialCacheTestSource(t, data)
	pkg, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), pkg.hash+".yingce-plugin")
	if err := cachePluginPackage(target, pkg); err == nil {
		t.Fatal("changed source was installed with its old digest")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("changed source left a published cache file: %v", err)
	}
}

func TestOfficialPluginPackageCacheDoesNotPublishChecksumMismatch(t *testing.T) {
	oldData := officialCacheTestPackage(t, "Original", []byte("old-provider"))
	newData := officialCacheTestPackage(t, "Replaced", []byte("new-provider"))
	source := writeOfficialCacheTestSource(t, oldData)
	pkg, err := inspectOfficialPluginPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, newData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(source, pkg.source.ModTime(), pkg.source.ModTime()); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), pkg.hash+".yingce-plugin")
	previous := []byte("interrupted-cache")
	if err := os.WriteFile(target, previous, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := cachePluginPackage(target, pkg); err == nil {
		t.Fatal("copy accepted altered package bytes with matching source metadata")
	}
	actual, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(actual, previous) {
		t.Fatalf("failed copy overwrote the previous cache file: %v", err)
	}
	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".plugin-*.tmp"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("failed copy left temporary files: %v %v", leftovers, err)
	}
}

func BenchmarkOfficialPluginInspectionCached(b *testing.B) {
	data := officialCacheTestPackage(b, "Original", bytes.Repeat([]byte("provider payload"), 128<<10))
	source := writeOfficialCacheTestSource(b, data)
	if _, err := inspectOfficialPluginPackage(source); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := inspectOfficialPluginPackage(source); err != nil {
			b.Fatal(err)
		}
	}
}

func writeOfficialCacheTestSource(t testing.TB, data []byte) string {
	t.Helper()
	source := filepath.Join(t.TempDir(), "official.yingce-plugin")
	if err := os.WriteFile(source, data, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		officialPluginPackageCache.Lock()
		delete(officialPluginPackageCache.entries, source)
		officialPluginPackageCache.Unlock()
	})
	return source
}

func officialCacheTestPackage(t testing.TB, name string, provider []byte) []byte {
	t.Helper()
	manifest := []byte(fmt.Sprintf(`{"apiVersion":"yingce.plugin/v1","id":"test-official-cache","version":"1.0.0","name":%q,"author":"Test","enabled":false,"runtime":{"backend":"rpc","backendEntry":"backend/provider"},"contributes":{"paymentProviders":[{"id":"test-payment","label":"Test Payment","icon":"brand:test","checkoutMode":"redirect","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}}`, name))
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range []struct {
		name string
		data []byte
	}{{"manifest.json", manifest}, {"backend/provider", provider}} {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store}
		header.SetModTime(time.Unix(0, 0).UTC())
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
