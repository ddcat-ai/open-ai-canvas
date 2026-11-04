package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceContinuationPreservesHistoryAndRejectsForeignTasks(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range []model.Task{{ID: "old-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded}, {ID: "foreign-task", UserID: "other", Type: "canvas_image", Status: model.TaskStatusSucceeded}} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	history := model.EcommercePlanTask{ID: "old-image", TaskID: "old-task", ImageType: "detail", Ratio: "9:16", Prompt: "original"}
	draft := EcommerceDraft{ProductName: "榨汁机", Platform: "taobao", ImageType: "detail", Count: 9}
	pending := &model.EcommercePlan{ProductSummary: "原商品", VisualStrategy: "原风格", Images: []model.EcommercePlanTask{}, PreviousImages: []model.EcommercePlanTask{history}}
	saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft, Plan: pending})
	if err != nil {
		t.Fatal(err)
	}
	var restored model.EcommercePlan
	if err := json.Unmarshal([]byte(saved.PlanJSON), &restored); err != nil || len(restored.PreviousImages) != 1 || restored.PreviousImages[0].Prompt != "original" || len(restored.Images) != 0 {
		t.Fatal("history lost", err, restored)
	}
	pending.PreviousImages[0].TaskID = "foreign-task"
	if _, err := svc.SaveEcommerceProject("user", saved.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, Plan: pending}); err == nil {
		t.Fatal("foreign history task accepted")
	}
}

func TestEcommerceStreamingDownloadPreservesBytesAndOwnership(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	data := encoded.Bytes()
	file, _, err := svc.storeResource("user", "image", "test.png", "image/png", int64(len(data)), 1, 1, 0, bytes.NewReader(data), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EcommerceDownloadResources("other", []string{file.ID}); err == nil {
		t.Fatal("foreign resource exported")
	}
	if _, err := svc.EcommerceDownloadResources("user", []string{file.ID, file.ID}); err == nil {
		t.Fatal("duplicate resource accepted")
	}
	files, err := svc.EcommerceDownloadResources("user", []string{file.ID})
	if err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	if err := svc.WriteEcommerceDownload(context.Background(), "user", files, &body); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(body.Bytes()), int64(body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 || archive.File[0].Name != "01.png" {
		t.Fatal("wrong archive")
	}
	reader, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	actual, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatal("original image changed", err)
	}
}

func TestEcommercePartialDirectionsNeverInventMissingObservations(t *testing.T) {
	draft := EcommerceDraft{Count: 9, Ratio: "9:16"}
	raw := `{"brief":{"category":"便携榨汁机","structure":["透明杯身"]},"recommendations":[{"label":"unfinished`
	recovered, ok := ecommerceRecoverDirections(raw, draft)
	if !ok || len(recovered.Recommendations) != 4 || len(recovered.Brief.Structure) != 1 {
		t.Fatal("complete observation not recovered", recovered)
	}
	for _, rec := range recovered.Recommendations {
		if rec.Pages != 9 || rec.AspectRatio != "9:16" {
			t.Fatal("draft settings lost")
		}
	}
	for _, bad := range []string{`{"brief":{"category":"榨汁`, `{"recommendations":[]}`, `{"brief":{"category":"未知"},"recommendations":[`} {
		if _, ok := ecommerceRecoverDirections(bad, draft); ok {
			t.Fatal("unfinished or unknown observations accepted", bad)
		}
	}
}
