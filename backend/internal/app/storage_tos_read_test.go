package app

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
)

func TestVolcengineReadContinuationInImageEditAndZIP(t *testing.T) {
	const root, host = "tos-s3-cn-beijing.volces.com", "bucket.tos-s3-cn-beijing.volces.com"
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		t.Setenv(name, "")
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,"+root+","+host)
	outboundtest.DNSAddresses(t, [][4]byte{{127, 0, 0, 1}, {127, 0, 0, 2}}, root, host)
	image := mediaTestPNG(t)
	first, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	port := first.Addr().(*net.TCPAddr).Port
	second, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.2:%d", port))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	var resumes atomic.Int32
	serve := func(listener net.Listener, truncate bool) {
		server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/missing.png" {
				http.Error(w, "test object missing", http.StatusNotFound)
				return
			}
			w.Header().Set("ETag", `"edit-source"`)
			if truncate {
				w.Header().Set("Content-Length", fmt.Sprint(len(image)))
				_, _ = w.Write(image[:16])
				return
			}
			if r.Header.Get("Range") != "" {
				if want := fmt.Sprintf("bytes=16-%d", len(image)-1); r.Header.Get("Range") != want || r.Header.Get("If-Match") != `"edit-source"` {
					t.Errorf("unexpected resume %s %s", r.Header.Get("Range"), r.Header.Get("If-Match"))
				}
				resumes.Add(1)
			}
			http.ServeContent(w, r, "reference.png", time.Time{}, bytes.NewReader(image))
		})}
		go func() { _ = server.Serve(listener) }()
		t.Cleanup(func() { _ = server.Close() })
	}
	serve(first, true)
	serve(second, false)

	svc, _ := newMediaRecoveryTestService(t)
	if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), make([]byte, 32), 0600); err != nil {
		t.Fatal(err)
	}
	setting := ossSettingValue{
		Enabled: true, Provider: volcengineTOSProvider, Region: "cn-beijing", Bucket: "bucket",
		Endpoint: fmt.Sprintf("http://%s:%d", root, port), AccessKeyID: "fixture-id", AccessKeySecret: "fixture-signing-value",
	}
	settingsJSON, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingsJSON)}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"reference", "missing"} {
		if err := svc.repo.CreateResource(&model.Resource{
			ID: id, UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Size: int64(len(image)), MimeType: "image/png",
			Provider: setting.Provider, Endpoint: setting.Endpoint, Bucket: setting.Bucket, ObjectKey: id + ".png",
		}); err != nil {
			t.Fatal(err)
		}
	}
	files, err := svc.EcommerceDownloadResources("owner", []string{"reference"})
	if err != nil {
		t.Fatal(err)
	}
	var zipped bytes.Buffer
	if err := svc.WriteEcommerceDownload(t.Context(), "owner", files, &zipped); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(zipped.Bytes()), int64(zipped.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 {
		t.Fatalf("unexpected archive entries: %d", len(archive.File))
	}
	entry, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer entry.Close()
	extracted, err := io.ReadAll(entry)
	if err != nil || !bytes.Equal(extracted, image) || resumes.Load() != 1 {
		t.Fatalf("zip has wrong bytes or resume count: decoded %d bytes, resumes=%d, %v", len(extracted), resumes.Load(), err)
	}

	var submitted atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		submitted.Add(1)
		file, _, err := r.FormFile("image")
		if r.URL.Path != "/v1/images/edits" || err != nil {
			t.Errorf("unexpected provider request %s: %v", r.URL.Path, err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		defer file.Close()
		actual, err := io.ReadAll(file)
		if err != nil || !bytes.Equal(actual, image) || r.FormValue("prompt") != "保留主角，换一套衣服" {
			t.Error("image edit did not retain the original reference and prompt")
		}
		_, _ = fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, base64.StdEncoding.EncodeToString(image))
	}))
	defer provider.Close()
	for _, id := range []string{"missing", "reference"} {
		payload, _ := json.Marshal(canvasGenerationInput{
			Mode: "image", Prompt: "保留主角，换一套衣服",
			Config:          providerConfig{InterfaceType: "openai-image", BaseURL: provider.URL, APIKey: "fixture-token", Model: "gpt-image-2", Size: "1024x1024"},
			ReferenceImages: []providerMedia{{StorageKey: "resource:" + id}},
		})
		_, err := svc.processCanvasGenerationTask(t.Context(), "owner", "", "canvas_image", "", string(payload))
		if id == "missing" {
			if referenceReadFailureCode(err) == "" || submitted.Load() != 0 {
				t.Fatalf("missing reference reached the provider: %v, calls=%d", err, submitted.Load())
			}
		} else if err != nil || submitted.Load() != 1 {
			t.Fatalf("expected one image edit: %v, calls=%d", err, submitted.Load())
		}
	}
}
