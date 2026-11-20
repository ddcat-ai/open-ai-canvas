package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"yingce/backend/internal/protocol"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// These settings describe reference inputs, independently of output response_format.
type ReferenceMediaTransport struct {
	Image string `json:"image,omitempty"`
	Audio string `json:"audio,omitempty"`
	Video string `json:"video,omitempty"`
}

func normalizeReferenceMediaTransport(input *ReferenceMediaTransport) (*ReferenceMediaTransport, error) {
	if input == nil {
		return nil, nil
	}
	value := *input
	for _, field := range []*string{&value.Image, &value.Audio, &value.Video} {
		*field = strings.ToLower(strings.TrimSpace(*field))
		switch *field {
		case "", "inherit", "protocol", "url", "base64":
		default:
			return nil, BadAuthRequest("参考素材发送方式只能是跟随上级、协议默认、URL 或 Base64")
		}
	}
	return &value, nil
}

func resolveReferenceMediaTransport(channel, override *ReferenceMediaTransport) ReferenceMediaTransport {
	var result ReferenceMediaTransport
	resolve := func(parent, child string) string {
		if child == "" || child == "inherit" {
			child = parent
		}
		if child == "url" || child == "base64" {
			return child
		}
		return ""
	}
	if channel == nil {
		channel = &ReferenceMediaTransport{}
	}
	if override == nil {
		override = &ReferenceMediaTransport{}
	}
	result.Image = resolve(channel.Image, override.Image)
	result.Audio = resolve(channel.Audio, override.Audio)
	result.Video = resolve(channel.Video, override.Video)
	return result
}

func (s *Service) channelMediaTransport(id string) (*ReferenceMediaTransport, error) {
	record, err := s.repo.SystemSetting("channel_media_transport:" + id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value ReferenceMediaTransport
	if err = json.Unmarshal([]byte(record.ValueJSON), &value); err != nil {
		return nil, errors.New("渠道参考素材发送方式配置无效")
	}
	return normalizeReferenceMediaTransport(&value)
}

func saveChannelMediaTransport(repo *repository.Repository, id, actor string, value *ReferenceMediaTransport) error {
	normalized, err := normalizeReferenceMediaTransport(value)
	if err != nil {
		return err
	}
	if normalized == nil {
		return nil
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	return repo.SaveSystemSetting(&model.SystemSetting{Key: "channel_media_transport:" + id, ValueJSON: string(data), UpdatedBy: actor})
}

// The channel and its transport policy commit together; omitted policy preserves the old value.
func (s *Service) saveChannelWithMediaTransport(channel *model.ModelChannel, actor string, value *ReferenceMediaTransport, create bool, expectedVersion ...time.Time) error {
	return s.repo.Transaction(func(repo *repository.Repository) error {
		var err error
		if channel.WebsiteID != "" {
			website, lockErr := repo.LockChannelWebsite(channel.WebsiteID)
			if lockErr != nil {
				return lockErr
			}
			if !channelMatchesWebsite(*channel, *website) {
				return BadAuthRequest("网站连接已更新，请刷新后重试")
			}
		} else if err = repo.EnsureChannelWebsite(channel); err != nil {
			return err
		}
		if create {
			err = repo.Create(channel)
		} else if len(expectedVersion) > 0 {
			err = repo.SaveSystemChannelVersion(channel, expectedVersion[0])
		} else {
			err = repo.Save(channel)
		}
		if err != nil {
			return err
		}
		return saveChannelMediaTransport(repo, channel.ID, actor, value)
	})
}

func (s *Service) decorateChannelMediaTransport(public *PublicModelChannel) error {
	value, err := s.channelMediaTransport(public.ID)
	if err != nil {
		return err
	}
	public.MediaTransport = value
	return nil
}

func hasExplicitMediaTransport(input canvasGenerationInput) bool {
	return (len(input.ReferenceImages) > 0 && input.Config.mediaTransport.Image != "") ||
		(len(input.ReferenceVideos) > 0 && input.Config.mediaTransport.Video != "") ||
		(len(input.ReferenceAudios) > 0 && input.Config.mediaTransport.Audio != "")
}

func validateReferenceTransportProtocol(ctx context.Context, input canvasGenerationInput) error {
	if !hasExplicitMediaTransport(input) || input.Mode == "text" {
		return nil
	}
	if _, ok := protocolAdapterForContext(ctx, input.Config.InterfaceType); !ok {
		return errors.New("当前协议未声明可配置的 JSON 素材合同，请将参考素材发送方式设为协议默认")
	}
	return nil
}

func validateMediaTransportRequest(spec protocol.RequestSpec, input canvasGenerationInput) error {
	if !hasExplicitMediaTransport(input) {
		return nil
	}
	if len(spec.Files) > 0 || !strings.Contains(strings.ToLower(spec.ContentType), "json") {
		return errors.New("当前协议需要文件或表单上传，请将参考素材发送方式设为协议默认")
	}
	return nil
}

func referenceMediaPolicy(policy providerMediaHydrationPolicy, mode string, hasMask bool) (providerMediaHydrationPolicy, error) {
	switch mode {
	case "url":
		if hasMask {
			return policy, errors.New("带遮罩的图片编辑需要文件素材，请将图片发送方式设为协议默认")
		}
		policy.requireURL = true
		policy.preferURL = true
		policy.explicitTransport = "url"
	case "base64":
		if policy.requireURL {
			return policy, errors.New("当前协议要求公网素材 URL，不能使用 Base64；请改为 URL 或协议默认")
		}
		policy.preferURL = false
		policy.forceBase64 = true
		policy.explicitTransport = "base64"
	case "":
	default:
		return policy, fmt.Errorf("无效的参考素材发送方式")
	}
	return policy, nil
}
