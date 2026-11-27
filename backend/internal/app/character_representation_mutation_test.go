package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCharacterOutfitRoleMatchesStorageLimit(t *testing.T) {
	if !validCharacterRepresentationRole("outfit:" + strings.Repeat("a", 25)) {
		t.Fatal("32 字符的合法造型槽位被拒绝")
	}
	for _, role := range []string{"outfit:", "outfit: ", "outfit:" + strings.Repeat("a", 26), "outfit:" + strings.Repeat("a", 32)} {
		if validCharacterRepresentationRole(role) {
			t.Fatalf("不合法或超过数据库字段上限的槽位未被拒绝: %q", role)
		}
	}
}

func TestCharacterDressingPostgresSaveAndReload(t *testing.T) {
	// 复用隔离 schema 与真实业务服务，覆盖 SQLite 不会强制执行的 varchar 长度约束。
	_, db := newProjectNameConflictPostgresService(t)
	svc, db, _, _ := creationTestServiceOnDatabase(t, db)
	baseID, outputID := strings.Repeat("a", 32), strings.Repeat("b", 32)
	for _, id := range []string{baseID, outputID} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	character, err := svc.CreateCharacter("user", CreateCharacterRequest{Name: "人物", ImageResourceID: baseID})
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"source": "character-dressing-table", "dressing": map[string]any{"characterAssetId": character.Asset.ID}}})
	result, _ := json.Marshal(map[string]any{"images": []any{map[string]any{"storageKey": "resource:" + outputID}}})
	if err := db.Create(&model.Task{ID: "source-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(input), ResultJSON: string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	req := ReplaceCharacterRepresentationsRequest{
		ExpectedVersionID: character.Character.VersionID, OperationID: "save-generated-look",
		Definition: map[string]any{"activeOutfitId": outputID, "outfits": []any{
			map[string]any{"id": "default", "name": "默认造型", "resourceId": baseID},
			map[string]any{"id": outputID, "name": "冬装", "resourceId": outputID, "source": map[string]any{"taskId": "source-task"}},
		}},
		Representations: []CharacterRepresentationInput{
			{Role: "primary", ResourceID: outputID},
			{Role: "turnaround_sheet", ResourceID: outputID},
			{Role: "outfit:1", ResourceID: baseID, Metadata: map[string]any{"outfitId": "default"}},
			{Role: "outfit:2", ResourceID: outputID, Metadata: map[string]any{"outfitId": outputID}},
		},
	}
	// 旧客户端的完整资源 ID 拼接应被服务端拒绝，不能进入数据库触发 500。
	req.Representations[3].Role = "outfit:" + outputID
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err == nil {
		t.Fatal("超过 32 字符的造型槽位未被拒绝")
	}
	req.Representations[3].Role = "outfit:2"
	saved, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := svc.Character("user", character.Asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(reloaded.Character.Definition)
	var definition struct {
		ActiveOutfitID string `json:"activeOutfitId"`
		Outfits        []struct {
			Name       string `json:"name"`
			ResourceID string `json:"resourceId"`
		} `json:"outfits"`
	}
	if err := json.Unmarshal(encoded, &definition); err != nil {
		t.Fatal(err)
	}
	if definition.ActiveOutfitID != outputID || len(definition.Outfits) != 2 || definition.Outfits[1].Name != "冬装" || definition.Outfits[1].ResourceID != outputID {
		t.Fatalf("重新读取后造型丢失: %s", encoded)
	}
	retried, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req)
	if err != nil || retried.Character.VersionID != saved.Character.VersionID {
		t.Fatalf("重复保存新增了版本: %v", err)
	}
}

func TestCharacterRepresentationMutationRetryAndConflict(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	for _, id := range []string{"base-image", "new-image"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 10}).Error; err != nil {
			t.Fatal(err)
		}
	}
	initial, err := svc.CreateCharacter("user", CreateCharacterRequest{Name: "人物", ImageResourceID: "base-image"})
	if err != nil {
		t.Fatal(err)
	}
	req := ReplaceCharacterRepresentationsRequest{
		ExpectedVersionID: initial.Character.VersionID, OperationID: "save-look-1",
		Definition:      map[string]any{"outfits": []any{map[string]any{"id": "new-look", "name": "新形象", "resourceId": "new-image"}}},
		Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "new-image"}},
	}
	saved, err := svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req)
	if err != nil || retried.Character.VersionID != saved.Character.VersionID {
		t.Fatalf("retry created another version: %#v, %v", retried, err)
	}
	changed := req
	changed.Definition = map[string]any{"outfits": []any{map[string]any{"id": "new-look", "name": "不同请求", "resourceId": "new-image"}}}
	if _, err := svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, changed); err == nil {
		t.Fatal("reused operation accepted different content")
	}
	req.OperationID = "save-look-2"
	if _, err = svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req); err == nil {
		t.Fatal("stale version accepted")
	}
	if _, err = svc.ReplaceCharacterRepresentations("another-user", initial.Asset.ID, req); err == nil {
		t.Fatal("foreign character accepted")
	}
}

func TestCharacterDressingSourceRequiresMatchingTaskOutput(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.Create(&model.Resource{ID: "image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
		t.Fatal(err)
	}
	character, err := svc.CreateCharacter("user", CreateCharacterRequest{Name: "人物", ImageResourceID: "image"})
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"source": "character-dressing-table", "dressing": map[string]any{"characterAssetId": character.Asset.ID}}})
	if err := db.Create(&model.Task{ID: "source-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(input), ResultJSON: `{"images":[{"storageKey":"resource:other-image"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := ReplaceCharacterRepresentationsRequest{ExpectedVersionID: character.Character.VersionID, OperationID: "forged", Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "image"}}, Definition: map[string]any{"outfits": []any{map[string]any{"id": "look", "name": "形象", "resourceId": "image", "source": map[string]any{"taskId": "source-task"}}}}}
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err == nil {
		t.Fatal("unrelated task output accepted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "source-task").Update("result_json", `{"images":[{"storageKey":"resource:image"}]}`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.Task{}, "id = ?", "source-task").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err != nil {
		t.Fatalf("persisted receipt must survive source cleanup: %v", err)
	}
}
