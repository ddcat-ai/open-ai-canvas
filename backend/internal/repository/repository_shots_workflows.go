// 镜头、镜头产物、素材引用与项目工作流。
//
// 镜头与素材引用的变更会使所在单元的工作流步骤失效（invalidateUnitWorkflowTx），
// 保证下游步骤不会基于过期镜头继续生成。

package repository

import (
	"errors"
	"slices"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) ProjectShots(projectID string) ([]model.Shot, error) {
	var shots []model.Shot
	err := r.db.Where("project_id = ?", projectID).Order("unit_id asc, position asc").Find(&shots).Error
	return shots, err
}

func (r *Repository) SaveShot(shot *model.Shot, create bool) error {
	if create {
		return r.db.Create(shot).Error
	}
	return r.db.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
		"unit_id": shot.UnitID, "title": shot.Title, "description": shot.Description, "position": shot.Position,
		"duration_ms": shot.DurationMs, "status": shot.Status, "updated_at": shot.UpdatedAt,
	}).Error
}

// SaveShotWithRevision 原子保存镜头当前值、新版本和下游失效状态。
func (r *Repository) SaveShotWithRevision(shot *model.Shot, revision *model.ShotRevision, create bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if create {
			if err := tx.Create(shot).Error; err != nil {
				return err
			}
		} else {
			result := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
				"unit_id": shot.UnitID, "title": shot.Title, "description": shot.Description, "position": shot.Position,
				"duration_ms": shot.DurationMs, "status": shot.Status, "updated_at": shot.UpdatedAt,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		var currentVersion int
		if err := tx.Model(&model.ShotRevision{}).Where("shot_id = ?", shot.ID).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		revision.Version = currentVersion + 1
		if err := tx.Create(revision).Error; err != nil {
			return err
		}
		shot.CurrentRevisionID = revision.ID
		if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(map[string]any{
			"current_revision_id": revision.ID, "description": shot.Description, "duration_ms": shot.DurationMs,
			"status": shot.Status, "updated_at": shot.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if !create {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": shot.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, shot.ProjectID, shot.UnitID, "storyboard", shot.UpdatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", shot.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": shot.UpdatedAt}).Error
	})
}

func (r *Repository) ReplaceProjectUnitShots(projectID string, unitID string, shots []model.Shot, revisions []model.ShotRevision, references []model.ShotAssetReference, expectedShotIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if expectedShotIDs != nil {
			var currentShotIDs []string
			if err := tx.Model(&model.Shot{}).Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("id asc").Pluck("id", &currentShotIDs).Error; err != nil {
				return err
			}
			expected := append([]string(nil), expectedShotIDs...)
			sort.Strings(expected)
			if !slices.Equal(currentShotIDs, expected) {
				return ErrProjectUnitShotsChanged
			}
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, unitID)
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id IN (?)", projectID, shotIDs).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&shots).Error; err != nil {
			return err
		}
		if len(revisions) > 0 {
			if err := tx.Create(&revisions).Error; err != nil {
				return err
			}
		}
		if len(references) > 0 {
			if err := tx.Create(&references).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, unitID, "storyboard", time.Now()); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ShotForProject(projectID string, shotID string) (*model.Shot, error) {
	var shot model.Shot
	if err := r.db.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
		return nil, err
	}
	return &shot, nil
}

func (r *Repository) ShotRevisionForShot(shotID string, revisionID string) (*model.ShotRevision, error) {
	var revision model.ShotRevision
	if err := r.db.First(&revision, "id = ? AND shot_id = ?", revisionID, shotID).Error; err != nil {
		return nil, err
	}
	return &revision, nil
}

// DeleteProjectShot 原子删除单个镜头的领域关联，并重新压紧同章节镜头顺序。
func (r *Repository) DeleteProjectShot(projectID string, shotID string, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id = ?", shotID).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id = ?", shotID).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND shot_id = ?", projectID, shotID).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND project_id = ?", shotID, projectID).Delete(&model.Shot{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		var remaining []model.Shot
		if err := tx.Select("id", "position").Where("project_id = ? AND unit_id = ?", projectID, shot.UnitID).Order("position asc, created_at asc, id asc").Find(&remaining).Error; err != nil {
			return err
		}
		for position, item := range remaining {
			if item.Position == position {
				continue
			}
			if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", item.ID, projectID).Update("position", position).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) ProjectShotRevisions(projectID string) ([]model.ShotRevision, error) {
	var revisions []model.ShotRevision
	err := r.db.Table("shot_revisions").Select("shot_revisions.*").
		Joins("JOIN shots ON shots.id = shot_revisions.shot_id").
		Where("shots.project_id = ?", projectID).
		Order("shots.unit_id asc, shots.position asc, shot_revisions.version asc").Scan(&revisions).Error
	return revisions, err
}

func (r *Repository) ProjectShotArtifacts(projectID string) ([]model.ShotArtifact, error) {
	var artifacts []model.ShotArtifact
	err := r.db.Where("project_id = ?", projectID).Order("unit_id asc, shot_id asc, type asc, version asc").Find(&artifacts).Error
	return artifacts, err
}

func (r *Repository) CreateShotArtifact(artifact *model.ShotArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var currentVersion int
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		artifact.Version = currentVersion + 1
		if artifact.Selected {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		return tx.Create(artifact).Error
	})
}

func (r *Repository) MarkShotArtifactsStale(shotID string, updatedAt time.Time) error {
	return r.db.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error
}

func (r *Repository) UpsertProductionTaskLink(link *model.ProductionTaskLink) error {
	return r.db.Where("task_id = ? AND shot_id = ? AND artifact_type = ?", link.TaskID, link.ShotID, link.ArtifactType).Assign(map[string]any{
		"project_id": link.ProjectID, "canvas_id": link.CanvasID, "unit_id": link.UnitID, "shot_id": link.ShotID,
		"workflow_step_id": link.WorkflowStepID, "artifact_type": link.ArtifactType, "updated_at": link.UpdatedAt,
	}).FirstOrCreate(link).Error
}

func (r *Repository) UpsertShotAssetReference(reference *model.ShotAssetReference) error {
	result := r.db.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND asset_version_id = ? AND role = ?", reference.ShotID, reference.AssetVersionID, reference.Role).Updates(map[string]any{"status": reference.Status})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(reference).Error
}

func (r *Repository) UpsertShotAssetReferenceAndInvalidate(projectID string, reference *model.ShotAssetReference, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND asset_version_id = ? AND role = ?", reference.ShotID, reference.AssetVersionID, reference.Role).Updates(map[string]any{"status": reference.Status})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			if err := tx.Create(reference).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", reference.ShotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", reference.ShotID, projectID).Error; err != nil {
			return err
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) DeleteShotAssetReferenceAndInvalidate(projectID string, shotID string, referenceID string, updatedAt time.Time) (bool, error) {
	deleted := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND shot_id = ?", referenceID, shotID).Delete(&model.ShotAssetReference{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		deleted = true
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shotID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
	return deleted, err
}

func invalidateUnitWorkflowTx(tx *gorm.DB, projectID string, unitID string, fromStepKey string, updatedAt time.Time) error {
	if strings.TrimSpace(unitID) == "" {
		return nil
	}
	var instances []model.WorkflowInstance
	if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Find(&instances).Error; err != nil {
		return err
	}
	for _, instance := range instances {
		var steps []model.WorkflowStepInstance
		if err := tx.Where("workflow_instance_id = ?", instance.ID).Order("position asc").Find(&steps).Error; err != nil {
			return err
		}
		fromPosition := -1
		for _, step := range steps {
			if step.StepKey == fromStepKey {
				fromPosition = step.Position
				break
			}
		}
		if fromPosition < 0 {
			continue
		}
		for _, step := range steps {
			if step.Position < fromPosition {
				continue
			}
			status := model.WorkflowStepStatusPending
			if step.Position == fromPosition {
				status = model.WorkflowStepStatusRunning
			}
			if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, instance.ID).Updates(map[string]any{
				"status": status, "error": "", "completed_at": nil, "updated_at": updatedAt,
			}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.WorkflowInstance{}).Where("id = ?", instance.ID).Updates(map[string]any{"status": model.WorkflowStatusActive, "revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) ProjectShotAssetReferences(projectID string) ([]model.ShotAssetReference, error) {
	var references []model.ShotAssetReference
	err := r.db.Table("shot_asset_references").Select("shot_asset_references.*").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Where("shots.project_id = ?", projectID).
		Order("shot_asset_references.created_at asc").Scan(&references).Error
	return references, err
}

func (r *Repository) ProjectAssetCandidates(projectID string) ([]model.ProjectAssetCandidate, error) {
	var candidates []model.ProjectAssetCandidate
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&candidates).Error
	return candidates, err
}

func (r *Repository) ProjectAssetCandidate(projectID string, candidateID string) (*model.ProjectAssetCandidate, error) {
	var candidate model.ProjectAssetCandidate
	if err := r.db.First(&candidate, "id = ? AND project_id = ?", candidateID, projectID).Error; err != nil {
		return nil, err
	}
	return &candidate, nil
}

func (r *Repository) CreateProjectAssetCandidates(candidates []model.ProjectAssetCandidate) error {
	if len(candidates) == 0 {
		return nil
	}
	return r.db.Create(&candidates).Error
}

func (r *Repository) CreateProjectAssetCandidate(candidate *model.ProjectAssetCandidate) (bool, error) {
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(candidate)
	return result.RowsAffected == 1, result.Error
}

// ConfirmProjectAssetCandidate 将正式资产身份、首版本、项目引用和候选状态放在同一事务中，避免出现半确认数据。
func (r *Repository) ConfirmProjectAssetCandidate(candidate *model.ProjectAssetCandidate, asset *model.Asset, version *model.AssetVersion, link *model.ProjectAssetLink, createAsset bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if createAsset {
			if err := tx.Create(asset).Error; err != nil {
				return err
			}
			if err := tx.Create(version).Error; err != nil {
				return err
			}
		} else if err := tx.First(&model.Asset{}, "id = ? AND user_id = ?", asset.ID, asset.UserID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND asset_id = ?", link.ProjectID, link.AssetID).FirstOrCreate(link).Error; err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).
			Where("id = ? AND project_id = ? AND status = ?", candidate.ID, candidate.ProjectID, "pending_confirmation").
			Updates(map[string]any{"status": candidate.Status, "resolved_asset_id": candidate.ResolvedAssetID, "updated_at": candidate.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return tx.Model(&model.Project{}).Where("id = ?", candidate.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": candidate.UpdatedAt}).Error
	})
}

func (r *Repository) WorkflowTemplateVersion(templateKey string, version int) (*model.WorkflowTemplateVersion, error) {
	var template model.WorkflowTemplateVersion
	if err := r.db.First(&template, "template_key = ? AND version = ?", templateKey, version).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) CreateWorkflowTemplateVersion(template *model.WorkflowTemplateVersion) error {
	return r.db.Create(template).Error
}

func (r *Repository) ProjectWorkflowInstances(projectID string) ([]model.WorkflowInstance, error) {
	var instances []model.WorkflowInstance
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&instances).Error
	return instances, err
}

func (r *Repository) WorkflowInstanceForScope(projectID string, unitID string, templateVersionID string) (*model.WorkflowInstance, error) {
	var instance model.WorkflowInstance
	if err := r.db.First(&instance, "project_id = ? AND unit_id = ? AND template_version_id = ?", projectID, unitID, templateVersionID).Error; err != nil {
		return nil, err
	}
	return &instance, nil
}

func (r *Repository) WorkflowInstance(id string) (*model.WorkflowInstance, error) {
	var instance model.WorkflowInstance
	if err := r.db.First(&instance, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &instance, nil
}

func (r *Repository) WorkflowSteps(instanceID string) ([]model.WorkflowStepInstance, error) {
	var steps []model.WorkflowStepInstance
	err := r.db.Where("workflow_instance_id = ?", instanceID).Order("position asc").Find(&steps).Error
	return steps, err
}

func (r *Repository) NextWorkflowStep(instanceID string, position int) (*model.WorkflowStepInstance, error) {
	var step model.WorkflowStepInstance
	if err := r.db.Where("workflow_instance_id = ? AND position > ?", instanceID, position).Order("position asc").First(&step).Error; err != nil {
		return nil, err
	}
	return &step, nil
}

func (r *Repository) CreateWorkflowInstance(instance *model.WorkflowInstance, steps []model.WorkflowStepInstance) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(instance).Error; err != nil {
			return err
		}
		if len(steps) == 0 {
			return nil
		}
		return tx.Create(&steps).Error
	})
}

func (r *Repository) WorkflowStepForProject(projectID string, stepID string) (*model.WorkflowStepInstance, error) {
	var step model.WorkflowStepInstance
	err := r.db.Table("workflow_step_instances").Select("workflow_step_instances.*").Joins("JOIN workflow_instances ON workflow_instances.id = workflow_step_instances.workflow_instance_id").Where("workflow_instances.project_id = ? AND workflow_step_instances.id = ?", projectID, stepID).First(&step).Error
	if err != nil {
		return nil, err
	}
	return &step, nil
}

func (r *Repository) UpdateWorkflowStep(step *model.WorkflowStepInstance) error {
	return r.db.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt, "completed_at": step.CompletedAt, "updated_at": step.UpdatedAt}).Error
}

// UpdateWorkflowProgress 原子保存当前步骤、下一步骤和实例状态，确保刷新后流程依赖仍可恢复。
func (r *Repository) UpdateWorkflowProgress(step *model.WorkflowStepInstance, next *model.WorkflowStepInstance, instance *model.WorkflowInstance, projectID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{
			"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt,
			"completed_at": step.CompletedAt, "updated_at": step.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if next != nil {
			if err := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", next.ID, next.WorkflowInstanceID).
				Updates(map[string]any{"status": next.Status, "updated_at": next.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.WorkflowInstance{}).Where("id = ? AND project_id = ?", instance.ID, projectID).
			Updates(map[string]any{"status": instance.Status, "revision": instance.Revision, "updated_at": instance.UpdatedAt}).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": step.UpdatedAt}).Error
	})
}

// RegisterWorkflowTaskOutput 将成功任务、流程步骤和产物表示写入同一事务，重复回填使用任务与用途唯一键幂等。
func (r *Repository) RegisterWorkflowTaskOutput(step *model.WorkflowStepInstance, next *model.WorkflowStepInstance, instance *model.WorkflowInstance, projectID string, link *model.WorkflowStepTask, representation *model.AssetRepresentation, productionLink *model.ProductionTaskLink, artifact *model.ShotArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existingLink model.WorkflowStepTask
		if err := tx.Where("workflow_step_id = ? AND task_id = ?", link.WorkflowStepID, link.TaskID).First(&existingLink).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(link).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if representation != nil {
			var existingRepresentation model.AssetRepresentation
			if err := tx.Where("task_id = ? AND role = ?", representation.TaskID, representation.Role).First(&existingRepresentation).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(representation).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		if productionLink != nil {
			var existingProductionLink model.ProductionTaskLink
			err := tx.Where("task_id = ? AND shot_id = ? AND artifact_type = ?", productionLink.TaskID, productionLink.ShotID, productionLink.ArtifactType).First(&existingProductionLink).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(productionLink).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else if err := tx.Model(&existingProductionLink).Updates(map[string]any{
				"project_id": productionLink.ProjectID, "canvas_id": productionLink.CanvasID, "unit_id": productionLink.UnitID,
				"workflow_step_id": productionLink.WorkflowStepID, "updated_at": productionLink.UpdatedAt,
			}).Error; err != nil {
				return err
			}
		}
		if artifact != nil {
			var existing model.ShotArtifact
			if err := tx.Where("task_id = ? AND shot_id = ? AND type = ?", artifact.TaskID, artifact.ShotID, artifact.Type).First(&existing).Error; err == nil {
				artifact = nil
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if artifact != nil {
			var currentVersion int
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
				return err
			}
			artifact.Version = currentVersion + 1
			if artifact.Selected {
				if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
					return err
				}
			}
			if err := tx.Create(artifact).Error; err != nil {
				return err
			}
		}
		stepResult := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", step.ID, step.WorkflowInstanceID).Updates(map[string]any{
			"status": step.Status, "output_json": step.OutputJSON, "error": step.Error, "started_at": step.StartedAt,
			"completed_at": step.CompletedAt, "updated_at": step.UpdatedAt,
		})
		if stepResult.Error != nil {
			return stepResult.Error
		}
		if stepResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		if next != nil {
			nextResult := tx.Model(&model.WorkflowStepInstance{}).Where("id = ? AND workflow_instance_id = ?", next.ID, next.WorkflowInstanceID).Updates(map[string]any{"status": next.Status, "updated_at": next.UpdatedAt})
			if nextResult.Error != nil {
				return nextResult.Error
			}
			if nextResult.RowsAffected != 1 {
				return gorm.ErrInvalidData
			}
		}
		instanceResult := tx.Model(&model.WorkflowInstance{}).Where("id = ? AND project_id = ?", instance.ID, projectID).Updates(map[string]any{"status": instance.Status, "revision": instance.Revision, "updated_at": instance.UpdatedAt})
		if instanceResult.Error != nil {
			return instanceResult.Error
		}
		if instanceResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		projectResult := tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": step.UpdatedAt})
		if projectResult.Error != nil {
			return projectResult.Error
		}
		if projectResult.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return nil
	})
}
