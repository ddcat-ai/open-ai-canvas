package database

import (
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateChannelWebsites(db *gorm.DB) error {
	if err := db.AutoMigrate(&model.ChannelWebsite{}, &model.ChannelCatalogSnapshot{}, &model.ChannelProtocolSelection{}); err != nil {
		return err
	}
	if !db.Migrator().HasColumn(&model.ModelChannel{}, "WebsiteID") {
		if err := db.Migrator().AddColumn(&model.ModelChannel{}, "WebsiteID"); err != nil {
			return err
		}
	}
	if !db.Migrator().HasIndex(&model.ModelChannel{}, "WebsiteID") {
		if err := db.Migrator().CreateIndex(&model.ModelChannel{}, "WebsiteID"); err != nil {
			return err
		}
	}
	var channels []model.ModelChannel
	if err := db.Where("scope = ? AND website_id = ''", model.ChannelScopeSystem).Order("created_at, id").Find(&channels).Error; err != nil {
		return err
	}
	grouped := map[string]string{}
	for _, channel := range channels {
		public, allPublic := model.WebsitePublicHeadersJSON(channel.HeadersJSON)
		format := channel.APIFormat
		if format == "" {
			format = "openai"
		}
		keyBytes, _ := json.Marshal([]string{string(channel.Scope), model.CanonicalWebsiteURL(channel.BaseURL), format, channel.ProxyURL, public})
		key := string(keyBytes)
		// Do not infer common ownership of arbitrary credential headers.
		if !allPublic {
			key += "/" + channel.ID
		}
		websiteID := grouped[key]
		if websiteID == "" {
			website := model.ChannelWebsite{ID: uuid.NewString(), Scope: channel.Scope, Name: channel.Name, BaseURL: channel.BaseURL, APIFormat: format, ProxyURL: channel.ProxyURL, HeadersJSON: public}
			if strings.TrimSpace(website.Name) == "" {
				website.Name = channel.ID
			}
			if err := db.Create(&website).Error; err != nil {
				return err
			}
			websiteID = website.ID
			grouped[key] = websiteID
		}
		// UpdateColumn deliberately preserves the channel configuration version and IDs.
		if err := db.Model(&model.ModelChannel{}).Where("id = ?", channel.ID).UpdateColumn("website_id", websiteID).Error; err != nil {
			return err
		}
	}
	return nil
}
