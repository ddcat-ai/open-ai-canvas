// 画布分享与提示词模板。

package repository

import (
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) CanvasShareForProject(userID string, projectID string) (*model.CanvasShare, error) {
	var share model.CanvasShare
	if err := r.db.First(&share, "user_id = ? AND project_id = ?", userID, projectID).Error; err != nil {
		return nil, err
	}
	return &share, nil
}

func (r *Repository) CanvasShareByTokenHash(tokenHash string) (*model.CanvasShare, error) {
	var share model.CanvasShare
	if err := r.db.First(&share, "token_hash = ? AND enabled = ?", tokenHash, true).Error; err != nil {
		return nil, err
	}
	return &share, nil
}

func (r *Repository) DeleteCanvasShare(userID string, projectID string) error {
	return r.db.Delete(&model.CanvasShare{}, "user_id = ? AND project_id = ?", userID, projectID).Error
}

func (r *Repository) PromptTemplates() ([]model.PromptTemplate, error) {
	var templates []model.PromptTemplate
	err := r.db.Order("operation asc, version desc").Find(&templates).Error
	return templates, err
}

func (r *Repository) PromptTemplate(id string) (*model.PromptTemplate, error) {
	var template model.PromptTemplate
	if err := r.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) ActivePromptTemplate(operation string) (*model.PromptTemplate, error) {
	var template model.PromptTemplate
	if err := r.db.Order("version desc").First(&template, "operation = ? AND enabled = ?", operation, true).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) PromptTemplateCount(operation string) (int64, error) {
	var count int64
	err := r.db.Model(&model.PromptTemplate{}).Where("operation = ?", operation).Count(&count).Error
	return count, err
}

func (r *Repository) NextPromptTemplateVersion(operation string) (int, error) {
	var version int
	err := r.db.Model(&model.PromptTemplate{}).Where("operation = ?", operation).Select("COALESCE(MAX(version), 0)").Scan(&version).Error
	return version + 1, err
}

func (r *Repository) SavePromptTemplate(template *model.PromptTemplate) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if template.Enabled {
			if err := tx.Model(&model.PromptTemplate{}).Where("operation = ? AND id <> ?", template.Operation, template.ID).Update("enabled", false).Error; err != nil {
				return err
			}
		}
		return tx.Save(template).Error
	})
}

func (r *Repository) DeletePromptTemplate(id string) error {
	return r.db.Delete(&model.PromptTemplate{}, "id = ?", id).Error
}

func (r *Repository) UserPromptCustomizations(userID string) ([]model.UserPromptCustomization, error) {
	var customizations []model.UserPromptCustomization
	err := r.db.Where("user_id = ?", userID).Order("operation asc").Find(&customizations).Error
	return customizations, err
}

func (r *Repository) UserPromptCustomization(userID string, operation string) (*model.UserPromptCustomization, error) {
	var customization model.UserPromptCustomization
	if err := r.db.First(&customization, "user_id = ? AND operation = ?", userID, operation).Error; err != nil {
		return nil, err
	}
	return &customization, nil
}

func (r *Repository) SaveUserPromptCustomization(customization *model.UserPromptCustomization) error {
	return r.db.Save(customization).Error
}

func (r *Repository) DeleteUserPromptCustomization(userID string, operation string) error {
	return r.db.Delete(&model.UserPromptCustomization{}, "user_id = ? AND operation = ?", userID, operation).Error
}
