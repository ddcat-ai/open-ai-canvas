package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPaymentOrdersHTTPScopesAndPaginates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.User{ID: "member", Username: "member", Email: "member@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "session", UserID: "member", TokenHash: auth.HashToken("token"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i, owner := range []string{"member", "member", "other"} {
		id := fmt.Sprintf("order-%d", i)
		order := model.PaymentOrder{ID: id, UserID: owner, IdempotencyKey: id, MerchantOrderNo: id, Status: model.PaymentOrderPending, CreatedAt: time.Unix(int64(i), 0), ExpiresAt: time.Now().Add(time.Hour), CheckoutMode: "qr_code", CheckoutValue: "checkout-" + id}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterPaymentRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	call := func(path string, authenticated bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if authenticated {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	if w := call("/api/payments/orders", false); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", w.Code, w.Body.String())
	}
	if w := call("/api/payments/orders?page=invalid", true); w.Code != http.StatusBadRequest {
		t.Fatalf("pagination: %d %s", w.Code, w.Body.String())
	}
	for page, wantID := range []string{"order-1", "order-0", ""} {
		w := call(fmt.Sprintf("/api/payments/orders?page=%d&pageSize=1&userId=other", page+1), true)
		var response struct {
			Code int
			Data struct {
				Orders   []service.PaymentOrderView
				Total    int
				Page     int
				PageSize int
			}
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != http.StatusOK || response.Code != 0 || response.Data.Total != 2 || response.Data.Page != page+1 || response.Data.PageSize != 1 {
			t.Fatalf("list: %d %s err=%v", w.Code, w.Body.String(), err)
		}
		if wantID == "" {
			if response.Data.Orders == nil || len(response.Data.Orders) != 0 {
				t.Fatalf("empty page: %+v", response.Data)
			}
		} else if len(response.Data.Orders) != 1 || response.Data.Orders[0].ID != wantID || response.Data.Orders[0].Checkout.Value != "checkout-"+wantID {
			t.Fatalf("own recoverable order: %+v", response.Data)
		}
	}
	if w := call("/api/payments/orders/order-2", true); w.Code != http.StatusNotFound {
		t.Fatalf("foreign checkout: %d %s", w.Code, w.Body.String())
	}
}
