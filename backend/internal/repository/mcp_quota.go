package repository

import (
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MCPStorageLimitBytes int64 = 64 << 20
const MCPResultLimitBytes = 48 << 10

var ErrMCPStorageQuota = errors.New("MCP 配置和调用记录已达到账号存储上限，请清理记录或减少连接")

func (r *Repository) lockMCPQuotaKey(key string) error {
	switch r.Dialect() {
	case "postgres":
		return r.db.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "mcp-quota:"+key).Error
	case "sqlite":
		return r.db.Exec("UPDATE mcp_storage_usages SET bytes = bytes WHERE 1 = 0").Error
	default:
		return gorm.ErrInvalidData
	}
}

// Call only within a transaction, before template/connection row locks. The
// first mutation accounts for legacy data; subsequent mutations use deltas.
func (r *Repository) LockMCPQuota(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return gorm.ErrInvalidData
	}
	if err := r.lockMCPQuotaKey("user:" + userID); err != nil {
		return err
	}
	var usage model.MCPStorageUsage
	err := r.db.First(&usage, "user_id = ?", userID).Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	bytes, err := r.mcpMeasuredBytes(userID)
	if err != nil {
		return err
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.MCPStorageUsage{UserID: userID, Bytes: bytes}).Error
}

func MCPConnectionStorageBytes(row *model.MCPConnection) int64 {
	overhead := 1024
	if row.Scope == "platform" {
		// Includes a bounded grant table (at most 100 IDs per connection).
		overhead = 32 << 10
	}
	return int64(overhead + len(row.ParametersCiphertext) + len(row.ToolsJSON) + len(row.ToolsSummaryJSON) + len(row.AllowedToolsJSON) + len(row.AllowedUserIDsJSON) + len(row.ToolPoliciesJSON) + len(row.Name) + len(row.ServerURL))
}

func mcpExecutionStorageBytes(row *model.MCPToolExecution) int64 {
	resultBytes := len(row.ResultJSON)
	if row.Status == "running" {
		resultBytes = max(resultBytes, MCPResultLimitBytes)
	}
	return int64(1024 + resultBytes)
}

func (r *Repository) adjustMCPStoredBytes(userID string, delta int64) error {
	if delta == 0 {
		return nil
	}
	q := r.db.Model(&model.MCPStorageUsage{}).Where("user_id = ? AND bytes + ? >= 0", userID, delta)
	if delta > 0 {
		q = q.Where("bytes + ? <= ?", delta, MCPStorageLimitBytes)
	}
	result := q.UpdateColumn("bytes", gorm.Expr("bytes + ?", delta))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrMCPStorageQuota
	}
	return nil
}

func (r *Repository) MCPStoredBytes(userID string) (int64, error) {
	var usage model.MCPStorageUsage
	err := r.db.First(&usage, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.mcpMeasuredBytes(userID)
	}
	return usage.Bytes, err
}

func (r *Repository) mcpMeasuredBytes(userID string) (int64, error) {
	length := func(column string) string {
		if r.Dialect() == "postgres" {
			return "octet_length(COALESCE(" + column + ", ''))"
		}
		return "length(CAST(COALESCE(" + column + ", '') AS BLOB))"
	}
	connectionBytes := "CASE WHEN scope = 'platform' THEN 32768 ELSE 1024 END"
	for _, column := range []string{"parameters_ciphertext", "tools_json", "tools_summary_json", "allowed_tools_json", "allowed_user_ids_json", "tool_policies_json", "name", "server_url"} {
		connectionBytes += " + " + length(column)
	}
	var configurations, receipts int64
	if err := r.db.Model(&model.MCPConnection{}).Where("user_id = ?", userID).Select("COALESCE(SUM(" + connectionBytes + "), 0)").Scan(&configurations).Error; err != nil {
		return 0, err
	}
	resultBytes := length("result_json")
	expression := "1024 + CASE WHEN status = 'running' AND " + resultBytes + " < 49152 THEN 49152 ELSE " + resultBytes + " END"
	if err := r.db.Model(&model.MCPToolExecution{}).Where("user_id = ?", userID).Select("COALESCE(SUM(" + expression + "), 0)").Scan(&receipts).Error; err != nil {
		return 0, err
	}
	return configurations + receipts, nil
}

// Expired receipts retain the id/fingerprint, so old external effects cannot be
// executed again after their result body is removed. Running effects are kept.
func (r *Repository) PruneMCPExecutionResults(before time.Time, limit int) (int, error) {
	limit = min(max(limit, 1), 500)
	var rows []model.MCPToolExecution
	if err := r.db.Select("id", "user_id").Where("status IN ? AND updated_at < ?", []string{"completed", "uncertain"}, before).Order("updated_at, id").Limit(limit).Find(&rows).Error; err != nil {
		return 0, err
	}
	pruned := 0
	for _, hint := range rows {
		err := r.Transaction(func(repo *Repository) error {
			if err := repo.LockMCPQuota(hint.UserID); err != nil {
				return err
			}
			row, err := repo.MCPExecution(hint.ID, hint.UserID)
			if err != nil {
				return err
			}
			if (row.Status != "completed" && row.Status != "uncertain") || !row.UpdatedAt.Before(before) {
				return nil
			}
			freed := int64(len(row.ResultJSON))
			if err := repo.db.Model(row).Updates(map[string]any{"status": "expired", "result_json": "", "updated_at": time.Now()}).Error; err != nil {
				return err
			}
			if err := repo.adjustMCPStoredBytes(row.UserID, -freed); err != nil {
				return err
			}
			pruned++
			return nil
		})
		if err != nil {
			return pruned, err
		}
	}
	return pruned, nil
}
