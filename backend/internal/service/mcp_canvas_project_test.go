package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

func newMCPProjectTestService(t *testing.T, name string) (*Service, *repository.Repository, *gorm.DB) {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-" + name + "-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.CanvasShare{}, &model.CanvasUnitLink{}, &model.Session{}, &model.Message{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}, &model.UserDailyActivity{}, &model.MCPAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	return New(repo, t.TempDir()), repo, db
}

func TestApplyCanvasMCPAtomicIsScopedToOwner(t *testing.T) {
	svc, repo, db := newMCPProjectTestService(t, "atomic-owner")
	raw := json.RawMessage(`{"id":"canvas-1","title":"用户 A","nodes":[],"connections":[]}`)
	project, err := svc.SaveCanvasProjectWithPrecondition("user-a", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	updated := &model.CanvasProject{ID: project.ID, UserID: "user-b", ProjectID: project.ProjectID, Title: "越权写入", PayloadJSON: string(raw), Revision: project.Revision + 1, StateHash: project.StateHash}
	audit := &model.MCPAuditEvent{ID: "audit-cross-user", UserID: "user-b", CanvasID: project.ID, Tool: "canvas_apply_ops"}
	_, ok, err := repo.ApplyCanvasMCPAtomic("user-b", project.ID, project.Revision, project.StateHash, updated, audit)
	if err == nil || ok {
		t.Fatalf("cross-user atomic write = ok:%v err:%v, want rejection", ok, err)
	}
	stored, err := svc.GetMCPProject("user-a", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != project.Revision || string(stored.Payload) != string(raw) {
		t.Fatalf("owner canvas changed after cross-user write: %#v", stored)
	}
	var count int64
	if err := db.Model(&model.MCPAuditEvent{}).Where("id = ?", audit.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("cross-user audit unexpectedly persisted: %d", count)
	}
}

func TestMCPTaskIdempotencyIsScopedToOwnerAndCanvas(t *testing.T) {
	svc, repo, db := newMCPProjectTestService(t, "task-owner")
	_ = svc
	now := time.Now()
	tasks := []model.Task{
		{ID: "task-a", UserID: "user-a", ProjectID: "canvas-a", InputJSON: `{"metadata":{"clientOperationId":"op-1","nodeId":"node-1"}}`, CreatedAt: now},
		{ID: "task-b", UserID: "user-b", ProjectID: "canvas-b", InputJSON: `{"metadata":{"clientOperationId":"op-1","nodeId":"node-1"}}`, CreatedAt: now.Add(time.Second)},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	got, err := repo.MCPTaskByIdempotency("user-a", "canvas-a", "node-1", "op-1")
	if err != nil || got == nil || got.ID != "task-a" {
		t.Fatalf("owner lookup = %#v, err=%v", got, err)
	}
	if _, err := repo.MCPTaskByIdempotency("user-a", "canvas-b", "node-1", "op-1"); err == nil {
		t.Fatal("cross-canvas idempotency lookup unexpectedly returned a task")
	}
	if _, err := repo.MCPTaskByIdempotency("user-c", "canvas-a", "node-1", "op-1"); err == nil {
		t.Fatal("cross-user idempotency lookup unexpectedly returned a task")
	}
}

// Sequential submissions from the same snapshot cover stale-write rejection,
// not simultaneous database transactions.
func TestApplyCanvasMCPAtomicRejectsSecondWriteFromSameVersion(t *testing.T) {
	svc, repo, _ := newMCPProjectTestService(t, "atomic-race-"+strings.ReplaceAll(time.Now().Format("150405.000000000"), ".", "-"))
	raw := json.RawMessage(`{"id":"canvas-race","title":"初稿","nodes":[],"connections":[]}`)
	base, err := svc.SaveCanvasProjectWithPrecondition("user-a", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	makeUpdate := func(title string) *model.CanvasProject {
		payload := `{"id":"canvas-race","title":"` + title + `","nodes":[],"connections":[]}`
		hash, hashErr := model.CanvasStateHash([]byte(payload))
		if hashErr != nil {
			t.Fatal(hashErr)
		}
		return &model.CanvasProject{ID: base.ID, UserID: "user-a", ProjectID: base.ProjectID, Title: title, PayloadJSON: payload, Revision: base.Revision + 1, StateHash: hash}
	}
	updates := []*model.CanvasProject{makeUpdate("并发一"), makeUpdate("并发二")}
	results := make([]bool, 2)
	errors := make([]error, 2)
	for i := range updates {
		_, results[i], errors[i] = repo.ApplyCanvasMCPAtomic("user-a", base.ID, base.Revision, base.StateHash, updates[i], &model.MCPAuditEvent{ID: "race-audit-" + string(rune('1'+i)), UserID: "user-a", CanvasID: base.ID, Tool: "canvas_apply_ops"})
	}
	successes := 0
	for i := range results {
		if results[i] {
			successes++
		} else if errors[i] != nil {
			t.Fatalf("concurrent writer %d returned unexpected error: %v", i, errors[i])
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent successes = %d, want exactly one (results=%v)", successes, results)
	}
	stored, err := svc.GetMCPProject("user-a", base.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != base.Revision+1 {
		t.Fatalf("revision after race = %d, want %d", stored.Revision, base.Revision+1)
	}
}

func paddedCanvasPayload(id string, title string, pad int) json.RawMessage {
	return json.RawMessage(`{"id":"` + id + `","title":"` + title + `","nodes":[],"connections":[],"pad":"` + strings.Repeat("x", pad) + `"}`)
}

func TestSaveCanvasProjectWithPreconditionIncrementsVersion(t *testing.T) {
	svc, _, _ := newMCPProjectTestService(t, "project")
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 0 || first.StateHash == "" {
		t.Fatalf("first = %#v", first)
	}
	if first.HashSource != "server" {
		t.Fatalf("first hash source = %q", first.HashSource)
	}
	updatedRaw := json.RawMessage(`{"id":"canvas-1","title":"二稿","nodes":[],"connections":[]}`)
	second, err := svc.SaveCanvasProjectWithPrecondition("user-1", updatedRaw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash})
	if err != nil {
		t.Fatal(err)
	}
	if second.Revision != 1 || second.StateHash == first.StateHash {
		t.Fatalf("second = %#v", second)
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected stale precondition conflict")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict || appErr.Message != "画布已被其他窗口或 MCP 修改，请重新加载/合并" {
			t.Fatalf("stale error = %v", err)
		}
	}
}

func TestListMCPProjectsReturnsServerVersionMetadata(t *testing.T) {
	svc, r, _ := newMCPProjectTestService(t, "list")
	stateHash, err := model.CanvasStateHash([]byte(`{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Create(&model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: "project-1", Title: "列表", PayloadJSON: `{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`, Revision: 4, StateHash: stateHash}); err != nil {
		t.Fatal(err)
	}
	projects, err := svc.ListMCPProjects("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Revision != 4 || projects[0].StateHash != stateHash || projects[0].HashSource != "server" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestSaveCanvasProjectRejectsStaleHashWithoutChangingStoredProject(t *testing.T) {
	svc, _, _ := newMCPProjectTestService(t, "hash")
	base := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", base, nil)
	if err != nil {
		t.Fatal(err)
	}
	changed := json.RawMessage(`{"id":"canvas-1","title":"不应写入","nodes":[],"connections":[]}`)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", changed, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: "wrong-hash"}); err == nil {
		t.Fatal("expected stale hash conflict")
	}
	stored, err := svc.GetMCPProject("user-1", "canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(stored.Payload) != string(base) || stored.Revision != first.Revision || stored.StateHash != first.StateHash {
		t.Fatalf("stored = %#v", stored)
	}
}

func TestSaveCanvasProjectPreconditionIsUserScoped(t *testing.T) {
	svc, _, _ := newMCPProjectTestService(t, "scope")
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetMCPProject("user-2", "canvas-1"); err == nil {
		t.Fatal("expected user-scoped project lookup to fail")
	}
	if _, err := svc.ListMCPProjects("user-2"); err != nil {
		t.Fatal(err)
	}
	other := json.RawMessage(`{"id":"canvas-2","title":"其他用户","nodes":[],"connections":[]}`)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-2", other, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected scoped stale precondition to fail for missing user-2 row")
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-2", other, nil); err != nil {
		t.Fatal(err)
	}
}

func TestSaveCanvasProjectWithPreconditionMissingRowDoesNotRecreate(t *testing.T) {
	svc, repo, _ := newMCPProjectTestService(t, "missing")
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteCanvasProject("user-1", "canvas-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected missing row conflict")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
			t.Fatalf("missing row error = %v", err)
		}
	}
	if _, err := svc.GetMCPProject("user-1", "canvas-1"); err == nil {
		t.Fatal("stale precondition recreated deleted canvas")
	}
}

func TestSaveCanvasProjectWithPreconditionChecksQuotaAndRecordsActivity(t *testing.T) {
	svc, repo, db := newMCPProjectTestService(t, "quota")
	policy := defaultRuntimePolicy()
	policy.Resource.StructuredDataMB = 1
	rawPolicy, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(rawPolicy)}); err != nil {
		t.Fatal(err)
	}
	base := paddedCanvasPayload("canvas-1", "初稿", 512*1024)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", base, nil)
	if err != nil {
		t.Fatal(err)
	}
	var activity model.UserDailyActivity
	if err := db.First(&activity, "user_id = ?", "user-1").Error; err != nil || !activity.CanvasActive {
		t.Fatalf("activity = %#v err=%v", activity, err)
	}
	oversized := paddedCanvasPayload("canvas-1", "超额", 1100*1024)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", oversized, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected quota error")
	}
	stored, err := svc.GetMCPProject("user-1", "canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != first.Revision || string(stored.Payload) != string(base) {
		t.Fatalf("stored after quota rejection = %#v", stored)
	}
}

func TestCanvasProjectSummarySerializesRevisionZeroAndStateHash(t *testing.T) {
	raw, err := json.Marshal(UserDataSummary{ID: "canvas-1", Title: "初稿", StateHash: "hash-r0"})
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if !strings.Contains(body, `"revision":0`) {
		t.Fatalf("revision zero omitted: %s", body)
	}
	if !strings.Contains(body, `"stateHash":"hash-r0"`) {
		t.Fatalf("state hash omitted: %s", body)
	}
}

func TestCanvasProjectSnapshotDerivesPayloadAndVersionFromSameRows(t *testing.T) {
	svc, _, db := newMCPProjectTestService(t, "snapshot")
	initialPayload := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", initialPayload, nil)
	if err != nil {
		t.Fatal(err)
	}
	updatedPayload := json.RawMessage(`{"id":"canvas-1","title":"并发更新","nodes":[],"connections":[]}`)
	updatedHash, err := model.CanvasStateHash(updatedPayload)
	if err != nil {
		t.Fatal(err)
	}
	callbackName := "test:mutate_canvas_after_snapshot_payload_query"
	mutated := false
	if err := db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if mutated || tx.Statement.Table != "canvas_projects" || len(tx.Statement.Selects) > 0 {
			return
		}
		mutated = true
		if err := tx.Session(&gorm.Session{NewDB: true}).Model(&model.CanvasProject{}).
			Where("id = ? AND user_id = ?", "canvas-1", "user-1").
			Updates(map[string]any{
				"title":        "并发更新",
				"payload_json": string(updatedPayload),
				"revision":     first.Revision + 1,
				"state_hash":   updatedHash,
			}).Error; err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove(callbackName)
	})

	snapshot, err := svc.UserDataSnapshot("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if !mutated {
		t.Fatal("expected test callback to simulate a concurrent canvas update")
	}
	if len(snapshot.Projects) != 1 || len(snapshot.ProjectVersions) != 1 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	payloadHash, err := model.CanvasStateHash(snapshot.Projects[0])
	if err != nil {
		t.Fatal(err)
	}
	version := snapshot.ProjectVersions[0]
	if version.Revision != first.Revision || version.StateHash != payloadHash {
		t.Fatalf("snapshot mixed rows: payloadHash=%s version=%#v", payloadHash, version)
	}
	if version.StateHash == updatedHash {
		t.Fatalf("snapshot version came from a later row: %#v", version)
	}
}
