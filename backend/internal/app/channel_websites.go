package app

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ChannelWebsiteRequest struct {
	Name              string           `json:"name"`
	BaseURL           string           `json:"baseUrl"`
	APIFormat         string           `json:"apiFormat"`
	ProxyURL          string           `json:"proxyUrl"`
	Headers           []OutboundHeader `json:"headers"`
	ExpectedUpdatedAt time.Time        `json:"expectedUpdatedAt"`
}

type AdminChannelWebsite struct {
	model.ChannelWebsite
	Headers  []OutboundHeader `json:"headers"`
	KeyCount int              `json:"keyCount"`
}

func (s *Service) AdminChannelWebsites(actor *model.User) ([]AdminChannelWebsite, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	rows, err := s.repo.ChannelWebsites()
	if err != nil {
		return nil, err
	}
	result := make([]AdminChannelWebsite, 0, len(rows))
	for _, row := range rows {
		channels, err := s.repo.WebsiteChannels(row.ID)
		if err != nil {
			return nil, err
		}
		headers, err := ParseOutboundHeadersJSON(row.HeadersJSON)
		if err != nil {
			return nil, err
		}
		result = append(result, AdminChannelWebsite{ChannelWebsite: row, Headers: headers, KeyCount: len(channels)})
	}
	return result, nil
}

func mergeWebsiteHeaders(private, public []OutboundHeader) []OutboundHeader {
	result := make([]OutboundHeader, 0, len(private)+len(public))
	for _, header := range private {
		if !model.IsWebsitePublicHeader(header.Name) {
			result = append(result, header)
		}
	}
	return append(result, public...)
}

func channelMatchesWebsite(channel model.ModelChannel, site model.ChannelWebsite) bool {
	public, _ := model.WebsitePublicHeadersJSON(channel.HeadersJSON)
	return model.CanonicalWebsiteURL(channel.BaseURL) == model.CanonicalWebsiteURL(site.BaseURL) && channel.APIFormat == site.APIFormat && channel.ProxyURL == site.ProxyURL && public == site.HeadersJSON
}

func sameWebsiteConnection(a, b model.ModelChannel) bool {
	aHeaders, _ := model.WebsitePublicHeadersJSON(a.HeadersJSON)
	bHeaders, _ := model.WebsitePublicHeadersJSON(b.HeadersJSON)
	return model.CanonicalWebsiteURL(a.BaseURL) == model.CanonicalWebsiteURL(b.BaseURL) && a.APIFormat == b.APIFormat && a.ProxyURL == b.ProxyURL && aHeaders == bHeaders
}

func (s *Service) SaveAdminChannelWebsite(actor *model.User, id string, req ChannelWebsiteRequest) (*AdminChannelWebsite, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) == "" || len([]rune(strings.TrimSpace(req.Name))) > 80 {
		return nil, BadAuthRequest("网站名称需为 1-80 个字")
	}
	format := strings.ToLower(strings.TrimSpace(req.APIFormat))
	if format == "" {
		format = "openai"
	}
	if format != "openai" && format != "gemini" {
		return nil, BadAuthRequest("目录格式只支持 OpenAI 或 Gemini")
	}
	for _, header := range req.Headers {
		if !model.IsWebsitePublicHeader(header.Name) {
			return nil, BadAuthRequest("公共请求头仅支持 Anthropic-Version、OpenAI-Beta；鉴权及其他头请在 Key 分组配置")
		}
	}
	headersJSON, err := EncodeOutboundHeadersJSON(req.Headers)
	if err != nil {
		return nil, err
	}
	headersJSON, _ = model.WebsitePublicHeadersJSON(headersJSON)
	proxy := strings.TrimSpace(req.ProxyURL)
	if _, err := ValidateProxyURL(proxy); err != nil {
		return nil, err
	}
	baseURL := strings.TrimSpace(req.BaseURL)
	var previous *model.ChannelWebsite
	if id != "" {
		previous, err = s.repo.ChannelWebsite(id)
		if err != nil {
			return nil, err
		}
		if req.ExpectedUpdatedAt.IsZero() {
			return nil, BadAuthRequest("缺少网站版本，请刷新后重试")
		}
	}
	if previous == nil || baseURL != previous.BaseURL {
		if _, err := ValidateOutboundURL(baseURL); err != nil {
			return nil, err
		}
	}
	site := model.ChannelWebsite{ID: id, Scope: model.ChannelScopeSystem, Name: strings.TrimSpace(req.Name), BaseURL: baseURL, APIFormat: format, ProxyURL: proxy, HeadersJSON: headersJSON}
	if id == "" {
		site.ID = uuid.NewString()
	}
	count := 0
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		if previous == nil {
			return repo.CreateChannelWebsite(&site)
		}
		current, err := repo.LockChannelWebsite(id)
		if err != nil {
			return err
		}
		if !current.UpdatedAt.Equal(req.ExpectedUpdatedAt) {
			return BadAuthRequest("网站配置已被修改，请刷新后重试")
		}
		channels, err := repo.WebsiteChannels(id)
		if err != nil {
			return err
		}
		ids := make([]string, 0, len(channels))
		for _, channel := range channels {
			ids = append(ids, channel.ID)
		}
		if err := repo.LockSystemChannelConfiguration(ids); err != nil {
			return err
		}
		public, err := ParseOutboundHeadersJSON(headersJSON)
		if err != nil {
			return err
		}
		for _, channel := range channels {
			// Membership and version are read again after channel locking.
			fresh, err := repo.AdminSystemChannel(channel.ID)
			if err != nil {
				return err
			}
			if fresh.WebsiteID != id {
				continue
			}
			headers, err := ParseOutboundHeadersJSON(fresh.HeadersJSON)
			if err != nil {
				return err
			}
			fresh.HeadersJSON, err = EncodeOutboundHeadersJSON(mergeWebsiteHeaders(headers, public))
			if err != nil {
				return err
			}
			fresh.BaseURL, fresh.APIFormat, fresh.ProxyURL = site.BaseURL, site.APIFormat, site.ProxyURL
			if err := repo.SaveSystemChannelVersion(fresh, fresh.UpdatedAt); err != nil {
				return err
			}
			count++
		}
		site.CreatedAt = current.CreatedAt
		return repo.SaveChannelWebsiteVersion(&site, current.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	headers, _ := ParseOutboundHeadersJSON(headersJSON)
	return &AdminChannelWebsite{ChannelWebsite: site, Headers: headers, KeyCount: count}, nil
}

func (s *Service) DeleteAdminChannelWebsite(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	err := s.repo.DeleteChannelWebsite(id)
	if errors.Is(err, repository.ErrWebsiteNotEmpty) {
		return BadAuthRequest(err.Error())
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BadAuthRequest("网站不存在或已删除")
	}
	return err
}

type ChannelProtocolSuggestion struct {
	Protocol   string     `json:"protocol,omitempty"`
	Source     string     `json:"source"`
	Reason     string     `json:"reason,omitempty"`
	Candidates []string   `json:"candidates"`
	SelectedAt *time.Time `json:"selectedAt,omitempty"`
}

func (s *Service) AdminChannelProtocolSuggestion(actor *model.User, channelID, key, capability string) (*ChannelProtocolSuggestion, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	key = strings.TrimPrefix(strings.TrimSpace(key), "models/")
	capability = normalizeCapability(capability)
	result := &ChannelProtocolSuggestion{Source: "none", Candidates: []string{}}
	if channel.WebsiteID == "" || key == "" || capability == "" {
		return result, nil
	}
	selection, err := s.repo.LatestChannelProtocolSelection(channel.WebsiteID, key, capability)
	if err == nil {
		result.Protocol, result.Source, result.SelectedAt = selection.Protocol, "selection", &selection.SelectedAt
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		result.Candidates, err = s.repo.WebsiteProtocolHistory(channel.WebsiteID, key, capability)
		if err != nil {
			return nil, err
		}
		if len(result.Candidates) > 1 {
			result.Source, result.Reason = "conflict", "同网站历史配置存在多个协议，请明确选择"
			return result, nil
		}
		if len(result.Candidates) == 1 {
			result.Protocol, result.Source = result.Candidates[0], "history"
		}
	} else {
		return nil, err
	}
	if result.Protocol != "" {
		if _, _, _, _, err := s.normalizeChannelModelContract(channel, ChannelModelRequest{ModelKey: key, ProviderModelKey: key, Capability: capability, Protocol: result.Protocol}); err != nil {
			result.Source, result.Reason = "invalid", "已记忆的协议当前不可用或不适用于该能力/凭据，请重新选择"
			result.Candidates = []string{result.Protocol}
			result.Protocol = ""
		}
	}
	return result, nil
}
