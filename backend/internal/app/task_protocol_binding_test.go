package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestModelReleaseSurvivesUpgradeAndRestart(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", t.TempDir())
	svc, db := newMediaRecoveryTestService(t)
	var err error
	svc.coordinator, err = platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	restart := func() {
		t.Helper()
		svc.pluginRuntime, err = newPluginRuntime(svc.dataDir)
		if err != nil {
			t.Fatal(err)
		}
	}
	restart()
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"original-job","status":"processing"}`)
	}))
	defer server.Close()
	channel := model.ModelChannel{ID: "release-channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: server.URL, APIKey: "fixture"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	const providerID = "release-video"
	archive := func(version, path string) []byte {
		return testPluginPackage(t, []byte(fmt.Sprintf(`{"apiVersion":"yingce.plugin/v2","id":"release-family","version":%q,"name":"Release test","author":"Test","documentation":"# Test","contributes":{"providers":[{"id":"release-video","label":"Release video","capabilities":["video"],"scopes":["admin.system-channel","canvas"],"detachedPolling":true,"create":{"method":"POST","path":"/%[2]s/jobs","body":{"model":{"$ref":"request.model"}}},"poll":{"method":"GET","path":"/%[2]s/jobs/{{taskId}}"},"cancel":{"method":"DELETE","path":"/%[2]s/jobs/{{taskId}}"},"response":{"taskIdPaths":["id"],"statusPaths":["status"]}}]}}`, version, path)))
	}
	install := func(version, path string) PluginView {
		t.Helper()
		item, err := svc.InstallPlugin(archive(version, path), "release.yingce-plugin")
		if err != nil {
			t.Fatal(err)
		}
		return item
	}
	save := func(key, digest string, previous *model.ChannelModel) *model.ChannelModel {
		t.Helper()
		req := ChannelModelRequest{ModelKey: key, Protocol: providerID, ProtocolRelease: digest, Capability: "video", CapabilityConfig: DefaultModelCapabilityConfigForModel(providerID, key), PriceTiers: []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true}}}
		id := ""
		if previous != nil {
			id, req.ExpectedUpdatedAt, req.ExpectedPriceVersion = previous.ID, previous.UpdatedAt, previous.PriceVersion
		}
		row, err := svc.SaveAdminChannelModel(admin, channel.ID, id, req)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	userID := testGroupUserID(svc)
	create := func(key string) *model.Task {
		t.Helper()
		job, err := svc.CreateTask(userID, CreateTaskRequest{Type: "canvas_video", Prompt: "test", Input: map[string]any{"mode": "video", "config": map[string]any{"channelId": channel.ID, "model": key, "protocolRelease": "client-value"}}})
		if err != nil {
			t.Fatal(err)
		}
		stored, err := svc.repo.Task(job.ID)
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}
	run := func(task *model.Task) {
		t.Helper()
		_, _, err := svc.processTask(t.Context(), *task)
		var pending providerStatePendingError
		if !errors.As(err, &pending) || pending.TaskID != "original-job" {
			t.Fatalf("dispatch: %v", err)
		}
	}
	first := install("1.0.0", "first")
	oldSKU := save("standard", "", nil)
	oldJob := create(oldSKU.ModelKey)
	var binding taskProtocolBinding
	if err := json.Unmarshal([]byte(oldJob.ProtocolBindingJSON), &binding); err != nil || binding.Digest != first.SHA256 || binding.PluginID != "release-family" || binding.ProviderID != providerID {
		t.Fatalf("bad admitted binding: %v %v", binding, err)
	}
	attempt, err := svc.beginTaskRouteAttempt(oldJob)
	if err != nil || attempt.ProtocolBindingJSON != oldJob.ProtocolBindingJSON || attempt.ChannelModelID != oldSKU.ID || attempt.ChannelID != channel.ID {
		t.Fatalf("attempt binding: %v", err)
	}
	run(oldJob)
	second := install("2.0.0", "second")
	if _, err := svc.InstallPlugin(archive("1.0.0", "modified"), "changed.yingce-plugin"); err == nil {
		t.Fatal("replaced archived release")
	}
	if _, err := selectModelRelease(svc.protocolRegistry(), "other-provider", first.SHA256, false); err == nil {
		t.Fatal("accepted unrelated provider")
	}
	newSKU := save("flash", second.SHA256, nil)
	if first.SHA256 != save(oldSKU.ModelKey, "", oldSKU).ProtocolRelease {
		t.Fatal("ordinary edit upgraded the old model")
	}
	run(create(oldSKU.ModelKey))
	run(create(newSKU.ModelKey))
	queued := create(newSKU.ModelKey)
	for _, target := range []struct {
		digest string
		path   string
	}{{first.SHA256, "/first/jobs"}, {second.SHA256, "/second/jobs"}} {
		contract, err := svc.ResolveSystemProxyContract(providerID, target.digest)
		if err != nil || !slices.Equal(contract.DeclaredPostPaths(), []string{target.path}) {
			t.Fatalf("proxy uses wrong release: %v %v", contract.DeclaredPostPaths(), err)
		}
	}
	oldSKU, err = svc.repo.ChannelModel(oldSKU.ID)
	if err != nil {
		t.Fatal(err)
	}
	save("standard-renamed", second.SHA256, oldSKU)
	restart()
	resumed, err := svc.repo.Task(oldJob.ID)
	if err != nil || resumed.ProviderRequestID != "original-job" {
		t.Fatalf("lost receipt: %v", err)
	}
	run(resumed)
	if want := []string{"POST /v1/first/jobs", "POST /v1/first/jobs", "POST /v1/second/jobs", "GET /v1/first/jobs/original-job"}; !slices.Equal(requests, want) {
		t.Fatal(requests)
	}
	cancelInput, err := svc.providerCancellationInput(resumed)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.cancelProviderTask(t.Context(), cancelInput, resumed.ProviderRequestID); err != nil {
		t.Fatal(err)
	}
	if requests[len(requests)-1] != "DELETE /v1/first/jobs/original-job" {
		t.Fatal(requests)
	}
	if _, err := svc.SetPluginEnabled("release-family", false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.providerCancellationInput(resumed); err == nil {
		t.Fatal("disabled release still executable")
	}
	if _, err := svc.SetPluginEnabled("release-family", true); err != nil {
		t.Fatal(err)
	}
	if err := svc.UninstallPlugin("release-family"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.processTask(t.Context(), *queued); err == nil || !strings.Contains(err.Error(), "已撤下") {
		t.Fatalf("withdrawn release submitted queued task: %v", err)
	}
	if err := db.Model(resumed).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.QueryFailedVideoTask(t.Context(), userID, resumed.ID); err != nil {
		t.Fatal(err)
	}
	if requests[len(requests)-1] != "GET /v1/first/jobs/original-job" || len(requests) != 6 {
		t.Fatal(requests)
	}
	if err := db.Model(&channel).Update("base_url", server.URL+"/other-region").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.processTask(t.Context(), *resumed); err == nil || !strings.Contains(err.Error(), "原任务") || len(requests) != 6 {
		t.Fatalf("wrong region: %v %v", requests, err)
	}
	if err := os.WriteFile(filepath.Join(svc.pluginRuntime.packageDir, first.SHA256+".yingce-plugin"), []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newPluginRuntime(svc.dataDir); err == nil || !strings.Contains(err.Error(), "摘要校验失败") {
		t.Fatalf("corrupt archive: %v", err)
	}
}
