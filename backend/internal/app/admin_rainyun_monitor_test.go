package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const rainyunTestInstance = `{"code":200,"data":{"Data":{"Status":"running","ExpDate":4102444800,"last_reset_date":1700000000,"next_reset_date":1702592000000,"is_enable_extra_accounting":false,"Plan":{"chinese":"测试套餐","plan_name":"ros-test","storage_size":10,"bandwidth":20},"UsageData":{"metrics_usage_total_bytes":123,"metrics_sent_bytes":0}}}}`

type rainyunMonitorTestTransport func(*http.Request) (*http.Response, error)

func (f rainyunMonitorTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func rainyunTestResponse(req *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}
}

func rainyunTestAdmin() *model.User {
	return &model.User{ID: "rainyun-admin", Role: model.UserRoleAdmin}
}

func saveRainyunTestSetting(t *testing.T, svc *Service, key string, value any) {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: key, ValueJSON: string(body)}); err != nil {
		t.Fatal(err)
	}
}

func rainyunTestOSS() ossSettingValue {
	return ossSettingValue{Enabled: true, Provider: "rainyun", Endpoint: "https://source.invalid", Bucket: "test-bucket", AccessKeyID: "test-access", AccessKeySecret: "test-source-secret", SessionToken: "test-session"}
}

func newRainyunMonitorFixture(t *testing.T) *Service {
	t.Helper()
	svc, _ := newSystemPerformanceTestService(t)
	// 所有外部请求由 fake 接管，包括缺失凭据等错误分支；专项不访问真实云端。
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		return rainyunTestResponse(req, http.StatusOK, rainyunTestInstance), nil
	})
	svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) { return http.StatusOK, nil }
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 123, APIKey: "test-management-secret"}); err != nil {
		t.Fatal(err)
	}
	saveRainyunTestSetting(t, svc, ossSettingKey, rainyunTestOSS())
	return svc
}

func TestRainyunMonitorSettingsRequireAdminBeforeRepository(t *testing.T) {
	svc := &Service{}
	for _, tc := range []struct {
		actor  *model.User
		status int
	}{{nil, 401}, {&model.User{Role: model.UserRoleUser}, 403}} {
		if _, err := svc.AdminRainyunMonitorSetting(context.Background(), tc.actor); authStatus(err) != tc.status {
			t.Fatalf("GET status=%d want=%d", authStatus(err), tc.status)
		}
		if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), tc.actor, RainyunMonitorSettingRequest{}); authStatus(err) != tc.status {
			t.Fatalf("PATCH status=%d want=%d", authStatus(err), tc.status)
		}
	}
}

func TestRainyunMonitorSettingsEncryptRetainAndOnlySaveOwnRecord(t *testing.T) {
	svc, db := newSystemPerformanceTestService(t)
	for _, key := range []string{ossSettingKey, "unrelated-setting"} {
		saveRainyunTestSetting(t, svc, key, map[string]string{"sentinel": "unchanged"})
	}
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(*http.Request) (*http.Response, error) {
		t.Error("saving settings made a cloud request")
		return nil, errors.New("unexpected cloud request")
	})
	svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) { t.Error("saving probed source"); return 0, nil }
	view, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 123, APIKey: "test-management-secret"})
	if err != nil || !view.Enabled || !view.HasAPIKey || view.InstanceID != 123 {
		t.Fatalf("saved view=%+v err=%v", view, err)
	}
	record, first, err := svc.readRainyunMonitorSetting(context.Background())
	if err != nil || record.UpdatedBy != "rainyun-admin" || !strings.HasPrefix(first.APIKey, encryptedSettingPrefix) || strings.Contains(record.ValueJSON, "test-management-secret") {
		t.Fatalf("credential not encrypted or actor missing: %v", err)
	}
	plain, err := svc.rainyunMonitorSecret(first.APIKey)
	if err != nil || plain != "test-management-secret" {
		t.Fatal("stored credential did not decrypt")
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 124}); err != nil {
		t.Fatal(err)
	}
	_, second, _ := svc.readRainyunMonitorSetting(context.Background())
	if second.APIKey != first.APIKey || second.InstanceID != 124 {
		t.Fatal("blank API key did not retain encrypted credential")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "apiKey") || strings.Contains(string(encoded), "test-management-secret") {
		t.Fatal("setting response leaked credential")
	}
	for _, key := range []string{ossSettingKey, "unrelated-setting"} {
		var other model.SystemSetting
		if err := db.First(&other, "key = ?", key).Error; err != nil || other.ValueJSON != `{"sentinel":"unchanged"}` {
			t.Fatalf("saving monitor changed %s", key)
		}
	}
}

func TestRainyunMonitorSettingsValidateWithoutWrites(t *testing.T) {
	cases := []RainyunMonitorSettingRequest{
		{InstanceID: -1}, {Enabled: true, APIKey: "key"}, {Enabled: true, InstanceID: 1},
		{APIKey: "key\r\nInjected:true"}, {APIKey: "key\tvalue"}, {APIKey: " key"}, {APIKey: "key\x00"},
		{APIKey: "密钥"}, {APIKey: strings.Repeat("x", 4097)},
	}
	for index, request := range cases {
		svc, db := newSystemPerformanceTestService(t)
		if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), request); authStatus(err) != 400 {
			t.Fatalf("case %d status=%d want 400", index, authStatus(err))
		}
		var count int64
		if err := db.Model(&model.SystemSetting{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("invalid configuration wrote settings: %d %v", count, err)
		}
		if _, err := os.Stat(filepath.Join(svc.dataDir, ".settings-key")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid configuration initialized encryption key")
		}
	}
	svc, _ := newSystemPerformanceTestService(t)
	if view, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{}); err != nil || view.Enabled || view.HasAPIKey {
		t.Fatalf("disabled incomplete setting rejected: %+v %v", view, err)
	}
	if !validRainyunMonitorAPIKey(strings.Repeat("x", 4096)) {
		t.Fatal("4096 byte visible ASCII key rejected")
	}
}

func TestRainyunMonitorGetAndCollectionNeverInitializeOrMigrateSecrets(t *testing.T) {
	for _, keyFile := range []string{"", "invalid-length"} {
		svc, db := newSystemPerformanceTestService(t)
		path := filepath.Join(svc.dataDir, ".settings-key")
		if keyFile != "" {
			if err := os.WriteFile(path, []byte(keyFile), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		view, err := svc.AdminRainyunMonitorSetting(context.Background(), rainyunTestAdmin())
		if err != nil || view.Enabled || view.HasAPIKey {
			t.Fatalf("default GET: %+v %v", view, err)
		}
		var count int64
		if err := db.Model(&model.SystemSetting{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("GET wrote a setting")
		}
		saveRainyunTestSetting(t, svc, rainyunMonitorSettingKey, rainyunMonitorSettingValue{Enabled: true, InstanceID: 123, APIKey: "enc:v1:AAAA"})
		saveRainyunTestSetting(t, svc, ossSettingKey, rainyunTestOSS())
		before, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
		ossBefore, _ := svc.repo.SystemSettingOptional(ossSettingKey)
		svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(*http.Request) (*http.Response, error) {
			t.Error("bad credential sent upstream")
			return nil, errors.New("unexpected")
		})
		svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) { return http.StatusOK, nil }
		if _, err := svc.AdminRainyunMonitorSetting(context.Background(), rainyunTestAdmin()); err != nil {
			t.Fatal(err)
		}
		got := svc.collectRainyunPerformance(context.Background())
		if got.Status != "unconfigured" || got.Configured || got.StorageUsedBytes != nil {
			t.Fatalf("bad credential result=%+v", got)
		}
		after, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
		ossAfter, _ := svc.repo.SystemSettingOptional(ossSettingKey)
		if after.ValueJSON != before.ValueJSON || !after.UpdatedAt.Equal(before.UpdatedAt) || ossAfter.ValueJSON != ossBefore.ValueJSON || !ossAfter.UpdatedAt.Equal(ossBefore.UpdatedAt) {
			t.Fatal("read path migrated secrets")
		}
		data, err := os.ReadFile(path)
		if keyFile == "" && !errors.Is(err, os.ErrNotExist) || keyFile != "" && (err != nil || string(data) != keyFile) {
			t.Fatal("read path initialized or replaced key file")
		}
	}
}

func TestRainyunMonitorParseExactFieldsAndTrueZero(t *testing.T) {
	var got SystemPerformanceRainyun
	if err := parseRainyunInstance([]byte(rainyunTestInstance), time.Now(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != "healthy" || got.CloudStatus != "运行中" || got.PlanName != "测试套餐" || got.ExtraAccounting == nil || *got.ExtraAccounting {
		t.Fatalf("instance=%+v", got)
	}
	for _, tc := range []struct {
		value *int64
		want  int64
	}{{got.StorageUsedBytes, 123}, {got.TrafficUsedBytes, 0}, {got.StorageQuotaBytes, 10 * 1073741824}, {got.TrafficQuotaBytes, 20 * 1073741824}} {
		if tc.value == nil || *tc.value != tc.want {
			t.Fatalf("metric=%v want=%d", tc.value, tc.want)
		}
	}
	if got.ExpiresAt == nil || got.ExpiresAt.Unix() != 4102444800 || got.PeriodStart == nil || got.PeriodStart.Unix() != 1700000000 || got.PeriodEnd == nil || got.PeriodEnd.UnixMilli() != 1702592000000 {
		t.Fatal("timestamp normalization failed")
	}
	body, _ := json.Marshal(got)
	if !strings.Contains(string(body), `"trafficUsedBytes":0`) || !strings.Contains(string(body), `"extraAccounting":false`) || !strings.Contains(got.StatisticsMessage, "包含实例下全部桶") {
		t.Fatal("zero values or accounting scope lost")
	}
	for _, invalid := range []string{`{}`, `{"code":0,"data":{"Data":{}}}`, `{"Code":200,"data":{"Data":{}}}`, `{"code":200,"data":{"data":{}}}`, `{"code":200,"data":{"Data":null}}`, `{"code":403,"message":"secret"}`} {
		if err := parseRainyunInstance([]byte(invalid), time.Now(), &SystemPerformanceRainyun{}); err == nil {
			t.Fatalf("invalid envelope accepted: %s", invalid)
		}
	}
	var missing SystemPerformanceRainyun
	if err := parseRainyunInstance([]byte(`{"code":200,"data":{"Data":{"status":"running","plan":{"storage_size":1},"usageData":{"metrics_sent_bytes":0}}}}`), time.Now(), &missing); err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(missing)
	if missing.Status != "unknown" || missing.StorageUsedBytes != nil || missing.TrafficUsedBytes != nil || missing.StorageQuotaBytes != nil || strings.Contains(string(body), "trafficUsedBytes") || !strings.Contains(missing.StatisticsMessage, "不代表已用为零") {
		t.Fatal("missing or wrong-case field invented a value")
	}
}

func TestRainyunMonitorParsingWarningsNumbersAndTimes(t *testing.T) {
	for _, tc := range []struct{ old, next, status string }{
		{`"running"`, `"stopped"`, "warning"}, {`"running"`, `"unrecognized-secret"`, "unknown"},
		{`"ExpDate":4102444800`, `"ExpDate":1`, "warning"},
		{`"metrics_usage_total_bytes":123`, `"metrics_usage_total_bytes":10737418240`, "warning"},
		{`"metrics_sent_bytes":0`, `"metrics_sent_bytes":21474836480`, "warning"},
	} {
		var got SystemPerformanceRainyun
		if err := parseRainyunInstance([]byte(strings.Replace(rainyunTestInstance, tc.old, tc.next, 1)), time.Now(), &got); err != nil || got.Status != tc.status {
			t.Fatalf("warning=%+v err=%v", got, err)
		}
		if strings.Contains(got.CloudStatus, "secret") {
			t.Fatal("unrecognized upstream status leaked")
		}
	}
	for _, raw := range []string{"", "null", "-1", `"123"`, "1.5", "1e100"} {
		if rainyunMonitorBytes(json.RawMessage(raw), 1) != nil {
			t.Fatalf("invalid byte value accepted: %s", raw)
		}
	}
	for _, raw := range []string{"", "null", "0", "-1", `"1700000000"`, "1e100"} {
		if rainyunMonitorTime(json.RawMessage(raw)) != nil {
			t.Fatalf("invalid time accepted: %s", raw)
		}
	}
	var fallback SystemPerformanceRainyun
	body := strings.Replace(rainyunTestInstance, `"chinese":"测试套餐"`, `"chinese":""`, 1)
	body = strings.Replace(body, `"storage_size":10`, `"storage_size":0`, 1)
	if err := parseRainyunInstance([]byte(body), time.Now(), &fallback); err != nil || fallback.PlanName != "ros-test" || fallback.Status != "healthy" {
		t.Fatal("plan fallback or zero quota semantics failed")
	}
}

func TestRainyunMonitorManagementHTTPContractFailuresAndRedaction(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		fail   bool
	}{
		{"healthy", 200, rainyunTestInstance, false}, {"forbidden", 403, "test-management-secret", true},
		{"redirect", 302, "", true}, {"network error", 0, "", true}, {"server error", 503, "https://private.invalid/secret", true},
		{"wrong business status", 200, `{"code":0,"message":"test-management-secret"}`, true},
		{"too large", 200, strings.Repeat("x", rainyunMonitorBodyLimit+1), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newRainyunMonitorFixture(t)
			calls := 0
			svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Method != http.MethodGet || req.URL.String() != "https://api.v2.rainyun.com/product/ros/instance/123/" || req.Header.Get("X-Api-Key") != "test-management-secret" {
					t.Error("wrong fixed management request contract")
				}
				if tc.status == 0 {
					return nil, errors.New(req.URL.String() + " test-management-secret https://private.invalid/secret")
				}
				resp := rainyunTestResponse(req, tc.status, tc.body)
				resp.Header.Set("Location", "https://private.invalid/secret")
				return resp, nil
			})
			got := svc.collectRainyunPerformance(context.Background())
			if calls != 1 || got.CheckedAt == nil || tc.fail && (got.Status != "error" || got.StorageUsedBytes != nil || got.TrafficUsedBytes != nil) || !tc.fail && got.Status != "healthy" {
				t.Fatalf("calls=%d snapshot=%+v", calls, got)
			}
			body, _ := json.Marshal(got)
			for _, forbidden := range []string{"test-management-secret", "private.invalid", "X-Amz", encryptedSettingPrefix} {
				if strings.Contains(string(body), forbidden) {
					t.Fatalf("snapshot leaked %s", forbidden)
				}
			}
		})
	}
}

func TestRainyunMonitorCacheCoalescesAndInvalidatesBothSettings(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	var calls, heads atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	var closeRelease sync.Once
	t.Cleanup(func() { closeRelease.Do(func() { close(release) }) })
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		select {
		case <-release:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return rainyunTestResponse(req, 200, rainyunTestInstance), nil
	})
	svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) { heads.Add(1); return 200, nil }
	results := make(chan SystemPerformanceRainyun, 12)
	for i := 0; i < cap(results); i++ {
		go func() { results <- svc.collectRainyunPerformance(context.Background()) }()
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("management call did not start")
	}
	closeRelease.Do(func() { close(release) })
	var checked *time.Time
	for i := 0; i < cap(results); i++ {
		got := <-results
		if got.Status != "healthy" || got.CheckedAt == nil {
			t.Fatalf("coalesced result=%+v", got)
		}
		if checked != nil && !checked.Equal(*got.CheckedAt) {
			t.Fatal("cache hit changed checkedAt")
		}
		checked = got.CheckedAt
	}
	if calls.Load() != 1 || heads.Load() != 1 {
		t.Fatalf("requests not coalesced: %d/%d", calls.Load(), heads.Load())
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{Enabled: true, InstanceID: 124}); err != nil {
		t.Fatal(err)
	}
	if got := svc.collectRainyunPerformance(context.Background()); got.InstanceID != 124 || calls.Load() != 2 {
		t.Fatal("monitor configuration change reused old cache")
	}
	setting := rainyunTestOSS()
	setting.Bucket = "another-bucket"
	saveRainyunTestSetting(t, svc, ossSettingKey, setting)
	if got := svc.collectRainyunPerformance(context.Background()); got.Status != "healthy" || calls.Load() != 3 || heads.Load() != 3 {
		t.Fatal("platform storage change reused old cache")
	}
}

func TestRainyunMonitorCachesFailureButNeverOldUsage(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	if got := svc.collectRainyunPerformance(context.Background()); got.StorageUsedBytes == nil {
		t.Fatal("healthy usage missing")
	}
	svc.rainyunMonitorCache.Clear()
	calls := 0
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		return rainyunTestResponse(req, 503, "secret"), nil
	})
	first := svc.collectRainyunPerformance(context.Background())
	// 失败快照走正常 60 秒 TTL，而不是缓存层默认的一秒 error 冷却。
	time.Sleep(1100 * time.Millisecond)
	second := svc.collectRainyunPerformance(context.Background())
	if calls != 1 || first.Status != "error" || second.Status != "error" || first.StorageUsedBytes != nil || first.StorageQuotaBytes != nil || first.TrafficUsedBytes != nil || first.TrafficQuotaBytes != nil || first.CheckedAt == nil || second.CheckedAt == nil || !first.CheckedAt.Equal(*second.CheckedAt) {
		t.Fatal("failure cache retained stale usage or reloaded")
	}
	other := &Service{repo: svc.repo, dataDir: svc.dataDir, rainyunMonitorTransport: svc.rainyunMonitorTransport, rainyunMonitorHead: svc.rainyunMonitorHead}
	_ = other.collectRainyunPerformance(context.Background())
	if calls != 2 {
		t.Fatal("cache unexpectedly shared across Service instances")
	}
}

func TestRainyunMonitorParallelDeadlineJoinsWorkersAndDoesNotCacheCancellation(t *testing.T) {
	svc := newRainyunMonitorFixture(t)
	var active, started atomic.Int32
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) {
		active.Add(1)
		defer active.Add(-1)
		started.Add(1)
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	svc.rainyunMonitorHead = func(ctx context.Context, _ ossSettingValue) (int, error) {
		active.Add(1)
		defer active.Add(-1)
		started.Add(1)
		<-ctx.Done()
		return 0, ctx.Err()
	}
	for attempt := 0; attempt < 2; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		begin := time.Now()
		got := svc.collectRainyunPerformance(ctx)
		cancel()
		if got.Status != "unknown" || got.StorageUsedBytes != nil || active.Load() != 0 || time.Since(begin) > time.Second || rainyunPerformanceDegraded(got) {
			t.Fatalf("deadline snapshot=%+v active=%d", got, active.Load())
		}
	}
	if started.Load() != 4 {
		t.Fatalf("canceled snapshot cached or probes serialized: %d", started.Load())
	}
}

func TestRainyunMonitorSourceStatusesAndSkipNonRainyun(t *testing.T) {
	for _, tc := range []struct {
		code     int
		status   string
		degraded bool
	}{{200, "healthy", false}, {403, "unknown", false}, {404, "error", true}, {429, "unknown", false}, {302, "error", true}, {503, "error", true}} {
		svc := newRainyunMonitorFixture(t)
		svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) { return tc.code, nil }
		got := svc.collectRainyunPerformance(context.Background())
		if got.SourceStatus != tc.status || rainyunPerformanceDegraded(got) != tc.degraded {
			t.Fatalf("source %d result=%+v", tc.code, got)
		}
		if tc.code == 403 && (!strings.Contains(got.SourceMessage, "权限") || !strings.Contains(got.SourceMessage, "不能据此判断宕机")) {
			t.Fatal("403 mislabeled as outage")
		}
	}
	svc := newRainyunMonitorFixture(t)
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(*http.Request) (*http.Response, error) {
		t.Error("non-Rainyun storage queried management API")
		return nil, errors.New("unexpected")
	})
	svc.rainyunMonitorHead = func(context.Context, ossSettingValue) (int, error) {
		t.Error("non-Rainyun storage probed source")
		return 0, nil
	}
	setting := rainyunTestOSS()
	setting.Provider = "s3"
	saveRainyunTestSetting(t, svc, ossSettingKey, setting)
	got := svc.collectRainyunPerformance(context.Background())
	if got.Status != "unknown" || got.SourceStatus != "disabled" || got.CheckedAt != nil || rainyunPerformanceDegraded(got) {
		t.Fatalf("non-Rainyun result=%+v", got)
	}
}

func TestRainyunMonitorCacheBoundsConcurrentDifferentConfigurations(t *testing.T) {
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
		return rainyunTestResponse(req, 200, rainyunTestInstance), nil
	})
	results := make(chan SystemPerformanceRainyun, 2)
	for i := 0; i < 2; i++ {
		setting := rainyunTestOSS()
		setting.Bucket += strings.Repeat("x", i)
		saveRainyunTestSetting(t, svc, ossSettingKey, setting)
		go func() { results <- svc.collectRainyunPerformance(context.Background()) }()
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("load did not start")
		}
	}
	setting := rainyunTestOSS()
	setting.Bucket = "third-configuration"
	saveRainyunTestSetting(t, svc, ossSettingKey, setting)
	if got := svc.collectRainyunPerformance(context.Background()); got.Status != "unknown" || got.StorageUsedBytes != nil || rainyunPerformanceDegraded(got) {
		t.Fatal("cache did not bound concurrent loads")
	}
	if len(entered) != 0 {
		t.Fatal("third concurrent configuration reached cloud")
	}
	once.Do(func() { close(release) })
	for i := 0; i < 2; i++ {
		if got := <-results; got.Status != "healthy" {
			t.Fatalf("bounded load failed: %+v", got)
		}
	}
}

func TestRainyunMonitorSourceSecretsStayReadOnly(t *testing.T) {
	for _, encryptedField := range []string{"accessKeySecret", "sessionToken", "none"} {
		svc, _ := newSystemPerformanceTestService(t)
		setting := rainyunTestOSS()
		if encryptedField == "accessKeySecret" {
			setting.AccessKeySecret = "enc:v1:AAAA"
		}
		if encryptedField == "sessionToken" {
			setting.SessionToken = "enc:v1:AAAA"
		}
		calls := 0
		svc.rainyunMonitorHead = func(_ context.Context, got ossSettingValue) (int, error) {
			calls++
			if got.AccessKeySecret != "test-source-secret" || got.SessionToken != "test-session" {
				t.Error("source credentials changed")
			}
			return 200, nil
		}
		got := svc.collectRainyunSource(context.Background(), setting)
		if encryptedField == "none" && (calls != 1 || got.SourceStatus != "healthy") || encryptedField != "none" && (calls != 0 || got.SourceStatus != "unconfigured") {
			t.Fatalf("source secret handling: %+v calls=%d", got, calls)
		}
		if _, err := os.Stat(filepath.Join(svc.dataDir, ".settings-key")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("source probe initialized a key file")
		}
	}
}

func TestRainyunMonitorReadAndSaveErrorsAreNotSilenced(t *testing.T) {
	svc, db := newSystemPerformanceTestService(t)
	if err := db.Callback().Query().Before("gorm:query").Register("rainyun-test-read-error", func(tx *gorm.DB) { tx.AddError(errors.New("private database detail")) }); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AdminRainyunMonitorSetting(context.Background(), rainyunTestAdmin()); err == nil || strings.Contains(err.Error(), "private database detail") {
		t.Fatal("GET error hidden or leaked")
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{}); err == nil {
		t.Fatal("configuration read failure became successful write")
	}
	if got := svc.collectRainyunPerformance(context.Background()); got.Status != "unknown" || rainyunPerformanceDegraded(got) {
		t.Fatal("read error became healthy or outage sample")
	}
	svc, db = newSystemPerformanceTestService(t)
	reject := func(tx *gorm.DB) { tx.AddError(errors.New("private database detail")) }
	if err := db.Callback().Update().Before("gorm:update").Register("rainyun-test-save-error", reject); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("rainyun-test-create-error", reject); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{}); err == nil || strings.Contains(err.Error(), "private database detail") {
		t.Fatal("save failure hidden or leaked")
	}
}

func TestRainyunMonitorGetDoesNotMigratePlainStoredManagementKey(t *testing.T) {
	svc, _ := newSystemPerformanceTestService(t)
	saveRainyunTestSetting(t, svc, rainyunMonitorSettingKey, rainyunMonitorSettingValue{Enabled: true, InstanceID: 123, APIKey: "legacy-plain-key"})
	before, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
	view, err := svc.AdminRainyunMonitorSetting(context.Background(), rainyunTestAdmin())
	if err != nil || !view.HasAPIKey {
		t.Fatalf("legacy GET: %+v %v", view, err)
	}
	after, _ := svc.repo.SystemSettingOptional(rainyunMonitorSettingKey)
	if after.ValueJSON != before.ValueJSON || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatal("GET migrated plaintext")
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, ".settings-key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("GET initialized a key file")
	}
}

func TestRainyunMonitorFailurePreservesSystemPerformance(t *testing.T) {
	t.Setenv("YINGCE_AGENT_URL", "")
	svc := newRainyunMonitorFixture(t)
	svc.rainyunMonitorTransport = rainyunMonitorTestTransport(func(req *http.Request) (*http.Response, error) { return rainyunTestResponse(req, 403, "secret"), nil })
	result, err := svc.AdminSystemPerformance(context.Background(), rainyunTestAdmin())
	if err != nil || result.Status != "degraded" || result.Rainyun.Status != "error" || !result.Database.Connected || result.Database.Driver != "sqlite" || result.Redis.Mode != "local" || result.Host.CPUCores < 1 || !result.Disk.Available {
		t.Fatalf("management failure lost system performance: %+v %v", result, err)
	}
	if _, err := svc.UpdateRainyunMonitorSetting(context.Background(), rainyunTestAdmin(), RainyunMonitorSettingRequest{}); err != nil {
		t.Fatal(err)
	}
	result, err = svc.AdminSystemPerformance(context.Background(), rainyunTestAdmin())
	if err != nil || result.Status != "healthy" || result.Rainyun.Status != "disabled" {
		t.Fatalf("disabled monitoring degraded system: %+v %v", result, err)
	}
}

func TestRainyunMonitorDegradedOnlyForEnabledExplicitFailures(t *testing.T) {
	for _, status := range []string{"disabled", "unconfigured", "unknown", "healthy", "warning", "error"} {
		for _, enabled := range []bool{false, true} {
			got := rainyunPerformanceDegraded(SystemPerformanceRainyun{Enabled: enabled, Status: status, SourceStatus: "unknown"})
			if got != (enabled && (status == "warning" || status == "error")) {
				t.Fatalf("status=%s enabled=%v degraded=%v", status, enabled, got)
			}
		}
	}
}
