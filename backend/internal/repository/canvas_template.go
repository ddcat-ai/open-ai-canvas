package repository

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type CanvasTemplatePage struct {
	Templates []model.CanvasTemplate
	Total     int64
}

func (r *Repository) CanvasTemplatesPage(userID string, page int, pageSize int, queryText string, category string) (CanvasTemplatePage, error) {
	var templates []model.CanvasTemplate
	var total int64
	query := r.db.Model(&model.CanvasTemplate{}).Where("owner_id = ? OR (status = ? AND visibility = ?)", userID, "published", "public")
	queryText = strings.TrimSpace(queryText)
	if queryText != "" {
		like := "%" + queryText + "%"
		query = query.Where("(title LIKE ? OR description LIKE ? OR tags_json LIKE ?)", like, like, like)
	}
	if category = strings.TrimSpace(category); category != "" {
		query = query.Where("category = ?", category)
	}
	if err := query.Count(&total).Error; err != nil {
		return CanvasTemplatePage{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 40
	}
	if pageSize > 100 {
		pageSize = 100
	}
	err := query.Order("updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&templates).Error
	return CanvasTemplatePage{Templates: templates, Total: total}, err
}

func (r *Repository) AdminCanvasTemplatesPage(page int, pageSize int, queryText string, status string) (CanvasTemplatePage, error) {
	var templates []model.CanvasTemplate
	var total int64
	query := r.db.Model(&model.CanvasTemplate{})
	queryText = strings.TrimSpace(queryText)
	if queryText != "" {
		like := "%" + queryText + "%"
		query = query.Where("(title LIKE ? OR description LIKE ? OR tags_json LIKE ?)", like, like, like)
	}
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return CanvasTemplatePage{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 40
	}
	if pageSize > 100 {
		pageSize = 100
	}
	err := query.Order("updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&templates).Error
	return CanvasTemplatePage{Templates: templates, Total: total}, err
}

func (r *Repository) CanvasTemplate(id string) (*model.CanvasTemplate, error) {
	var template model.CanvasTemplate
	if err := r.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) CanvasTemplateVersion(templateID string, version int) (*model.CanvasTemplateVersion, error) {
	var item model.CanvasTemplateVersion
	if err := r.db.First(&item, "template_id = ? AND version = ?", templateID, version).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateCanvasTemplate(template *model.CanvasTemplate, version *model.CanvasTemplateVersion) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(template).Error; err != nil {
			return err
		}
		return tx.Create(version).Error
	})
}

func (r *Repository) CreateCanvasTemplateVersion(template *model.CanvasTemplate, version *model.CanvasTemplateVersion) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		return tx.Model(&model.CanvasTemplate{}).Where("id = ?", template.ID).Updates(map[string]any{
			"current_version": version.Version,
			"updated_at":      time.Now(),
		}).Error
	})
}

func (r *Repository) UpdateCanvasTemplate(template *model.CanvasTemplate, updates map[string]any) error {
	return r.db.Model(&model.CanvasTemplate{}).Where("id = ?", template.ID).Updates(updates).Error
}

func (r *Repository) DeleteCanvasTemplate(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.CanvasTemplateVersion{}, "template_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&model.CanvasTemplate{}, "id = ?", id).Error
	})
}
