package database

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type workspaceAssetV107 struct {
	ID, TeamID, PublishedBy, Title, Kind, Status, CurrentVersionID string
	CreatedAt, UpdatedAt                                           time.Time
}

type workspaceVersionV107 struct {
	ID, TeamID, AssetID, Title, Kind, TextContent, ResourceID string
	Version                                                   int
	CreatedAt                                                 time.Time
}

type workspaceBindingV107 struct{ HolderType, HolderID, BindingID, AssetID, VersionID, TeamID string }

func migrateSharedWorkspaceContent(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.Task{}, &model.Asset{}); err != nil {
		return err
	}
	if !tx.Migrator().HasTable("team_canvases") {
		return nil
	}
	var pending int64
	if err := tx.Model(&model.TeamAssetPublication{}).Where("status = ?", model.TeamAssetPending).Count(&pending).Error; err != nil {
		return err
	}
	if pending != 0 {
		return fmt.Errorf("仍有 %d 项素材发布未结束，请在旧版完成或处理超时发布后升级", pending)
	}
	versions := map[string]workspaceVersionV107{}
	var assets []workspaceAssetV107
	if err := tx.Table("team_assets").Find(&assets).Error; err != nil {
		return err
	}
	for _, asset := range assets {
		if err := migrateWorkspaceAsset(tx, asset, versions); err != nil {
			return fmt.Errorf("迁移素材 %s: %w", asset.ID, err)
		}
	}
	var counts struct{ Versions, Resources int64 }
	if err := tx.Raw(`SELECT (SELECT COUNT(*) FROM team_asset_versions) AS versions, (SELECT COUNT(*) FROM team_asset_resources) AS resources`).Scan(&counts).Error; err != nil {
		return err
	}
	var mediaCount int64
	for _, version := range versions {
		if version.ResourceID != "" {
			mediaCount++
		}
	}
	if int64(len(versions)) != counts.Versions || mediaCount != counts.Resources {
		return errors.New("存在未关联素材的旧版本或媒体，已停止升级")
	}
	var bindings []workspaceBindingV107
	if err := tx.Table("team_asset_references").Find(&bindings).Error; err != nil {
		return err
	}
	byHolder := map[string][]workspaceBindingV107{}
	for _, ref := range bindings {
		version, ok := versions[ref.VersionID]
		if !ok || version.TeamID != ref.TeamID || version.AssetID != ref.AssetID {
			return fmt.Errorf("素材绑定 %s 的所属空间或版本不一致", ref.BindingID)
		}
		byHolder[ref.HolderID] = append(byHolder[ref.HolderID], ref)
	}
	if err := migrateWorkspaceCanvases(tx, versions, byHolder); err != nil {
		return err
	}
	if err := migrateWorkspaceTasks(tx, byHolder); err != nil {
		return err
	}
	if len(byHolder) != 0 {
		return errors.New("有素材引用未迁入画布或任务，已停止升级")
	}
	return tx.Migrator().DropTable("team_asset_references", "team_canvases", "team_text_generations", "team_asset_resources", "team_asset_versions", "team_assets")
}

func migrateWorkspaceAsset(tx *gorm.DB, old workspaceAssetV107, versions map[string]workspaceVersionV107) error {
	status := model.AssetVersionStatusConfirmed
	switch old.Status {
	case "ready", "active":
	case "archived":
		status = model.AssetVersionStatusArchived
	default:
		return fmt.Errorf("状态 %q 未完成，请先在旧版处理", old.Status)
	}
	item := model.Asset{ID: old.ID, UserID: model.TeamContentKey(old.TeamID), CreatedBy: old.PublishedBy, Title: old.Title, Kind: old.Kind, PrimaryVersionID: old.CurrentVersionID, Status: status, Category: model.AssetCategoryMaterial, CreatedAt: old.CreatedAt, UpdatedAt: old.UpdatedAt}
	var rows []workspaceVersionV107
	if err := tx.Table("team_asset_versions").Where("team_id = ? AND asset_id = ?", old.TeamID, old.ID).Order("version").Find(&rows).Error; err != nil {
		return err
	}
	for _, version := range rows {
		data := map[string]any{"content": version.TextContent}
		if version.Kind != "text" {
			var source struct {
				ID, ObjectKey, MimeType string
				Size                    int64
				Width, Height           int
				DurationMs              int64
				CreatedAt               time.Time
			}
			if err := tx.Table("team_asset_resources").Where("id = ? AND team_id = ? AND version_id = ? AND asset_id = ?", version.ResourceID, old.TeamID, version.ID, old.ID).Take(&source).Error; err != nil {
				return err
			}
			key, err := adoptWorkspaceMedia(source.ObjectKey, source.ID, source.Size)
			if err != nil {
				return err
			}
			resource := model.Resource{ID: source.ID, UserID: item.UserID, Kind: version.Kind, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: key, MimeType: source.MimeType, Size: source.Size, Width: source.Width, Height: source.Height, DurationMs: source.DurationMs, CreatedAt: source.CreatedAt, UpdatedAt: source.CreatedAt}
			if err := tx.Create(&resource).Error; err != nil {
				return err
			}
			data = map[string]any{"storageKey": "resource:" + source.ID, "bytes": source.Size, "width": source.Width, "height": source.Height, "durationMs": source.DurationMs, "mimeType": source.MimeType}
			key = "url"
			if version.Kind == "image" {
				key = "dataUrl"
			}
			data[key] = workspaceMediaURL(old.TeamID, source.ID)
		}
		payload := map[string]any{"id": old.ID, "title": version.Title, "kind": version.Kind, "primaryVersionId": version.ID, "category": item.Category, "status": status, "tags": []string{}, "data": data, "createdAt": old.CreatedAt, "updatedAt": version.CreatedAt, "coverUrl": ""}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if err := tx.Create(&model.AssetVersion{ID: version.ID, AssetID: old.ID, Version: version.Version, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: string(encoded), CreatedAt: version.CreatedAt, UpdatedAt: version.CreatedAt}).Error; err != nil {
			return err
		}
		if version.ID == old.CurrentVersionID {
			payload["title"], payload["updatedAt"] = old.Title, old.UpdatedAt
			encoded, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			item.PayloadJSON = string(encoded)
		}
		versions[version.ID] = version
	}
	if item.PayloadJSON == "" {
		return errors.New("主版本不存在")
	}
	return tx.Create(&item).Error
}

func workspaceMediaURL(teamID, resourceID string) string {
	return "/api/teams/" + url.PathEscape(teamID) + "/workspace/resources/" + url.PathEscape(resourceID) + "/file"
}

func adoptWorkspaceMedia(key, id string, size int64) (string, error) {
	dataDir := os.Getenv("CANVAS_BACKEND_DATA_DIR")
	if dataDir == "" || !filepath.IsLocal(key) || !filepath.IsLocal(id) || filepath.Base(id) != id {
		return "", errors.New("迁移旧媒体须指定 CANVAS_BACKEND_DATA_DIR 和有效对象键")
	}
	root, err := os.OpenRoot(dataDir)
	if err != nil {
		return "", err
	}
	defer root.Close()
	original := filepath.Join("team-assets", key)
	info, err := root.Lstat(original)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() != size {
		return "", fmt.Errorf("旧媒体 %s 的类型或长度不一致", id)
	}
	const folder = "workspace-import"
	if err := root.MkdirAll(filepath.Join("resources", folder), 0700); err != nil {
		return "", err
	}
	objectKey := filepath.Join(folder, id+filepath.Ext(key))
	target := filepath.Join("resources", objectKey)
	if err := root.Link(original, target); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		existing, err := root.Lstat(target)
		if err != nil {
			return "", err
		}
		if !os.SameFile(info, existing) {
			return "", fmt.Errorf("媒体 %s 的目标文件已被占用", id)
		}
	}
	return filepath.ToSlash(objectKey), nil
}

func migrateWorkspaceCanvases(tx *gorm.DB, versions map[string]workspaceVersionV107, bindings map[string][]workspaceBindingV107) error {
	var rows []struct {
		ID, TeamID, Title, Nodes string
		Revision                 int64
		CreatedAt, UpdatedAt     time.Time
	}
	if err := tx.Table("team_canvases").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var old []struct {
			ID, Text, AssetID, VersionID string
			X, Y                         float64
		}
		if err := json.Unmarshal([]byte(row.Nodes), &old); err != nil {
			return fmt.Errorf("画布 %s: %w", row.ID, err)
		}
		nodes := make([]map[string]any, 0, len(old))
		bound := map[string]string{}
		for _, node := range old {
			kind, title := "text", "文本"
			metadata := map[string]any{"content": node.Text}
			if node.AssetID != "" || node.VersionID != "" {
				version, ok := versions[node.VersionID]
				if !ok || version.TeamID != row.TeamID || version.AssetID != node.AssetID {
					return fmt.Errorf("画布 %s 节点 %s 素材版本不一致", row.ID, node.ID)
				}
				bound[node.ID] = version.ID
				kind, title = version.Kind, version.Title
				metadata["assetId"], metadata["assetVersionId"] = version.AssetID, version.ID
				if node.Text != "" {
					metadata["prompt"] = node.Text
				}
				if version.ResourceID == "" {
					metadata["content"] = version.TextContent
				} else {
					metadata["content"], metadata["storageKey"] = workspaceMediaURL(row.TeamID, version.ResourceID), "resource:"+version.ResourceID
				}
			}
			nodes = append(nodes, map[string]any{"id": node.ID, "type": kind, "title": title, "position": map[string]float64{"x": node.X, "y": node.Y}, "width": 320, "height": 200, "metadata": metadata})
		}
		for _, ref := range bindings[row.ID] {
			if bound[ref.BindingID] != ref.VersionID || row.TeamID != ref.TeamID {
				return fmt.Errorf("画布 %s 的素材绑定 %s 无法还原", row.ID, ref.BindingID)
			}
		}
		delete(bindings, row.ID)
		payload, err := json.Marshal(map[string]any{"id": row.ID, "title": row.Title, "revision": row.Revision, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt, "nodes": nodes, "connections": []any{}, "viewport": map[string]int{"x": 0, "y": 0, "k": 1}, "backgroundMode": "dots", "showImageInfo": true, "chatSessions": []any{}, "activeChatId": nil, "previsScenes": []any{}})
		if err != nil {
			return err
		}
		if err := tx.Create(&model.CanvasProject{ID: row.ID, UserID: model.TeamContentKey(row.TeamID), Title: row.Title, Revision: row.Revision, PayloadJSON: string(payload), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}).Error; err != nil {
			return err
		}
	}
	return nil
}

func migrateWorkspaceTasks(tx *gorm.DB, bindings map[string][]workspaceBindingV107) error {
	var rows []struct {
		ID, TeamID, UserID, MembershipID, CanvasID, BillingOrderID, ChannelID, Model, Prompt, InputSnapshot, Status, ResultText, ResultAssetID, Error, IdempotencyKey, RequestHash string
		MaxOutputTokens                                                                                                                                                            int
		MaxChargeMicrocredits                                                                                                                                                      int64
		CreatedAt, UpdatedAt                                                                                                                                                       time.Time
	}
	if err := tx.Table("team_text_generations").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var order model.BillingOrder
		if err := tx.Where("id = ? AND team_id = ? AND membership_id = ? AND user_id = ?", row.BillingOrderID, row.TeamID, row.MembershipID, row.UserID).Take(&order).Error; err != nil {
			return fmt.Errorf("生成 %s 的原订单归属不一致: %w", row.ID, err)
		}
		status := model.TaskStatus(row.Status)
		if !(status == model.TaskStatusSucceeded && order.Status == model.BillingStatusSettled || (status == model.TaskStatusFailed || status == model.TaskStatusCancelled) && order.Status == model.BillingStatusRefunded) {
			return fmt.Errorf("生成 %s（%s/%s）尚未对账；请在旧版本核对订单，不要重新提交", row.ID, row.Status, order.Status)
		}
		if order.TaskID != "" && order.TaskID != row.ID {
			return fmt.Errorf("生成 %s 的账单已关联其他任务", row.ID)
		}
		refs := []map[string]string{}
		for _, ref := range bindings[row.ID] {
			if ref.TeamID != row.TeamID {
				return fmt.Errorf("生成 %s 的引用空间不一致", row.ID)
			}
			refs = append(refs, map[string]string{"assetId": ref.AssetID, "versionId": ref.VersionID, "bindingId": ref.BindingID})
		}
		delete(bindings, row.ID)
		input, err := json.Marshal(map[string]any{"mode": "text", "prompt": row.Prompt, "config": map[string]string{"channelId": row.ChannelID, "model": row.Model}, "maxOutputTokens": row.MaxOutputTokens, "inputSnapshot": row.InputSnapshot, "assetReferences": refs, "idempotencyKey": row.IdempotencyKey})
		if err != nil {
			return err
		}
		output, err := json.Marshal(map[string]string{"mode": "text", "text": row.ResultText, "assetId": row.ResultAssetID})
		if err != nil {
			return err
		}
		task := model.Task{ID: row.ID, UserID: model.TeamContentKey(row.TeamID), ProjectID: row.CanvasID, BillingOrderID: order.ID, Type: "canvas_text", Operation: "text", Model: row.Model, Prompt: row.Prompt, Status: status, Stage: string(status), SubmissionHash: row.RequestHash, AuthorizedChargeMicrocredits: row.MaxChargeMicrocredits, InputJSON: string(input), ResultJSON: string(output), Error: row.Error, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, CompletedAt: &row.UpdatedAt}
		if status == model.TaskStatusSucceeded {
			task.Progress = 100
		}
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		if strings.TrimSpace(order.TaskID) == "" {
			if err := tx.Model(&order).UpdateColumn("task_id", task.ID).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
