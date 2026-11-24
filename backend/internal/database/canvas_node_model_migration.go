package database

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	canvasdoc "yingce/backend/internal/canvas/document"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const canvasNodeModelChecksum = "sha256:canvas-unified-text-nodes-v96"
const canvasMigrationBatch = 100

// Shares reference the live canvas row. Only these explicit document columns
// can restore a canvas; event journals and billed request identities are audit
// records, and must never be recursively rewritten as arbitrary JSON.
func migrateCanvasNodeModel(tx *gorm.DB) error {
	tables := []string{}
	if tx.Migrator().HasTable(&model.CanvasProject{}) {
		tables = append(tables, "SELECT user_id, id AS canvas_id FROM canvas_projects")
	}
	if tx.Migrator().HasTable(&model.CanvasSnapshot{}) {
		tables = append(tables, "SELECT user_id, canvas_id FROM canvas_snapshots")
	}
	if tx.Migrator().HasTable(&model.CloudAgentCanvasMutation{}) {
		tables = append(tables, "SELECT user_id, canvas_id FROM cloud_agent_canvas_mutations")
	}
	if len(tables) > 0 {
		lastUser, lastCanvas := "", ""
		first := true
		for {
			var scopes []struct{ UserID, CanvasID string }
			query := tx.Table("(" + strings.Join(tables, " UNION ") + ") AS canvas_scopes").Order("user_id, canvas_id").Limit(canvasMigrationBatch)
			if !first {
				query = query.Where("user_id > ? OR (user_id = ? AND canvas_id > ?)", lastUser, lastUser, lastCanvas)
			}
			if err := query.Find(&scopes).Error; err != nil {
				return err
			}
			if len(scopes) == 0 {
				break
			}
			for _, scope := range scopes {
				if err := migrateCanvasNodeScope(tx, scope.UserID, scope.CanvasID); err != nil {
					return fmt.Errorf("画布 %q 统一节点迁移失败：%w", scope.CanvasID, err)
				}
			}
			last := scopes[len(scopes)-1]
			lastUser, lastCanvas, first = last.UserID, last.CanvasID, false
		}
	}
	return migrateCreationCanvasBaselines(tx)
}

func migrateCanvasNodeScope(tx *gorm.DB, userID, canvasID string) error {
	// Hash mappings are scoped to one canvas, so undo cannot borrow proof from a
	// different owner/document. No full documents remain in this map.
	hashes := map[string]string{}
	changedBefore := map[string]bool{}
	changedScope := false
	normalize := func(raw string) (string, bool, error) {
		next, changed, err := canvasdoc.Canonicalize([]byte(raw))
		if err != nil {
			return "", false, err
		}
		if strings.TrimSpace(raw) != "" {
			var before, after map[string]any
			if err := json.Unmarshal([]byte(raw), &before); err != nil {
				return "", false, err
			}
			if err := json.Unmarshal(next, &after); err != nil {
				return "", false, err
			}
			nextHash := canvasdoc.SnapshotHash(after)
			for _, oldHash := range canvasMigrationSnapshotHashes(before) {
				if existing, ok := hashes[oldHash]; ok && existing != nextHash {
					return "", false, fmt.Errorf("同一原始快照哈希对应不同迁移结果，拒绝推断撤销授权")
				}
				hashes[oldHash] = nextHash
			}
		}
		changedScope = changedScope || changed
		return string(next), changed, nil
	}
	if tx.Migrator().HasTable(&model.CanvasProject{}) {
		var rows []model.CanvasProject
		if err := tx.Where("user_id = ? AND id = ?", userID, canvasID).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			next, changed, err := normalize(row.PayloadJSON)
			if err != nil {
				return fmt.Errorf("canvas_projects.payload_json: %w", err)
			}
			if !changed {
				continue
			}
			if row.Revision >= 9007199254740990 || row.Revision < 0 {
				return fmt.Errorf("画布版本超出安全递增范围")
			}
			var payload map[string]json.RawMessage
			if err := json.Unmarshal([]byte(next), &payload); err != nil {
				return err
			}
			// Rows are authoritative; clients must re-read after the structural edit.
			delete(payload, "revision")
			now := time.Now().UTC()
			payload["updatedAt"], _ = json.Marshal(now)
			encoded, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			result := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ? AND revision = ?", row.ID, userID, row.Revision).
				Updates(map[string]any{"payload_json": string(encoded), "revision": row.Revision + 1, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("画布迁移期间发生并发写入")
			}
		}
	}
	if tx.Migrator().HasTable(&model.CanvasSnapshot{}) {
		var rows []model.CanvasSnapshot
		if err := tx.Where("user_id = ? AND canvas_id = ?", userID, canvasID).FindInBatches(&rows, canvasMigrationBatch, func(batch *gorm.DB, _ int) error {
			for _, row := range rows {
				next, changed, err := normalize(row.PayloadJSON)
				if err != nil {
					return fmt.Errorf("canvas_snapshots %q: %w", row.ID, err)
				}
				if changed {
					// Historical revision/creation times and resource protection rows
					// retain their identity; only representation and byte count change.
					if err := tx.Model(&model.CanvasSnapshot{}).Where("id = ?", row.ID).UpdateColumns(map[string]any{"payload_json": next, "payload_bytes": len([]byte(next))}).Error; err != nil {
						return err
					}
				}
			}
			return nil
		}).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&model.CloudAgentCanvasMutation{}) {
		var rows []model.CloudAgentCanvasMutation
		if err := tx.Where("user_id = ? AND canvas_id = ?", userID, canvasID).FindInBatches(&rows, canvasMigrationBatch, func(batch *gorm.DB, _ int) error {
			for _, row := range rows {
				if strings.TrimSpace(row.BeforeJSON) == "" {
					continue
				}
				next, changed, err := normalize(row.BeforeJSON)
				if err != nil {
					return fmt.Errorf("cloud_agent_canvas_mutations %q: %w", row.ID, err)
				}
				var before map[string]any
				if err := json.Unmarshal([]byte(row.BeforeJSON), &before); err != nil {
					return err
				}
				if !changed && row.BeforeSnapshotHash == canvasdoc.SnapshotHash(before) {
					continue
				}
				verified := false
				for _, oldHash := range canvasMigrationSnapshotHashes(before) {
					verified = verified || row.BeforeSnapshotHash == oldHash
				}
				if !verified {
					return fmt.Errorf("Agent 撤销快照 %q 的原始哈希不匹配，未迁移任何内容", row.ID)
				}
				changedBefore[row.ID], changedScope = true, true
				updates := map[string]any{"before_snapshot_hash": hashes[row.BeforeSnapshotHash]}
				if changed {
					updates["before_json"] = next
				}
				if err := tx.Model(&model.CloudAgentCanvasMutation{}).Where("id = ?", row.ID).UpdateColumns(updates).Error; err != nil {
					return err
				}
			}
			return nil
		}).Error; err != nil {
			return err
		}
		if changedScope {
			rows = nil
			if err := tx.Where("user_id = ? AND canvas_id = ?", userID, canvasID).FindInBatches(&rows, canvasMigrationBatch, func(batch *gorm.DB, _ int) error {
				for _, row := range rows {
					if mapped, exists := hashes[row.AfterSnapshotHash]; exists {
						if mapped != row.AfterSnapshotHash {
							if err := tx.Model(&model.CloudAgentCanvasMutation{}).Where("id = ?", row.ID).UpdateColumn("after_snapshot_hash", mapped).Error; err != nil {
								return err
							}
						}
					} else if row.Status == "applied" && changedBefore[row.ID] {
						// There is no after-document to prove a new hash. Preserve the
						// snapshot for audit, but never fabricate undo authorization.
						if err := tx.Model(&model.CloudAgentCanvasMutation{}).Where("id = ?", row.ID).UpdateColumn("status", "not_undoable").Error; err != nil {
							return err
						}
					}
				}
				return nil
			}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// Old mutation rows have no hash-version column. Recompute only the two actual
// historical contracts: 5f359f2b normalized top-level presentation fields, then
// 8e8d78a5 excluded node timestamps. Each accepted hash still proves this exact
// preimage; these aliases must remain scoped to its owner and canvas.
func canvasMigrationSnapshotHashes(doc map[string]any) []string {
	withNodeTimestamps := make(map[string]any, len(doc))
	original := make(map[string]any, len(doc))
	for key, value := range doc {
		if key != "viewport" && key != "updatedAt" {
			original[key] = value
		}
		switch key {
		case "id", "viewport", "updatedAt", "revision", "createdAt":
			continue
		case "title", "projectId":
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
				continue
			}
		}
		withNodeTimestamps[key] = value
	}
	for _, key := range []string{"nodes", "connections"} {
		if value, exists := withNodeTimestamps[key]; !exists || value == nil {
			withNodeTimestamps[key] = []any{}
		}
	}
	hashes := []string{canvasdoc.SnapshotHash(doc)}
	for _, content := range []map[string]any{withNodeTimestamps, original} {
		// These maps contain only values decoded from valid JSON; this matches
		// the historical creationHash encoding, including its numeric contract.
		encoded, _ := json.Marshal(content)
		digest := sha256.Sum256(encoded)
		hashes = append(hashes, hex.EncodeToString(digest[:]))
	}
	return hashes
}

func migrateCreationCanvasBaselines(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.CreationRun{}) {
		return nil
	}
	var rows []model.CreationRun
	return tx.Where("approved_canvas_json IS NOT NULL AND approved_canvas_json <> ?", "").FindInBatches(&rows, canvasMigrationBatch, func(batch *gorm.DB, _ int) error {
		for _, row := range rows {
			next, changed, err := canvasdoc.Canonicalize([]byte(row.ApprovedCanvasJSON))
			if err != nil {
				return fmt.Errorf("creation_runs %q 的画布批准基线无效：%w", row.ID, err)
			}
			if changed {
				if row.Revision >= 9007199254740990 || row.Revision < 0 {
					return fmt.Errorf("创作记录 %q 的版本超出安全递增范围", row.ID)
				}
				// Proposal/request digests are immutable authority, not canvas hashes.
				if err := tx.Model(&model.CreationRun{}).Where("id = ?", row.ID).UpdateColumns(map[string]any{"approved_canvas_json": string(next), "revision": row.Revision + 1}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}).Error
}
