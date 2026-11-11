package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func rainyunRealtimeTestBody(at time.Time) string {
	return fmt.Sprintf(`{"code":200,"data":{"Columns":["time","minio_bucket_traffic_received_bytes","minio_bucket_traffic_sent_bytes","minio_bucket_requests_total"],"Values":[[%d,1048576,0,7],[%d,0,2097152,3]]}}`, at.Unix()-60, at.Unix())
}

func rainyunRealtimeTestGet(t *testing.T, svc *Service) *SystemPerformanceRainyunRealtime {
	t.Helper()
	got, err := svc.AdminRainyunRealtime(context.Background(), rainyunTestAdmin())
	if err != nil || got == nil {
		t.Fatalf("realtime result=%+v err=%v", got, err)
	}
	return got
}

func expireRainyunRealtimeTestSnapshot(svc *Service) {
	cache := svc.rainyunRealtimeCache
	cache.loads.Clear()
	cache.mu.Lock()
	defer cache.mu.Unlock()
	for key, snapshot := range cache.recent {
		snapshot.retryAt = time.Now().Add(-time.Second)
		cache.recent[key] = snapshot
	}
}

func TestRainyunRealtimeRequiresAdminBeforeRepository(t *testing.T) {
	for _, tc := range []struct {
		actor  *model.User
		status int
	}{{nil, 401}, {&model.User{Role: model.UserRoleUser}, 403}} {
		if _, err := (&Service{}).AdminRainyunRealtime(context.Background(), tc.actor); authStatus(err) != tc.status {
			t.Fatalf("realtime status=%d want=%d", authStatus(err), tc.status)
		}
	}
}

func TestRainyunRealtimeParseColumnsZeroUnknownAndDeduplication(t *testing.T) {
	end := time.Unix(1800000000, 0).UTC()
	body := fmt.Sprintf(`{"code":200,"data":{"Columns":["minio_bucket_requests_total","minio_bucket_traffic_sent_bytes","time","minio_bucket_traffic_received_bytes","unused"],"Values":[[4,8,%d,16],[7,2097152,%d,1048576],[9,0,%d,0],[0,"bad",%d],[1,2,null,3],[1,2,"%d",3],[1,2,-1,3],[1,2,1e100,3],[1,2,%d,3],[1,2,%d,3],[]]}}`, end.Unix()-120, end.Unix()-180, end.Unix()-120, end.Unix()-60, end.Unix(), end.Unix()-301, end.Unix()+1)
	points, err := parseRainyunRealtime([]byte(body), end)
	if err != nil || len(points) != 3 {
		t.Fatalf("points=%+v err=%v", points, err)
	}
	if points[0].Time.Unix() != end.Unix()-180 || *points[0].ReceivedBytesPerSecond != 1048576 || *points[0].SentBytesPerSecond != 2097152 || *points[0].RequestsTotal != 7 {
		t.Fatal("column mapping changed raw official values")
	}
	if *points[1].ReceivedBytesPerSecond != 0 || *points[1].SentBytesPerSecond != 0 || *points[1].RequestsTotal != 9 {
		t.Fatal("duplicate timestamps did not retain the last real row or total was summed")
	}
	if points[2].ReceivedBytesPerSecond != nil || points[2].SentBytesPerSecond != nil || points[2].RequestsTotal == nil || *points[2].RequestsTotal != 0 {
		t.Fatal("missing metric was zero-filled or true zero was omitted")
	}
	encoded, _ := json.Marshal(points[2])
	if strings.Contains(string(encoded), "receivedBytesPerSecond") || strings.Contains(string(encoded), "sentBytesPerSecond") || !strings.Contains(string(encoded), `"requestsTotal":0`) {
		t.Fatalf("unknown/zero JSON contract: %s", encoded)
	}
	if interval := rainyunRealtimeSampleInterval(points); interval == nil || *interval != 60 {
		t.Fatal("actual minute sampling was presented as one second")
	}
}

func TestRainyunRealtimeParseRejectsUnconfirmedShapeAndInvalidValues(t *testing.T) {
	end := time.Unix(1800000000, 0).UTC()
	for _, body := range []string{
		`{}`, `null`, `{"code":0,"data":{"Columns":["time"],"Values":[]}}`,
		`{"code":200,"data":{"Data":{"Columns":["time"],"Values":[]}}}`,
		`{"code":200,"data":{"columns":["time"],"values":[]}}`,
		`{"code":200,"data":{"Columns":["other"],"Values":[]}}`,
		`{"code":200,"data":{"Columns":["time"],"Values":null}}`,
	} {
		if _, err := parseRainyunRealtime([]byte(body), end); err == nil {
			t.Fatalf("unconfirmed shape accepted: %s", body)
		}
	}
	for _, raw := range []string{`null`, `-1`, `"0"`, `true`, `{}`, `[]`, `1e100`, `1e309`, `9007199254740992`} {
		body := fmt.Sprintf(`{"code":200,"data":{"Columns":["time","minio_bucket_traffic_received_bytes","minio_bucket_requests_total"],"Values":[[%d,%s,%s]]}}`, end.Unix(), raw, raw)
		points, err := parseRainyunRealtime([]byte(body), end)
		if err != nil || len(points) != 1 || points[0].ReceivedBytesPerSecond != nil || points[0].SentBytesPerSecond != nil || points[0].RequestsTotal != nil {
			t.Fatalf("invalid metric %s became a value: %+v %v", raw, points, err)
		}
	}
	body := fmt.Sprintf(`{"code":200,"data":{"Columns":["time","minio_bucket_traffic_received_bytes"],"Values":[[%d,0.5],[%d,9007199254740991]]}}`, end.Unix()-1, end.Unix())
	points, err := parseRainyunRealtime([]byte(body), end)
	if err != nil || len(points) != 2 || *points[0].ReceivedBytesPerSecond != 0.5 || *points[1].ReceivedBytesPerSecond != 9007199254740991 {
		t.Fatal("finite real samples or safe numeric boundary lost")
	}
	empty, err := parseRainyunRealtime([]byte(`{"code":200,"data":{"Columns":["time"],"Values":[]}}`), end)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatal("empty real window must be a non-nil empty slice")
	}
}

func TestRainyunRealtimeWindowBoundAndObservedIntervals(t *testing.T) {
	end := time.Unix(1800000000, 0).UTC()
	rows := make([][]any, 0, rainyunRealtimeMaxPoints+10)
	for i := rainyunRealtimeMaxPoints + 9; i >= 0; i-- {
		rows = append(rows, []any{float64(end.Unix()) - float64(i)/4, i})
	}
	body, _ := json.Marshal(map[string]any{"code": 200, "data": map[string]any{"Columns": []string{"time", "minio_bucket_requests_total"}, "Values": rows}})
	points, err := parseRainyunRealtime(body, end)
	if err != nil || len(points) != rainyunRealtimeMaxPoints || cap(points) > rainyunRealtimeMaxPoints*2 || !points[len(points)-1].Time.Equal(end) {
		t.Fatalf("point storage not bounded: len=%d cap=%d err=%v", len(points), cap(points), err)
	}
	if interval := rainyunRealtimeSampleInterval(points); interval == nil || *interval != 0.25 {
		t.Fatal("subsecond observed spacing lost")
	}
	window := rainyunRealtimeWindowPoints(points, end.Add(rainyunRealtimeWindow))
	if window == nil || len(window) != 1 || !window[0].Time.Equal(end) || rainyunRealtimeSampleInterval(window) != nil {
		t.Fatal("cache response kept expired points or invented a one-point interval")
	}
	if got := rainyunRealtimeWindowPoints(points, end.Add(rainyunRealtimeWindow+time.Second)); got == nil || len(got) != 0 {
		t.Fatal("expired real points survived five-minute window")
	}
	irregular := []RainyunRealtimePoint{{Time: end.Add(-3 * time.Second)}, {Time: end.Add(-2 * time.Second)}, {Time: end}}
	if rainyunRealtimeSampleInterval(irregular) != nil || rainyunRealtimeSampleInterval(nil) != nil || rainyunRealtimeSampleInterval([]RainyunRealtimePoint{{Time: end}, {Time: end}}) != nil {
		t.Fatal("irregular, missing or duplicate sampling was guessed")
	}
}

func TestRainyunRealtimeFixedReadOnlyHTTPAndRedaction(t *testing.T) {
	for _, tc := range []struct {
		name                string
		code                int
		body, status, retry string
	}{
		{"healthy", 200, "", "healthy", ""}, {"empty", 200, `{"code":200,"data":{"Columns":["time"],"Values":[]}}`, "unknown", ""},
		{"forbidden", 403, "test-management-secret", "error", ""},
		{"redirect", 302, "secret", "error", ""}, {"network", 0, "", "error", ""},
		{"server", 503, "https://private.invalid/secret", "error", ""},
		{"rate limited", 429, "test-management-secret", "warning", "17"},
		{"business error", 200, `{"code":0,"message":"test-management-secret"}`, "error", ""},
		{"too large", 200, strings.Repeat("x", rainyunMonitorBodyLimit+1), "error", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newRainyunMonitorFixture(t)
			calls := 0
			svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) {
				t.Error("realtime probed bucket HEAD")
				return 0, nil
			}
			svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				query := req.URL.Query()
				start, end := query.Get("start_date"), query.Get("end_date")
				var startSeconds, endSeconds int64
				_, startErr := fmt.Sscan(start, &startSeconds)
				_, endErr := fmt.Sscan(end, &endSeconds)
				deadline, ok := req.Context().Deadline()
				if req.Method != http.MethodGet || req.Body != nil || req.URL.Scheme != "https" || req.URL.Host != "api.v2.rainyun.com" || req.URL.Path != "/product/ros/instance/123/monitor" || len(query) != 2 || startErr != nil || endErr != nil || endSeconds-startSeconds != 300 || req.Header.Get("X-Api-Key") != "test-management-secret" || !ok || time.Until(deadline) > rainyunMonitorRequestTimeout {
					t.Error("fixed realtime GET contract changed")
				}
				if tc.code == 0 {
					return nil, errors.New(req.URL.String() + " test-management-secret")
				}
				body := tc.body
				if tc.name == "healthy" {
					body = rainyunRealtimeTestBody(time.Unix(endSeconds, 0))
				}
				response := rainyunTestResponse(req, tc.code, body)
				response.Header.Set("Location", "https://private.invalid/secret")
				response.Header.Set("Retry-After", tc.retry)
				return response, nil
			})
			got := rainyunRealtimeTestGet(t, svc)
			if calls != 1 || got.Status != tc.status || got.CheckedAt == nil || got.Points == nil || tc.status != "healthy" && len(got.Points) != 0 {
				t.Fatalf("calls=%d realtime=%+v", calls, got)
			}
			if tc.name == "healthy" && (len(got.Points) != 2 || got.SampleIntervalSeconds == nil || *got.SampleIntervalSeconds != 60 || got.RetryAfterSeconds != 1) {
				t.Fatalf("healthy projection=%+v", got)
			}
			if tc.name == "empty" && (got.RetryAfterSeconds != 1 || got.SampleIntervalSeconds != nil) {
				t.Fatal("valid empty window invented cadence or became a query failure")
			}
			if tc.code == 429 && got.RetryAfterSeconds != 17 {
				t.Fatalf("Retry-After ignored: %+v", got)
			}
			encoded, _ := json.Marshal(got)
			for _, secret := range []string{"test-management-secret", "private.invalid", "api.v2.rainyun.com", "X-Amz", encryptedSettingPrefix} {
				if strings.Contains(string(encoded), secret) {
					t.Fatalf("realtime leaked %s", secret)
				}
			}
		})
	}
}

func TestRainyunRealtimeReadsNeverInitializeOrMigrateCredentials(t *testing.T) {
	for _, setting := range []rainyunMonitorSettingValue{{}, {Enabled: true}, {Enabled: true, InstanceID: 123, APIKey: "legacy-plain-key"}, {Enabled: true, InstanceID: 123, APIKey: "enc:v1:AAAA"}} {
		svc, db := newSystemPerformanceTestService(t)
		saveRainyunTestSetting(t, svc, rainyunMonitorSettingKey, setting)
		before, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
		svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(*http.Request) (*http.Response, error) {
			t.Error("incomplete credentials reached cloud")
			return nil, errors.New("unexpected")
		})
		writes := 0
		countWrite := func(*gorm.DB) { writes++ }
		if err := db.Callback().Create().Before("gorm:create").Register("realtime-no-create", countWrite); err != nil {
			t.Fatal(err)
		}
		if err := db.Callback().Update().Before("gorm:update").Register("realtime-no-update", countWrite); err != nil {
			t.Fatal(err)
		}
		if err := db.Callback().Delete().Before("gorm:delete").Register("realtime-no-delete", countWrite); err != nil {
			t.Fatal(err)
		}
		got := rainyunRealtimeTestGet(t, svc)
		if got.Points == nil || len(got.Points) != 0 || writes != 0 || got.Status == "healthy" || got.Configured {
			t.Fatalf("invalid configuration=%+v writes=%d", got, writes)
		}
		after, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
		if after.ValueJSON != before.ValueJSON || !after.UpdatedAt.Equal(before.UpdatedAt) {
			t.Fatal("GET migrated credential or wrote settings")
		}
		if _, err := os.Stat(filepath.Join(svc.dataDir, ".settings-key")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("realtime initialized an encryption key")
		}
	}
	svc, db := newSystemPerformanceTestService(t)
	if err := db.Callback().Query().Before("gorm:query").Register("realtime-read-error", func(tx *gorm.DB) { tx.AddError(errors.New("private database detail")) }); err != nil {
		t.Fatal(err)
	}
	got := rainyunRealtimeTestGet(t, svc)
	if got.Status != "unknown" || got.Points == nil || strings.Contains(got.StatusMessage, "private") {
		t.Fatal("read error became success or leaked detail")
	}
}

func TestRainyunRealtimeCacheCoalescesAndSeparatesConfiguration(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		call := calls.Add(1)
		if call == 1 {
			close(entered)
		}
		expectedID, expectedKey := 123, "test-management-secret"
		if call == 2 {
			expectedID = 124
		}
		if call == 4 {
			expectedKey = "rotated-test-key"
		}
		if req.URL.Path != fmt.Sprintf("/product/ros/instance/%d/monitor", expectedID) || req.Header.Get("X-Api-Key") != expectedKey {
			t.Error("configuration fingerprint did not select current instance/credential")
		}
		select {
		case <-release:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return rainyunTestResponse(req, 200, rainyunRealtimeTestBody(time.Now())), nil
	})
	results := make(chan *SystemPerformanceRainyunRealtime, 12)
	for i := 0; i < cap(results); i++ {
		go func() { got, _ := svc.AdminRainyunRealtime(context.Background(), rainyunTestAdmin()); results <- got }()
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("realtime load did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	got, err := svc.AdminRainyunRealtime(ctx, rainyunTestAdmin())
	cancel()
	if err != nil || got.Status != "unknown" || calls.Load() != 1 {
		t.Fatal("canceled waiter did not return promptly or started another upstream call")
	}
	once.Do(func() { close(release) })
	var checked *time.Time
	for i := 0; i < cap(results); i++ {
		got := <-results
		if got == nil || got.Status != "healthy" || got.CheckedAt == nil {
			t.Fatalf("coalesced realtime=%+v", got)
		}
		if checked != nil && !checked.Equal(*got.CheckedAt) {
			t.Fatal("concurrent requests were not shared")
		}
		checked = got.CheckedAt
	}
	if got := rainyunRealtimeTestGet(t, svc); calls.Load() != 1 || !got.CheckedAt.Equal(*checked) {
		t.Fatal("one-second snapshot was not reused")
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 124}); err != nil {
		t.Fatal(err)
	}
	if got := rainyunRealtimeTestGet(t, svc); got.InstanceID != 124 || got.Status != "healthy" || calls.Load() != 2 {
		t.Fatal("configuration switch reused old instance snapshot")
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 123}); err != nil {
		t.Fatal(err)
	}
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "healthy" || calls.Load() != 3 {
		t.Fatal("returning to old configuration resurrected an old saved version")
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 123, APIKey: "rotated-test-key"}); err != nil {
		t.Fatal(err)
	}
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "healthy" || calls.Load() != 4 {
		t.Fatal("credential rotation reused the old realtime cache")
	}
}

func TestRainyunRealtimeFailureBackoffAndSuccessReset(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	calls, success := 0, false
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if success {
			return rainyunTestResponse(req, 200, rainyunRealtimeTestBody(time.Now())), nil
		}
		return rainyunTestResponse(req, 503, "private upstream error"), nil
	})
	first := rainyunRealtimeTestGet(t, svc)
	if first.Status != "error" || first.RetryAfterSeconds != 5 {
		t.Fatalf("initial backoff=%+v", first)
	}
	// 清掉一秒 fast cache 模拟高频轮询；更长失败快照仍须挡住真实回源。
	for i := 0; i < 5; i++ {
		svc.rainyunRealtimeCache.loads.Clear()
		got := rainyunRealtimeTestGet(t, svc)
		if calls != 1 || !got.CheckedAt.Equal(*first.CheckedAt) || got.RetryAfterSeconds < 1 {
			t.Fatal("failure polling bypassed backoff")
		}
	}
	expireRainyunRealtimeTestSnapshot(svc)
	if got := rainyunRealtimeTestGet(t, svc); calls != 2 || got.RetryAfterSeconds != 10 {
		t.Fatalf("second failure did not back off: %+v calls=%d", got, calls)
	}
	for _, delay := range []int{20, 40, 60, 60} {
		expireRainyunRealtimeTestSnapshot(svc)
		if got := rainyunRealtimeTestGet(t, svc); got.RetryAfterSeconds != delay {
			t.Fatalf("bounded retry=%d want=%d", got.RetryAfterSeconds, delay)
		}
	}
	success = true
	expireRainyunRealtimeTestSnapshot(svc)
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "healthy" || got.RetryAfterSeconds != 1 || len(got.Points) == 0 {
		t.Fatal("success did not reset cooldown")
	}
	success = false
	expireRainyunRealtimeTestSnapshot(svc)
	if got := rainyunRealtimeTestGet(t, svc); got.RetryAfterSeconds != 5 || len(got.Points) != 0 || got.SampleIntervalSeconds != nil {
		t.Fatal("failure retained stale success points or old retry count")
	}
}

func TestRainyunRealtimeRetryAfterIsBoundedAndHonored(t *testing.T) {
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		raw  string
		want time.Duration
	}{
		{"", 0}, {"-1", 0}, {"invalid", 0}, {strings.Repeat("9", 129), 0},
		{"1", time.Second}, {"17", 17 * time.Second}, {"600", rainyunRealtimeMaxRetry},
		{"9999999999999999999999999999", rainyunRealtimeMaxRetry},
		{now.Add(45 * time.Second).Format(http.TimeFormat), 45 * time.Second},
		{now.Add(time.Hour).Format(http.TimeFormat), rainyunRealtimeMaxRetry}, {now.Add(-time.Second).Format(http.TimeFormat), 0},
	} {
		if got := rainyunRealtimeRetryAfter(tc.raw, now); got != tc.want {
			t.Fatalf("Retry-After %q=%s want=%s", tc.raw, got, tc.want)
		}
	}
	svc := newRainyunMonitorFixture(t)
	calls := 0
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		response := rainyunTestResponse(req, 429, "secret")
		response.Header.Set("Retry-After", "600")
		return response, nil
	})
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "warning" || got.RetryAfterSeconds != 300 {
		t.Fatalf("rate limit snapshot=%+v", got)
	}
	svc.rainyunRealtimeCache.loads.Clear()
	if got := rainyunRealtimeTestGet(t, svc); calls != 1 || got.Status != "warning" {
		t.Fatal("rate-limit snapshot did not block high-frequency reload")
	}
}

func TestRainyunRealtimeCancellationReleasesLoadAndCoolsDown(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	var calls, active atomic.Int32
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		active.Add(1)
		defer active.Add(-1)
		if calls.Add(1) == 1 {
			<-req.Context().Done()
			return nil, req.Context().Err()
		}
		return rainyunTestResponse(req, 200, rainyunRealtimeTestBody(time.Now())), nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	got, err := svc.AdminRainyunRealtime(ctx, rainyunTestAdmin())
	if err != nil || got.Status != "unknown" || active.Load() != 0 {
		t.Fatalf("cancellation left active work: %+v %v active=%d", got, err, active.Load())
	}
	if got := rainyunRealtimeTestGet(t, svc); calls.Load() != 1 || got.Status != "unknown" {
		t.Fatal("cancellation allowed immediate failure reload")
	}
	expireRainyunRealtimeTestSnapshot(svc)
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "healthy" || calls.Load() != 2 || active.Load() != 0 {
		t.Fatal("canceled flight permanently occupied a load slot")
	}
}

func TestRainyunRealtimeCacheBoundsConcurrentConfigurations(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	entered, release := make(chan struct{}, 3), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		entered <- struct{}{}
		select {
		case <-release:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return rainyunTestResponse(req, 200, rainyunRealtimeTestBody(time.Now())), nil
	})
	results := make(chan *SystemPerformanceRainyunRealtime, 2)
	for i := 0; i < 2; i++ {
		_, value, _ := svc.readRainyunMonitorSetting(context.Background())
		value.InstanceID = int64(123 + i)
		saveRainyunTestSetting(t, svc, rainyunMonitorSettingKey, value)
		go func() { got, _ := svc.AdminRainyunRealtime(context.Background(), rainyunTestAdmin()); results <- got }()
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("configuration load did not start")
		}
	}
	_, value, _ := svc.readRainyunMonitorSetting(context.Background())
	value.InstanceID = 125
	saveRainyunTestSetting(t, svc, rainyunMonitorSettingKey, value)
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "unknown" || len(got.Points) != 0 || len(entered) != 0 {
		t.Fatal("third concurrent configuration reached upstream")
	}
	once.Do(func() { close(release) })
	for i := 0; i < 2; i++ {
		if got := <-results; got == nil || got.Status != "healthy" {
			t.Fatalf("bounded result=%+v", got)
		}
	}
	if got := rainyunRealtimeTestGet(t, svc); got.Status != "healthy" {
		t.Fatal("released slots could not serve next configuration")
	}
	svc.rainyunRealtimeCache.mu.Lock()
	defer svc.rainyunRealtimeCache.mu.Unlock()
	if len(svc.rainyunRealtimeCache.recent) > 2 {
		t.Fatal("cooldown state grew without bound")
	}
}
