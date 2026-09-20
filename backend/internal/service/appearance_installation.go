package service

import (
	_ "embed"
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

//go:embed seed/appearance-logo.svg
var installationLogo string

const appearanceBaselineKey = "appearance_installation"

type appearanceInstallation struct {
	Setting   AppearanceSetting `json:"setting"`
	LightLogo string            `json:"lightLogo"`
	DarkLogo  string            `json:"darkLogo"`
	VideoURL  string            `json:"videoUrl"`
	PosterURL string            `json:"posterUrl"`
}

// EnsureAppearance snapshots this installation once. Repeated startups and
// concurrent instances may insert missing records, never replace saved data.
func (s *Service) EnsureAppearance() error {
	_, value, err := s.readAppearance()
	if err != nil {
		return err
	}
	value.SEOTitle = effectiveAppearanceSEOTitle(value)
	value.SEODescription = effectiveAppearanceSEODescription(value)
	value.FooterCopyright = effectiveAppearanceCopyright(value)
	baseline := appearanceInstallation{Setting: value,
		LightLogo: strings.ReplaceAll(installationLogo, "currentColor", "#171717"),
		DarkLogo:  strings.ReplaceAll(installationLogo, "currentColor", "#fafafa"),
		VideoURL:  defaultAppearanceVideoURL, PosterURL: defaultAppearancePosterURL}
	encoded, err := json.Marshal(baseline)
	if err != nil {
		return err
	}
	if err := s.repo.CreateSystemSettingIfMissing(&model.SystemSetting{Key: appearanceBaselineKey, ValueJSON: string(encoded)}); err != nil {
		return err
	}
	saved, err := s.appearanceInstallation()
	if err != nil {
		return err
	}
	if saved == nil {
		return errors.New("站点初始配置未能保存")
	}
	encoded, err = json.Marshal(saved.Setting)
	if err != nil {
		return err
	}
	return s.repo.CreateSystemSettingIfMissing(&model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(encoded)})
}

func (s *Service) appearanceInstallation() (*appearanceInstallation, error) {
	record, err := s.repo.SystemSetting(appearanceBaselineKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value appearanceInstallation
	if err := json.Unmarshal([]byte(record.ValueJSON), &value); err != nil {
		return nil, errors.New("站点初始配置格式无效")
	}
	return &value, nil
}

func (s *Service) DefaultAppearanceLogo(theme string) ([]byte, error) {
	value, err := s.appearanceInstallation()
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, NotFound("站点初始 Logo 尚未保存")
	}
	if theme == "dark" {
		return []byte(value.DarkLogo), nil
	}
	if theme == "light" {
		return []byte(value.LightLogo), nil
	}
	return nil, NotFound("Logo 主题不存在")
}

func (s *Service) projectInstallationAssets(result *PublicAppearanceSetting) error {
	baseline, err := s.appearanceInstallation()
	if err != nil || baseline == nil {
		return err
	}
	if !result.LogoConfigured {
		result.LogoURL = "/api/public/appearance/default-logo/light"
		result.DarkLogoURL = "/api/public/appearance/default-logo/dark"
		result.LogoConfigured = true
		result.DarkLogoConfigured = true
	}
	if !result.AuthVideoConfigured {
		result.AuthVideoURL = baseline.VideoURL
	}
	if !result.AuthVideoConfigured && !result.AuthVideoPosterConfigured {
		result.AuthVideoPosterURL = baseline.PosterURL
	}
	return nil
}
