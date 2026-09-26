package repository

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/tools"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FirstAdminUserID 返回最早创建的管理员 ID，用于内置工具归属；尚无管理员时返回空串。
func (r *Repository) FirstAdminUserID() (string, error) {
	var user model.User
	err := r.db.Where("role = ?", model.UserRoleAdmin).Order("created_at asc").First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return user.ID, nil
}

// UpsertBuiltinTools 按 id 幂等更新内置工具；created_at 保留首次写入值。
func (r *Repository) UpsertBuiltinTools(tools []model.Tool) error {
	if len(tools) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		ids := make([]int64, 0, len(tools))
		for _, tool := range tools {
			ids = append(ids, tool.ID)
		}
		var collisions int64
		if err := tx.Model(&model.Tool{}).Where("id IN ? AND source <> ?", ids, "builtin").Count(&collisions).Error; err != nil {
			return err
		}
		if collisions > 0 {
			return errors.New("内置工具 ID 与用户工具冲突，拒绝覆盖")
		}
		result := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "id"}},
			Where:   clause.Where{Exprs: []clause.Expression{clause.Eq{Column: clause.Column{Table: "tools", Name: "source"}, Value: "builtin"}}},
			DoUpdates: clause.AssignmentColumns([]string{
				"type", "label_en", "label", "desc", "tag", "cover", "extra_info_json", "prompt", "ratio",
				"media_url", "owner_id", "source", "enabled", "visibility", "sort_weight", "updated_at",
			}),
		}).Create(&tools)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != int64(len(tools)) {
			return errors.New("内置工具写入遇到 ID 冲突，已回滚")
		}
		// 内置工具显式写入自增主键，PostgreSQL 的序列不会自动前移；这里同步到当前最大值，
		// 避免用户自建工具从 1 重新分配而与内置工具主键冲突。
		if r.Dialect() != "postgres" {
			return nil
		}
		return tx.Exec("SELECT setval(pg_get_serial_sequence('tools', 'id'), (SELECT COALESCE(MAX(id), 1) FROM tools), true)").Error
	})
}

// ListTools 按范围查询工具列表并携带当前用户收藏状态。
func (r *Repository) ListTools(userID string, req tools.ToolListRequest) ([]tools.ToolWithFavorite, int64, error) {
	base := r.db.Table("tools").Where("enabled = ? AND (tools.visibility = ? OR tools.owner_id = ?)", true, tools.ToolVisibilityPublic, userID)
	switch req.Scope {
	case tools.ToolScopeFavorites:
		base = base.Joins("JOIN tool_favorites tf ON tf.tool_id = tools.id AND tf.user_id = ?", userID)
	default: // public / custom
		base = base.Joins("LEFT JOIN tool_favorites tf ON tf.tool_id = tools.id AND tf.user_id = ?", userID)
	}

	// 可见性：公共 scope 只看 public（含他人公开），其余 scope 只看自己可见的
	switch req.Scope {
	case tools.ToolScopePublic:
		base = base.Where("tools.visibility = ?", tools.ToolVisibilityPublic)
	case tools.ToolScopeFavorites:
		base = base.Where("tf.user_id = ?", userID)
	case tools.ToolScopeCustom:
		base = base.Where("tools.owner_id = ? AND tools.source = ?", userID, tools.ToolSourceUser)
	}

	if req.Type != "" {
		base = base.Where("tools.type = ?", req.Type)
	}
	if req.Tag != "" {
		base = base.Where("tools.tag = ?", req.Tag)
	}
	if req.Search != "" {
		keyword := "%" + strings.ToLower(req.Search) + "%"
		base = base.Where("(LOWER(tools.label) LIKE ? OR LOWER(tools.label_en) LIKE ? OR LOWER(tools.desc) LIKE ?)", keyword, keyword, keyword)
	}

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	orderBy := "tools.sort_weight ASC, tools.id ASC"
	switch req.Scope {
	case tools.ToolScopeFavorites:
		orderBy = "tf.created_at DESC, tools.id DESC"
	}

	offset := (req.Page - 1) * req.PageSize
	var rows []struct {
		model.Tool
		TFID        *int64     `gorm:"column:tf_id"`
		TFCreatedAt *time.Time `gorm:"column:tf_created_at"`
	}
	// 列表只取摘要字段，不取 extra_info_json、prompt 两个大字段；列与 tools.ToolSummary 对齐。
	selectColumns := "tools.id, tools.type, tools.label_en, tools.label, tools.desc, tools.tag, tools.cover, " +
		"tools.ratio, tools.media_url, tools.owner_id, tools.source, tools.enabled, tools.visibility, " +
		"tools.sort_weight, tools.created_at, tools.updated_at, tf.id AS tf_id, tf.created_at AS tf_created_at"
	err := base.Session(&gorm.Session{}).
		Select(selectColumns).
		Order(orderBy).
		Offset(offset).
		Limit(req.PageSize).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}

	items := make([]tools.ToolWithFavorite, 0, len(rows))
	for _, row := range rows {
		items = append(items, tools.ToolWithFavorite{
			Tool:        row.Tool,
			Favorited:   row.TFID != nil,
			FavoritedAt: row.TFCreatedAt,
		})
	}
	return items, total, nil
}

// ToolForUser 校验可见性后返回工具。
func (r *Repository) ToolForUser(userID string, toolID int64) (model.Tool, error) {
	var tool model.Tool
	err := r.db.Where("id = ? AND enabled = ? AND (visibility = ? OR owner_id = ?)", toolID, true, tools.ToolVisibilityPublic, userID).
		First(&tool).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tool, kernel.NotFound("工具不存在或不可见")
	}
	if err != nil {
		return tool, err
	}
	return tool, nil
}

// ToolFavorited 返回工具及收藏时间（未收藏时为 nil）。
func (r *Repository) ToolFavorited(userID string, toolID int64) (model.Tool, *time.Time, error) {
	tool, err := r.ToolForUser(userID, toolID)
	if err != nil {
		return tool, nil, err
	}
	var favorite model.ToolFavorite
	err = r.db.Where("user_id = ? AND tool_id = ?", userID, toolID).First(&favorite).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tool, nil, nil
	}
	if err != nil {
		return tool, nil, err
	}
	return tool, &favorite.CreatedAt, nil
}

// AddToolFavorite 幂等添加收藏；已收藏时直接成功。
func (r *Repository) AddToolFavorite(userID string, toolID int64) error {
	favorite := model.ToolFavorite{UserID: userID, ToolID: toolID, CreatedAt: time.Now()}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "tool_id"}},
		DoNothing: true,
	}).Create(&favorite).Error
}

// RemoveToolFavorite 取消收藏；未收藏时也无错误。
func (r *Repository) RemoveToolFavorite(userID string, toolID int64) error {
	return r.db.Where("user_id = ? AND tool_id = ?", userID, toolID).
		Delete(&model.ToolFavorite{}).Error
}

// CreateTool 创建用户自定义工具。
func (r *Repository) CreateTool(tool *model.Tool) (*model.Tool, error) {
	if err := r.db.Create(tool).Error; err != nil {
		return nil, err
	}
	return tool, nil
}

// DeleteUserTool 仅允许删除自己的自定义工具；事务内同步清理收藏记录。
func (r *Repository) DeleteUserTool(userID string, toolID int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var tool model.Tool
		err := tx.Where("id = ? AND owner_id = ? AND source = ?", toolID, userID, tools.ToolSourceUser).
			First(&tool).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("工具不存在或不支持删除")
		}
		if err != nil {
			return err
		}
		if err := tx.Where("tool_id = ?", toolID).Delete(&model.ToolFavorite{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Tool{}, toolID).Error
	})
}

// AdminListTools 后台分页查询全部工具（含禁用、私有），不受用户可见性约束。
func (r *Repository) AdminListTools(req tools.AdminToolListRequest) ([]model.Tool, int64, error) {
	base := r.db.Table("tools")
	if req.Type != "" {
		base = base.Where("tools.type = ?", req.Type)
	}
	if req.Source != "" {
		base = base.Where("tools.source = ?", req.Source)
	}
	if req.Enabled != nil {
		base = base.Where("tools.enabled = ?", *req.Enabled)
	}
	if req.Search != "" {
		keyword := "%" + strings.ToLower(req.Search) + "%"
		base = base.Where("(LOWER(tools.label) LIKE ? OR LOWER(tools.label_en) LIKE ? OR LOWER(tools.desc) LIKE ?)", keyword, keyword, keyword)
	}

	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 列表只取摘要字段，不取 extra_info_json、prompt 两个大字段；列与 tools.ToolSummary 对齐。
	selectColumns := "tools.id, tools.type, tools.label_en, tools.label, tools.desc, tools.tag, tools.cover, " +
		"tools.ratio, tools.media_url, tools.owner_id, tools.source, tools.enabled, tools.visibility, " +
		"tools.sort_weight, tools.created_at, tools.updated_at"
	offset := (req.Page - 1) * req.PageSize
	var items []model.Tool
	err := base.Session(&gorm.Session{}).
		Select(selectColumns).
		Order("tools.sort_weight ASC, tools.id ASC").
		Offset(offset).
		Limit(req.PageSize).
		Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// AdminTool 后台按 ID 获取工具，不做可见性/启用过滤。
func (r *Repository) AdminTool(toolID int64) (model.Tool, error) {
	var tool model.Tool
	err := r.db.First(&tool, toolID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tool, kernel.NotFound("工具不存在")
	}
	if err != nil {
		return tool, err
	}
	return tool, nil
}

// AdminUpdateTool 后台更新工具的启用状态、可见性与排序权重。
func (r *Repository) AdminUpdateTool(tool *model.Tool) (*model.Tool, error) {
	err := r.db.Model(&model.Tool{}).Where("id = ?", tool.ID).
		Select("enabled", "visibility", "sort_weight", "updated_at").
		Updates(tool).Error
	if err != nil {
		return nil, err
	}
	var updated model.Tool
	if err := r.db.First(&updated, tool.ID).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

// AdminUpdateToolFull 后台完整更新工具业务字段；来源与所属人随请求调整，英文标识保留原值。
func (r *Repository) AdminUpdateToolFull(tool *model.Tool) (*model.Tool, error) {
	err := r.db.Model(&model.Tool{}).Where("id = ?", tool.ID).
		Select("type", "label", "desc", "tag", "cover", "extra_info_json", "prompt", "ratio",
			"media_url", "owner_id", "source", "visibility", "enabled", "sort_weight", "updated_at").
		Updates(tool).Error
	if err != nil {
		return nil, err
	}
	var updated model.Tool
	if err := r.db.First(&updated, tool.ID).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

// AdminDeleteTool 后台删除工具（调用方需保证非内置），事务内同步清理收藏记录。
func (r *Repository) AdminDeleteTool(toolID int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tool_id = ?", toolID).Delete(&model.ToolFavorite{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&model.Tool{}, toolID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return kernel.NotFound("工具不存在")
		}
		return nil
	})
}
