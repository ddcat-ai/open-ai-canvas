package repository

import (
	"database/sql"
	"errors"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MCPReadSnapshot keeps installed parameter values and their template's secret
// definitions on the same database snapshot, including on PostgreSQL.
func (r *Repository) MCPReadSnapshot(fn func(*Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(New(tx))
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
}

// LockMCPTemplate must be called inside a transaction before reading a template
// used to save or admit a connection. A no-op write also locks on SQLite.
func (r *Repository) LockMCPTemplate(id string) error {
	result := r.db.Model(&model.MCPServerTemplate{}).Where("id = ?", id).
		UpdateColumn("updated_at", gorm.Expr("updated_at"))
	if result.Error == nil && result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

func (r *Repository) MCPTemplates(publishedOnly bool) ([]model.MCPServerTemplate, error) {
	rows := []model.MCPServerTemplate{}
	q := r.db.Order("created_at ASC, id ASC")
	if publishedOnly {
		q = q.Where("published = ?", true)
	}
	err := q.Find(&rows).Error
	return rows, err
}

func (r *Repository) MCPTemplate(id string) (*model.MCPServerTemplate, error) {
	var row model.MCPServerTemplate
	err := r.db.Where("id = ?", id).First(&row).Error
	return &row, err
}

func (r *Repository) CreateMCPTemplate(row *model.MCPServerTemplate) error {
	return r.db.Create(row).Error
}

func (r *Repository) UpdateMCPTemplate(row *model.MCPServerTemplate) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := New(tx).LockMCPTemplate(row.ID); err != nil {
			return err
		}
		var installed []model.MCPConnection
		if err := tx.Where("template_id = ?", row.ID).Order("user_id, id").Find(&installed).Error; err != nil {
			return err
		}
		result := tx.Model(&model.MCPServerTemplate{}).Where("id = ?", row.ID).
			Updates(map[string]any{"definition": row.Definition, "published": row.Published, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		// A template must never reinterpret an installed secret as public text.
		// Clear values atomically with every edit, along with discovery/grants.
		if err := tx.Model(&model.MCPConnection{}).Where("template_id = ?", row.ID).Updates(map[string]any{
			"enabled": false, "tools_json": "[]", "tools_summary_json": "[]", "allowed_tools_json": "[]", "tool_policies_json": "{}", "last_test_at": nil,
			"parameters_ciphertext": "",
			"revision":              gorm.Expr("revision + 1"), "updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		// Revocation only frees bytes. Atomic negative deltas do not take the
		// user quota advisory lock while the template is locked.
		for _, connection := range installed {
			before := MCPConnectionStorageBytes(&connection)
			connection.ToolsJSON, connection.ToolsSummaryJSON, connection.AllowedToolsJSON, connection.ToolPoliciesJSON, connection.ParametersCiphertext = "[]", "[]", "[]", "{}", ""
			if err := New(tx).adjustMCPStoredBytes(connection.UserID, MCPConnectionStorageBytes(&connection)-before); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) DeleteMCPTemplate(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := New(tx).LockMCPTemplate(id); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.MCPConnection{}).Where("template_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrCreationConflict
		}
		result := tx.Where("id = ?", id).Delete(&model.MCPServerTemplate{})
		if result.Error == nil && result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return result.Error
	})
}

func (r *Repository) MCPConnections(userID string, platformOnly bool) ([]model.MCPConnection, error) {
	rows := []model.MCPConnection{}
	q := r.db.Omit("tools_json").Order("scope ASC, created_at ASC, id ASC")
	if platformOnly {
		q = q.Where("scope = ?", "platform")
	} else {
		q = q.Where("(scope = ? AND user_id = ?) OR (scope = ? AND enabled = ? AND id IN (?))", "user", userID, "platform", true,
			r.db.Model(&model.MCPConnectionGrant{}).Select("connection_id").Where("user_id = ?", userID))
	}
	err := q.Find(&rows).Error
	return rows, err
}

func (r *Repository) MCPConnection(id string) (*model.MCPConnection, error) {
	var row model.MCPConnection
	err := r.db.Where("id = ?", id).First(&row).Error
	return &row, err
}

// Call admission locks Agent run -> MCP quota -> template -> connection.
// Template edits use template -> connection and only decrease storage usage;
// cancellation only needs the Agent row. No lock is held during network IO.
func (r *Repository) LockMCPConnection(id string) error {
	hint, err := r.MCPConnection(id)
	if err != nil {
		return err
	}
	if hint.TemplateID != "" {
		if err := r.LockMCPTemplate(hint.TemplateID); err != nil {
			return err
		}
	}
	result := r.db.Model(&model.MCPConnection{}).Where("id = ?", id).
		UpdateColumn("revision", gorm.Expr("revision"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	row, err := r.MCPConnection(id)
	if err != nil {
		return err
	}
	if row.TemplateID != hint.TemplateID {
		return ErrCreationConflict
	}
	return nil
}

func (r *Repository) LockMCPAgentRun(userID, runID string) (*model.CloudAgentExecution, error) {
	result := r.db.Model(&model.CloudAgentExecution{}).Where("id = ? AND user_id = ?", runID, userID).
		UpdateColumn("revision", gorm.Expr("revision"))
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	var run model.CloudAgentExecution
	if err := r.db.First(&run, "id = ? AND user_id = ?", runID, userID).Error; err != nil {
		return nil, err
	}
	return &run, r.hydrateCloudAgent(&run)
}

func (r *Repository) CreateMCPConnection(row *model.MCPConnection) error {
	if err := r.adjustMCPStoredBytes(row.UserID, MCPConnectionStorageBytes(row)); err != nil {
		return err
	}
	return r.db.Create(row).Error
}

func (r *Repository) UpdateMCPConnection(row *model.MCPConnection, expectedRevision int64) error {
	previous, err := r.MCPConnection(row.ID)
	if err != nil {
		return err
	}
	if previous.Revision != expectedRevision {
		return ErrCreationConflict
	}
	row.Revision = expectedRevision + 1
	row.UpdatedAt = time.Now()
	result := r.db.Model(&model.MCPConnection{}).Where("id = ? AND revision = ?", row.ID, expectedRevision).
		Select("name", "template_id", "transport", "server_url", "parameters_ciphertext", "enabled", "tools_json", "tools_summary_json", "allowed_tools_json", "allowed_user_ids_json", "tool_policies_json", "last_test_at", "revision", "updated_at").Updates(row)
	if result.Error == nil && result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	if result.Error != nil {
		return result.Error
	}
	return r.adjustMCPStoredBytes(row.UserID, MCPConnectionStorageBytes(row)-MCPConnectionStorageBytes(previous))
}

func (r *Repository) DeleteMCPConnection(id, userID, scope string) error {
	row, err := r.MCPConnection(id)
	if err != nil {
		return err
	}
	q := r.db.Where("id = ? AND scope = ?", id, scope)
	if scope == "user" {
		q = q.Where("user_id = ?", userID)
	}
	result := q.Delete(&model.MCPConnection{})
	if result.Error == nil && result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	if result.Error != nil {
		return result.Error
	}
	if err := r.db.Where("connection_id = ?", id).Delete(&model.MCPConnectionGrant{}).Error; err != nil {
		return err
	}
	return r.adjustMCPStoredBytes(row.UserID, -MCPConnectionStorageBytes(row))
}

func (r *Repository) ClaimMCPExecution(row *model.MCPToolExecution) (bool, *model.MCPToolExecution, error) {
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(row)
	if result.Error == nil && result.RowsAffected == 1 {
		if err := r.adjustMCPStoredBytes(row.UserID, mcpExecutionStorageBytes(row)); err != nil {
			return false, nil, err
		}
	}
	if result.Error != nil || result.RowsAffected == 1 {
		return result.RowsAffected == 1, row, result.Error
	}
	var existing model.MCPToolExecution
	err := r.db.Where("id = ? AND user_id = ?", row.ID, row.UserID).First(&existing).Error
	return false, &existing, err
}

func (r *Repository) MCPExecution(id, userID string) (*model.MCPToolExecution, error) {
	var row model.MCPToolExecution
	err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error
	return &row, err
}

func (r *Repository) HasUncertainMCPExecution(userID, runID, fingerprint, exceptID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.MCPToolExecution{}).
		Where("user_id = ? AND run_id = ? AND fingerprint = ? AND id <> ? AND status <> ?", userID, runID, fingerprint, exceptID, "completed").
		Count(&count).Error
	return count > 0, err
}

func (r *Repository) FinishMCPExecution(id, userID, status, resultJSON string) error {
	if len(resultJSON) > MCPResultLimitBytes {
		return errors.New("MCP execution receipt is too large")
	}
	return r.Transaction(func(repo *Repository) error {
		if err := repo.LockMCPQuota(userID); err != nil {
			return err
		}
		row, err := repo.MCPExecution(id, userID)
		if err != nil {
			return err
		}
		before := mcpExecutionStorageBytes(row)
		result := repo.db.Model(&model.MCPToolExecution{}).Where("id = ? AND user_id = ? AND status = ?", id, userID, "running").
			Updates(map[string]any{"status": status, "result_json": resultJSON, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("MCP execution receipt changed")
		}
		row.Status, row.ResultJSON = status, resultJSON
		return repo.adjustMCPStoredBytes(userID, mcpExecutionStorageBytes(row)-before)
	})
}

func (r *Repository) MCPConnectionGrantedTo(connectionID, userID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.MCPConnectionGrant{}).Where("connection_id = ? AND user_id = ?", connectionID, userID).Count(&count).Error
	return count != 0, err
}

func (r *Repository) ReplaceMCPConnectionGrants(connectionID string, userIDs []string) error {
	if err := r.db.Where("connection_id = ?", connectionID).Delete(&model.MCPConnectionGrant{}).Error; err != nil {
		return err
	}
	for _, userID := range userIDs {
		if err := r.db.Create(&model.MCPConnectionGrant{ConnectionID: connectionID, UserID: userID}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) MCPConnectionCount(userID, scope string) (int64, error) {
	q := r.db.Model(&model.MCPConnection{}).Where("scope = ?", scope)
	if scope == "user" {
		q = q.Where("user_id = ?", userID)
	}
	var count int64
	err := q.Count(&count).Error
	return count, err
}

func (r *Repository) LockMCPPlatformQuota() error {
	return r.lockMCPQuotaKey("platform-connections")
}
