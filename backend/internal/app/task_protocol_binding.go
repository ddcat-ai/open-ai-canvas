package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type taskProtocolBinding struct {
	PluginID          string `json:"pluginId"`
	Version           string `json:"version"`
	Digest            string `json:"packageSHA256"`
	ProviderID        string `json:"providerId"`
	ChannelID         string `json:"channelId"`
	ChannelModelID    string `json:"channelModelId"`
	UpstreamModel     string `json:"upstreamModel"`
	ProfileModel      string `json:"profileModel"`
	Capability        string `json:"capability"`
	CapabilityVersion int64  `json:"capabilityVersion"`
	PriceVersion      int64  `json:"priceVersion"`
	CapabilityConfig  string `json:"capabilityConfig"`
	ConnectionRef     string `json:"connectionRef"`
}

func (s *Service) protocolConnectionRef(channel *model.ModelChannel) (string, error) {
	key, err := s.settingsEncryptionKey()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	if err := json.NewEncoder(mac).Encode([]string{"model-protocol-connection", channel.ID, strings.TrimRight(channel.BaseURL, "/"), channel.APIKey, channel.SecretKey, channel.HeadersJSON}); err != nil {
		return "", err
	}
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) captureTaskProtocolBinding(input map[string]any, selected *model.ChannelModel) (string, error) {
	config, _ := input["config"].(map[string]any)
	channelID := stringValue(config["channelId"])
	if channelID == "" || taskInputUsesWorkflowProvider(input) {
		return "", nil
	}
	var err error
	if selected == nil {
		selected, err = s.repo.ChannelModelByKey(channelID, stringValue(config["channelModelKey"]))
		if err != nil {
			return "", err
		}
	}
	id := string(selected.Protocol)
	priceRevision, hasPrice := config["priceRevision"].(int64)
	profileRevision, hasProfile := config["profileRevision"].(int64)
	if id != stringValue(config["interfaceType"]) || selected.ChannelID != channelID || selected.ProtocolRelease != stringValue(config["protocolRelease"]) || !hasPrice || !hasProfile || selected.PriceVersion != priceRevision || selected.CapabilityVersion != profileRevision {
		return "", InvalidModelSelection("模型配置已更新，请重新选择")
	}
	release, err := selectModelRelease(s.protocolRegistry(), id, selected.ProtocolRelease, false)
	if err != nil || release.SHA256 == "" {
		return "", err
	}
	channel, err := s.SystemChannel(channelID)
	if err != nil {
		return "", err
	}
	connection, err := s.protocolConnectionRef(channel)
	if err != nil {
		return "", err
	}
	binding := taskProtocolBinding{
		PluginID: release.PluginID, Version: release.Version, Digest: release.SHA256, ProviderID: id,
		ChannelID: channelID, ChannelModelID: selected.ID, ConnectionRef: connection,
		UpstreamModel: stringValue(config["providerModelKey"]), ProfileModel: firstNonEmpty(selected.ProviderModelKey, selected.ModelKey),
		Capability: selected.Capability, CapabilityConfig: selected.CapabilityConfigJSON,
		CapabilityVersion: selected.CapabilityVersion, PriceVersion: selected.PriceVersion,
	}
	raw, err := json.Marshal(binding)
	return string(raw), err
}

func decodeTaskProtocolBinding(raw string) (taskProtocolBinding, error) {
	var binding taskProtocolBinding
	if err := json.Unmarshal([]byte(raw), &binding); err != nil {
		return binding, err
	}
	if binding.Digest == "" || binding.ProviderID == "" || binding.UpstreamModel == "" || binding.ChannelID == "" || binding.ChannelModelID == "" {
		return binding, errors.New("任务原始渠道模型绑定无效")
	}
	return binding, nil
}

func (s *Service) boundChannelModel(binding taskProtocolBinding, channel *model.ModelChannel, item *model.ChannelModel, config *providerConfig) (*protocol.Registry, error) {
	if binding.ChannelID != channel.ID || binding.ChannelModelID != item.ID {
		return nil, errors.New("任务原始渠道模型绑定无效")
	}
	connection, err := s.protocolConnectionRef(channel)
	if err != nil {
		return nil, err
	}
	if connection != binding.ConnectionRef {
		return nil, errors.New("原任务的渠道地址或凭据已更换，请核对原账号")
	}
	release, err := s.protocolRegistry().BoundRelease(binding.ProviderID, binding.Digest)
	if err != nil {
		return nil, err
	}
	item.Protocol, item.Capability, item.CapabilityConfigJSON = model.ChannelInterfaceType(binding.ProviderID), binding.Capability, binding.CapabilityConfig
	item.ProviderModelKey = binding.ProfileModel
	config.ProviderModelKey, config.pinned = binding.UpstreamModel, true
	config.releaseWithdrawn = !release.Selectable
	return release.Registry, nil
}
