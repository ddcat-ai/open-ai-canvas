package canvas

import (
	"net/http"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestCanvasCreditUsageDoesNotExposeCollaboratorBilling(t *testing.T) {
	svc, owner, editor, stranger := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.WithCanvasCollaborationTransaction("canvas-1", func(tx *gorm.DB, _ *model.CanvasProject) error {
		if err := tx.AutoMigrate(&model.Task{}, &model.BillingOrder{}); err != nil {
			return err
		}
		for _, record := range []any{
			&model.Task{ID: "owner-task", UserID: owner.ID, BillingOrderID: "owner-order", InputJSON: `{"metadata":{"canvasId":"canvas-1"}}`},
			&model.BillingOrder{ID: "owner-order", UserID: owner.ID, TaskID: "owner-task", Status: model.BillingStatusSettled, Capability: "image", AmountMicrocredits: 20, ActualAmountMicrocredits: 15},
			&model.Task{ID: "editor-task", UserID: editor.ID, BillingOrderID: "editor-order", InputJSON: `{"canvasId":"canvas-1"}`},
			&model.BillingOrder{ID: "editor-order", UserID: editor.ID, TaskID: "editor-task", Status: model.BillingStatusReserved, Capability: "video", AmountMicrocredits: 30},
		} {
			if err := tx.Create(record).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	own, err := svc.CanvasCreditUsageForUser(owner, "canvas-1")
	if err != nil || own.OrderCount != 1 || own.SettledMicrocredits != 15 || own.PendingMicrocredits != 0 {
		t.Fatalf("owner usage = %#v, %v", own, err)
	}
	invited, err := svc.CanvasCreditUsageForUser(editor, "canvas-1")
	if err != nil || invited.OrderCount != 1 || invited.PendingMicrocredits != 30 || invited.SettledMicrocredits != 0 {
		t.Fatalf("editor usage = %#v, %v", invited, err)
	}
	if _, err := svc.CanvasCreditUsageForUser(stranger, "canvas-1"); !hasAppStatus(err, http.StatusNotFound) {
		t.Fatalf("unauthorized usage = %v", err)
	}
}
