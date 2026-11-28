package handler

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestAudioReviewHTTP(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	router, db, _ := skillAuthorizationFixture(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	RegisterFinanceRoutes(router.Group("/api"), svc)
	resourceDir := filepath.Join(dir, "resources")
	if err := os.MkdirAll(resourceDir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id, kind, reason         string
		reserved, available, cap int64
		status                   int
	}{
		{"supplement", "audio", "", 100, 400, 0, 200},
		{"return", "audio", "", 500, 100, 0, 200},
		{"image", "image", "audio_output_required", 100, 400, 0, 422},
		{"empty", "audio", "audio_duration_unverified", 100, 400, 0, 422},
		{"cap", "audio", "billing_charge_limit", 100, 400, 200, 422},
		{"balance", "audio", "insufficient_credits", 100, 50, 0, 422},
		{"other-payer", "audio", "audio_order_mismatch", 100, 400, 0, 422},
		{"decoder-missing", "audio", "服务端缺少 FFmpeg", 100, 400, 0, 503},
		{"audit", "audio", "", 100, 400, 0, 500},
	} {
		t.Run(tc.id, func(t *testing.T) {
			path := filepath.Join(resourceDir, tc.id)
			if tc.id != "empty" {
				if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "2.1", "-f", "wav", path).CombinedOutput(); err != nil {
					t.Fatal(string(out), err)
				}
			} else if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
				t.Fatal(err)
			}
			fi, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			bill := model.BillingOrder{
				ID: tc.id, UserID: tc.id, TaskID: tc.id, IdempotencyKey: tc.id,
				Status: model.BillingStatusUncertain, Capability: "audio", BillingMode: "per_second",
				UnitPriceMicrocredits: 100, Quantity: 1, MultiplierBasisPoints: 10000,
				AmountMicrocredits: tc.reserved, ReservedAmountMicrocredits: tc.reserved,
				ChargeLimitSet: tc.cap > 0, ChargeLimitMicrocredits: tc.cap,
			}
			if tc.id == "other-payer" {
				bill.BillingAccountID = model.PersonalCreditAccountID("other")
			}
			rows := []any{
				&bill,
				&model.CreditAccount{UserID: tc.id, ReservedMicrocredits: tc.reserved, AvailableMicrocredits: tc.available},
				&model.Resource{ID: tc.id, UserID: tc.id, Provider: "local", ObjectKey: tc.id, Size: fi.Size(),
					Status: model.ResourceStatusReady, Kind: tc.kind, DurationMs: 777777},
				&model.Task{ID: tc.id, UserID: tc.id, Type: "canvas_audio", Status: model.TaskStatusSucceeded,
					BillingOrderID: tc.id, ResultJSON: `{"audio":{"resourceId":"` + tc.id + `"},"cover":{"resourceId":"cover"}}`},
			}
			for _, row := range rows {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.id == "audit" {
				if err := db.Exec("CREATE TRIGGER failed_review BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END").Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.id == "decoder-missing" {
				t.Setenv("PATH", t.TempDir())
			}
			out := skillAuthorizationRequest(router, "POST", "/api/admin/billing-orders/"+tc.id+"/resolve", "skill-admin", strings.NewReader(`{"action":"settle","note":"fixture review"}`))
			if out.Code != tc.status || tc.reason != "" && !strings.Contains(out.Body.String(), tc.reason) {
				t.Fatalf("response %d %s", out.Code, out.Body.String())
			}
			repo := repository.New(db)
			order, err := repo.BillingOrder(tc.id)
			if err != nil {
				t.Fatal(err)
			}
			account, err := repo.CreditAccount(tc.id)
			if err != nil {
				t.Fatal(err)
			}
			var entries int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id=?", tc.id).Count(&entries).Error; err != nil {
				t.Fatal(err)
			}
			if tc.status == 200 {
				if order.Quantity != 3 || order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != 300 || account.AvailableMicrocredits != tc.available+tc.reserved-300 || account.ReservedMicrocredits != 0 || entries < 1 {
					t.Fatal(order, account, entries)
				}
			} else if order.Status != model.BillingStatusUncertain || order.ResolvedBy != "" || account.AvailableMicrocredits != tc.available || account.ReservedMicrocredits != tc.reserved || entries != 0 {
				t.Fatal(order, account, entries)
			}
		})
	}
}
