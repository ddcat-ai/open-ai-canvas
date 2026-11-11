package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func siteTrafficHandlerFixture(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_CORS_ORIGINS", "")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: ":memory:"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.SiteTrafficEvent{}, &model.User{}, &model.AuthSession{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	for _, role := range []model.UserRole{model.UserRoleUser, model.UserRoleAdmin} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("token-" + id), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	// 模拟全局CORS已放行；端点仍须拒绝缺失/null/非法和非明确允许的跨源。
	router.Use(func(c *gin.Context) {
		if origin := c.GetHeader("Origin"); origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Next()
	})
	api := router.Group("/api")
	api.Use(StorageReadOnlyGuard(svc))
	RegisterSiteTrafficRoutes(api, svc)
	return router, db
}

func siteTrafficEventJSON() string {
	return fmt.Sprintf(`{"id":%q,"visitorId":%q,"sessionId":%q,"type":"page_view","page":"inspirations"}`, uuid.NewString(), uuid.NewString(), uuid.NewString())
}

func siteTrafficRequest(router *gin.Engine, method, path, body, origin, contentType, role string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "https://traffic.example.test/api"+path, strings.NewReader(body))
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if role != "" {
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".token-" + role})
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestSiteTrafficAnonymousPostDeduplicatesAndNeverReadsOptionalAuth(t *testing.T) {
	router, db := siteTrafficHandlerFixture(t)
	authReads := 0
	callback := "site-traffic-test-auth-reads"
	if err := db.Callback().Query().Before("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "auth_sessions" || tx.Statement.Table == "users" {
			authReads++
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callback) })
	event := siteTrafficEventJSON()
	body := `{"events":[` + event + `,` + event + `]}`
	for index, role := range []string{"", string(model.UserRoleUser)} {
		response := siteTrafficRequest(router, http.MethodPost, "/traffic/events", body, "https://traffic.example.test", "application/json; charset=utf-8", role)
		var envelope struct {
			Code int `json:"code"`
			Data struct {
				Accepted int64 `json:"accepted"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != 200 || envelope.Code != 0 || envelope.Data.Accepted != int64(1-index) {
			t.Fatalf("post/retry = %d, %s, %v", response.Code, response.Body.String(), err)
		}
	}
	if authReads != 0 {
		t.Fatalf("anonymous event intake read optional auth %d times", authReads)
	}
}

func TestSiteTrafficPostAcceptsCurrentPagesAndRejectsLegacyWithoutPartialWrites(t *testing.T) {
	router, db := siteTrafficHandlerFixture(t)
	for _, page := range []string{"welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"} {
		for _, kind := range []string{"page_view", "action"} {
			event := strings.Replace(siteTrafficEventJSON(), `"page":"inspirations"`, `"page":"`+page+`"`, 1)
			if kind == "action" {
				event = strings.Replace(event, `"type":"page_view"`, `"type":"action","action":"open_create"`, 1)
			}
			body := `{"events":[` + siteTrafficEventJSON() + `,` + event + `]}`
			response := siteTrafficRequest(router, http.MethodPost, "/traffic/events", body, "https://traffic.example.test", "application/json", "")
			var envelope struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != http.StatusBadRequest || envelope.Code == 0 {
				t.Fatalf("legacy %s/%s must reject the batch: %d %s, %v", page, kind, response.Code, response.Body.String(), err)
			}
		}
	}
	var count int64
	if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected batches were partially persisted: %d, %v", count, err)
	}
	var events []string
	for _, page := range []string{
		"inspirations", "create", "canvas_list", "canvas", "assets", "history", "ecommerce", "ecommerce_pipeline", "drama",
		"skills", "referral", "tools_image", "tools_video",
	} {
		events = append(events, strings.Replace(siteTrafficEventJSON(), `"page":"inspirations"`, `"page":"`+page+`"`, 1))
	}
	for _, page := range []string{"tools_image", "tools_video"} {
		event := strings.Replace(siteTrafficEventJSON(), `"page":"inspirations"`, `"page":"`+page+`"`, 1)
		events = append(events, strings.Replace(event, `"type":"page_view"`, `"type":"action","action":"open_create"`, 1))
	}
	response := siteTrafficRequest(router, http.MethodPost, "/traffic/events", `{"events":[`+strings.Join(events, ",")+`]}`, "https://traffic.example.test", "application/json", "")
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Accepted int64 `json:"accepted"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != http.StatusOK || envelope.Code != 0 || envelope.Data.Accepted != 15 {
		t.Fatalf("current pages and split tool actions rejected: %d %s, %v", response.Code, response.Body.String(), err)
	}
	if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 15 {
		t.Fatalf("current events were dropped: %d, %v", count, err)
	}
}

func TestSiteTrafficPostRejectsInvalidJSONContentOriginAndBatch(t *testing.T) {
	router, db := siteTrafficHandlerFixture(t)
	valid := `{"events":[` + siteTrafficEventJSON() + `]}`
	for _, test := range []struct {
		name, body, origin, contentType string
		status                          int
	}{
		{"no-origin", valid, "", "application/json", 403},
		{"null-origin", valid, "null", "application/json", 403},
		{"foreign-origin", valid, "https://untrusted.example.test", "application/json", 403},
		{"path-origin", valid, "https://traffic.example.test/path", "application/json", 403},
		{"text", valid, "https://traffic.example.test", "text/plain", 415},
		{"no-content-type", valid, "https://traffic.example.test", "", 415},
		{"wrong-charset", valid, "https://traffic.example.test", "application/json; charset=gbk", 415},
		{"unknown-root", strings.TrimSuffix(valid, "}") + `,"properties":{"account":"secret"}}`, "https://traffic.example.test", "application/json", 400},
		{"client-time", strings.Replace(valid, `"page":"inspirations"`, `"page":"inspirations","receivedAt":1`, 1), "https://traffic.example.test", "application/json", 400},
		{"arbitrary-url", strings.Replace(valid, `"page":"inspirations"`, `"page":"inspirations","url":"secret"`, 1), "https://traffic.example.test", "application/json", 400},
		{"null-action", strings.Replace(valid, `"page":"inspirations"`, `"page":"inspirations","action":null`, 1), "https://traffic.example.test", "application/json", 400},
		{"null-batch", `{"events":null}`, "https://traffic.example.test", "application/json", 400},
		{"empty-batch", `{"events":[]}`, "https://traffic.example.test", "application/json", 400},
		{"batch-21", `{"events":[` + strings.Repeat(siteTrafficEventJSON()+",", 20) + siteTrafficEventJSON() + `]}`, "https://traffic.example.test", "application/json", 400},
		{"trailing-object", valid + `{}`, "https://traffic.example.test", "application/json", 400},
		{"oversized", valid + strings.Repeat(" ", siteTrafficBodyLimit), "https://traffic.example.test", "application/json", 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := siteTrafficRequest(router, http.MethodPost, "/traffic/events", test.body, test.origin, test.contentType, "")
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.status, response.Body.String())
			}
		})
	}
	var count int64
	if err := db.Model(&model.SiteTrafficEvent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("invalid intake wrote %d events, %v", count, err)
	}
	// unknown Content-Length 也要在读取阶段限体，不能只信请求声明。
	request := httptest.NewRequest(http.MethodPost, "https://traffic.example.test/api/traffic/events", strings.NewReader(valid+strings.Repeat(" ", siteTrafficBodyLimit)))
	request.ContentLength = -1
	request.Header.Set("Origin", "https://traffic.example.test")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("streaming body limit = %d", response.Code)
	}
}

func TestSiteTrafficOriginRejectsWildcardAndSpoofedForwardedHost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "*")
	check := func(origin, host, peer, forwardedHost, forwardedProto string, cors bool) bool {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest(http.MethodPost, "http://"+host+"/api/traffic/events", nil)
		context.Request.RemoteAddr = peer
		context.Request.Header.Set("Origin", origin)
		context.Request.Header.Set("X-Forwarded-Host", forwardedHost)
		context.Request.Header.Set("X-Forwarded-Proto", forwardedProto)
		if cors {
			context.Header("Access-Control-Allow-Origin", origin)
		}
		return siteTrafficOriginAllowed(context)
	}
	if check("https://evil.test", "traffic.example.test", "192.0.2.1:80", "evil.test", "https", true) {
		t.Fatal("wildcard or spoofed forwarded host authorized foreign origin")
	}
	if check("https://traffic.example.test", "traffic.example.test", "192.0.2.1:80", "", "https", true) {
		t.Fatal("public peer may not change scheme using forwarded header")
	}
	if !check("https://traffic.example.test", "traffic.example.test", "127.0.0.1:80", "", "https", true) {
		t.Fatal("same-origin HTTPS termination via local reverse proxy rejected")
	}
	if check("http://traffic.example.test", "traffic.example.test", "192.0.2.1:80", "", "", false) {
		t.Fatal("endpoint bypassed shared CORS decision")
	}
	if !check("http://localhost:3001", "127.0.0.1:8081", "127.0.0.1:50000", "localhost:3001", "http", true) {
		t.Fatal("loopback Vite changeOrigin+xfwd same-origin request rejected")
	}
	if check("https://evil.test", "127.0.0.1:8081", "127.0.0.1:50000", "evil.test", "https", true) {
		t.Fatal("loopback proxy may not authorize an arbitrary forwarded host")
	}
	t.Setenv("CANVAS_CORS_ORIGINS", "https://explicit.example.test")
	if !check("https://explicit.example.test", "traffic.example.test", "192.0.2.1:80", "", "", true) {
		t.Fatal("explicit configured CORS origin rejected")
	}
}

func TestSiteTrafficOverviewRequiresAdminAndValidRange(t *testing.T) {
	router, _ := siteTrafficHandlerFixture(t)
	for _, test := range []struct {
		role, query string
		status      int
	}{
		{"", "", 401}, {string(model.UserRoleUser), "", 403},
		{string(model.UserRoleAdmin), "?from=bad", 400},
		{string(model.UserRoleAdmin), "?from=2026-11-10&to=2026-11-09", 400},
		{string(model.UserRoleAdmin), "?to=2999-01-01", 400},
		{string(model.UserRoleAdmin), "?from=", 400},
		{string(model.UserRoleAdmin), "?from=%zz", 400},
		{string(model.UserRoleAdmin), "?from=2026-11-10&from=2026-11-10", 400},
		{string(model.UserRoleAdmin), "", 200},
	} {
		response := siteTrafficRequest(router, http.MethodGet, "/admin/traffic/overview"+test.query, "", "", "", test.role)
		if response.Code != test.status {
			t.Fatalf("role=%q query=%q: %d, %s", test.role, test.query, response.Code, response.Body.String())
		}
		if test.status == 200 && (!strings.Contains(response.Body.String(), `"availableFrom":null`) || !strings.Contains(response.Body.String(), `"retentionDays":365`)) {
			t.Fatalf("wrong empty-state envelope: %s", response.Body.String())
		}
		if test.status == 200 {
			var envelope struct {
				Code int                         `json:"code"`
				Data service.SiteTrafficOverview `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			asOf, err := time.Parse(time.RFC3339, envelope.Data.AsOf)
			if err != nil || asOf.Nanosecond() != 0 || envelope.Code != 0 || envelope.Data.EffectiveTo != envelope.Data.AsOf || envelope.Data.EffectiveFrom == "" ||
				envelope.Data.Comparison.Status != "insufficient_history" || envelope.Data.Comparison.KPI != nil || envelope.Data.Comparison.Range.TimeZone != "Asia/Shanghai" ||
				envelope.Data.Comparison.EffectiveFrom == "" || envelope.Data.Comparison.EffectiveTo == "" || envelope.Data.Engagement.Rate != nil ||
				!strings.Contains(response.Body.String(), `"engagement":{"visits":0,"engagedVisits":0,"rate":null}`) {
				t.Fatalf("extended overview DTO = %s, %v", response.Body.String(), err)
			}
			insights := envelope.Data.Insights
			if len(insights.Heatmap) != 168 || len(insights.FeatureTrend) != 30 || len(insights.PageEngagement) != 13 || len(insights.Depth.Buckets) != 3 || insights.Depth.Visits != 0 {
				t.Fatalf("insights fixed empty shape = %s", response.Body.String())
			}
			for index, cell := range insights.Heatmap {
				if cell.Weekday != index/24+1 || cell.Hour != index%24 || cell.PageViews != nil || cell.CompletedHours > cell.Hours ||
					(cell.Hours == 0 && (cell.HistoryStatus != "outside_range" || cell.CompletedHours != 0 || cell.Partial)) ||
					(cell.Hours > 0 && cell.HistoryStatus != "unknown") {
					t.Fatalf("empty history cannot become measured zero: %+v", cell)
				}
			}
			for _, point := range insights.FeatureTrend {
				if point.Counts != nil || point.HistoryStatus != "unknown" || point.Partial != (point.Date == asOf.In(time.FixedZone("Asia/Shanghai", 28800)).Format("2006-01-02")) {
					t.Fatalf("empty feature history = %+v", point)
				}
			}
			for _, bucket := range insights.Depth.Buckets {
				if bucket.Visits != 0 || bucket.Rate != nil {
					t.Fatalf("zero denominator depth = %+v", insights.Depth)
				}
			}
		}
	}
}

func TestSiteTrafficTodayRequiresAdminAndReturnsBoundedEmptyHours(t *testing.T) {
	router, _ := siteTrafficHandlerFixture(t)
	for _, test := range []struct {
		role   string
		status int
	}{
		{"", http.StatusUnauthorized},
		{string(model.UserRoleUser), http.StatusForbidden},
		{string(model.UserRoleAdmin), http.StatusOK},
	} {
		response := siteTrafficRequest(router, http.MethodGet, "/admin/traffic/today", "", "", "", test.role)
		if response.Code != test.status {
			t.Fatalf("today role=%q: %d, %s", test.role, response.Code, response.Body.String())
		}
		if test.status != http.StatusOK {
			continue
		}
		var envelope struct {
			Code int                      `json:"code"`
			Data service.SiteTrafficToday `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		result := envelope.Data
		asOf, err := time.Parse(time.RFC3339, result.AsOf)
		if err != nil {
			t.Fatal(err)
		}
		windowFrom, err := time.Parse(time.RFC3339, result.Active.WindowFrom)
		if err != nil {
			t.Fatal(err)
		}
		local := asOf.In(time.FixedZone("Asia/Shanghai", 28800))
		if envelope.Code != 0 || asOf.Nanosecond() != 0 || result.Date != local.Format("2006-01-02") || result.TimeZone != "Asia/Shanghai" ||
			result.Active.Visitors != 0 || result.Active.WindowTo != result.AsOf || asOf.Sub(windowFrom) != 300*time.Second || len(result.Hours) != local.Hour()+1 {
			t.Fatalf("today DTO/shared cutoff = %s", response.Body.String())
		}
		for hour, point := range result.Hours {
			if point.Hour != hour || point.Partial != (hour == local.Hour()) || point.SiteTrafficCounts != (repository.SiteTrafficCounts{}) {
				t.Fatalf("empty elapsed hour/future exclusion = %+v", point)
			}
		}
	}
}

func TestSiteTrafficDatabaseFailureDoesNotBecomeEmptySuccess(t *testing.T) {
	router, db := siteTrafficHandlerFixture(t)
	if err := db.Migrator().DropTable(&model.SiteTrafficEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/admin/traffic/today", "/admin/traffic/overview"} {
		response := siteTrafficRequest(router, http.MethodGet, path, "", "", "", string(model.UserRoleAdmin))
		var envelope struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != http.StatusInternalServerError || envelope.Code == 0 {
			t.Fatalf("failed read was reported as zero/success: %s %d %s, %v", path, response.Code, response.Body.String(), err)
		}
	}
}

func TestSiteTrafficStorageExemptionAndRateKeysStayBounded(t *testing.T) {
	if !storageReadOnlyExempt(http.MethodPost, "/api/traffic/events") {
		t.Fatal("anonymous traffic events must bypass user storage ownership")
	}
	for _, path := range []string{"/api/traffic/anything", "/api/traffic/events/other", "/api/public/content"} {
		if storageReadOnlyExempt(http.MethodPost, path) {
			t.Fatalf("broad public-prefix exemption leaked to %s", path)
		}
	}
	keys := map[string]bool{}
	for index := 0; index < 10000; index++ {
		keys[siteTrafficRateBucket(fmt.Sprintf("203.0.%d.%d", index/256, index%256))] = true
	}
	if len(keys) > 1024 || siteTrafficRateBucket("127.0.0.1") != siteTrafficRateBucket("127.0.0.1") {
		t.Fatalf("unbounded/unstable rate keys: %d", len(keys))
	}
	for key := range keys {
		if !strings.HasPrefix(key, "site-traffic:bucket:") || strings.Contains(key, "203.0.") {
			t.Fatalf("rate key leaked IP: %q", key)
		}
	}
}
