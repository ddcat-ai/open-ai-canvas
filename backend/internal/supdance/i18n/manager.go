package i18n

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

var validKeyRegex = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,160}$`)

// IsSupportedLocale reports whether the given locale code is one of the 6 core languages.
func IsSupportedLocale(code string) bool {
	trimmed := strings.TrimSpace(code)
	for _, item := range SupportedLocaleCodes {
		if item == trimmed {
			return true
		}
	}
	return false
}

// NormalizeSettings validates and normalizes user-submitted settings, filling defaults where needed.
func NormalizeSettings(input Settings) (Settings, error) {
	defaults := DefaultSettings()
	defaultByCode := make(map[string]LanguageItem, len(defaults.Languages))
	for _, lang := range defaults.Languages {
		defaultByCode[lang.Code] = lang
	}

	seen := make(map[string]bool, len(defaults.Languages))
	languages := make([]LanguageItem, 0, len(defaults.Languages))
	for idx, item := range input.Languages {
		code := strings.TrimSpace(item.Code)
		base, ok := defaultByCode[code]
		if !ok {
			continue
		}
		if seen[code] {
			continue
		}
		seen[code] = true
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = base.Name
		}
		nativeName := strings.TrimSpace(item.NativeName)
		if nativeName == "" {
			nativeName = base.NativeName
		}
		badge := strings.TrimSpace(item.Badge)
		if badge == "" {
			badge = base.Badge
		}
		sortOrder := item.SortOrder
		if sortOrder <= 0 {
			sortOrder = idx + 1
		}
		languages = append(languages, LanguageItem{
			Code:       code,
			Name:       name,
			NativeName: nativeName,
			Badge:      badge,
			Direction:  "ltr",
			Enabled:    item.Enabled,
			SortOrder:  sortOrder,
		})
	}
	for _, base := range defaults.Languages {
		if !seen[base.Code] {
			base.SortOrder = len(languages) + 1
			languages = append(languages, base)
		}
	}

	sort.SliceStable(languages, func(i, j int) bool {
		if languages[i].SortOrder != languages[j].SortOrder {
			return languages[i].SortOrder < languages[j].SortOrder
		}
		return languages[i].Code < languages[j].Code
	})
	for i := range languages {
		languages[i].SortOrder = i + 1
	}

	enabledCount := 0
	enabledSet := make(map[string]bool, len(languages))
	for _, lang := range languages {
		if lang.Enabled {
			enabledCount++
			enabledSet[lang.Code] = true
		}
	}
	if enabledCount == 0 {
		return Settings{}, fmt.Errorf("至少需要启用一种站点语言")
	}

	defaultLocale := strings.TrimSpace(input.DefaultLocale)
	if !IsSupportedLocale(defaultLocale) {
		defaultLocale = defaults.DefaultLocale
	}
	if !enabledSet[defaultLocale] {
		// Automatically enable the selected default locale so the site always has a valid default.
		for i := range languages {
			if languages[i].Code == defaultLocale {
				languages[i].Enabled = true
				enabledSet[defaultLocale] = true
				break
			}
		}
	}

	fallbackLocale := strings.TrimSpace(input.FallbackLocale)
	if !IsSupportedLocale(fallbackLocale) {
		fallbackLocale = LocaleZhCN
	}

	switcherStyle := strings.TrimSpace(input.SwitcherStyle)
	switch switcherStyle {
	case SwitcherStyleIconCode, SwitcherStyleIconOnly, SwitcherStyleIconName:
	default:
		switcherStyle = SwitcherStyleIconCode
	}

	return Settings{
		DefaultLocale:         defaultLocale,
		FallbackLocale:        fallbackLocale,
		AutoDetectBrowser:     input.AutoDetectBrowser,
		SwitcherStyle:         switcherStyle,
		ShowInWorkspaceTopBar: input.ShowInWorkspaceTopBar,
		ShowInAuthPage:        input.ShowInAuthPage,
		ShowInCanvasTopBar:    input.ShowInCanvasTopBar,
		ShowInAdminTopBar:     input.ShowInAdminTopBar,
		TranslateAdminPages:   input.TranslateAdminPages,
		Languages:             languages,
		UpdatedAt:             input.UpdatedAt,
		UpdatedBy:             input.UpdatedBy,
	}, nil
}

// MergeEntries merges built-in dictionary entries with administrator overrides and custom entries.
func MergeEntries(custom map[string]Entry) ([]Entry, int, int) {
	builtins := BuiltinEntries()
	builtinKeys := make(map[string]Entry, len(builtins))
	result := make([]Entry, 0, len(builtins)+len(custom))
	modifiedCount := 0
	customCount := 0

	for _, b := range builtins {
		builtinKeys[b.Key] = b
		if override, ok := custom[b.Key]; ok {
			mergedTrans := make(map[string]string, len(SupportedLocaleCodes))
			for _, code := range SupportedLocaleCodes {
				mergedTrans[code] = b.Translations[code]
				if val, has := override.Translations[code]; has && strings.TrimSpace(val) != "" {
					mergedTrans[code] = strings.TrimSpace(val)
				}
			}
			sourceText := b.SourceText
			if trimmedOverrideSource := strings.TrimSpace(override.SourceText); trimmedOverrideSource != "" && trimmedOverrideSource != mergedTrans[LocaleZhCN] {
				sourceText = trimmedOverrideSource
			}
			desc := strings.TrimSpace(override.Description)
			if desc == "" {
				desc = b.Description
			}
			ns := strings.TrimSpace(override.Namespace)
			if ns == "" {
				ns = b.Namespace
			}
			result = append(result, Entry{
				Key:          b.Key,
				Namespace:    ns,
				SourceText:   sourceText,
				Description:  desc,
				Translations: mergedTrans,
				Origin:       EntryOriginModified,
				UpdatedAt:    override.UpdatedAt,
				UpdatedBy:    override.UpdatedBy,
			})
			modifiedCount++
		} else {
			clonedTrans := make(map[string]string, len(b.Translations))
			for k, v := range b.Translations {
				clonedTrans[k] = v
			}
			b.Translations = clonedTrans
			result = append(result, b)
		}
	}

	customKeys := make([]string, 0, len(custom))
	for k := range custom {
		if _, isBuiltin := builtinKeys[k]; !isBuiltin {
			customKeys = append(customKeys, k)
		}
	}
	sort.Strings(customKeys)

	for _, k := range customKeys {
		c := custom[k]
		trans := make(map[string]string, len(SupportedLocaleCodes))
		for _, code := range SupportedLocaleCodes {
			trans[code] = strings.TrimSpace(c.Translations[code])
		}
		sourceText := strings.TrimSpace(c.SourceText)
		if sourceText == "" {
			sourceText = trans[LocaleZhCN]
		}
		if trans[LocaleZhCN] == "" && sourceText != "" {
			trans[LocaleZhCN] = sourceText
		}
		ns := strings.TrimSpace(c.Namespace)
		if ns == "" {
			ns = "custom"
		}
		result = append(result, Entry{
			Key:          k,
			Namespace:    ns,
			SourceText:   sourceText,
			Description:  strings.TrimSpace(c.Description),
			Translations: trans,
			Origin:       EntryOriginCustom,
			UpdatedAt:    c.UpdatedAt,
			UpdatedBy:    c.UpdatedBy,
		})
		customCount++
	}

	return result, customCount, modifiedCount
}

// ComputeLanguageStats calculates translation coverage across all merged entries for each language.
func ComputeLanguageStats(settings Settings, entries []Entry) []LanguageStats {
	total := len(entries)
	stats := make([]LanguageStats, 0, len(settings.Languages))
	for _, lang := range settings.Languages {
		translated := 0
		for _, item := range entries {
			if strings.TrimSpace(item.Translations[lang.Code]) != "" {
				translated++
			}
		}
		missing := total - translated
		coverage := 100.0
		if total > 0 {
			coverage = math.Round((float64(translated)/float64(total))*1000) / 10
		}
		stats = append(stats, LanguageStats{
			LanguageItem:    lang,
			TranslatedCount: translated,
			TotalCount:      total,
			MissingCount:    missing,
			CoveragePercent: coverage,
		})
	}
	return stats
}

// ComputeNamespaces returns namespace counts in stable display order.
func ComputeNamespaces(entries []Entry) []NamespaceSummary {
	counts := make(map[string]int, len(NamespaceOrder))
	for _, item := range entries {
		ns := item.Namespace
		if ns == "" {
			ns = "custom"
		}
		counts[ns]++
	}
	summaries := make([]NamespaceSummary, 0, len(NamespaceOrder))
	seen := make(map[string]bool, len(NamespaceOrder))
	for _, ns := range NamespaceOrder {
		seen[ns] = true
		summaries = append(summaries, NamespaceSummary{
			Namespace: ns,
			Label:     NamespaceLabels[ns],
			Count:     counts[ns],
		})
	}
	for ns, count := range counts {
		if !seen[ns] {
			summaries = append(summaries, NamespaceSummary{
				Namespace: ns,
				Label:     ns,
				Count:     count,
			})
		}
	}
	return summaries
}

// FilterEntries filters and paginates merged entries for the admin dictionary editor.
func FilterEntries(entries []Entry, customCount, modifiedCount int, filter EntryFilter) EntryListResult {
	namespaces := ComputeNamespaces(entries)
	ns := strings.TrimSpace(filter.Namespace)
	origin := strings.TrimSpace(filter.Origin)
	missingLocale := strings.TrimSpace(filter.MissingLocale)
	keyword := strings.ToLower(strings.TrimSpace(filter.Keyword))

	filtered := make([]Entry, 0, len(entries))
	for _, item := range entries {
		if ns != "" && ns != "all" && item.Namespace != ns {
			continue
		}
		if origin != "" && origin != "all" && item.Origin != origin {
			continue
		}
		if missingLocale != "" && IsSupportedLocale(missingLocale) {
			if strings.TrimSpace(item.Translations[missingLocale]) != "" {
				continue
			}
		}
		if keyword != "" {
			matched := strings.Contains(strings.ToLower(item.Key), keyword) ||
				strings.Contains(strings.ToLower(item.SourceText), keyword) ||
				strings.Contains(strings.ToLower(item.Description), keyword)
			if !matched {
				for _, val := range item.Translations {
					if strings.Contains(strings.ToLower(val), keyword) {
						matched = true
						break
					}
				}
			}
			if !matched {
				continue
			}
		}
		filtered = append(filtered, item)
	}

	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}
	page := filter.Page
	if page <= 0 {
		page = 1
	}
	total := len(filtered)
	maxPage := 1
	if total > 0 {
		maxPage = (total + pageSize - 1) / pageSize
	}
	if page > maxPage {
		page = maxPage
	}
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	return EntryListResult{
		Items:         filtered[start:end],
		Total:         total,
		Page:          page,
		PageSize:      pageSize,
		Namespaces:    namespaces,
		TotalEntries:  len(entries),
		CustomCount:   customCount,
		ModifiedCount: modifiedCount,
	}
}

// UpsertEntries validates and merges one or more updated/new entries into the custom overrides map.
func UpsertEntries(existing map[string]Entry, updates []Entry, actorID string) (map[string]Entry, int, error) {
	if len(updates) == 0 {
		return nil, 0, fmt.Errorf("请至少提交一条词条记录")
	}
	if len(updates) > 2000 {
		return nil, 0, fmt.Errorf("单次最多更新 2000 条词条")
	}

	builtins := BuiltinEntries()
	builtinByKey := make(map[string]Entry, len(builtins))
	for _, b := range builtins {
		builtinByKey[b.Key] = b
	}

	next := make(map[string]Entry, len(existing)+len(updates))
	for k, v := range existing {
		next[k] = v
	}

	now := time.Now().UTC().Format(time.RFC3339)
	updatedCount := 0

	for _, item := range updates {
		key := strings.TrimSpace(item.Key)
		sourceText := strings.TrimSpace(item.SourceText)
		if sourceText == "" && item.Translations != nil {
			sourceText = strings.TrimSpace(item.Translations[LocaleZhCN])
		}
		if key == "" && sourceText != "" {
			hash := sha256.Sum256([]byte(sourceText))
			key = "custom." + hex.EncodeToString(hash[:6])
		}
		if !validKeyRegex.MatchString(key) {
			return nil, 0, fmt.Errorf("词条 Key %q 格式不合法（仅支持字母、数字、点、下划线、短横线）", key)
		}

		base, isBuiltin := builtinByKey[key]
		if !isBuiltin && sourceText == "" {
			return nil, 0, fmt.Errorf("词条 %q 缺少基准中文原文（sourceText 或 zh-CN）", key)
		}
		if isBuiltin && sourceText == "" {
			sourceText = base.SourceText
		}

		ns := strings.TrimSpace(item.Namespace)
		if isBuiltin {
			ns = base.Namespace
		} else if ns == "" {
			ns = "custom"
		}

		trans := make(map[string]string, len(SupportedLocaleCodes))
		for _, code := range SupportedLocaleCodes {
			val := ""
			if item.Translations != nil {
				val = strings.TrimSpace(item.Translations[code])
			}
			if val == "" && isBuiltin {
				val = base.Translations[code]
			}
			trans[code] = val
		}
		if trans[LocaleZhCN] == "" {
			trans[LocaleZhCN] = sourceText
		}

		origin := EntryOriginCustom
		if isBuiltin {
			origin = EntryOriginModified
		}

		desc := strings.TrimSpace(item.Description)
		if desc == "" && isBuiltin {
			desc = base.Description
		}

		next[key] = Entry{
			Key:          key,
			Namespace:    ns,
			SourceText:   sourceText,
			Description:  desc,
			Translations: trans,
			Origin:       origin,
			UpdatedAt:    now,
			UpdatedBy:    actorID,
		}
		updatedCount++
	}

	return next, updatedCount, nil
}

// DeleteOrResetEntry removes a custom entry or resets a modified built-in entry back to its default.
func DeleteOrResetEntry(existing map[string]Entry, key string) (map[string]Entry, bool) {
	trimmed := strings.TrimSpace(key)
	if _, ok := existing[trimmed]; !ok {
		return existing, false
	}
	next := make(map[string]Entry, len(existing))
	for k, v := range existing {
		if k != trimmed {
			next[k] = v
		}
	}
	return next, true
}

// ComputeRevision returns a deterministic short hash for client cache invalidation.
func ComputeRevision(settings Settings, custom map[string]Entry, pluginEnabled bool) string {
	payload := struct {
		Enabled  bool             `json:"enabled"`
		Settings Settings         `json:"settings"`
		Custom   map[string]Entry `json:"custom"`
	}{
		Enabled:  pluginEnabled,
		Settings: settings,
		Custom:   custom,
	}
	payload.Settings.Revision = ""
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8])
}
