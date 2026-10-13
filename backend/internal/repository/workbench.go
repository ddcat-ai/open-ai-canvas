package repository

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) WorkbenchTools(kind string, enabledOnly bool) ([]model.WorkbenchTool, error) {
	var items []model.WorkbenchTool
	query := r.db.Model(&model.WorkbenchTool{})
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("kind asc, sort_order asc, name asc, id asc").Find(&items).Error
	return items, err
}

func (r *Repository) WorkbenchTool(id string) (*model.WorkbenchTool, error) {
	var item model.WorkbenchTool
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateWorkbenchTool(item *model.WorkbenchTool) error {
	return r.db.Create(item).Error
}
func (r *Repository) SaveWorkbenchTool(item *model.WorkbenchTool) error { return r.db.Save(item).Error }

func (r *Repository) SaveWorkbenchToolWithPresets(item *model.WorkbenchTool, presets *[]model.WorkbenchPreset, create bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var err error
		if create {
			err = tx.Create(item).Error
		} else {
			err = tx.Save(item).Error
		}
		if err != nil || presets == nil {
			return err
		}
		ids := make([]string, 0, len(*presets))
		for index := range *presets {
			preset := &(*presets)[index]
			ids = append(ids, preset.ID)
			if err := tx.Save(preset).Error; err != nil {
				return err
			}
		}
		// Omitted presets remain available to task history but leave the public catalog.
		query := tx.Model(&model.WorkbenchPreset{}).Where("tool_id = ? AND enabled = ?", item.ID, true)
		if len(ids) > 0 {
			query = query.Where("id NOT IN ?", ids)
		}
		return query.Updates(map[string]any{"enabled": false, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt, "version": gorm.Expr("version + 1")}).Error
	})
}

func (r *Repository) WorkbenchPresets(toolID string, enabledOnly bool) ([]model.WorkbenchPreset, error) {
	var items []model.WorkbenchPreset
	query := r.db.Model(&model.WorkbenchPreset{})
	if toolID != "" {
		query = query.Where("tool_id = ?", toolID)
	}
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("sort_order asc, name asc, id asc").Find(&items).Error
	return items, err
}

func (r *Repository) WorkbenchPreset(id string) (*model.WorkbenchPreset, error) {
	var item model.WorkbenchPreset
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateWorkbenchPreset(item *model.WorkbenchPreset) error {
	return r.db.Create(item).Error
}
func (r *Repository) SaveWorkbenchPreset(item *model.WorkbenchPreset) error {
	return r.db.Save(item).Error
}

func (r *Repository) WorkbenchToolAndPreset(toolID, presetID string, publishedOnly bool) (*model.WorkbenchTool, *model.WorkbenchPreset, error) {
	var tool model.WorkbenchTool
	query := r.db.Where("id = ?", toolID)
	if publishedOnly {
		query = query.Where("enabled = ?", true)
	}
	if err := query.First(&tool).Error; err != nil {
		return nil, nil, err
	}
	if presetID == "" {
		return &tool, nil, nil
	}
	var preset model.WorkbenchPreset
	query = r.db.Where("id = ? AND tool_id = ?", presetID, toolID)
	if publishedOnly {
		query = query.Where("enabled = ?", true)
	}
	if err := query.First(&preset).Error; err != nil {
		return nil, nil, err
	}
	return &tool, &preset, nil
}

func (r *Repository) WorkbenchEnabledPresetsForTools(toolIDs []string) (map[string][]model.WorkbenchPreset, error) {
	result := make(map[string][]model.WorkbenchPreset, len(toolIDs))
	if len(toolIDs) == 0 {
		return result, nil
	}
	var presets []model.WorkbenchPreset
	if err := r.db.Where("tool_id IN ? AND enabled = ?", toolIDs, true).Order("sort_order asc, name asc, id asc").Find(&presets).Error; err != nil {
		return nil, err
	}
	for _, preset := range presets {
		result[preset.ToolID] = append(result[preset.ToolID], preset)
	}
	return result, nil
}

var _ = gorm.ErrRecordNotFound
