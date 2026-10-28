export const SUPDANCE_I18N_PLUGIN_ID = "supdance-i18n" as const;

export type SupDanceLocaleCode = "zh-CN" | "en-US" | "zh-TW" | "ja-JP" | "ko-KR" | "es-ES";

export type SupDanceSwitcherStyle = "icon_code" | "icon_only" | "icon_name";

export type SupDanceI18nEntryOrigin = "builtin" | "modified" | "custom";

export type SupDanceLanguageItem = {
    code: SupDanceLocaleCode;
    name: string;
    nativeName: string;
    badge: string;
    direction: "ltr" | "rtl";
    enabled: boolean;
    sortOrder: number;
};

export type SupDanceLanguageStats = SupDanceLanguageItem & {
    translatedCount: number;
    totalCount: number;
    missingCount: number;
    coveragePercent: number;
};

export type SupDanceI18nSettings = {
    defaultLocale: SupDanceLocaleCode;
    fallbackLocale: SupDanceLocaleCode;
    autoDetectBrowser: boolean;
    switcherStyle: SupDanceSwitcherStyle;
    showInWorkspaceTopBar: boolean;
    showInAuthPage: boolean;
    showInCanvasTopBar: boolean;
    showInAdminTopBar: boolean;
    translateAdminPages: boolean;
    languages: SupDanceLanguageItem[];
    revision: string;
    updatedAt?: string;
    updatedBy?: string;
};

export type SupDanceI18nEntry = {
    key: string;
    namespace: string;
    sourceText: string;
    description?: string;
    translations: Record<SupDanceLocaleCode, string>;
    origin: SupDanceI18nEntryOrigin;
    updatedAt?: string;
    updatedBy?: string;
};

export type SupDanceI18nNamespaceSummary = {
    namespace: string;
    label: string;
    count: number;
};

export type SupDanceI18nPublicBundle = {
    pluginId: string;
    pluginEnabled: boolean;
    settings: SupDanceI18nSettings;
    customEntries: Record<string, SupDanceI18nEntry>;
    revision: string;
};

export type SupDanceI18nAdminOverview = {
    pluginId: string;
    pluginEnabled: boolean;
    settings: SupDanceI18nSettings;
    languageStats: SupDanceLanguageStats[];
    namespaces: SupDanceI18nNamespaceSummary[];
    totalEntries: number;
    customCount: number;
    modifiedCount: number;
};

export type SupDanceI18nEntryQuery = {
    namespace?: string;
    origin?: string;
    missingLocale?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
};

export type SupDanceI18nEntryListResult = {
    items: SupDanceI18nEntry[];
    total: number;
    page: number;
    pageSize: number;
    namespaces: SupDanceI18nNamespaceSummary[];
    totalEntries: number;
    customCount: number;
    modifiedCount: number;
};

export type SupDanceI18nExportPayload = {
    pluginId: string;
    version: string;
    exportedAt: string;
    settings: SupDanceI18nSettings;
    entries: SupDanceI18nEntry[];
    overrides?: Record<string, SupDanceI18nEntry>;
};

export type SupDanceDiscoveredTextItem = {
    sourceText: string;
    route: string;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
};
