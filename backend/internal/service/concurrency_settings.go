package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const runtimeConcurrencySettingKey = "runtime_concurrency"

type RuntimeConcurrencySettingRequest struct {
	WorkerConcurrency  int `json:"workerConcurrency"`
	ChannelConcurrency int `json:"channelConcurrency"`
}

type PublicRuntimeConcurrencySetting struct {
	WorkerConcurrency  int       `json:"workerConcurrency"`
	ChannelConcurrency int       `json:"channelConcurrency"`
	UpdatedBy          string    `json:"updatedBy"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type runtimeConcurrencySettingValue struct {
	WorkerConcurrency  int `json:"workerConcurrency"`
	ChannelConcurrency int `json:"channelConcurrency"`
}

func (s *Service) AdminRuntimeConcurrencySetting(actor *model.User) (*PublicRuntimeConcurrencySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readRuntimeConcurrencySetting()
	if err != nil {
		return nil, err
	}
	return publicRuntimeConcurrencySetting(setting, value), nil
}

func (s *Service) UpdateRuntimeConcurrencySetting(actor *model.User, req RuntimeConcurrencySettingRequest) (*PublicRuntimeConcurrencySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	value := runtimeConcurrencySettingValue{WorkerConcurrency: req.WorkerConcurrency, ChannelConcurrency: req.ChannelConcurrency}
	if err := validateRuntimeConcurrencySetting(value); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	current, _, err := s.readRuntimeConcurrencySetting()
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: runtimeConcurrencySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "runtime_concurrency.update", "system_setting", runtimeConcurrencySettingKey, "更新任务并发配置", value); err != nil {
		return nil, err
	}
	return publicRuntimeConcurrencySetting(&setting, value), nil
}

func (s *Service) runtimeConcurrencySetting() (runtimeConcurrencySettingValue, error) {
	_, value, err := s.readRuntimeConcurrencySetting()
	return value, err
}

func (s *Service) readRuntimeConcurrencySetting() (*model.SystemSetting, runtimeConcurrencySettingValue, error) {
	setting, err := s.repo.SystemSetting(runtimeConcurrencySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, runtimeConcurrencyFromEnvironment(), nil
	}
	if err != nil {
		return nil, runtimeConcurrencySettingValue{}, err
	}
	value := runtimeConcurrencySettingValue{}
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, runtimeConcurrencySettingValue{}, errors.New("任务并发配置格式无效")
	}
	if err := validateRuntimeConcurrencySetting(value); err != nil {
		return nil, runtimeConcurrencySettingValue{}, err
	}
	return setting, value, nil
}

func runtimeConcurrencyFromEnvironment() runtimeConcurrencySettingValue {
	return runtimeConcurrencySettingValue{
		WorkerConcurrency:  effectiveChannelConcurrencyLimit(envInt("CANVAS_WORKER_CONCURRENCY", taskWorkerConcurrency)),
		ChannelConcurrency: defaultChannelConcurrencyLimit(),
	}
}

func validateRuntimeConcurrencySetting(value runtimeConcurrencySettingValue) error {
	if value.WorkerConcurrency < minChannelConcurrencyLimit || value.WorkerConcurrency > maxChannelConcurrencyLimit {
		return BadAuthRequest("Worker 并发数必须是 1-100 的整数")
	}
	if value.ChannelConcurrency < minChannelConcurrencyLimit || value.ChannelConcurrency > maxChannelConcurrencyLimit {
		return BadAuthRequest("全局渠道并发数必须是 1-100 的整数")
	}
	return nil
}

func publicRuntimeConcurrencySetting(setting *model.SystemSetting, value runtimeConcurrencySettingValue) *PublicRuntimeConcurrencySetting {
	result := &PublicRuntimeConcurrencySetting{WorkerConcurrency: value.WorkerConcurrency, ChannelConcurrency: value.ChannelConcurrency}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
