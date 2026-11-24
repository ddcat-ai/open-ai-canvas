package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func newTeamTextTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	allowLoopbackProviderTest(t)
	svc, db, _, _ := creationTestService(t)
	t.Setenv("REDIS_URL", "")
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	svc.coordinator = coordinator
	svc.activeCancels = make(map[string]context.CancelFunc)
	svc.platform = platform.New(svc.repo, coordinator, platformHost{svc: svc})
	if err := svc.EnsureDefaultUserGroup(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.User{ID: "worker", Username: "worker", Role: model.UserRoleUser, Status: model.UserStatusActive, UserGroup: "worker"},
		&model.UserGroup{ID: "worker-group", Code: "worker", Name: "成员分组", RatioBasisPoints: 5000, AllChannels: true, PointsPerUSD: 7 * CreditScale, PointsPerCNY: CreditScale, ModelOverridesJSON: "[]"},
		&model.CreditAccount{UserID: "worker", AvailableMicrocredits: 1234},
		&model.Team{ID: "team", Name: "文本团队", OwnerUserID: "user", Status: model.TeamActive},
		&model.TeamMembership{ID: "owner-member", TeamID: "team", UserID: "user", Role: model.TeamOwner, Status: model.TeamActive},
		&model.TeamMembership{ID: "worker-member", TeamID: "team", UserID: "worker", Role: model.TeamMember, Status: model.TeamActive},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc.invalidateUserGroups()
	if _, err := svc.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, FeatureAvailability{TeamsEnabled: true, CreditsEnabled: true, TaskCenterEnabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.OpenTeamWallets("team", "owner-member", true); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.OpenTeamWallets("team", "worker-member", false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.TransferTeamCredits("user", "team", "", "fund", 2000, "fund"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.TransferTeamCredits("user", "team", "worker-member", "allocate", 2000, "allocate"); err != nil {
		t.Fatal(err)
	}
	return svc, db
}

func TestTeamWorkspaceTaskQuoteExecutionAndReplay(t *testing.T) {
	svc, db := newTeamTextTestService(t)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"镜头一。"}}],"usage":{"prompt_tokens":4,"completion_tokens":3}}`))
	}))
	defer upstream.Close()
	key, err := svc.encryptSettingSecret(newID())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": key}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationTextRequest()
	req.Operation = "text"
	req.Input["textOptions"] = map[string]any{"stream": false}
	req.IdempotencyKey = "message-one"
	quote, err := svc.TeamWorkspaceTask("worker", "team", req, true)
	if err != nil {
		t.Fatal(err)
	}
	cap := quote.(map[string]int64)["maxChargeMicrocredits"]
	if cap != 50 {
		t.Fatalf("actor price = %d", cap)
	}
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("missing confirmation accepted")
	}
	lower := cap - 1
	req.MaxChargeMicrocredits = &lower
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("insufficient cap accepted")
	}
	req.MaxChargeMicrocredits = &cap
	result, err := svc.TeamWorkspaceTask("worker", "team", req, false)
	if err != nil {
		t.Fatal(err)
	}
	task := result.(*model.Task)
	claimed, err := svc.repo.ClaimNextTask("worker-1", time.Minute)
	if err != nil || claimed == nil || claimed.ID != task.ID {
		t.Fatal("team task not queued", err)
	}
	if err := svc.taskWorker().processClaimedTask(claimed, nil); err != nil {
		t.Fatal(err)
	}
	saved, err := svc.repo.TaskForUser(model.TeamContentKey("team"), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var bound struct {
		AssetID string `json:"assetId"`
	}
	if err := json.Unmarshal([]byte(saved.ResultJSON), &bound); err != nil || bound.AssetID != generationMediaAssetID(task.ID, 0) {
		t.Fatal("missing task result binding", err)
	}
	output, err := svc.repo.AssetForUser(model.TeamContentKey("team"), bound.AssetID)
	if err != nil || !strings.Contains(output.PayloadJSON, "镜头一。") {
		t.Fatal("missing workspace output", err)
	}
	order, err := svc.repo.BillingOrder(task.BillingOrderID)
	if err != nil || order.Status != model.BillingStatusSettled || order.UserID != "worker" || order.BillingAccountID != model.TeamMemberCreditAccountID("worker-member") {
		t.Fatalf("order: %+v, %v", order, err)
	}
	personal, err := svc.repo.CreditAccount("worker")
	if err != nil || personal.AvailableMicrocredits != 1234 || personal.ReservedMicrocredits != 0 {
		t.Fatal("personal balance changed", err)
	}
	account, err := svc.repo.CreditAccountByID(order.BillingAccountID)
	if err != nil || account.AvailableMicrocredits != 1950 || account.ReservedMicrocredits != 0 {
		t.Fatal("wrong team balance", err)
	}
	replayed, err := svc.TeamWorkspaceTask("worker", "team", req, false)
	if err != nil || replayed.(*model.Task).ID != task.ID || calls.Load() != 1 {
		t.Fatal("duplicate submission", err)
	}
	req.Prompt = "different"
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("idempotent request changed")
	}
}
