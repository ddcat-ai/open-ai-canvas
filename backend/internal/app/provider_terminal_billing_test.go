package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
)

// 上游以 HTTP 200 返回明确的失败/取消终态时，任务、调用日志和账单必须得到同一个结论：
// 任务失败、计费根日志失败、预留积分退回，而不是停在待核对。
func TestProviderTerminalStatusReleasesBillingReservation(t *testing.T) {
	allowLoopbackProviderTest(t)
	tests := []struct {
		name          string
		mode          string
		taskType      string
		interfaceType string
		adapter       protocol.Adapter
		createBody    string
		pollBody      string
		wantStatus    protocol.Status
		wantErrorCode string
		wantLogError  string
	}{
		{
			// 官方 NewAPI 视频插件 + 中转站真实的失败响应：外层 code=success，终态只在 data.status。
			name: "official newapi plugin data.status FAILURE", mode: "video", taskType: "canvas_video", interfaceType: "newapi-channel-2",
			adapter:    loadOfficialProtocolAdapterForTest(t, "newapi-video-generations-v1.yingce-plugin"),
			createBody: `{"task_id":"provider-task-1","status":"queued"}`,
			pollBody:   `{"code":"success","message":"","data":{"task_id":"provider-task-1","action":"generate","status":"FAILURE","fail_reason":"内容审核未通过","progress":"100%"}}`,
			wantStatus: protocol.StatusFailed, wantErrorCode: "task_failed", wantLogError: "内容审核未通过",
		},
		{
			// 终态只在 manifest 声明的 output.task_status 里，调用日志侧的通用字段识别看不到它。
			name: "manifest-only cancelled status", mode: "image", taskType: "canvas_image", interfaceType: "test-terminal-image",
			adapter:    terminalStatusTestAdapter(t, "test-terminal-image", "image"),
			createBody: `{"output":{"task_id":"provider-task-1","task_status":"PENDING"}}`,
			pollBody:   `{"request_id":"req-1","output":{"task_id":"provider-task-1","task_status":"CANCELED","message":"任务已被上游取消"}}`,
			wantStatus: protocol.StatusCancelled, wantErrorCode: "task_cancelled", wantLogError: "任务已被上游取消",
		},
		{
			// 音频轮询日志不合并进 create 根日志；失败原因里的 timeout 是上游自述，不能触发待核对。
			name: "audio failure reason mentions timeout", mode: "audio", taskType: "canvas_audio", interfaceType: "test-terminal-audio",
			adapter:    terminalStatusTestAdapter(t, "test-terminal-audio", "audio"),
			createBody: `{"output":{"task_id":"provider-task-1","task_status":"PENDING"}}`,
			pollBody:   `{"output":{"task_id":"provider-task-1","task_status":"FAILED","message":"upstream generation timeout"}}`,
			wantStatus: protocol.StatusFailed, wantErrorCode: "task_failed", wantLogError: "upstream generation timeout",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			// 真实上游请求要经过渠道熔断和并发槽位，单进程测试使用本地协调器。
			t.Setenv("REDIS_URL", "")
			coordinator, err := platform.NewCoordinator("sqlite")
			if err != nil {
				t.Fatal(err)
			}
			s.coordinator = coordinator
			s.platform = platform.New(s.repo, s.coordinator, platformHost{svc: s})
			creates, polls := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == http.MethodPost:
					creates++
					_, _ = w.Write([]byte(tt.createBody))
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/provider-task-1"):
					polls++
					_, _ = w.Write([]byte(tt.pollBody))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			input := canvasGenerationInput{Mode: tt.mode, Prompt: "test", Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", InterfaceType: tt.interfaceType}}
			encoded, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(time.Hour)
			task := &model.Task{ID: newID(), UserID: "billing-user", Type: tt.taskType, Status: model.TaskStatusRunning, InputJSON: string(encoded), LeaseOwner: "worker-a", LeaseExpiresAt: &expires, RouteRun: 1}
			order := model.BillingOrder{ID: newID(), UserID: task.UserID, TaskID: task.ID, IdempotencyKey: newID(), Status: model.BillingStatusRunning, AmountMicrocredits: 100, ReservedAmountMicrocredits: 100}
			task.BillingOrderID = order.ID
			for _, value := range []any{task, &order, &model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 900, ReservedMicrocredits: 100}} {
				if err := db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}

			ctx := withProviderAnalytics(context.Background(), s, *task)
			result, runErr := runProtocolAdapterTaskWithPolicy(ctx, input, tt.adapter, fastVideoPollPolicy())
			var terminal providerTaskTerminalError
			if result != nil || !errors.As(runErr, &terminal) || terminal.Status != tt.wantStatus || terminal.TaskID != "provider-task-1" {
				t.Fatalf("result=%#v error=%v, want %s terminal error", result, runErr, tt.wantStatus)
			}
			if creates != 1 || polls != 1 {
				t.Fatalf("creates=%d polls=%d, want one create and one poll", creates, polls)
			}
			if err := s.terminalCoordinator().handleExecutionFailure(task, runErr, false, false); err == nil {
				t.Fatal("failure must stay visible to the worker")
			}

			var root model.ApiCallLog
			if err := db.First(&root, "task_id = ? AND request_kind = ? AND billable = ?", task.ID, "create", true).Error; err != nil {
				t.Fatal(err)
			}
			if root.Status != model.ApiCallStatusFailed || root.ErrorCode != tt.wantErrorCode || !strings.Contains(root.Error, tt.wantLogError) || root.ProviderStatus == "" {
				t.Fatalf("billable root log = status %q code %q error %q provider status %q, want failed %s with %q", root.Status, root.ErrorCode, root.Error, root.ProviderStatus, tt.wantErrorCode, tt.wantLogError)
			}
			var fallbackLogs int64
			if err := db.Model(&model.ApiCallLog{}).Where("task_id = ? AND method = ?", task.ID, "INTERNAL").Count(&fallbackLogs).Error; err != nil {
				t.Fatal(err)
			}
			if fallbackLogs != 0 {
				t.Fatalf("fallback logs = %d; the real provider log already records the failure", fallbackLogs)
			}
			stored, err := s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			gotOrder, err := s.repo.BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", task.UserID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusFailed || gotOrder.Status != model.BillingStatusRefunded || account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 0 {
				t.Fatalf("task=%s billing=%s available=%d reserved=%d, want failed task with refunded reservation", stored.Status, gotOrder.Status, account.AvailableMicrocredits, account.ReservedMicrocredits)
			}
		})
	}
}

func TestEnrichAPICallLogUsesSharedTerminalStatusVocabulary(t *testing.T) {
	for _, status := range []string{"FAILURE", "failed", "error", "expired", "canceled", "cancelled", "aborted", "TASK_STATUS_FAILED"} {
		t.Run(status, func(t *testing.T) {
			log := model.ApiCallLog{Capability: "video", RequestKind: "poll", Status: model.ApiCallStatusSucceeded, StatusCode: http.StatusOK}
			(&Service{}).EnrichAPICallLog(&log, []byte(`{"code":"success","message":"","data":{"task_id":"provider-task-1","status":"`+status+`","fail_reason":"上游失败"}}`))
			// 外层 code=success 是信封成功码，不能被记成失败日志的错误码。
			if log.Status != model.ApiCallStatusFailed || log.Error != "上游失败" || log.ErrorCode != "" {
				t.Fatalf("status %q produced log status %q code %q error %q, want failed with upstream reason", status, log.Status, log.ErrorCode, log.Error)
			}
		})
	}
	log := model.ApiCallLog{Capability: "video", RequestKind: "poll", Status: model.ApiCallStatusSucceeded, StatusCode: http.StatusOK}
	(&Service{}).EnrichAPICallLog(&log, []byte(`{"code":"success","data":{"task_id":"provider-task-1","status":"IN_PROGRESS"}}`))
	if log.Status != model.ApiCallStatusSucceeded {
		t.Fatalf("in-progress poll marked %q", log.Status)
	}
}

func TestProviderBusinessFailureAcceptsVolcengineVisualSuccessEnvelope(t *testing.T) {
	for _, test := range []struct {
		body       string
		wantFailed bool
	}{
		{body: `{"code":10000,"data":{"task_id":"jimeng-1"},"message":"Success","status":10000}`},
		{body: `{"code":50411,"data":null,"message":"Pre Img Risk Not Pass","status":50411}`, wantFailed: true},
		// 只有火山视觉的成功信封放行 10000；其他协议里的 10000 仍是业务错误。
		{body: `{"code":10000,"message":"upgrade websocket failed"}`, wantFailed: true},
	} {
		code, message, failed := providerResponseBusinessFailure([]byte(test.body))
		if failed != test.wantFailed {
			t.Fatalf("%s: failed=%v code=%q message=%q, want failed=%v", test.body, failed, code, message, test.wantFailed)
		}
	}
}

func loadOfficialProtocolAdapterForTest(t *testing.T, packageName string) protocol.Adapter {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", packageName))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load %s: count=%d error=%v", packageName, len(adapters), err)
	}
	return adapters[0]
}

func terminalStatusTestAdapter(t *testing.T, id, capability string) protocol.Adapter {
	t.Helper()
	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"` + id + `","version":"1.0.0","name":"Terminal Status Test","author":"Test","documentation":"# Test",
		"contributes":{"providers":[{"id":"` + id + `","label":"Terminal Status Test","capabilities":["` + capability + `"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"model":"request.model"}},"poll":{"method":"GET","path":"/tasks/{{taskId}}"},"response":{"taskIdPaths":["output.task_id"],"statusPaths":["output.task_status"],"messagePaths":["output.message"],"resultPaths":["output.url"],"resultKind":"` + capability + `"}}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}
