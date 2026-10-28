// Package i18n implements the isolated domain model and dictionary management
// for the SupDance multi-language plugin (supdance-i18n).
// It never imports yingce/backend/internal/app or yingce/backend/internal/service.
package i18n

const (
	// PluginID is the unique plugin identifier for the SupDance i18n plugin.
	PluginID = "supdance-i18n"

	// ConfigSettingKey is the SystemSetting key storing global i18n configuration.
	ConfigSettingKey = "supdance_i18n_config"

	// CustomEntriesSettingKey is the SystemSetting key storing modified and custom dictionary entries.
	CustomEntriesSettingKey = "supdance_i18n_custom_entries"
)

const (
	LocaleZhCN = "zh-CN"
	LocaleEnUS = "en-US"
	LocaleZhTW = "zh-TW"
	LocaleJaJP = "ja-JP"
	LocaleKoKR = "ko-KR"
	LocaleEsES = "es-ES"
)

const (
	SwitcherStyleIconCode = "icon_code"
	SwitcherStyleIconOnly = "icon_only"
	SwitcherStyleIconName = "icon_name"
)

const (
	EntryOriginBuiltin  = "builtin"
	EntryOriginModified = "modified"
	EntryOriginCustom   = "custom"
)

// LanguageItem defines a supported language and its administrative settings.
type LanguageItem struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	NativeName string `json:"nativeName"`
	Badge      string `json:"badge"`
	Direction  string `json:"direction"`
	Enabled    bool   `json:"enabled"`
	SortOrder  int    `json:"sortOrder"`
}

// LanguageStats reports translation completeness for a single language.
type LanguageStats struct {
	LanguageItem
	TranslatedCount int     `json:"translatedCount"`
	TotalCount      int     `json:"totalCount"`
	MissingCount    int     `json:"missingCount"`
	CoveragePercent float64 `json:"coveragePercent"`
}

// Settings holds the administrator-configurable settings for supdance-i18n.
type Settings struct {
	DefaultLocale         string         `json:"defaultLocale"`
	FallbackLocale        string         `json:"fallbackLocale"`
	AutoDetectBrowser     bool           `json:"autoDetectBrowser"`
	SwitcherStyle         string         `json:"switcherStyle"`
	ShowInWorkspaceTopBar bool           `json:"showInWorkspaceTopBar"`
	ShowInAuthPage        bool           `json:"showInAuthPage"`
	ShowInCanvasTopBar    bool           `json:"showInCanvasTopBar"`
	ShowInAdminTopBar     bool           `json:"showInAdminTopBar"`
	TranslateAdminPages   bool           `json:"translateAdminPages"`
	Languages             []LanguageItem `json:"languages"`
	Revision              string         `json:"revision"`
	UpdatedAt             string         `json:"updatedAt,omitempty"`
	UpdatedBy             string         `json:"updatedBy,omitempty"`
}

// Entry represents one i18n dictionary entry across all 6 supported languages.
type Entry struct {
	Key          string            `json:"key"`
	Namespace    string            `json:"namespace"`
	SourceText   string            `json:"sourceText"`
	Description  string            `json:"description,omitempty"`
	Translations map[string]string `json:"translations"`
	Origin       string            `json:"origin"`
	UpdatedAt    string            `json:"updatedAt,omitempty"`
	UpdatedBy    string            `json:"updatedBy,omitempty"`
}

// NamespaceSummary describes a dictionary module category and its entry count.
type NamespaceSummary struct {
	Namespace string `json:"namespace"`
	Label     string `json:"label"`
	Count     int    `json:"count"`
}

// PublicBundle is returned to all clients (including unauthenticated login pages)
// so the frontend can initialize or update its active language and custom overrides.
type PublicBundle struct {
	PluginID      string           `json:"pluginId"`
	PluginEnabled bool             `json:"pluginEnabled"`
	Settings      Settings         `json:"settings"`
	CustomEntries map[string]Entry `json:"customEntries"`
	Revision      string           `json:"revision"`
}

// AdminOverview combines plugin state, settings, per-language stats, and namespace summaries.
type AdminOverview struct {
	PluginID       string             `json:"pluginId"`
	PluginEnabled  bool               `json:"pluginEnabled"`
	Settings       Settings           `json:"settings"`
	LanguageStats  []LanguageStats    `json:"languageStats"`
	Namespaces     []NamespaceSummary `json:"namespaces"`
	TotalEntries   int                `json:"totalEntries"`
	CustomCount    int                `json:"customCount"`
	ModifiedCount  int                `json:"modifiedCount"`
}

// EntryFilter specifies query criteria for the admin entry editor page.
type EntryFilter struct {
	Namespace     string
	Origin        string
	MissingLocale string
	Keyword       string
	Page          int
	PageSize      int
}

// EntryListResult is the paginated response for the admin entry editor page.
type EntryListResult struct {
	Items         []Entry            `json:"items"`
	Total         int                `json:"total"`
	Page          int                `json:"page"`
	PageSize      int                `json:"pageSize"`
	Namespaces    []NamespaceSummary `json:"namespaces"`
	TotalEntries  int                `json:"totalEntries"`
	CustomCount   int                `json:"customCount"`
	ModifiedCount int                `json:"modifiedCount"`
}

// ExportPayload is the portable JSON format for exporting and importing dictionaries.
type ExportPayload struct {
	PluginID   string           `json:"pluginId"`
	Version    string           `json:"version"`
	ExportedAt string           `json:"exportedAt"`
	Settings   Settings         `json:"settings"`
	Entries    []Entry          `json:"entries"`
	Overrides  map[string]Entry `json:"overrides,omitempty"`
}
