package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
	supdancei18n "yingce/backend/internal/supdance/i18n"
)

const (
	PluginSupDanceI18n = supdancei18n.PluginID
)

type (
	SupDanceI18nSettings        = supdancei18n.Settings
	SupDanceI18nEntry           = supdancei18n.Entry
	SupDanceI18nEntryFilter     = supdancei18n.EntryFilter
	SupDanceI18nEntryListResult = supdancei18n.EntryListResult
	SupDanceI18nPublicBundle    = supdancei18n.PublicBundle
	SupDanceI18nAdminOverview   = supdancei18n.AdminOverview
	SupDanceI18nExportPayload   = supdancei18n.ExportPayload
)

var supdanceSystemApplicationPolicies = map[string]PluginManagementView{
	PluginSupDanceI18n: {
		Origin:             PluginOriginOfficial,
		Kind:               PluginKindApplication,
		ActivationScope:    PluginScopeSystem,
		ConfigurationScope: PluginConfigurationSystem,
	},
	PluginSupDanceSocialAuth: {
		Origin:             PluginOriginOfficial,
		Kind:               PluginKindApplication,
		ActivationScope:    PluginScopeSystem,
		ConfigurationScope: PluginConfigurationSystem,
	},
}

func isSupDanceSystemApplicationPluginID(pluginID string) bool {
	_, ok := supdanceSystemApplicationPolicies[strings.TrimSpace(pluginID)]
	return ok
}

// SupDanceI18nPluginAvailable returns whether the supdance-i18n plugin is currently enabled on the platform.
func (s *Service) SupDanceI18nPluginAvailable() (bool, error) {
	if s.repo == nil {
		return true, nil
	}
	state, err := s.repo.PluginPlatformState(PluginSupDanceI18n)
	if err != nil {
		return false, fmt.Errorf("读取多语言插件状态：%w", err)
	}
	if state == nil {
		return true, nil
	}
	return state.Available, nil
}

func (s *Service) readSupDanceI18nSettings() (supdancei18n.Settings, error) {
	defaults := supdancei18n.DefaultSettings()
	if s.repo == nil {
		return defaults, nil
	}
	setting, err := s.repo.SystemSettingOptional(supdancei18n.ConfigSettingKey)
	if err != nil {
		return defaults, fmt.Errorf("读取多语言设置：%w", err)
	}
	if setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return defaults, nil
	}
	var parsed supdancei18n.Settings
	if err := json.Unmarshal([]byte(setting.ValueJSON), &parsed); err != nil {
		return defaults, nil
	}
	normalized, err := supdancei18n.NormalizeSettings(parsed)
	if err != nil {
		return defaults, nil
	}
	normalized.UpdatedAt = setting.UpdatedAt.UTC().Format(time.RFC3339)
	normalized.UpdatedBy = setting.UpdatedBy
	return normalized, nil
}

func (s *Service) readSupDanceI18nCustomEntries() (map[string]supdancei18n.Entry, error) {
	if s.repo == nil {
		return map[string]supdancei18n.Entry{}, nil
	}
	setting, err := s.repo.SystemSettingOptional(supdancei18n.CustomEntriesSettingKey)
	if err != nil {
		return nil, fmt.Errorf("读取自定义词条：%w", err)
	}
	if setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return map[string]supdancei18n.Entry{}, nil
	}
	var custom map[string]supdancei18n.Entry
	if err := json.Unmarshal([]byte(setting.ValueJSON), &custom); err != nil || custom == nil {
		return map[string]supdancei18n.Entry{}, nil
	}
	return custom, nil
}

func (s *Service) saveSupDanceI18nCustomEntries(actorID string, custom map[string]supdancei18n.Entry) error {
	if s.repo == nil {
		return fmt.Errorf("系统配置存储未初始化")
	}
	encoded, err := json.Marshal(custom)
	if err != nil {
		return fmt.Errorf("序列化自定义词条失败：%w", err)
	}
	now := time.Now().UTC()
	return s.repo.SaveSystemSetting(&model.SystemSetting{
		Key:       supdancei18n.CustomEntriesSettingKey,
		ValueJSON: string(encoded),
		UpdatedBy: actorID,
		CreatedAt: now,
		UpdatedAt: now,
	})
}

// PublicSupDanceI18nBundle returns the public i18n configuration and custom overrides for all pages.
func (s *Service) PublicSupDanceI18nBundle() (supdancei18n.PublicBundle, error) {
	enabled, err := s.SupDanceI18nPluginAvailable()
	if err != nil {
		return supdancei18n.PublicBundle{}, err
	}
	settings, err := s.readSupDanceI18nSettings()
	if err != nil {
		return supdancei18n.PublicBundle{}, err
	}
	custom, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.PublicBundle{}, err
	}
	revision := supdancei18n.ComputeRevision(settings, custom, enabled)
	settings.Revision = revision
	if !enabled {
		return supdancei18n.PublicBundle{
			PluginID:      PluginSupDanceI18n,
			PluginEnabled: false,
			Settings:      settings,
			CustomEntries: map[string]supdancei18n.Entry{},
			Revision:      revision,
		}, nil
	}
	return supdancei18n.PublicBundle{
		PluginID:      PluginSupDanceI18n,
		PluginEnabled: true,
		Settings:      settings,
		CustomEntries: custom,
		Revision:      revision,
	}, nil
}

// AdminSupDanceI18nOverview returns the full administrative overview, language coverage stats, and namespace summaries.
func (s *Service) AdminSupDanceI18nOverview(actor *model.User) (supdancei18n.AdminOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	enabled, err := s.SupDanceI18nPluginAvailable()
	if err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	settings, err := s.readSupDanceI18nSettings()
	if err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	custom, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	merged, customCount, modifiedCount := supdancei18n.MergeEntries(custom)
	revision := supdancei18n.ComputeRevision(settings, custom, enabled)
	settings.Revision = revision

	return supdancei18n.AdminOverview{
		PluginID:      PluginSupDanceI18n,
		PluginEnabled: enabled,
		Settings:      settings,
		LanguageStats: supdancei18n.ComputeLanguageStats(settings, merged),
		Namespaces:    supdancei18n.ComputeNamespaces(merged),
		TotalEntries:  len(merged),
		CustomCount:   customCount,
		ModifiedCount: modifiedCount,
	}, nil
}

// UpdateAdminSupDanceI18nSettings validates and saves updated global i18n settings.
func (s *Service) UpdateAdminSupDanceI18nSettings(actor *model.User, input supdancei18n.Settings) (supdancei18n.AdminOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	if s.repo == nil {
		return supdancei18n.AdminOverview{}, fmt.Errorf("系统配置存储未初始化")
	}
	normalized, err := supdancei18n.NormalizeSettings(input)
	if err != nil {
		return supdancei18n.AdminOverview{}, err
	}
	now := time.Now().UTC()
	normalized.UpdatedAt = now.Format(time.RFC3339)
	normalized.UpdatedBy = actor.ID

	encoded, err := json.Marshal(normalized)
	if err != nil {
		return supdancei18n.AdminOverview{}, fmt.Errorf("序列化多语言配置失败：%w", err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{
		Key:       supdancei18n.ConfigSettingKey,
		ValueJSON: string(encoded),
		UpdatedBy: actor.ID,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		return supdancei18n.AdminOverview{}, fmt.Errorf("保存多语言配置失败：%w", err)
	}
	_ = s.appendAdminAudit(actor, "supdance.i18n.settings.update", "plugin", PluginSupDanceI18n, "更新多语言插件设置", map[string]any{
		"defaultLocale":     normalized.DefaultLocale,
		"autoDetectBrowser": normalized.AutoDetectBrowser,
	})
	return s.AdminSupDanceI18nOverview(actor)
}

// ListAdminSupDanceI18nEntries returns filtered and paginated dictionary entries for the admin editor.
func (s *Service) ListAdminSupDanceI18nEntries(actor *model.User, filter supdancei18n.EntryFilter) (supdancei18n.EntryListResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.EntryListResult{}, err
	}
	custom, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.EntryListResult{}, err
	}
	merged, customCount, modifiedCount := supdancei18n.MergeEntries(custom)
	return supdancei18n.FilterEntries(merged, customCount, modifiedCount, filter), nil
}

// UpsertAdminSupDanceI18nEntries creates or updates one or more dictionary entries.
func (s *Service) UpsertAdminSupDanceI18nEntries(actor *model.User, updates []supdancei18n.Entry) (supdancei18n.AdminOverview, int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	existing, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	next, count, err := supdancei18n.UpsertEntries(existing, updates, actor.ID)
	if err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	if err := s.saveSupDanceI18nCustomEntries(actor.ID, next); err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	_ = s.appendAdminAudit(actor, "supdance.i18n.entries.upsert", "plugin", PluginSupDanceI18n, "更新或新增多语言词条", map[string]any{
		"updatedCount": count,
	})
	overview, err := s.AdminSupDanceI18nOverview(actor)
	return overview, count, err
}

// DeleteAdminSupDanceI18nEntry removes a custom entry or resets a modified built-in entry back to default.
func (s *Service) DeleteAdminSupDanceI18nEntry(actor *model.User, key string) (supdancei18n.AdminOverview, bool, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.AdminOverview{}, false, err
	}
	existing, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.AdminOverview{}, false, err
	}
	next, removed := supdancei18n.DeleteOrResetEntry(existing, key)
	if removed {
		if err := s.saveSupDanceI18nCustomEntries(actor.ID, next); err != nil {
			return supdancei18n.AdminOverview{}, false, err
		}
		_ = s.appendAdminAudit(actor, "supdance.i18n.entries.delete", "plugin", PluginSupDanceI18n, "重置或删除多语言词条", map[string]any{
			"key": key,
		})
	}
	overview, err := s.AdminSupDanceI18nOverview(actor)
	return overview, removed, err
}

// ExportAdminSupDanceI18n exports the complete settings and dictionary entries as a portable bundle.
func (s *Service) ExportAdminSupDanceI18n(actor *model.User) (supdancei18n.ExportPayload, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.ExportPayload{}, err
	}
	settings, err := s.readSupDanceI18nSettings()
	if err != nil {
		return supdancei18n.ExportPayload{}, err
	}
	custom, err := s.readSupDanceI18nCustomEntries()
	if err != nil {
		return supdancei18n.ExportPayload{}, err
	}
	merged, _, _ := supdancei18n.MergeEntries(custom)
	return supdancei18n.ExportPayload{
		PluginID:   PluginSupDanceI18n,
		Version:    "1.0.0",
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Settings:   settings,
		Entries:    merged,
		Overrides:  custom,
	}, nil
}

// ImportAdminSupDanceI18n imports dictionary entries (and optionally settings) from a JSON bundle.
func (s *Service) ImportAdminSupDanceI18n(actor *model.User, payload supdancei18n.ExportPayload, replaceAll bool) (supdancei18n.AdminOverview, int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	var base map[string]supdancei18n.Entry
	if replaceAll {
		base = map[string]supdancei18n.Entry{}
	} else {
		var err error
		base, err = s.readSupDanceI18nCustomEntries()
		if err != nil {
			return supdancei18n.AdminOverview{}, 0, err
		}
	}

	toImport := make([]supdancei18n.Entry, 0, len(payload.Overrides)+len(payload.Entries))
	if len(payload.Overrides) > 0 {
		for _, item := range payload.Overrides {
			toImport = append(toImport, item)
		}
	} else {
		for _, item := range payload.Entries {
			if item.Origin == supdancei18n.EntryOriginCustom || item.Origin == supdancei18n.EntryOriginModified {
				toImport = append(toImport, item)
			}
		}
		if len(toImport) == 0 && len(payload.Entries) > 0 {
			toImport = append(toImport, payload.Entries...)
		}
	}
	if len(toImport) == 0 {
		overview, err := s.AdminSupDanceI18nOverview(actor)
		return overview, 0, err
	}

	next, count, err := supdancei18n.UpsertEntries(base, toImport, actor.ID)
	if err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	if err := s.saveSupDanceI18nCustomEntries(actor.ID, next); err != nil {
		return supdancei18n.AdminOverview{}, 0, err
	}
	_ = s.appendAdminAudit(actor, "supdance.i18n.entries.import", "plugin", PluginSupDanceI18n, "批量导入多语言词条", map[string]any{
		"importedCount": count,
		"replaceAll":    replaceAll,
	})
	overview, err := s.AdminSupDanceI18nOverview(actor)
	return overview, count, err
}
