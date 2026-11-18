package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/database"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type communityFixture struct {
	svc          *Service
	db           *gorm.DB
	owner, other *model.User
	admin        *model.User
	media, ref   *model.Resource
	input        CommunityWorkInput
	project      map[string]any
}

func newCommunityFixture(t *testing.T) *communityFixture {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close(); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	f := &communityFixture{svc: svc, db: db}
	f.owner = &model.User{ID: "author", Username: "author", DisplayName: "投稿者", Role: model.UserRoleUser, Status: model.UserStatusActive, Email: "private@example.com", Phone: "13800000000"}
	f.other = &model.User{ID: "viewer", Username: "viewer", DisplayName: "观众", Role: model.UserRoleUser, Status: model.UserStatusActive}
	f.admin = &model.User{ID: "reviewer", Username: "reviewer", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	for _, user := range []*model.User{f.owner, f.other, f.admin} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	upload := func(name string, shade color.RGBA) *model.Resource {
		pic := image.NewRGBA(image.Rect(0, 0, 4, 4))
		for y := 0; y < 4; y++ {
			for x := 0; x < 4; x++ {
				pic.SetRGBA(x, y, shade)
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, pic); err != nil {
			t.Fatal(err)
		}
		resource, err := svc.UploadResourceFile(f.owner.ID, name, int64(encoded.Len()), "image", 4, 4, 0, bytes.NewReader(encoded.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		return resource
	}
	f.media = upload("finished.png", color.RGBA{R: 40, G: 160, B: 240, A: 255})
	f.ref = upload("reference.png", color.RGBA{R: 220, G: 100, B: 40, A: 255})
	assetData, _ := json.Marshal(map[string]any{"id": "source-asset", "kind": "image", "title": "原素材", "coverUrl": assets.FileURL(f.media.ID), "tags": []string{}, "data": map[string]any{"storageKey": "resource:" + f.media.ID, "width": 4, "height": 4, "bytes": f.media.Size, "mimeType": "image/png"}})
	if _, err := svc.UpsertUserAsset(f.owner.ID, assetData); err != nil {
		t.Fatal(err)
	}
	f.project = map[string]any{
		"id": "source-canvas", "title": "投稿制作过程", "revision": int64(0), "createdAt": time.Now().UTC().Format(time.RFC3339), "updatedAt": time.Now().UTC().Format(time.RFC3339),
		"nodes": []any{
			map[string]any{"id": "prompt", "type": "text", "title": "提示词", "position": map[string]any{"x": 0, "y": 0}, "width": 400, "height": 240, "metadata": map[string]any{"content": "参考 ![](/api/resources/" + f.media.ID + "/file) 和 ![](resource:" + f.ref.ID + ") 后继续", "composerContent": "使用 @[node:finished]", "apiKey": "private-key", "skillSnapshot": map[string]any{"name": "保留技能", "headers": map[string]any{"Authorization": "private-auth"}}}},
			map[string]any{"id": "finished", "type": "image", "title": "成品", "position": map[string]any{"x": 600, "y": 80}, "width": 480, "height": 480, "metadata": map[string]any{"content": assets.FileURL(f.media.ID), "assetId": "source-asset", "storageKey": "resource:" + f.media.ID, "prompt": "保留提示词"}},
		},
		"connections": []any{map[string]any{"id": "edge", "fromNodeId": "prompt", "toNodeId": "finished"}}, "chatSessions": []any{map[string]any{"id": "private-chat", "messages": []any{map[string]any{"id": "message", "role": "user", "content": "聊天内容不能公开"}}}}, "previsScenes": []any{}, "viewport": map[string]any{"x": 0, "y": 0, "k": 1},
	}
	raw, _ := json.Marshal(f.project)
	summary, err := svc.UpsertUserCanvasProject(f.owner.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	f.project["revision"] = summary.Revision
	f.input = CommunityWorkInput{Title: "用户成品", Description: "实际投稿", Category: "creative", Tags: []string{"电影"}, MediaResourceID: f.media.ID, CoverResourceID: f.media.ID, ProjectID: "source-canvas", RightsConfirmed: true}
	return f
}

func requireCommunityError(t *testing.T, err error, status int) {
	t.Helper()
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Status != status {
		t.Fatalf("expected HTTP %d, got %v", status, err)
	}
}

func (f *communityFixture) publish(t *testing.T) *CommunityWorkView {
	t.Helper()
	work, err := f.svc.SubmitCommunityWork(f.owner, "", f.input)
	if err != nil {
		t.Fatal(err)
	}
	work, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	return work
}

func TestCommunityWorkPermissionsRightsAndDuplicateSubmission(t *testing.T) {
	f := newCommunityFixture(t)
	input := f.input
	input.RightsConfirmed = false
	_, err := f.svc.SubmitCommunityWork(f.owner, "", input)
	requireCommunityError(t, err, 400)
	_, err = f.svc.SubmitCommunityWork(f.other, "", f.input)
	requireCommunityError(t, err, 400)
	_, err = f.svc.SubmitCommunityWork(nil, "", f.input)
	requireCommunityError(t, err, 401)
	work, err := f.svc.SubmitCommunityWork(f.owner, "", f.input)
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range []func() error{
		func() error { _, err := f.svc.CommunityWork(nil, work.ID, true); return err },
		func() error { _, err := f.svc.CommunityWorkProject(nil, work.ID, true); return err },
		func() error { _, err := f.svc.CommunityWork(f.other, work.ID, false); return err },
		func() error { _, err := f.svc.SubmitCommunityWork(f.other, work.ID, f.input); return err },
		func() error { _, err := f.svc.WithdrawCommunityWork(f.other, work.ID); return err },
	} {
		requireCommunityError(t, call(), 404)
	}
	_, err = f.svc.ReviewCommunityWork(f.other, work.ID, CommunityWorkReviewInput{Action: "approve"})
	requireCommunityError(t, err, 403)
	_, err = f.svc.SubmitCommunityWork(f.owner, "", f.input)
	requireCommunityError(t, err, 409)
	if _, err := f.svc.WithdrawCommunityWork(f.owner, work.ID); err != nil {
		t.Fatal(err)
	}
	replacement, err := f.svc.SubmitCommunityWork(f.owner, "", f.input)
	if err != nil || replacement.ID == work.ID {
		t.Fatalf("resubmit after withdrawal: %+v, %v", replacement, err)
	}
	_, err = f.svc.SubmitCommunityWork(f.owner, work.ID, f.input)
	requireCommunityError(t, err, 409)
}

func TestCommunityWorkFrozenSnapshotModerationAndReactions(t *testing.T) {
	f := newCommunityFixture(t)
	work := f.publish(t)
	featured, err := f.svc.PublicCommunityWorks(true)
	if err != nil || len(featured) != 0 {
		t.Fatalf("unselected work in featured: %v %v", featured, err)
	}
	if _, err := f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "feature"}); err != nil {
		t.Fatal(err)
	}
	featured, err = f.svc.PublicCommunityWorks(true)
	if err != nil || len(featured) != 1 || featured[0].ID != work.ID || featured[0].ProjectID != "" || featured[0].Author != "投稿者" {
		t.Fatalf("featured publication: %+v %v", featured, err)
	}
	f.project["nodes"].([]any)[0].(map[string]any)["metadata"].(map[string]any)["content"] = "作者后来修改，不能混入已审核快照"
	raw, _ := json.Marshal(f.project)
	if _, err := f.svc.UpsertUserCanvasProject(f.owner.ID, raw); err != nil {
		t.Fatal(err)
	}
	snapshot, err := f.svc.CommunityWorkProject(nil, work.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(snapshot)
	for _, forbidden := range []string{"作者后来修改", "private-key", "private-auth", "private-chat", "private@example.com", "13800000000", "source-asset"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("snapshot changed or leaked %q: %s", forbidden, encoded)
		}
	}
	if !strings.Contains(string(encoded), "后继续") || !strings.Contains(string(encoded), f.ref.ID) || len(snapshot.Project["nodes"].([]any)) != 2 || len(snapshot.Project["connections"].([]any)) != 1 {
		t.Fatalf("snapshot lost workflow: %s", encoded)
	}
	if _, err := f.svc.SetCommunityWorkLiked(f.other, work.ID, true); err != nil {
		t.Fatal(err)
	}
	reaction, err := f.svc.CommunityWorkReaction(f.owner, work.ID)
	if err != nil || reaction.Count != 1 || reaction.Liked {
		t.Fatalf("vote account isolation: %+v %v", reaction, err)
	}
	if _, err := f.svc.WithdrawCommunityWork(f.owner, work.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.CommunityWork(nil, work.ID, true)
	requireCommunityError(t, err, 404)
	_, err = f.svc.CommunityWorkReaction(nil, work.ID)
	requireCommunityError(t, err, 404)
	featured, err = f.svc.PublicCommunityWorks(true)
	if err != nil || len(featured) != 0 {
		t.Fatal("withdrawn work remains public")
	}
	var audit []model.CommunityWorkReview
	if err := f.db.Where("work_id = ?", work.ID).Find(&audit).Error; err != nil || len(audit) != 4 {
		t.Fatalf("missing review audit: %+v %v", audit, err)
	}
}

func TestCommunityWorkCopiesOwnedResourcesAndAssetsWithoutRepeatedFiles(t *testing.T) {
	f := newCommunityFixture(t)
	work := f.publish(t)
	copy, err := f.svc.CopyCommunityWork(context.Background(), f.other, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	copyID := copy.Project["id"].(string)
	if copyID == "source-canvas" || len(copy.Project["nodes"].([]any)) != 2 || len(copy.Project["connections"].([]any)) != 1 {
		t.Fatalf("copy lost editable graph: %#v", copy.Project)
	}
	var resources []model.Resource
	if err := f.db.Where("user_id = ?", f.other.ID).Find(&resources).Error; err != nil || len(resources) != 2 {
		t.Fatalf("copied resources: %+v %v", resources, err)
	}
	for _, resource := range resources {
		if resource.ID == f.media.ID || resource.ID == f.ref.ID || resource.UserID != f.other.ID || resource.Status != model.ResourceStatusReady {
			t.Fatalf("resource belongs to source author: %+v", resource)
		}
		_, body, err := f.svc.OpenResource(f.other.ID, resource.ID)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := io.ReadAll(body)
		_ = body.Close()
		if err != nil || len(actual) != int(resource.Size) || !bytes.HasPrefix(actual, []byte("\x89PNG")) {
			t.Fatalf("copied file invalid: %d %v", len(actual), err)
		}
	}
	raw, err := f.svc.UserCanvasProject(f.other.ID, copyID)
	if err != nil || strings.Contains(string(raw), f.media.ID) || strings.Contains(string(raw), f.ref.ID) || strings.Contains(string(raw), "source-asset") {
		t.Fatalf("copy still refers to another account: %s %v", raw, err)
	}
	if err := f.svc.validateCanvasMediaAssets(f.other.ID, raw); err != nil {
		t.Fatalf("copied canvas cannot save: %v", err)
	}
	if _, err := f.svc.CopyCommunityWork(context.Background(), f.other, work.ID); err != nil {
		t.Fatal(err)
	}
	var resourceCount, assetCount int64
	_ = f.db.Model(&model.Resource{}).Where("user_id = ?", f.other.ID).Count(&resourceCount).Error
	_ = f.db.Model(&model.Asset{}).Where("user_id = ?", f.other.ID).Count(&assetCount).Error
	if resourceCount != 2 || assetCount != 1 {
		t.Fatalf("repeated copy duplicated media/assets: resources=%d assets=%d", resourceCount, assetCount)
	}
	leftovers, err := os.ReadDir(filepath.Join(f.svc.dataDir, "tmp", "community-copy"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("copy left temporary media: %v %v", leftovers, err)
	}
	if _, err := f.svc.WithdrawCommunityWork(f.owner, work.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.CopyCommunityWork(context.Background(), f.other, work.ID)
	requireCommunityError(t, err, 404)
}

func TestCommunityWorkRejectsUnfinishedForeignCanvasAndReadOnlyWrites(t *testing.T) {
	f := newCommunityFixture(t)
	input := f.input
	input.ProjectID = "foreign-canvas"
	if err := f.db.Create(&model.CanvasProject{ID: input.ProjectID, UserID: f.other.ID, PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	_, err := f.svc.SubmitCommunityWork(f.owner, "", input)
	requireCommunityError(t, err, 400)
	if err := f.db.Model(&model.Resource{}).Where("id = ?", f.media.ID).Update("status", model.ResourceStatusPending).Error; err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.SubmitCommunityWork(f.owner, "", f.input)
	requireCommunityError(t, err, 400)
	_ = f.db.Model(&model.Resource{}).Where("id = ?", f.media.ID).Update("status", model.ResourceStatusReady).Error
	work := f.publish(t)
	policy, err := f.svc.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Resource{ID: "over-capacity", UserID: f.other.ID, Provider: "local", ObjectKey: "over", Status: model.ResourceStatusReady, Size: gigabytes(policy.Resource.StoredFileGB) + 1}).Error; err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-8 * 24 * time.Hour)
	if err := f.db.Create(&model.UserStorageState{UserID: f.other.ID, OverLimitSince: &old}).Error; err != nil {
		t.Fatal(err)
	}
	f.svc.invalidateStorageStatus(f.other.ID)
	_, err = f.svc.CopyCommunityWork(context.Background(), f.other, work.ID)
	requireCommunityError(t, err, 403)
	if err := f.db.Model(&model.Resource{}).Where("id = ?", "over-capacity").Update("user_id", f.owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.UserStorageState{UserID: f.owner.ID, OverLimitSince: &old}).Error; err != nil {
		t.Fatal(err)
	}
	f.svc.invalidateStorageStatus(f.owner.ID)
	_, err = f.svc.SubmitCommunityWork(f.owner, work.ID, f.input)
	requireCommunityError(t, err, 403)
	if _, err := f.svc.WithdrawCommunityWork(f.owner, work.ID); err != nil {
		t.Fatalf("read-only account cannot withdraw: %v", err)
	}
}

func TestCommunityWorkResourceReferencesProtectDeletionAndPagination(t *testing.T) {
	f := newCommunityFixture(t)
	work := f.publish(t)
	refs, err := f.svc.repo.CommunityWorkResourceReferences(f.owner.ID, []string{f.media.ID, f.ref.ID})
	if err != nil || len(refs) != 2 || refs[0].ID != work.ID {
		t.Fatalf("publication not protected from resource cleanup: %v %v", refs, err)
	}
	if err := f.db.Where("id = ?", f.ref.ID).Delete(&model.Resource{}).Error; err == nil {
		t.Fatal("database allowed deleting a published resource")
	}
	for index := 0; index < 27; index++ {
		item := model.CommunityWork{ID: kernel.NewID(), UserID: f.owner.ID, Title: "待审作品", Status: model.CommunityWorkPending, TagsJSON: "[]", SnapshotJSON: "{}"}
		if err := f.db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := f.svc.CommunityWorks(f.owner, false, "", 2, 24)
	if err != nil || page.Total != 28 || page.Page != 2 || len(page.Items) != 4 {
		t.Fatalf("own pagination: %+v %v", page, err)
	}
	page, err = f.svc.CommunityWorks(f.other, false, "", 1, 24)
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("author list leaked another account: %+v %v", page, err)
	}
	page, err = f.svc.CommunityWorks(f.admin, true, model.CommunityWorkPending, 2, 24)
	if err != nil || page.Total != 27 || len(page.Items) != 3 {
		t.Fatalf("admin pagination/filter: %+v %v", page, err)
	}
}

func TestCommunityWorkReviewRevalidatesOwnerMediaAndRequiresReapproval(t *testing.T) {
	f := newCommunityFixture(t)
	work, err := f.svc.SubmitCommunityWork(f.owner, "", f.input)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Model(&model.User{}).Where("id = ?", f.owner.ID).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "approve"})
	requireCommunityError(t, err, 409)
	_ = f.db.Model(&model.User{}).Where("id = ?", f.owner.ID).Update("status", model.UserStatusActive).Error
	_ = f.db.Model(&model.Resource{}).Where("id = ?", f.ref.ID).Update("status", model.ResourceStatusFailed).Error
	_, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "approve"})
	requireCommunityError(t, err, 409)
	_ = f.db.Model(&model.Resource{}).Where("id = ?", f.ref.ID).Update("status", model.ResourceStatusReady).Error
	if _, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "approve"}); err != nil {
		t.Fatal(err)
	}
	if _, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "feature"}); err != nil {
		t.Fatal(err)
	}
	input := f.input
	input.Title = "作者修改后的版本"
	updated, err := f.svc.SubmitCommunityWork(f.owner, work.ID, input)
	if err != nil || updated.Status != model.CommunityWorkPending || updated.Featured {
		t.Fatalf("edited publication bypassed review: %+v %v", updated, err)
	}
	_, err = f.svc.CommunityWork(nil, work.ID, true)
	requireCommunityError(t, err, 404)
	_, err = f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "reject"})
	requireCommunityError(t, err, 400)
	rejected, err := f.svc.ReviewCommunityWork(f.admin, work.ID, CommunityWorkReviewInput{Action: "reject", Reason: "请调整成品封面"})
	if err != nil || rejected.Status != model.CommunityWorkRejected || rejected.ReviewReason != "请调整成品封面" {
		t.Fatalf("rejection feedback missing: %+v %v", rejected, err)
	}
	_, err = f.svc.CommunityWork(nil, work.ID, true)
	requireCommunityError(t, err, 404)
}

func TestCommunityWorkRejectsForeignEmbeddedResourceAndSVGResult(t *testing.T) {
	f := newCommunityFixture(t)
	if err := f.db.Model(&model.Resource{}).Where("id = ?", f.ref.ID).Update("user_id", f.other.ID).Error; err != nil {
		t.Fatal(err)
	}
	_, err := f.svc.SubmitCommunityWork(f.owner, "", f.input)
	requireCommunityError(t, err, 400)
	_ = f.db.Model(&model.Resource{}).Where("id = ?", f.ref.ID).Update("user_id", f.owner.ID).Error
	_ = f.db.Model(&model.Resource{}).Where("id = ?", f.media.ID).Update("mime_type", "image/svg+xml").Error
	_, err = f.svc.SubmitCommunityWork(f.owner, "", f.input)
	requireCommunityError(t, err, 400)
}
