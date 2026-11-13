package app

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	mcpintegration "yingce/backend/internal/integrations/mcp"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
)

func TestMCPPlatformGrantAndArgumentPolicyAreIndependentOfApproval(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := db.Create(&model.User{ID: "other", Username: "other", Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	view := enabledAgentMCPConnection(t, s, remote, admin, true, "")
	input := MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, Enabled: true, AllowedTools: view.AllowedTools,
		AllowedUserIDs: []string{"user"}, ToolPolicies: map[string]map[string]any{"record_note": {"type": "object", "properties": map[string]any{"text": map[string]any{"const": "allowed"}}, "required": []string{"text"}}}}
	view, err := s.SaveMCPConnection(admin, view.ID, true, input)
	if err != nil {
		t.Fatal(err)
	}
	call := agentMCPToolCall(t, view, "bounded-platform-call", "forbidden")
	args, _ := cloudAgentDecodeMCPCall(call)
	before := remote.requests.Load()
	for _, userID := range []string{"other", "admin"} {
		_, err := mcpintegration.AuthorizeCall(s.repo, userID, args)
		assertMCPErrorStatus(t, err, http.StatusNotFound)
		available, err := s.mcpDomain().AvailableTools(userID, "", "")
		if err != nil || len(available) != 0 {
			t.Fatalf("ungranted user %s saw platform tools: %+v %v", userID, available, err)
		}
	}
	_, err = cloudAgentPreviewMCPCall(s.repo, "user", "", call)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	_, err = s.mcpDomain().Call(t.Context(), "user", "any-run", call.ID, args, func(*model.CloudAgentExecution) error { return nil })
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	if remote.requests.Load() != before {
		t.Fatal("a rejected resource policy reached the remote server")
	}
	call = agentMCPToolCall(t, view, "allowed-platform-call", "allowed")
	state := approvedAgentMCPState(t, s, call)
	if _, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s); err != nil {
		t.Fatal(err)
	}
	if remote.calls.Load() != 1 {
		t.Fatal("explicitly granted and approved call did not execute")
	}
	listed, err := s.MCPConnections(admin, true)
	if err != nil || len(listed) != 1 || listed[0].Tools[0].InputSchema != nil {
		t.Fatalf("settings list loaded full schemas: %+v %v", listed, err)
	}
	available, err := s.mcpDomain().AvailableTools("user", view.ID, "record_note")
	if err != nil || len(available) != 1 || available[0].Tools[0].InputSchema == nil || available[0].Tools[0].ArgumentPolicy == nil {
		t.Fatalf("on-demand schema or platform constraints missing: %+v %v", available, err)
	}
	input.AllowedUserIDs = []string{"other"}
	view, err = s.SaveMCPConnection(admin, view.ID, true, input)
	if err != nil {
		t.Fatal(err)
	}
	args.Revision = view.Revision
	args.Arguments = map[string]any{"text": "allowed"}
	_, err = mcpintegration.AuthorizeCall(s.repo, "user", args)
	assertMCPErrorStatus(t, err, http.StatusNotFound)
	input.AllowedUserIDs = nil
	_, err = s.SaveMCPConnection(admin, view.ID, true, input)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
	input.AllowedUserIDs = []string{"other"}
	input.ToolPolicies = nil
	_, err = s.SaveMCPConnection(admin, view.ID, true, input)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
	if err := db.Model(&model.User{}).Where("id = ?", "other").UpdateColumn("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	input.Enabled = false
	view, err = s.SaveMCPConnection(admin, view.ID, true, input)
	if err != nil || view.Enabled {
		t.Fatalf("missing policies or a disabled grantee prevented revocation: %+v %v", view, err)
	}
	args.Revision = view.Revision
	_, err = mcpintegration.AuthorizeCall(s.repo, "other", args)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	input.Enabled = true
	_, err = s.SaveMCPConnection(admin, view.ID, true, input)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
	input.Enabled, input.AllowedTools = false, nil
	_, err = s.SaveMCPConnection(&model.User{ID: "user"}, "", false, input)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
}

func TestMCPQuotaReservesBeforeExternalIOAndExpiredReceiptNeverReplays(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user"}, false, "")
	call := agentMCPToolCall(t, view, "quota-call", "saved result")
	state := approvedAgentMCPState(t, s, call)
	initial, err := s.repo.MCPStoredBytes("user")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.MCPStorageUsage{}).Where("user_id = ?", "user").UpdateColumn("bytes", repository.MCPStorageLimitBytes-100).Error; err != nil {
		t.Fatal(err)
	}
	before := remote.requests.Load()
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	var count int64
	if err := db.Model(&model.MCPToolExecution{}).Count(&count).Error; err != nil || count != 0 || remote.requests.Load() != before {
		t.Fatalf("quota rejection executed or retained a receipt: count=%d err=%v", count, err)
	}
	free, acquired, err := s.coordinator.Acquire(t.Context(), "mcp:connection:"+view.ID, 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("quota failure leaked a connection lease: %v", err)
	}
	free()
	if err := db.Model(&model.MCPStorageUsage{}).Where("user_id = ?", "user").UpdateColumn("bytes", initial).Error; err != nil {
		t.Fatal(err)
	}
	result, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	used, err := s.repo.MCPStoredBytes("user")
	if err != nil || used != initial+1024+int64(len(raw)) {
		t.Fatalf("receipt budget not settled: initial=%d used=%d result=%d err=%v", initial, used, len(raw), err)
	}
	// Durable replay remains available even when admission is unavailable.
	s.coordinator = nil
	before = remote.requests.Load()
	if _, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s); err != nil {
		t.Fatal(err)
	}
	if again, err := s.repo.MCPStoredBytes("user"); err != nil || again != used || remote.requests.Load() != before {
		t.Fatalf("replay consumed quota or external IO: %d %v", again, err)
	}
	pruned, err := s.repo.PruneMCPExecutionResults(time.Now().Add(time.Hour), 10)
	if err != nil || pruned != 1 {
		t.Fatalf("failed to expire receipt: %d %v", pruned, err)
	}
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusConflict)
	if remaining, err := s.repo.MCPStoredBytes("user"); err != nil || remaining != initial+1024 || remote.requests.Load() != before {
		t.Fatalf("expired receipt lost idempotency or quota: %d %v", remaining, err)
	}
}

func TestMCPLegacyUnsafeTemplateIsHiddenAndCannotReachNetwork(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	admin, actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}, &model.User{ID: "user"}
	input := MCPTemplateInput{Name: "legacy", Transport: "streamable_http", Published: true,
		Headers: map[string]string{"Authorization": "Bearer {{token}}"}, Parameters: []mcpintegration.Parameter{{Name: "token", Type: "secret"}}}
	template, err := s.SaveMCPTemplate(admin, "", input)
	if err != nil {
		t.Fatal(err)
	}
	view := enabledAgentMCPConnection(t, s, remote, actor, false, template.ID)
	call := agentMCPToolCall(t, view, "legacy-template-call", "must not execute")
	state := approvedAgentMCPState(t, s, call)
	// Emulate a template written before custom auth headers required secrets.
	input.Headers["X-Auth"] = "legacy-public-credential"
	raw, _ := json.Marshal(input)
	if err := db.Model(&model.MCPServerTemplate{}).Where("id = ?", template.ID).UpdateColumn("definition", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	catalog, err := s.MCPCatalog(actor, false)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(catalog)
	if strings.Contains(string(raw), template.ID) || strings.Contains(string(raw), "legacy-public-credential") {
		t.Fatal("unsafe legacy template leaked through the public catalog")
	}
	catalog, err = s.MCPCatalog(admin, true)
	if err != nil {
		t.Fatal(err)
	}
	adminCanRepair := false
	for _, entry := range catalog {
		adminCanRepair = adminCanRepair || entry.ID == template.ID
	}
	if !adminCanRepair {
		t.Fatal("administrator lost the legacy template repair entry")
	}
	before := remote.requests.Load()
	_, err = s.TestMCPConnection(t.Context(), actor, view.ID, false)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	if remote.requests.Load() != before {
		t.Fatal("unsafe legacy template reached external IO")
	}
}

func TestMCPConnectionQuotaSerializesConcurrentCreates(t *testing.T) {
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	s, _, _, _ := creationTestService(t)
	actor := &model.User{ID: "user"}
	input := MCPConnectionInput{Name: "quota", Transport: "streamable_http", ServerURL: "http://127.0.0.1/mcp"}
	for i := 0; i < 29; i++ {
		if _, err := s.SaveMCPConnection(actor, "", false, input); err != nil {
			t.Fatal(err)
		}
	}
	var created atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Go(func() {
			if _, err := s.SaveMCPConnection(actor, "", false, input); err == nil {
				created.Add(1)
			}
		})
	}
	wg.Wait()
	count, err := s.repo.MCPConnectionCount("user", "user")
	if err != nil || count != 30 || created.Load() != 1 {
		t.Fatalf("concurrent create exceeded quota: count=%d created=%d err=%v", count, created.Load(), err)
	}
}

func TestMCPDetectionConcurrencyAndRateLimitsPreventNetworkIO(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	actor := &model.User{ID: "user"}
	view := enabledAgentMCPConnection(t, s, remote, actor, false, "")
	for _, scenario := range []struct {
		key   string
		limit int
	}{
		{"mcp:connection:" + view.ID, 1}, {"mcp:user:user", 2}, {"mcp:test:global", 16}, {"mcp:egress:global", 32},
	} {
		releases := []func(){}
		for i := 0; i < scenario.limit; i++ {
			free, ok, err := s.coordinator.Acquire(t.Context(), scenario.key, scenario.limit, time.Minute)
			if err != nil || !ok {
				t.Fatalf("prepare slot: %v", err)
			}
			releases = append(releases, free)
		}
		before := remote.requests.Load()
		_, err := s.TestMCPConnection(t.Context(), actor, view.ID, false)
		for _, free := range releases {
			free()
		}
		assertMCPErrorStatus(t, err, http.StatusTooManyRequests)
		if remote.requests.Load() != before {
			t.Fatal("rejected detection reached network")
		}
	}
	// One original detection + four rejected admissions consumed five attempts.
	if _, err := s.TestMCPConnection(t.Context(), actor, view.ID, false); err != nil {
		t.Fatal(err)
	}
	before := remote.requests.Load()
	_, err := s.TestMCPConnection(t.Context(), actor, view.ID, false)
	assertMCPErrorStatus(t, err, http.StatusTooManyRequests)
	if remote.requests.Load() != before {
		t.Fatal("rate-limited detection reached network")
	}
}

func TestMCPCallLimitsAndCoordinatorFailureDoNotClaimEffects(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user"}, false, "")
	call := agentMCPToolCall(t, view, "limited-call", "one operation")
	state := approvedAgentMCPState(t, s, call)
	for _, scenario := range []struct {
		key   string
		limit int
	}{
		{"mcp:connection:" + view.ID, 1}, {"mcp:user:user", 2}, {"mcp:call:global", 32},
	} {
		releases := []func(){}
		for i := 0; i < scenario.limit; i++ {
			free, ok, err := s.coordinator.Acquire(t.Context(), scenario.key, scenario.limit, time.Minute)
			if err != nil || !ok {
				t.Fatalf("prepare slot: %v", err)
			}
			releases = append(releases, free)
		}
		before := remote.requests.Load()
		_, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
		for _, free := range releases {
			free()
		}
		assertMCPErrorStatus(t, err, http.StatusTooManyRequests)
		if remote.requests.Load() != before {
			t.Fatal("concurrency-rejected call reached network")
		}
	}
	for i := 0; i < 60; i++ {
		if _, err := s.coordinator.Allow(t.Context(), "mcp:call:user", 60, time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	before := remote.requests.Load()
	_, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusTooManyRequests)
	client := redis.NewClient(&redis.Options{Network: "unix", Addr: filepath.Join(t.TempDir(), "absent.sock"), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	s.coordinator = platform.NewCoordinatorWithRedis(client, "unavailable-test")
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusServiceUnavailable)
	var count int64
	if err := db.Model(&model.MCPToolExecution{}).Count(&count).Error; err != nil || count != 0 || remote.requests.Load() != before {
		t.Fatalf("limit or coordinator failure claimed an external effect: count=%d err=%v", count, err)
	}
}
