package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

const ModelDisplayGroupsKey = "model_display_groups_v1"

var ErrModelDisplayGroupsChanged = errors.New("模型或分组已发生变化，请重新加载后再保存")

// Only presentation identities are selected; connection credentials never enter this view.
type ModelDisplayMember struct {
	ID               string `json:"id"`
	ChannelID        string `json:"channelId"`
	ChannelName      string `json:"channelName"`
	ChannelEnabled   bool   `json:"channelEnabled"`
	ModelKey         string `json:"modelKey"`
	ProviderModelKey string `json:"providerModelKey"`
	DisplayName      string `json:"displayName"`
	ChannelLabel     string `json:"channelLabel"`
	Capability       string `json:"capability"`
	Enabled          bool   `json:"enabled"`
}

func (r *Repository) ModelDisplayMembers() ([]ModelDisplayMember, error) {
	return modelDisplayMembers(r.db)
}

func modelDisplayMembers(db *gorm.DB) ([]ModelDisplayMember, error) {
	items := []ModelDisplayMember{}
	err := db.Table("channel_models AS m").
		Select("m.id, m.channel_id, c.name AS channel_name, c.enabled AS channel_enabled, m.model_key, m.provider_model_key, m.display_name, m.channel_label, m.capability, m.enabled").
		Joins("JOIN model_channels AS c ON c.id = m.channel_id").
		Where("c.scope = ? AND c.deleted_at IS NULL AND m.deleted_at IS NULL", model.ChannelScopeSystem).
		Order("c.sort_order ASC, c.created_at ASC, c.id ASC, m.sort_order ASC, m.created_at ASC, m.id ASC").Scan(&items).Error
	return items, err
}

func ModelDisplaySnapshot(raw string, members []ModelDisplayMember) string {
	data, _ := json.Marshal(members)
	digest := sha256.Sum256(append([]byte(raw+"\n"), data...))
	return hex.EncodeToString(digest[:])
}

func (r *Repository) SaveModelDisplayGroups(expected, value, actorID string, audit *model.AdminAuditEvent) error {
	return r.SaveModelDisplayGroupsWithLabels(expected, value, actorID, audit, nil)
}

func (r *Repository) SaveModelDisplayGroupsWithLabels(expected, value, actorID string, audit *model.AdminAuditEvent, labels map[string]string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// A placeholder serializes concurrent first saves too; failure rolls it back.
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.SystemSetting{Key: ModelDisplayGroupsKey}).Error; err != nil {
			return err
		}
		query := tx
		if tx.Dialector.Name() == "postgres" {
			query = tx.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var setting model.SystemSetting
		if err := query.First(&setting, "key = ?", ModelDisplayGroupsKey).Error; err != nil {
			return err
		}
		members, err := modelDisplayMembers(tx)
		if err != nil {
			return err
		}
		if ModelDisplaySnapshot(setting.ValueJSON, members) != expected {
			return ErrModelDisplayGroupsChanged
		}
		result := tx.Model(&model.SystemSetting{}).Where("key = ? AND value_json = ?", ModelDisplayGroupsKey, setting.ValueJSON).
			Updates(map[string]any{"value_json": value, "updated_by": actorID, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrModelDisplayGroupsChanged
		}
		// Display labels and hierarchy share one snapshot and commit; prices and routing stay untouched.
		for id, label := range labels {
			result := tx.Model(&model.ChannelModel{}).Where("id = ?", id).Update("channel_label", label)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrModelDisplayGroupsChanged
			}
		}
		return tx.Create(audit).Error
	})
}

// Check the pre-edit catalog snapshot before writing the model; both changes roll back together.
func (r *Repository) SaveChannelModelAndDisplayGroups(item *model.ChannelModel, tiers []model.ChannelModelPriceTier, expected, value, actorID string, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		repo := New(tx)
		if err := repo.SaveModelDisplayGroups(expected, value, actorID, audit); err != nil {
			return err
		}
		return repo.SaveChannelModelWithPriceTiers(item, tiers)
	})
}
