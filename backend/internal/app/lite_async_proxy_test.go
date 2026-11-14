package app

import (
	"net/http"
	"net/url"
	"testing"

	"yingce/backend/internal/model"
)

func TestSystemProxyMatchesDeclaredVideoPollAndResultPaths(t *testing.T) {
	s := &Service{}
	if !s.SystemProxySupportsPolling("newapi") {
		t.Fatal("OpenAI Videos polling contract is unavailable")
	}
	tests := []struct {
		method string
		path   string
		query  url.Values
		id     string
		op     string
		ok     bool
	}{
		{method: http.MethodGet, path: "/v1/videos/video-42", id: "video-42", op: "poll", ok: true},
		{method: http.MethodGet, path: "/v1/videos/video-42/content", id: "video-42", op: "result", ok: true},
		{method: http.MethodGet, path: "/v1/videos/video-42/content", query: url.Values{"download": {"1"}}},
		{method: http.MethodGet, path: "/v1/videos/video-42/content/extra"},
		{method: http.MethodGet, path: "/v1/videos/video%2F42"},
		{method: http.MethodPost, path: "/v1/videos/video-42"},
	}
	for _, test := range tests {
		id, operation, ok := s.MatchSystemProxyAsyncRequest("newapi", "video", "sora-2", "video-42", test.method, test.path, test.query)
		if id != test.id || operation != test.op || ok != test.ok {
			t.Errorf("MatchSystemProxyAsyncRequest(%s %s) = (%q, %q, %v), want (%q, %q, %v)", test.method, test.path, id, operation, ok, test.id, test.op, test.ok)
		}
	}
}

func TestSystemProxyAsyncResponseParsesVideoTaskAndTerminalStatus(t *testing.T) {
	s := &Service{}
	created, err := s.ParseSystemProxyAsyncResponse("newapi", "video", "sora-2", "", "create", []byte(`{"id":"video-42","status":"queued"}`))
	if err != nil || created.TaskID != "video-42" {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	polled, err := s.ParseSystemProxyAsyncResponse("newapi", "video", "sora-2", "video-42", "poll", []byte(`{"id":"video-42","status":"completed"}`))
	if err != nil || string(polled.Status) != "succeeded" || !polled.RequiresResultRequest || polled.HasResult {
		t.Fatalf("polled = %#v, err = %v", polled, err)
	}
}

func TestSystemProxyBillingOrderForTaskScopesAndRejectsClosedOrders(t *testing.T) {
	s, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	orders := []model.BillingOrder{
		{ID: "running", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "key-running", ProviderRequestID: "task-running", Status: model.BillingStatusRunning},
		{ID: "uncertain", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "key-uncertain", ProviderRequestID: "task-uncertain", Status: model.BillingStatusUncertain},
		{ID: "settled", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "key-settled", ProviderRequestID: "task-settled", Status: model.BillingStatusSettled},
		{ID: "refunded", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "key-refunded", ProviderRequestID: "task-refunded", Status: model.BillingStatusRefunded},
		{ID: "reserved", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "key-reserved", ProviderRequestID: "task-reserved", Status: model.BillingStatusReserved},
		{ID: "other-user", UserID: "user-2", ChannelID: "channel-1", IdempotencyKey: "key-other-user", ProviderRequestID: "task-other-user", Status: model.BillingStatusRunning},
	}
	for index := range orders {
		if err := db.Create(&orders[index]).Error; err != nil {
			t.Fatal(err)
		}
	}

	for _, taskID := range []string{"task-running", "task-uncertain", "task-settled"} {
		order, err := s.SystemProxyBillingOrderForTask("user-1", "channel-1", []string{taskID})
		if err != nil || order.ProviderRequestID != taskID {
			t.Errorf("lookup %q = %#v, err = %v", taskID, order, err)
		}
	}
	for _, test := range []struct{ userID, channelID, taskID string }{
		{userID: "user-2", channelID: "channel-1", taskID: "task-running"},
		{userID: "user-1", channelID: "channel-2", taskID: "task-running"},
		{userID: "user-1", channelID: "channel-1", taskID: "task-refunded"},
		{userID: "user-1", channelID: "channel-1", taskID: "task-reserved"},
	} {
		if order, err := s.SystemProxyBillingOrderForTask(test.userID, test.channelID, []string{test.taskID}); err == nil {
			t.Errorf("lookup for user=%q channel=%q task=%q unexpectedly returned %#v", test.userID, test.channelID, test.taskID, order)
		}
	}
}

func TestLinkSystemProxyBillingTaskIsOwnerBoundAndIdempotent(t *testing.T) {
	s, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	order := model.BillingOrder{ID: "link-order", UserID: "user-1", ChannelID: "channel-1", IdempotencyKey: "link-key", Status: model.BillingStatusRunning}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.LinkSystemProxyBillingTask(order.ID, "user-2", "channel-1", "provider-task"); err == nil {
		t.Fatal("link accepted another user's billing order")
	}
	if err := s.LinkSystemProxyBillingTask(order.ID, "user-1", "channel-1", "provider-task"); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkSystemProxyBillingTask(order.ID, "user-1", "channel-1", "provider-task"); err != nil {
		t.Fatalf("repeated link = %v", err)
	}
	if err := s.LinkSystemProxyBillingTask(order.ID, "user-1", "channel-1", "different-task"); err == nil {
		t.Fatal("link replaced the existing provider task")
	}
}
