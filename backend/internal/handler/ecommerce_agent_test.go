package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceAgentHTTPMockSSEAndTaskRecovery(t *testing.T) {
	t.Setenv("AI_MODE", "mock")
	t.Setenv("TEXT_API_KEY", "")
	t.Setenv("IMAGE_API_KEY", "")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:ecommerce-agent-http?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.AuthSession{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.EcommerceProject{}, &model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "ecommerce-http-user", Username: "ecommerce-http-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err = db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.AuthSession{ID: "ecommerce-http-session", UserID: user.ID, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CreditAccount{UserID: user.ID, AvailableMicrocredits: 1_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"ecommerceEnabled":true,"imageWorkbenchEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	router := gin.New()
	RegisterEcommerceAgentRoutes(router.Group("/api"), svc)
	call := func(authenticated bool, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if authenticated {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "ecommerce-http-session.test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	body := `{"fileInfoList":[{"url":"https://example.invalid/product.png"}],"query":"蓝牙耳机","platform":"Amazon","language":"英语","generateType":200,"imageCount":5,"needText":false,"idempotencyKey":"http-mock"}`
	if r := call(true, "POST", "/api/agent/quote", body); r.Code != http.StatusOK || !strings.Contains(r.Body.String(), `"pageCount":5`) {
		t.Fatalf("quote=%d %s", r.Code, r.Body.String())
	}
	var preQuoteAccount model.CreditAccount
	if err := db.Where("user_id = ?", user.ID).First(&preQuoteAccount).Error; err != nil || preQuoteAccount.AvailableMicrocredits != 1_000_000 || preQuoteAccount.ReservedMicrocredits != 0 {
		t.Fatalf("quote changed credits: %+v %v", preQuoteAccount, err)
	}
	if r := call(false, "POST", "/api/agent/analyze", body); r.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous analyze=%d", r.Code)
	}
	if r := call(true, "POST", "/api/agent/analyze", body); r.Code != http.StatusOK || !strings.Contains(r.Body.String(), `"recommendations"`) {
		t.Fatalf("analyze=%d %s", r.Code, r.Body.String())
	}
	r := call(true, "POST", "/api/agent/generate/stream", body)
	if r.Code != http.StatusOK || !strings.HasPrefix(r.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("SSE headers=%d %v", r.Code, r.Header())
	}
	for _, event := range []string{`"event":"workflow_started"`, `"event":"iteration_completed"`, `"event":"message"`, `"done":true`} {
		if !strings.Contains(r.Body.String(), event) {
			t.Fatalf("missing %s in SSE: %s", event, r.Body.String())
		}
	}
	if strings.Contains(r.Body.String(), `"type":"i-text"`) {
		t.Fatalf("no-text request added canvas text: %s", r.Body.String())
	}
	var run model.EcommerceAgentRun
	if err = db.Where("user_id = ?", user.ID).First(&run).Error; err != nil {
		t.Fatal(err)
	}
	if r := call(true, "GET", "/api/task/"+run.ID, ""); r.Code != http.StatusOK || !strings.Contains(r.Body.String(), `"successPages":5`) {
		t.Fatalf("task=%d %s", r.Code, r.Body.String())
	}
	if r := call(true, "GET", "/api/agent/projects/"+run.ProjectID+"/task", ""); r.Code != http.StatusOK || !strings.Contains(r.Body.String(), run.ID) {
		t.Fatalf("project task=%d %s", r.Code, r.Body.String())
	}
	if r := call(false, "GET", "/api/agent/projects/"+run.ProjectID+"/task", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous project task=%d", r.Code)
	}
}
