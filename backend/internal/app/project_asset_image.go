package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ProjectAssetVisualSummary struct {
	Definition map[string]any `json:"definition"`
	Status     string         `json:"status"`
}

type BindProjectAssetImageRequest struct {
	ResourceID        string `json:"resourceId"`
	ExpectedVersionID string `json:"expectedVersionId"`
}

func projectVisualCategory(category model.AssetCategory) bool {
	return category == model.AssetCategoryEnvironment || category == model.AssetCategoryProp
}

// BindProjectAssetImage validates the project, image and version before promoting a reference.
func (s *Service) BindProjectAssetImage(userID, projectID, assetID string, req BindProjectAssetImageRequest) (ProjectAssetSummary, error) {
	_, err := s.bindProjectAssetImage(userID, projectID, assetID, req, newID())
	if errors.Is(err, repository.ErrProjectAssetVersionChanged) {
		return ProjectAssetSummary{}, BadAuthRequest("资产版本已变化，请刷新后重新绑定图片")
	}
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	return s.projectAssetSummary(userID, projectID, asset)
}

func (s *Service) bindProjectAssetImage(userID, projectID, assetID string, req BindProjectAssetImageRequest, operationID string) (bool, error) {
	if strings.TrimSpace(req.ResourceID) == "" || strings.TrimSpace(req.ExpectedVersionID) == "" {
		return false, BadAuthRequest("图片资源与预期资产版本不能为空")
	}
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return false, err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return false, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, assetID)
	if err != nil {
		return false, err
	}
	if !linked || !projectVisualCategory(asset.Category) || (asset.Kind != "entity" && asset.Kind != "text" && asset.Kind != "image") {
		return false, BadAuthRequest("请选择当前项目的场景或道具图片资产")
	}
	representations, err := s.repo.AssetRepresentationsForTask(operationID)
	if err != nil {
		return false, err
	}
	for _, representation := range representations {
		if representation.Role == "primary" {
			return false, nil
		}
	}
	if asset.PrimaryVersionID != req.ExpectedVersionID {
		return false, repository.ErrProjectAssetVersionChanged
	}
	resource, err := s.repo.ResourceForUser(userID, req.ResourceID)
	if err != nil {
		return false, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady || resource.Width <= 0 || resource.Height <= 0 || !strings.HasPrefix(resource.MimeType, "image/") {
		return false, BadAuthRequest("图片资源未就绪或缺少有效图片尺寸")
	}
	current, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return false, err
	}
	if current.AssetID != asset.ID {
		return false, BadAuthRequest("资产主版本不属于当前资产")
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return false, err
	}
	nextNumber := current.Version + 1
	if len(versions) > 0 {
		nextNumber = versions[0].Version + 1
	}
	now := time.Now()
	version := model.AssetVersion{ID: newID(), AssetID: asset.ID, Version: nextNumber, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: current.DefinitionJSON, Prompt: current.Prompt, Note: current.Note, CreatedAt: now, UpdatedAt: now}
	// 在已有 payload 上更新媒体字段，保留标签、来源及其他非媒体元数据。
	var payload map[string]any
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil || payload == nil {
		return false, BadAuthRequest("资产内容无效")
	}
	payload["kind"], payload["primaryVersionId"], payload["status"] = "image", version.ID, model.AssetVersionStatusConfirmed
	payload["coverUrl"], payload["updatedAt"] = resourceFileURL(resource.ID), now.Format(time.RFC3339Nano)
	payload["data"] = map[string]any{"dataUrl": resourceFileURL(resource.ID), "storageKey": "resource:" + resource.ID, "width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType}
	imageReferences, err := s.repo.ProjectAssetImageReferences(userID, []string{asset.ID})
	if err != nil {
		return false, err
	}
	history := []string{}
	seen := map[string]bool{}
	for _, ref := range imageReferences {
		key := "resource:" + ref.ResourceID
		if !seen[key] {
			history = append(history, key)
			seen[key] = true
		}
	}
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["projectAssetImageHistory"] = history
	payload["metadata"] = metadata
	encoded, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}
	asset.Kind, asset.PayloadJSON, asset.PrimaryVersionID, asset.Status, asset.UpdatedAt = "image", string(encoded), version.ID, model.AssetVersionStatusConfirmed, now
	representation := model.AssetRepresentation{ID: newID(), AssetVersionID: version.ID, TaskID: operationID, ResourceID: resource.ID, MediaType: "image", Role: "primary", MetadataJSON: "{}", CreatedAt: now}
	applied, err := s.repo.CommitProjectAssetImage(projectID, req.ExpectedVersionID, asset, &version, &representation)
	if err != nil {
		// 多实例对同一任务收尾时只允许一个提交；其他实例按重放处理。
		existing, readErr := s.repo.AssetRepresentationsForTask(operationID)
		if readErr == nil {
			for _, item := range existing {
				if item.Role == "primary" {
					return false, nil
				}
			}
		}
	}
	return applied, err
}

// finalizeProjectAssetImageTask runs before task success, including media recovery.
func (s *Service) finalizeProjectAssetImageTask(task model.Task, result map[string]interface{}) (bool, error) {
	if !strings.Contains(task.InputJSON, "project_asset_image") {
		return false, nil
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return false, err
	}
	var input struct {
		Metadata struct {
			Operation string `json:"operation"`
			AssetID   string `json:"projectAssetId"`
			VersionID string `json:"projectAssetVersionId"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return false, err
	}
	if input.Metadata.Operation != "project_asset_image" {
		return false, nil
	}
	if task.ProjectID == "" || input.Metadata.AssetID == "" || input.Metadata.VersionID == "" {
		return false, BadAuthRequest("场景与道具出图任务缺少资产或版本标识")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return false, err
	}
	var output struct {
		Images []struct {
			ResourceID string `json:"resourceId"`
		} `json:"images"`
	}
	if err := json.Unmarshal(encoded, &output); err != nil {
		return false, err
	}
	if len(output.Images) != 1 || output.Images[0].ResourceID == "" {
		return false, BadAuthRequest("资产出图任务必须返回一张已保存图片")
	}
	applied, err := s.bindProjectAssetImage(task.UserID, task.ProjectID, input.Metadata.AssetID, BindProjectAssetImageRequest{ResourceID: output.Images[0].ResourceID, ExpectedVersionID: input.Metadata.VersionID}, task.ID)
	if errors.Is(err, repository.ErrProjectAssetVersionChanged) {
		// 出图期间设定或图片已有新版本：保留任务产物，不覆盖新版本，也不重发收费请求。
		result["projectAssetImageStatus"] = "stale"
		return false, nil
	}
	if err == nil {
		result["projectAssetImageStatus"] = "bound"
	}
	return applied, err
}
