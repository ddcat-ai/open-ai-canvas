package repository

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrWebsiteNotEmpty = errors.New("网站仍有 Key 分组，请先删除或移出分组")

func (r *Repository) ChannelWebsites() ([]model.ChannelWebsite, error) {
	var rows []model.ChannelWebsite
	err := r.db.Where("scope = ?", model.ChannelScopeSystem).Order("created_at, id").Find(&rows).Error
	return rows, err
}

func (r *Repository) ChannelWebsite(id string) (*model.ChannelWebsite, error) {
	var row model.ChannelWebsite
	err := r.db.Where("id = ? AND scope = ?", id, model.ChannelScopeSystem).First(&row).Error
	return &row, err
}

// Always take website locks before channel locks. New keys and connection edits
// serialize on the same row, so a group cannot join using an obsolete template.
func (r *Repository) LockChannelWebsite(id string) (*model.ChannelWebsite, error) {
	query := r.db.Model(&model.ChannelWebsite{}).Where("id = ? AND scope = ?", id, model.ChannelScopeSystem)
	if r.Dialect() == "sqlite" {
		result := query.UpdateColumn("id", gorm.Expr("id"))
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != 1 {
			return nil, gorm.ErrRecordNotFound
		}
		return r.ChannelWebsite(id)
	}
	var row model.ChannelWebsite
	err := query.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row).Error
	return &row, err
}

func (r *Repository) WebsiteChannels(id string) ([]model.ModelChannel, error) {
	var rows []model.ModelChannel
	err := r.db.Where("website_id = ? AND scope = ?", id, model.ChannelScopeSystem).Order("id").Find(&rows).Error
	return rows, err
}

func (r *Repository) CreateChannelWebsite(site *model.ChannelWebsite) error {
	version := nextChannelEditVersion(r.db.NowFunc(), time.Time{})
	return r.db.Session(&gorm.Session{NowFunc: func() time.Time { return version }}).Create(site).Error
}

// The caller holds the website lock while synchronizing its child channels.
// Use the same monotonic microsecond version as ordinary channel edits, both
// for the persisted row and the response subsequently used as a CAS token.
func (r *Repository) SaveChannelWebsiteVersion(site *model.ChannelWebsite, expected time.Time) error {
	version := nextChannelEditVersion(r.db.NowFunc(), expected)
	tx := r.db.Session(&gorm.Session{NowFunc: func() time.Time { return version }})
	result := tx.Model(site).Where("id = ? AND scope = ? AND updated_at = ?", site.ID, model.ChannelScopeSystem, expected).Select("*").Updates(site)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

func (r *Repository) EnsureChannelWebsite(channel *model.ModelChannel) error {
	if channel.WebsiteID != "" {
		return nil
	}
	public, _ := model.WebsitePublicHeadersJSON(channel.HeadersJSON)
	website := model.ChannelWebsite{ID: uuid.NewString(), Scope: channel.Scope, Name: channel.Name, BaseURL: channel.BaseURL, APIFormat: channel.APIFormat, ProxyURL: channel.ProxyURL, HeadersJSON: public}
	if err := r.CreateChannelWebsite(&website); err != nil {
		return err
	}
	channel.WebsiteID = website.ID
	return nil
}

func (r *Repository) DeleteChannelWebsite(id string) error {
	return r.Transaction(func(repo *Repository) error {
		if _, err := repo.LockChannelWebsite(id); err != nil {
			return err
		}
		var count int64
		if err := repo.db.Model(&model.ModelChannel{}).Where("website_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrWebsiteNotEmpty
		}
		return repo.db.Delete(&model.ChannelWebsite{}, "id = ?", id).Error
	})
}

func (r *Repository) ChannelCatalogSnapshot(id string) (*model.ChannelCatalogSnapshot, error) {
	var row model.ChannelCatalogSnapshot
	if err := r.db.First(&row, "channel_id = ?", id).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Repository) LatestChannelProtocolSelection(websiteID, key, capability string) (*model.ChannelProtocolSelection, error) {
	var row model.ChannelProtocolSelection
	err := r.db.Where("website_id = ? AND provider_model_key = ? AND capability = ?", websiteID, key, capability).Order("id DESC").First(&row).Error
	return &row, err
}

func (r *Repository) WebsiteProtocolHistory(websiteID, key, capability string) ([]string, error) {
	var rows []string
	err := r.db.Model(&model.ChannelModel{}).Distinct("channel_models.protocol").
		Joins("JOIN model_channels ON model_channels.id = channel_models.channel_id AND model_channels.deleted_at IS NULL").
		Where("model_channels.website_id = ? AND model_channels.scope = ? AND channel_models.capability = ? AND channel_models.protocol <> '' AND (channel_models.provider_model_key = ? OR (channel_models.provider_model_key = '' AND channel_models.model_key = ?))", websiteID, model.ChannelScopeSystem, capability, key, key).
		Order("channel_models.protocol").Pluck("channel_models.protocol", &rows).Error
	return rows, err
}

func (r *Repository) RecordChannelProtocolSelection(websiteID, actorID string, item *model.ChannelModel) error {
	if websiteID == "" || item.Protocol == "" {
		return nil
	}
	key := item.ProviderModelKey
	if key == "" {
		key = item.ModelKey
	}
	return r.db.Create(&model.ChannelProtocolSelection{WebsiteID: websiteID, ProviderModelKey: key, Capability: item.Capability, Protocol: string(item.Protocol), ChannelModelID: item.ID, ActorID: actorID, SelectedAt: time.Now().UTC()}).Error
}
