package repository

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// Recover the durable receipt even if the browser left before saving the task ID.
// Direction tasks are always created after their project, so the created_at lower
// bound lets the database skip the owner's older tasks before matching input_json.
func (r *Repository) EcommerceDirectionsTask(userID, projectID string, since time.Time) (*model.Task, error) {
	var tasks []model.Task
	query := r.db.Where("user_id = ? AND type = ?", userID, "canvas_text")
	if !since.IsZero() {
		query = query.Where("created_at >= ?", since.Add(-time.Minute))
	}
	if err := query.Where("input_json LIKE ? AND input_json LIKE ?", `%"stage":"creative-directions"%`, `%"ecommerceProjectId":"`+projectID+`"%`).Order("created_at desc, id desc").Limit(10).Find(&tasks).Error; err != nil {
		return nil, err
	}
	for _, task := range tasks {
		var input struct {
			Metadata struct {
				ProjectID string `json:"ecommerceProjectId"`
				Stage     string `json:"stage"`
				Source    string `json:"source"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Metadata.ProjectID == projectID && input.Metadata.Stage == "creative-directions" && input.Metadata.Source == "ecommerce-agent" {
			return &task, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

var ErrEcommerceProjectSelectionChanged = errors.New("ecommerce project selection changed")

func (r *Repository) CreateEcommerceProject(project *model.EcommerceProject) error {
	return r.db.Create(project).Error
}

func (r *Repository) EcommerceProject(userID, id string) (*model.EcommerceProject, error) {
	var project model.EcommerceProject
	if err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) EcommerceProjects(userID string) ([]model.EcommerceProject, error) {
	projects, _, err := r.EcommerceProjectPage(userID, 1, 100)
	return projects, err
}

func (r *Repository) EcommerceProjectPage(userID string, page, pageSize int) ([]model.EcommerceProject, int64, error) {
	projects := make([]model.EcommerceProject, 0)
	var total int64
	if err := r.db.Model(&model.EcommerceProject{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc, id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&projects).Error
	return projects, total, err
}

// DeleteEcommerceProjects removes only the owner's project records. Referenced
// resources and generation tasks have their own lifecycles and remain intact.
func (r *Repository) DeleteEcommerceProjects(userID string, ids []string, all bool, expectedTotal int64) (int64, error) {
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.EcommerceProject{}).Where("user_id = ?", userID)
		if !all {
			query = query.Where("id IN ?", ids)
		}
		var matchedIDs []string
		if err := query.Pluck("id", &matchedIDs).Error; err != nil {
			return err
		}
		if int64(len(matchedIDs)) != expectedTotal {
			return ErrEcommerceProjectSelectionChanged
		}
		result := tx.Where("user_id = ? AND id IN ?", userID, matchedIDs).Delete(&model.EcommerceProject{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != expectedTotal {
			return ErrEcommerceProjectSelectionChanged
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}
func (r *Repository) SaveEcommerceProject(project *model.EcommerceProject, expectedRevision int64) error {
	result := r.db.Model(&model.EcommerceProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
		Updates(map[string]any{"name": project.Name, "status": project.Status, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "revision": expectedRevision + 1})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	project.Revision = expectedRevision + 1
	return nil
}
