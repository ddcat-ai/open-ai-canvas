// 管理端系统渠道：增删改、复制、密钥加解密与前台投影。
//
// 渠道密钥只以密文入库；前台投影（publicChannel）永远不包含密钥与上游地址。

package app

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) PublicSystemChannels() ([]PublicModelChannel, error) {
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return nil, err
	}
	result := make([]PublicModelChannel, 0, len(channels))
	for _, channel := range channels {
		items, itemErr := s.repo.ChannelModels(channel.ID, false)
		if itemErr != nil {
			return nil, itemErr
		}
		result = append(result, publicChannel(channel, false, items))
	}
	return result, nil
}

func (s *Service) SystemChannel(id string) (*model.ModelChannel, error) {
	channel, err := s.repo.SystemChannel(id)
	if err != nil {
		return nil, err
	}
	if err := s.decryptSystemChannelSecrets(channel); err != nil {
		return nil, err
	}
	return channel, nil
}

func (s *Service) adminSystemChannel(id string) (*model.ModelChannel, error) {
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		return nil, err
	}
	if err := s.decryptSystemChannelSecrets(channel); err != nil {
		return nil, err
	}
	return channel, nil
}

func (s *Service) AdminSystemChannelPage(actor *model.User, query AdminListQuery) (*AdminChannelPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	channels, total, err := s.repo.AdminSystemChannels(query.Keyword, query.Status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	result := make([]PublicModelChannel, 0, len(channels))
	for _, channel := range channels {
		items, itemErr := s.repo.ChannelModels(channel.ID, true)
		if itemErr != nil {
			return nil, itemErr
		}
		result = append(result, publicChannel(channel, true, items))
	}
	return &AdminChannelPage{Channels: result, Total: total, Page: page, Limit: limit}, nil
}

func normalizeAdminPage(page int, limit int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return page, limit
}

func (s *Service) CreateSystemChannel(actor *model.User, req ChannelRequest) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channelID, err := s.repo.NextPrefixedID("CHANNEL")
	if err != nil {
		return nil, err
	}
	channel, err := s.channelFromRequest(req, model.ModelChannel{ID: channelID, UserID: actor.ID, Scope: model.ChannelScopeSystem, Enabled: true})
	if err != nil {
		return nil, err
	}
	if err := s.encryptSystemChannelSecrets(&channel); err != nil {
		return nil, err
	}
	if err := s.repo.Create(&channel); err != nil {
		return nil, err
	}
	if err := s.syncInitialChannelModels(&channel, req.Models); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	items, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(channel, true, items)
	return &public, nil
}

func (s *Service) DuplicateSystemChannel(actor *model.User, id string) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	source, err := s.adminSystemChannel(id)
	if err != nil {
		return nil, err
	}
	sourceModels, err := s.repo.ChannelModels(source.ID, true)
	if err != nil {
		return nil, err
	}
	if len(sourceModels) == 0 {
		for _, name := range channelModelNames(*source) {
			sourceModels = append(sourceModels, model.ChannelModel{ModelKey: name, ProviderModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceVersion: 1})
		}
	}
	channelID, err := s.repo.NextPrefixedID("CHANNEL")
	if err != nil {
		return nil, err
	}
	channel := *source
	channel.ID = channelID
	channel.UserID = actor.ID
	channel.Scope = model.ChannelScopeSystem
	channel.Name = duplicateChannelName(source.Name)
	channel.CreatedAt = time.Time{}
	channel.UpdatedAt = time.Time{}
	channel.DeletedAt = gorm.DeletedAt{}
	if err := s.encryptSystemChannelSecrets(&channel); err != nil {
		return nil, err
	}

	channelModels := make([]model.ChannelModel, 0, len(sourceModels))
	priceTiers := make([]model.ChannelModelPriceTier, 0)
	for _, sourceModel := range sourceModels {
		modelID, idErr := s.repo.NextPrefixedID("MODEL")
		if idErr != nil {
			return nil, idErr
		}
		channelModel := sourceModel
		channelModel.ID = modelID
		channelModel.ChannelID = channel.ID
		channelModel.CreatedAt = time.Time{}
		channelModel.UpdatedAt = time.Time{}
		channelModel.DeletedAt = gorm.DeletedAt{}
		channelModel.PriceTiers = nil
		channelModels = append(channelModels, channelModel)
		for _, sourceTier := range sourceModel.PriceTiers {
			tierID, tierErr := s.repo.NextPrefixedID("PTIER")
			if tierErr != nil {
				return nil, tierErr
			}
			priceTier := sourceTier
			priceTier.ID = tierID
			priceTier.ChannelModelID = channelModel.ID
			priceTier.Selector = nil
			priceTier.CreatedAt = time.Time{}
			priceTier.UpdatedAt = time.Time{}
			priceTier.DeletedAt = gorm.DeletedAt{}
			priceTiers = append(priceTiers, priceTier)
		}
	}
	if err := s.repo.CreateDuplicatedSystemChannel(&channel, channelModels, priceTiers); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	items, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(channel, true, items)
	return &public, nil
}

func duplicateChannelName(name string) string {
	const suffix = " - 副本"
	base := []rune(strings.TrimSpace(name))
	if len(base) == 0 {
		base = []rune("系统渠道")
	}
	if len(base)+len([]rune(suffix)) > 80 {
		base = base[:80-len([]rune(suffix))]
	}
	return string(base) + suffix
}

func (s *Service) UpdateSystemChannel(actor *model.User, id string, req ChannelRequest) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if req.presentationOnly() {
		return s.updateChannelPresentation(id, req)
	}
	updateModels := req.Models != nil
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		return nil, err
	}
	if err := s.decryptSystemChannelSecrets(channel); err != nil {
		return nil, err
	}
	req = mergeChannelRequest(req, *channel)
	next, err := s.channelFromRequest(req, *channel)
	if err != nil {
		return nil, err
	}
	next.ID = channel.ID
	next.UserID = channel.UserID
	next.Scope = model.ChannelScopeSystem
	next.CreatedAt = channel.CreatedAt
	if req.APIKey == "" {
		next.APIKey = channel.APIKey
	}
	if req.SecretKey == "" {
		next.SecretKey = channel.SecretKey
	}
	if err := s.encryptSystemChannelSecrets(&next); err != nil {
		return nil, err
	}
	if err := s.repo.Save(&next); err != nil {
		return nil, err
	}
	if updateModels {
		if err := s.syncInitialChannelModels(&next, req.Models); err != nil {
			return nil, err
		}
	}
	s.invalidateRouteCatalog()
	items, err := s.repo.ChannelModels(next.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(next, true, items)
	return &public, nil
}

func (s *Service) encryptSystemChannelSecrets(channel *model.ModelChannel) error {
	apiKey, err := s.encryptSettingSecret(channel.APIKey)
	if err != nil {
		return err
	}
	secretKey, err := s.encryptSettingSecret(channel.SecretKey)
	if err != nil {
		return err
	}
	channel.APIKey = apiKey
	channel.SecretKey = secretKey
	return nil
}

func (s *Service) decryptSystemChannelSecrets(channel *model.ModelChannel) error {
	apiKey, err := s.decryptSettingSecret(channel.APIKey)
	if err != nil {
		return err
	}
	secretKey, err := s.decryptSettingSecret(channel.SecretKey)
	if err != nil {
		return err
	}
	channel.APIKey = apiKey
	channel.SecretKey = secretKey
	return nil
}

func (s *Service) DeleteSystemChannel(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("系统渠道不存在或已删除")
		}
		return err
	}
	// 保留主体供历史账单和调用日志关联，但从所有业务查询中隐藏并清除密钥。
	err = s.repo.DeleteSystemChannel(channel.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BadAuthRequest("系统渠道不存在或已删除")
	}
	if err == nil {
		s.invalidateRouteCatalog()
	}
	return err
}
