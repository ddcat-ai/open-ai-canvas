package repository

import (
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ResourceReferenceDocument 是资源删除校验使用的只读业务文档快照。
// repository 只按用户范围读取记录；JSON 中的资源引用合同由 service 统一解释。
type ResourceReferenceDocument struct {
	Kind          string
	ID            string
	Title         string
	PrimaryJSON   string
	SecondaryJSON string
	TaskStatus    model.TaskStatus
}

type ResourceDirectReference struct {
	Kind       string
	ID         string
	Title      string
	ResourceID string
}

type ResourceReferenceSnapshot struct {
	Documents []ResourceReferenceDocument
	Direct    []ResourceDirectReference
}

func (r *Repository) AssetResourceRecords(assetID string) ([]model.AssetVersion, []model.AssetRepresentation, error) {
	return r.AssetsResourceRecords([]string{assetID})
}

func (r *Repository) AssetsResourceRecords(assetIDs []string) ([]model.AssetVersion, []model.AssetRepresentation, error) {
	var versions []model.AssetVersion
	if err := r.db.Where("asset_id IN ?", assetIDs).Find(&versions).Error; err != nil {
		return nil, nil, err
	}
	if len(versions) == 0 {
		return versions, nil, nil
	}
	versionIDs := make([]string, 0, len(versions))
	for _, version := range versions {
		versionIDs = append(versionIDs, version.ID)
	}
	var representations []model.AssetRepresentation
	if err := r.db.Where("asset_version_id IN ?", versionIDs).Find(&representations).Error; err != nil {
		return nil, nil, err
	}
	return versions, representations, nil
}

// OtherAssetResourceReferences 只查询整批删除范围之外的素材，不扫描任务和画布。
func (r *Repository) OtherAssetResourceReferences(userID string, excludedAssetIDs []string) (ResourceReferenceSnapshot, error) {
	snapshot := ResourceReferenceSnapshot{}
	var assets []model.Asset
	if err := r.db.Where("user_id = ? AND id NOT IN ?", userID, excludedAssetIDs).Find(&assets).Error; err != nil {
		return snapshot, err
	}
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.ID)
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "素材", ID: asset.ID, PrimaryJSON: asset.PayloadJSON})
	}
	if len(ids) == 0 {
		return snapshot, nil
	}
	versions, representations, err := r.AssetsResourceRecords(ids)
	if err != nil {
		return snapshot, err
	}
	for _, version := range versions {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "素材", ID: version.ID, PrimaryJSON: version.DefinitionJSON})
	}
	for _, representation := range representations {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "素材", ID: representation.ID, ResourceID: representation.ResourceID})
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "素材", ID: representation.ID, PrimaryJSON: representation.MetadataJSON})
	}
	return snapshot, nil
}

func (r *Repository) ResourcesForUserIDs(userID string, resourceIDs []string) ([]model.Resource, error) {
	if len(resourceIDs) == 0 {
		return []model.Resource{}, nil
	}
	var resources []model.Resource
	err := r.db.Where("user_id = ? AND id IN ?", userID, resourceIDs).Find(&resources).Error
	return resources, err
}

// ResourceStorageReferenceCount 返回未包含在 excludedResourceIDs 中、但指向同一物理对象的资源记录数。
// 这用于兼容历史数据中多个 Resource 行复用一个对象路径的情况。
func (r *Repository) ResourceStorageReferenceCount(resource *model.Resource, excludedResourceIDs []string) (int64, error) {
	if resource == nil {
		return 0, nil
	}
	query := r.db.Model(&model.Resource{}).
		Where("endpoint = ? AND bucket = ? AND object_key = ?", resource.Endpoint, resource.Bucket, resource.ObjectKey)
	if strings.TrimSpace(resource.Provider) == "" || strings.EqualFold(strings.TrimSpace(resource.Provider), "local") {
		query = query.Where("provider IN ?", []string{"", "local"})
	} else {
		query = query.Where("provider = ?", resource.Provider)
	}
	if len(excludedResourceIDs) > 0 {
		query = query.Where("id NOT IN ?", excludedResourceIDs)
	}
	var count int64
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) ResourceReferenceSnapshot(userID string, excludingAssetID string, resourceIDs []string) (ResourceReferenceSnapshot, error) {
	snapshot := ResourceReferenceSnapshot{Documents: []ResourceReferenceDocument{}, Direct: []ResourceDirectReference{}}
	if len(resourceIDs) == 0 {
		return snapshot, nil
	}
	history, err := r.CanvasHistoryResourceReferences(resourceIDs)
	if err != nil {
		return snapshot, err
	}
	snapshot.Direct = append(snapshot.Direct, history...)
	var leases []model.CloudAgentResourceLease
	if err := r.db.Where("user_id = ? AND resource_id IN ? AND expires_at > ?", userID, resourceIDs, time.Now()).Find(&leases).Error; err != nil {
		return snapshot, err
	}
	for _, lease := range leases {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "Agent 待执行引用", ID: lease.OwnerID, Title: "已准备的生成输入", ResourceID: lease.ResourceID})
	}

	var toolRecords []model.Tool
	if err := r.db.Where("owner_id = ?", userID).Find(&toolRecords).Error; err != nil {
		return snapshot, err
	}
	for _, tool := range toolRecords {
		var extra []string
		if tool.ExtraInfoJSON != "" {
			if err := json.Unmarshal([]byte(tool.ExtraInfoJSON), &extra); err != nil {
				return snapshot, err
			}
		}
		payload, err := json.Marshal(map[string]any{"coverUrl": tool.Cover, "url": tool.MediaURL, "referenceUrls": extra})
		if err != nil {
			return snapshot, err
		}
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "工具", ID: strconv.FormatInt(tool.ID, 10), Title: tool.Label, PrimaryJSON: string(payload)})
	}
	var assets []model.Asset
	assetQuery := r.db.Where("user_id = ? AND id <> ?", userID, excludingAssetID)
	if err := assetQuery.Find(&assets).Error; err != nil {
		return snapshot, err
	}
	for _, asset := range assets {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "素材", ID: asset.ID, Title: asset.Title, PrimaryJSON: asset.PayloadJSON})
	}

	var canvases []model.CanvasProject
	if err := r.db.Where("user_id = ?", userID).Find(&canvases).Error; err != nil {
		return snapshot, err
	}
	for _, canvas := range canvases {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "画布", ID: canvas.ID, Title: canvas.Title, PrimaryJSON: canvas.PayloadJSON})
	}

	var tasks []model.Task
	if err := r.db.Select("id", "prompt", "status", "input_json", "result_json").Where("user_id = ?", userID).Find(&tasks).Error; err != nil {
		return snapshot, err
	}
	taskStatuses := make(map[string]model.TaskStatus, len(tasks))
	for _, task := range tasks {
		taskStatuses[task.ID] = task.Status
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "任务", ID: task.ID, Title: task.Prompt, PrimaryJSON: task.InputJSON, SecondaryJSON: task.ResultJSON, TaskStatus: task.Status})
	}

	var runs []model.CreationRun
	if err := r.db.Where("user_id = ?", userID).Find(&runs).Error; err != nil {
		return snapshot, err
	}
	for _, run := range runs {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "创作会话", ID: run.ID, Title: "智能创作", PrimaryJSON: run.StateJSON, SecondaryJSON: run.ApprovedOperationsJSON})
	}
	var submissions []model.CreationSubmission
	if err := r.db.Where("user_id = ? AND revoked_at IS NULL", userID).Find(&submissions).Error; err != nil {
		return snapshot, err
	}
	for _, submission := range submissions {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "创作执行项", ID: submission.ID, Title: submission.ItemKey, PrimaryJSON: submission.RequestJSON})
	}

	var taskLogs []model.TaskLog
	if err := r.db.Select("id", "task_id", "message", "payload").Where("user_id = ?", userID).Find(&taskLogs).Error; err != nil {
		return snapshot, err
	}
	for _, taskLog := range taskLogs {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "任务日志", ID: taskLog.ID, Title: taskLog.Message, PrimaryJSON: taskLog.Payload, TaskStatus: taskStatuses[taskLog.TaskID]})
	}

	var results []model.Result
	if err := r.db.Select("id", "task_id", "kind", "url", "payload").Where("user_id = ?", userID).Find(&results).Error; err != nil {
		return snapshot, err
	}
	for _, result := range results {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "任务结果", ID: result.ID, Title: result.Kind, PrimaryJSON: result.URL, SecondaryJSON: result.Payload, TaskStatus: taskStatuses[result.TaskID]})
	}

	var projects []model.Project
	if err := r.db.Where("user_id = ?", userID).Find(&projects).Error; err != nil {
		return snapshot, err
	}
	for _, project := range projects {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "项目", ID: project.ID, Title: project.Name, PrimaryJSON: project.StyleProfileJSON})
		if project.CoverResourceID != "" && slices.Contains(resourceIDs, project.CoverResourceID) {
			snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "项目主图", ID: project.ID, Title: project.Name, ResourceID: project.CoverResourceID})
		}
	}

	var styles []model.StyleProfile
	if err := r.db.Where("user_id = ?", userID).Find(&styles).Error; err != nil {
		return snapshot, err
	}
	for _, style := range styles {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "风格", ID: style.ID, Title: style.Name, PrimaryJSON: style.CoverURL, SecondaryJSON: style.ProfileJSON})
	}

	type joinedDocument struct {
		ID            string
		Title         string
		PrimaryJSON   string
		SecondaryJSON string
	}
	var versions []joinedDocument
	versionQuery := r.db.Table("asset_versions").
		Select("asset_versions.id, assets.title, asset_versions.definition_json AS primary_json").
		Joins("JOIN assets ON assets.id = asset_versions.asset_id").
		Where("assets.user_id = ? AND assets.id <> ?", userID, excludingAssetID)
	if err := versionQuery.Scan(&versions).Error; err != nil {
		return snapshot, err
	}
	for _, version := range versions {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "素材", ID: version.ID, Title: version.Title, PrimaryJSON: version.PrimaryJSON})
	}

	var candidates []joinedDocument
	candidateQuery := r.db.Table("project_asset_candidates").
		Select("project_asset_candidates.id, projects.name AS title, project_asset_candidates.details_json AS primary_json").
		Joins("JOIN projects ON projects.id = project_asset_candidates.project_id").
		Where("projects.user_id = ?", userID)
	if err := candidateQuery.Scan(&candidates).Error; err != nil {
		return snapshot, err
	}
	for _, candidate := range candidates {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "项目", ID: candidate.ID, Title: candidate.Title, PrimaryJSON: candidate.PrimaryJSON})
	}

	var steps []joinedDocument
	stepQuery := r.db.Table("workflow_step_instances").
		Select("workflow_step_instances.id, workflow_step_instances.name AS title, workflow_step_instances.input_json AS primary_json, workflow_step_instances.output_json AS secondary_json").
		Joins("JOIN workflow_instances ON workflow_instances.id = workflow_step_instances.workflow_instance_id").
		Joins("JOIN projects ON projects.id = workflow_instances.project_id").
		Where("projects.user_id = ?", userID)
	if err := stepQuery.Scan(&steps).Error; err != nil {
		return snapshot, err
	}
	for _, step := range steps {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "工作流", ID: step.ID, Title: step.Title, PrimaryJSON: step.PrimaryJSON, SecondaryJSON: step.SecondaryJSON})
	}

	var shotArtifacts []joinedDocument
	artifactDocumentQuery := r.db.Table("shot_artifacts").
		Select("shot_artifacts.id, shots.title, shot_artifacts.metadata_json AS primary_json").
		Joins("JOIN shots ON shots.id = shot_artifacts.shot_id").
		Joins("JOIN projects ON projects.id = shots.project_id").
		Where("projects.user_id = ?", userID)
	if err := artifactDocumentQuery.Scan(&shotArtifacts).Error; err != nil {
		return snapshot, err
	}
	for _, artifact := range shotArtifacts {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "镜头产物", ID: artifact.ID, Title: artifact.Title, PrimaryJSON: artifact.PrimaryJSON})
	}

	type joinedRepresentation struct {
		ID         string
		Title      string
		ResourceID string
	}
	var representations []joinedRepresentation
	if err := r.db.Table("asset_representations").
		Select("asset_representations.id, assets.title, asset_representations.resource_id").
		Joins("JOIN asset_versions ON asset_versions.id = asset_representations.asset_version_id").
		Joins("JOIN assets ON assets.id = asset_versions.asset_id").
		Where("assets.user_id = ? AND assets.id <> ? AND asset_representations.resource_id IN ?", userID, excludingAssetID, resourceIDs).
		Scan(&representations).Error; err != nil {
		return snapshot, err
	}
	for _, representation := range representations {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "素材", ID: representation.ID, Title: representation.Title, ResourceID: representation.ResourceID})
	}

	var voices []model.VoiceProfile
	if err := r.db.Where("user_id = ? AND sample_resource_id IN ?", userID, resourceIDs).Find(&voices).Error; err != nil {
		return snapshot, err
	}
	for _, voice := range voices {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "声音", ID: voice.ID, Title: voice.Name, ResourceID: voice.SampleResourceID})
	}

	type joinedShotArtifact struct {
		ID         string
		Title      string
		ResourceID string
	}
	var artifacts []joinedShotArtifact
	if err := r.db.Table("shot_artifacts").
		Select("shot_artifacts.id, shots.title, shot_artifacts.resource_id").
		Joins("JOIN shots ON shots.id = shot_artifacts.shot_id").
		Joins("JOIN projects ON projects.id = shots.project_id").
		Where("projects.user_id = ? AND shot_artifacts.resource_id IN ?", userID, resourceIDs).
		Scan(&artifacts).Error; err != nil {
		return snapshot, err
	}
	for _, artifact := range artifacts {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "镜头产物", ID: artifact.ID, Title: artifact.Title, ResourceID: artifact.ResourceID})
	}

	var announcements []model.Announcement
	if err := r.db.Where("created_by = ? AND image_resource_id IN ?", userID, resourceIDs).Find(&announcements).Error; err != nil {
		return snapshot, err
	}
	for _, announcement := range announcements {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "公告", ID: announcement.ID, Title: announcement.Title, ResourceID: announcement.ImageResourceID})
	}

	var announcementDrafts []model.AnnouncementImageDraft
	if err := r.db.Where("user_id = ? AND resource_id IN ?", userID, resourceIDs).Find(&announcementDrafts).Error; err != nil {
		return snapshot, err
	}
	for _, draft := range announcementDrafts {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "公告草稿", ID: draft.ResourceID, ResourceID: draft.ResourceID})
	}
	return snapshot, nil
}

func (r *Repository) AssetBusinessReferences(userID string, assetID string) ([]ResourceDirectReference, error) {
	type projectReference struct {
		ID    string
		Title string
	}
	var projects []projectReference
	if err := r.db.Table("project_asset_links").
		Distinct("projects.id, projects.name AS title").
		Joins("JOIN projects ON projects.id = project_asset_links.project_id").
		Where("projects.user_id = ? AND project_asset_links.asset_id = ?", userID, assetID).
		Scan(&projects).Error; err != nil {
		return nil, err
	}
	var shotProjects []projectReference
	if err := r.db.Table("shot_asset_references").
		Distinct("projects.id, projects.name AS title").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Joins("JOIN projects ON projects.id = shots.project_id").
		Where("projects.user_id = ? AND asset_versions.asset_id = ?", userID, assetID).
		Scan(&shotProjects).Error; err != nil {
		return nil, err
	}
	var candidateProjects []projectReference
	if err := r.db.Table("project_asset_candidates").
		Distinct("projects.id, projects.name AS title").
		Joins("JOIN projects ON projects.id = project_asset_candidates.project_id").
		Where("projects.user_id = ? AND project_asset_candidates.resolved_asset_id = ?", userID, assetID).
		Scan(&candidateProjects).Error; err != nil {
		return nil, err
	}
	result := make([]ResourceDirectReference, 0, len(projects)+len(shotProjects)+len(candidateProjects))
	for _, project := range append(append(projects, shotProjects...), candidateProjects...) {
		result = append(result, ResourceDirectReference{Kind: "项目", ID: project.ID, Title: project.Title})
	}
	return result, nil
}

func (r *Repository) DeleteAssetAndResources(userID string, assetID string, resourceIDs []string, deletionJobs []model.ResourceDeletionJob, deleteReferencedResources bool) error {
	return r.DeleteAssetsAndResources(userID, []string{assetID}, resourceIDs, deletionJobs, deleteReferencedResources)
}

func (r *Repository) DeleteAssetsAndResources(userID string, assetIDs []string, resourceIDs []string, deletionJobs []model.ResourceDeletionJob, deleteReferencedResources bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var ownedAssets []model.Asset
		query := tx.Where("user_id = ? AND id IN ?", userID, assetIDs).Order("id")
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Find(&ownedAssets).Error; err != nil {
			return err
		}
		if len(assetIDs) == 0 || len(ownedAssets) != len(assetIDs) {
			return gorm.ErrRecordNotFound
		}
		if deleteReferencedResources {
			if len(resourceIDs) > 0 {
				// 与历史快照写入串行化，避免清除索引后又插入外键引用。
				if r.Dialect() == "postgres" {
					var resources []model.Resource
					if err := tx.Select("id").Where("id IN ?", resourceIDs).Order("id").Clauses(clause.Locking{Strength: "UPDATE"}).Find(&resources).Error; err != nil {
						return err
					}
				}
				if err := tx.Where("resource_id IN ?", resourceIDs).Delete(&model.CanvasSnapshotResource{}).Error; err != nil {
					return err
				}
			}
		} else {
			if err := New(tx).RequireNoCanvasHistoryReferences(resourceIDs); err != nil {
				return err
			}
		}
		versionIDs := tx.Model(&model.AssetVersion{}).Select("id").Where("asset_id IN ?", assetIDs)
		if err := tx.Where("asset_version_id IN (?)", versionIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("asset_version_id IN (?)", versionIDs).Delete(&model.CharacterVoiceBinding{}).Error; err != nil {
			return err
		}
		if err := tx.Where("asset_version_id IN (?)", versionIDs).Delete(&model.AssetRepresentation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("asset_id IN ?", assetIDs).Delete(&model.ProjectAssetLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resolved_asset_id IN ?", assetIDs).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("asset_id IN ?", assetIDs).Delete(&model.AssetVersion{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.Asset{}, "id IN ? AND user_id = ?", assetIDs, userID).Error; err != nil {
			return err
		}
		if len(deletionJobs) > 0 {
			if err := tx.Create(&deletionJobs).Error; err != nil {
				return err
			}
		}
		if len(resourceIDs) == 0 {
			return nil
		}
		if err := tx.Where("resource_id IN ?", resourceIDs).Delete(&model.ArkPrivateAssetBinding{}).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ? AND id IN ?", userID, resourceIDs).Delete(&model.Resource{}).Error
	})
}
