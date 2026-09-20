package canvas

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type AssetBytesRepairIssue struct {
	AssetID string `json:"assetId"`
	Reason  string `json:"reason"`
}

type AssetBytesRepairReport struct {
	Apply      bool                    `json:"apply"`
	Scanned    int                     `json:"scanned"`
	Repairable int                     `json:"repairable"`
	Repaired   int                     `json:"repaired"`
	Unresolved []AssetBytesRepairIssue `json:"unresolved"`
}

// RepairAssetBytes is an explicit offline maintenance operation, not a read fallback.
// Only an owned, ready resource with a known positive size can repair a record.
func RepairAssetBytes(db *gorm.DB, apply bool) (AssetBytesRepairReport, error) {
	report := AssetBytesRepairReport{Apply: apply, Unresolved: []AssetBytesRepairIssue{}}
	// Payloads may contain private media URLs; never include SQL parameters in logs.
	err := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		after := ""
		for {
			var rows []model.Asset
			if err := tx.Where("id > ? AND kind IN ?", after, []string{"image", "video", "audio", "model"}).Order("id ASC").Limit(100).Find(&rows).Error; err != nil {
				return errors.New("读取素材失败，未提交修复")
			}
			if len(rows) == 0 {
				return nil
			}
			for _, asset := range rows {
				after = asset.ID
				report.Scanned++
				issue := func(reason string) {
					report.Unresolved = append(report.Unresolved, AssetBytesRepairIssue{AssetID: asset.ID, Reason: reason})
				}
				var payload map[string]json.RawMessage
				var data map[string]json.RawMessage
				if json.Unmarshal([]byte(asset.PayloadJSON), &payload) != nil || json.Unmarshal(payload["data"], &data) != nil || data == nil {
					issue("素材 JSON 或 data 无效，需人工核查")
					continue
				}
				if _, err := requiredJSONNumberField(data, "bytes"); err == nil {
					continue
				}
				var kind, key string
				_ = json.Unmarshal(payload["kind"], &kind)
				_ = json.Unmarshal(data["storageKey"], &key)
				key = strings.TrimSpace(key)
				if strings.TrimSpace(asset.UserID) == "" || kind != asset.Kind || !strings.HasPrefix(key, "resource:") || strings.TrimPrefix(key, "resource:") == "" {
					issue("类型不一致或缺少明确的 resource: 引用，不能推测文件大小")
					continue
				}
				var resource model.Resource
				err := tx.Where("id = ? AND user_id = ? AND kind = ? AND status = ? AND size > 0", strings.TrimPrefix(key, "resource:"), asset.UserID, kind, model.ResourceStatusReady).Take(&resource).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					issue("未找到同用户、同类型、就绪且大小已知的资源")
					continue
				}
				if err != nil {
					return errors.New("读取资源失败，未提交修复")
				}
				data["bytes"], err = json.Marshal(resource.Size)
				if err != nil {
					return err
				}
				payload["data"], err = json.Marshal(data)
				if err != nil {
					return err
				}
				now := time.Now().UTC()
				payload["updatedAt"], err = json.Marshal(now.Format(time.RFC3339Nano))
				if err != nil {
					return err
				}
				encoded, err := json.Marshal(payload)
				if err != nil {
					return err
				}
				if err := validateUserAssetDocument(encoded); err != nil {
					issue("素材仍有其他合同错误，未修改，请另行核查")
					continue
				}
				report.Repairable++
				if !apply {
					continue
				}
				result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ? AND payload_json = ? AND updated_at = ?", asset.ID, asset.UserID, asset.PayloadJSON, asset.UpdatedAt).Updates(map[string]any{"payload_json": string(encoded), "updated_at": now})
				if result.Error != nil {
					return errors.New("更新素材失败，未提交修复")
				}
				if result.RowsAffected != 1 {
					return fmt.Errorf("素材 %s 已变化，整批修复回滚，请停止写入后重试", asset.ID)
				}
				report.Repaired++
			}
		}
	})
	if err != nil {
		report.Repaired = 0
	}
	return report, err
}
