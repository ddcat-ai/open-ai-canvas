package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ChannelCatalogDiff struct {
	Models         []string   `json:"models"`
	Added          []string   `json:"added"`
	Retained       []string   `json:"retained"`
	Missing        []string   `json:"missing"`
	FirstRead      bool       `json:"firstRead"`
	BaselineReset  bool       `json:"baselineReset"`
	ReadAt         time.Time  `json:"readAt"`
	PreviousReadAt *time.Time `json:"previousReadAt,omitempty"`
}

type ChannelCatalogStatus struct {
	Models []string   `json:"models"`
	ReadAt *time.Time `json:"readAt,omitempty"`
	Stale  bool       `json:"stale"`
}

func (s *Service) AdminChannelCatalogStatus(actor *model.User, channelID string) (*ChannelCatalogStatus, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	result := &ChannelCatalogStatus{Models: []string{}}
	snapshot, err := s.repo.ChannelCatalogSnapshot(channelID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(snapshot.ModelsJSON), &result.Models); err != nil {
		return nil, err
	}
	result.ReadAt = &snapshot.ReadAt
	result.Stale = snapshot.SourceDigest != channelCatalogDigest(*channel)
	return result, nil
}

func channelCatalogDigest(channel model.ModelChannel) string {
	data, _ := json.Marshal([]string{channel.BaseURL, channel.APIFormat, channel.ProxyURL, channel.APIKey, channel.SecretKey, channel.HeadersJSON})
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func (s *Service) checkCatalogSource(repo *repository.Repository, channel *model.ModelChannel) error {
	if err := repo.LockSystemChannelConfiguration([]string{channel.ID}); err != nil {
		return err
	}
	current, err := repo.AdminSystemChannel(channel.ID)
	if err != nil {
		return err
	}
	if err := s.decryptSystemChannelSecrets(current); err != nil {
		return err
	}
	if channelCatalogDigest(*current) != channelCatalogDigest(*channel) {
		return BadAuthRequest("读取期间 Key 或连接配置已变化，请重新读取模型")
	}
	return nil
}

func (s *Service) ReadAdminChannelCatalog(ctx context.Context, actor *model.User, channelID string) (*ChannelCatalogDiff, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, ProxyURL: channel.ProxyURL, Headers: headers})
	if err != nil {
		return nil, err
	}
	models = uniqueNonEmpty(models)
	sort.Strings(models)
	result := &ChannelCatalogDiff{Models: models, Added: []string{}, Retained: []string{}, Missing: []string{}, ReadAt: time.Now().UTC()}
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		if err := s.checkCatalogSource(repo, channel); err != nil {
			return err
		}
		previous, err := repo.ChannelCatalogSnapshot(channelID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		result.FirstRead = previous == nil
		old := map[string]bool{}
		if previous != nil {
			result.PreviousReadAt = &previous.ReadAt
			result.BaselineReset = previous.SourceDigest != channelCatalogDigest(*channel)
			if !result.BaselineReset {
				var names []string
				if err := json.Unmarshal([]byte(previous.ModelsJSON), &names); err != nil {
					return err
				}
				for _, name := range names {
					old[name] = true
				}
			}
		}
		for _, name := range models {
			if old[name] {
				result.Retained = append(result.Retained, name)
				delete(old, name)
			} else {
				result.Added = append(result.Added, name)
			}
		}
		for name := range old {
			result.Missing = append(result.Missing, name)
		}
		sort.Strings(result.Missing)
		encoded, err := json.Marshal(models)
		if err != nil {
			return err
		}
		return repo.Save(&model.ChannelCatalogSnapshot{ChannelID: channelID, SourceDigest: channelCatalogDigest(*channel), ModelsJSON: string(encoded), ReadAt: result.ReadAt})
	})
	return result, err
}
