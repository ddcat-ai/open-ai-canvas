package service

import "yingce/backend/internal/app"

const (
	PluginSupDanceI18n       = app.PluginSupDanceI18n
	PluginSupDanceSocialAuth = app.PluginSupDanceSocialAuth
)

type (
	SupDanceI18nSettings        = app.SupDanceI18nSettings
	SupDanceI18nEntry           = app.SupDanceI18nEntry
	SupDanceI18nEntryFilter     = app.SupDanceI18nEntryFilter
	SupDanceI18nEntryListResult = app.SupDanceI18nEntryListResult
	SupDanceI18nPublicBundle    = app.SupDanceI18nPublicBundle
	SupDanceI18nAdminOverview   = app.SupDanceI18nAdminOverview
	SupDanceI18nExportPayload   = app.SupDanceI18nExportPayload

	SocialAuthAdminSettingsView   = app.SocialAuthAdminSettingsView
	SocialAuthSettingsUpdateRequest = app.SocialAuthSettingsUpdateRequest
	SocialAuthProviderTestResult  = app.SocialAuthProviderTestResult
	SocialAuthProvidersPublicView = app.SocialAuthProvidersPublicView
	SocialAuthLoginResult         = app.SocialAuthLoginResult
)

