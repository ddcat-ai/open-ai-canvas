import { useMemo } from "react";
import { create } from "zustand";
import { usePluginStore } from "@/stores/use-plugin-store";
import { getAntdLocaleForCode } from "./engine/antd-locale";
import { compileI18nDictionary, isCandidateUntranslatedChinese, translateByKey, translateSourceText, type CompiledI18nDictionary } from "./engine/translator";
import { BUILTIN_I18N_ENTRIES, DEFAULT_SUPDANCE_I18N_SETTINGS, mergeI18nEntries, SUPPORTED_LOCALE_CODES } from "./locales";
import { SUPDANCE_I18N_PLUGIN_ID, type SupDanceDiscoveredTextItem, type SupDanceI18nEntry, type SupDanceI18nPublicBundle, type SupDanceI18nSettings, type SupDanceLanguageItem, type SupDanceLocaleCode } from "./types";

export const SUPDANCE_I18N_LOCALE_STORAGE_KEY = "supdance:i18n:locale";
export const SUPDANCE_I18N_CACHE_STORAGE_KEY = "supdance:i18n:config-cache";
export const SUPDANCE_I18N_DISCOVERED_STORAGE_KEY = "supdance:i18n:discovered-untranslated";
const MAX_DISCOVERED_ITEMS = 200;

type StoredI18nCache = {
    pluginEnabled?: boolean;
    settings?: SupDanceI18nSettings;
    customEntries?: Record<string, SupDanceI18nEntry>;
};

function readStoredCache(): StoredI18nCache | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(SUPDANCE_I18N_CACHE_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as StoredI18nCache;
    } catch {
        return null;
    }
}

function writeStoredCache(cache: StoredI18nCache): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(SUPDANCE_I18N_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
        // Ignore storage write errors in restricted privacy contexts
    }
}

function readStoredDiscovered(): SupDanceDiscoveredTextItem[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(SUPDANCE_I18N_DISCOVERED_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as SupDanceDiscoveredTextItem[]) : [];
    } catch {
        return [];
    }
}

function writeStoredDiscovered(items: SupDanceDiscoveredTextItem[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(SUPDANCE_I18N_DISCOVERED_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_DISCOVERED_ITEMS)));
    } catch {
        // Ignore storage write errors
    }
}

function isValidLocaleCode(value: unknown): value is SupDanceLocaleCode {
    return typeof value === "string" && (SUPPORTED_LOCALE_CODES as readonly string[]).includes(value);
}

function matchBrowserLocale(enabledLanguages: SupDanceLanguageItem[]): SupDanceLocaleCode | null {
    if (typeof navigator === "undefined") return null;
    const enabledSet = new Set(enabledLanguages.filter((l) => l.enabled).map((l) => l.code));
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const raw of candidates) {
        if (!raw) continue;
        const normalized = raw.trim().toLowerCase();
        if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-mo") || normalized.includes("hant")) {
            if (enabledSet.has("zh-TW")) return "zh-TW";
        }
        if (normalized.startsWith("zh")) {
            if (enabledSet.has("zh-CN")) return "zh-CN";
        }
        if (normalized.startsWith("en")) {
            if (enabledSet.has("en-US")) return "en-US";
        }
        if (normalized.startsWith("ja")) {
            if (enabledSet.has("ja-JP")) return "ja-JP";
        }
        if (normalized.startsWith("ko")) {
            if (enabledSet.has("ko-KR")) return "ko-KR";
        }
        if (normalized.startsWith("es")) {
            if (enabledSet.has("es-ES")) return "es-ES";
        }
    }
    return null;
}

function readStoredLocale(): SupDanceLocaleCode | null {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.localStorage.getItem(SUPDANCE_I18N_LOCALE_STORAGE_KEY);
        return isValidLocaleCode(stored) ? stored : null;
    } catch {
        return null;
    }
}

function writeStoredLocale(locale: SupDanceLocaleCode): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(SUPDANCE_I18N_LOCALE_STORAGE_KEY, locale);
    } catch {
        // Ignore storage write errors in restricted privacy contexts
    }
}

function resolveEffectiveLocale(preferred: SupDanceLocaleCode | null, settings: SupDanceI18nSettings): SupDanceLocaleCode {
    const enabledCodes = new Set(settings.languages.filter((item) => item.enabled).map((item) => item.code));
    if (preferred && enabledCodes.has(preferred)) {
        return preferred;
    }
    if (settings.autoDetectBrowser) {
        const detected = matchBrowserLocale(settings.languages);
        if (detected && enabledCodes.has(detected)) {
            return detected;
        }
    }
    if (enabledCodes.has(settings.defaultLocale)) {
        return settings.defaultLocale;
    }
    const firstEnabled = settings.languages.find((item) => item.enabled)?.code;
    return firstEnabled ?? "zh-CN";
}

function filterOutTranslatedDiscovered(discovered: SupDanceDiscoveredTextItem[], dictionary: CompiledI18nDictionary): SupDanceDiscoveredTextItem[] {
    return discovered.filter((item) => translateSourceText(dictionary, item.sourceText, "en-US", "zh-CN") === null);
}

const initialCache = readStoredCache();
const initialSettings = initialCache?.settings ?? DEFAULT_SUPDANCE_I18N_SETTINGS;
const initialCustomEntries = initialCache?.customEntries ?? {};
const initialPluginEnabled = typeof initialCache?.pluginEnabled === "boolean" ? initialCache.pluginEnabled : true;
const initialEntries = mergeI18nEntries(initialCustomEntries);
const initialDictionary = compileI18nDictionary(initialEntries);
const initialLocale = resolveEffectiveLocale(readStoredLocale(), initialSettings);
const initialDiscovered = filterOutTranslatedDiscovered(readStoredDiscovered(), initialDictionary);

export type SupDanceI18nStoreState = {
    initialized: boolean;
    pluginEnabled: boolean;
    locale: SupDanceLocaleCode;
    settings: SupDanceI18nSettings;
    customEntries: Record<string, SupDanceI18nEntry>;
    entries: SupDanceI18nEntry[];
    dictionary: CompiledI18nDictionary;
    discoveredUntranslated: SupDanceDiscoveredTextItem[];
    revision: string;
    setLocale: (locale: SupDanceLocaleCode) => void;
    setPluginEnabled: (enabled: boolean) => void;
    applyBundle: (bundle: SupDanceI18nPublicBundle) => void;
    updateLocalSettings: (settings: SupDanceI18nSettings) => void;
    upsertLocalEntries: (items: SupDanceI18nEntry[]) => void;
    removeLocalEntry: (key: string) => void;
    recordUntranslatedText: (sourceText: string, route?: string) => void;
    clearDiscoveredUntranslated: (sourceText?: string) => void;
    syncFromStorage: () => void;
};

export const useSupDanceI18nStore = create<SupDanceI18nStoreState>((set, get) => ({
    initialized: false,
    pluginEnabled: initialPluginEnabled,
    locale: initialLocale,
    settings: initialSettings,
    customEntries: initialCustomEntries,
    entries: initialEntries,
    dictionary: initialDictionary,
    discoveredUntranslated: initialDiscovered,
    revision: initialSettings.revision || DEFAULT_SUPDANCE_I18N_SETTINGS.revision,

    setLocale: (nextLocale) => {
        const { settings } = get();
        const enabledCodes = new Set(settings.languages.filter((item) => item.enabled).map((item) => item.code));
        const resolved = enabledCodes.has(nextLocale) ? nextLocale : settings.defaultLocale;
        writeStoredLocale(resolved);
        set({ locale: resolved });
    },

    setPluginEnabled: (enabled) => {
        const { settings, customEntries } = get();
        writeStoredCache({ pluginEnabled: enabled, settings, customEntries });
        set({ pluginEnabled: enabled });
    },

    applyBundle: (bundle) => {
        const currentStored = readStoredLocale();
        const settings = bundle.settings ?? DEFAULT_SUPDANCE_I18N_SETTINGS;
        const customEntries = bundle.customEntries ?? {};
        const pluginEnabled = Boolean(bundle.pluginEnabled);
        const entries = mergeI18nEntries(customEntries);
        const dictionary = compileI18nDictionary(entries);
        const nextLocale = resolveEffectiveLocale(currentStored ?? get().locale, settings);
        const discoveredUntranslated = filterOutTranslatedDiscovered(get().discoveredUntranslated, dictionary);

        writeStoredCache({ pluginEnabled, settings, customEntries });
        writeStoredDiscovered(discoveredUntranslated);
        set({
            initialized: true,
            pluginEnabled,
            settings,
            customEntries,
            entries,
            dictionary,
            discoveredUntranslated,
            locale: nextLocale,
            revision: bundle.revision || settings.revision || "builtin-v1",
        });
    },

    updateLocalSettings: (settings) => {
        const currentStored = readStoredLocale();
        const nextLocale = resolveEffectiveLocale(currentStored ?? get().locale, settings);
        writeStoredCache({
            pluginEnabled: get().pluginEnabled,
            settings,
            customEntries: get().customEntries,
        });
        set({
            settings,
            locale: nextLocale,
            revision: settings.revision || get().revision,
        });
    },

    upsertLocalEntries: (items) => {
        const nextCustom = { ...get().customEntries };
        for (const item of items) {
            if (!item?.key) continue;
            nextCustom[item.key] = item;
        }
        const entries = mergeI18nEntries(nextCustom);
        const dictionary = compileI18nDictionary(entries);
        const discoveredUntranslated = filterOutTranslatedDiscovered(get().discoveredUntranslated, dictionary);
        writeStoredCache({
            pluginEnabled: get().pluginEnabled,
            settings: get().settings,
            customEntries: nextCustom,
        });
        writeStoredDiscovered(discoveredUntranslated);
        set({
            customEntries: nextCustom,
            entries,
            dictionary,
            discoveredUntranslated,
            revision: `local-${Date.now()}`,
        });
    },

    removeLocalEntry: (key) => {
        const nextCustom = { ...get().customEntries };
        delete nextCustom[key];
        const entries = mergeI18nEntries(nextCustom);
        const dictionary = compileI18nDictionary(entries);
        writeStoredCache({
            pluginEnabled: get().pluginEnabled,
            settings: get().settings,
            customEntries: nextCustom,
        });
        set({
            customEntries: nextCustom,
            entries,
            dictionary,
            revision: `local-${Date.now()}`,
        });
    },

    recordUntranslatedText: (rawSourceText, route) => {
        const trimmed = rawSourceText.trim();
        if (!isCandidateUntranslatedChinese(trimmed)) return;
        const { dictionary, discoveredUntranslated } = get();
        if (translateSourceText(dictionary, trimmed, "en-US", "zh-CN") !== null) return;

        const now = new Date().toISOString();
        const activeRoute = route || (typeof window !== "undefined" ? window.location.pathname : "/");
        const existingIndex = discoveredUntranslated.findIndex((item) => item.sourceText === trimmed);
        if (existingIndex >= 0) {
            const existing = discoveredUntranslated[existingIndex]!;
            // Avoid noisy state churn if already recorded on this route recently
            if (existing.route === activeRoute && existing.count >= 1) return;
            const next = [...discoveredUntranslated];
            next[existingIndex] = {
                ...existing,
                route: activeRoute,
                count: existing.count + 1,
                lastSeenAt: now,
            };
            writeStoredDiscovered(next);
            set({ discoveredUntranslated: next });
            return;
        }

        if (discoveredUntranslated.length >= MAX_DISCOVERED_ITEMS) return;
        const next: SupDanceDiscoveredTextItem[] = [
            {
                sourceText: trimmed,
                route: activeRoute,
                count: 1,
                firstSeenAt: now,
                lastSeenAt: now,
            },
            ...discoveredUntranslated,
        ];
        writeStoredDiscovered(next);
        set({ discoveredUntranslated: next });
    },

    clearDiscoveredUntranslated: (sourceText) => {
        if (!sourceText) {
            writeStoredDiscovered([]);
            set({ discoveredUntranslated: [] });
            return;
        }
        const next = get().discoveredUntranslated.filter((item) => item.sourceText !== sourceText);
        writeStoredDiscovered(next);
        set({ discoveredUntranslated: next });
    },

    syncFromStorage: () => {
        const storedCache = readStoredCache();
        const storedLocale = readStoredLocale();
        const settings = storedCache?.settings ?? get().settings;
        const customEntries = storedCache?.customEntries ?? get().customEntries;
        const pluginEnabled = typeof storedCache?.pluginEnabled === "boolean" ? storedCache.pluginEnabled : get().pluginEnabled;
        const entries = mergeI18nEntries(customEntries);
        const dictionary = compileI18nDictionary(entries);
        const locale = resolveEffectiveLocale(storedLocale ?? get().locale, settings);
        const discoveredUntranslated = filterOutTranslatedDiscovered(readStoredDiscovered(), dictionary);
        set({
            pluginEnabled,
            settings,
            customEntries,
            entries,
            dictionary,
            locale,
            discoveredUntranslated,
            revision: `storage-${Date.now()}`,
        });
    },
}));

/**
 * Checks if the supdance-i18n plugin is currently active across both the global plugin store
 * and the i18n bundle state.
 */
export function useSupDanceI18nEnabled(): boolean {
    const storePluginEnabled = useSupDanceI18nStore((s) => s.pluginEnabled);
    const platformAvailable = usePluginStore((state) => {
        const pluginState = state.pluginStates[SUPDANCE_I18N_PLUGIN_ID];
        if (pluginState) {
            if (typeof pluginState.platformAvailable === "boolean" && !pluginState.platformAvailable) {
                return false;
            }
            if (typeof pluginState.effectiveEnabled === "boolean") {
                return pluginState.effectiveEnabled;
            }
        }
        const installation = state.installations.find((item) => item.manifest.id === SUPDANCE_I18N_PLUGIN_ID);
        if (installation && typeof installation.enabled === "boolean") {
            return installation.enabled;
        }
        return true;
    });
    return storePluginEnabled && platformAvailable;
}

/**
 * Hook returning the active Ant Design Locale object.
 * Automatically falls back to zh-CN when the plugin is disabled.
 */
export function useSupDanceAntdLocale() {
    const enabled = useSupDanceI18nEnabled();
    const locale = useSupDanceI18nStore((s) => s.locale);
    const effectiveLocale: SupDanceLocaleCode = enabled ? locale : "zh-CN";
    return useMemo(() => getAntdLocaleForCode(effectiveLocale), [effectiveLocale]);
}

/**
 * Main i18n hook for components that want explicit key/text translation and locale switching.
 */
export function useI18n() {
    const enabled = useSupDanceI18nEnabled();
    const locale = useSupDanceI18nStore((s) => s.locale);
    const settings = useSupDanceI18nStore((s) => s.settings);
    const dictionary = useSupDanceI18nStore((s) => s.dictionary);
    const setLocale = useSupDanceI18nStore((s) => s.setLocale);

    const effectiveLocale: SupDanceLocaleCode = enabled ? locale : "zh-CN";

    const enabledLanguages = useMemo(() => [...settings.languages].filter((item) => item.enabled).sort((a, b) => a.sortOrder - b.sortOrder), [settings.languages]);

    const currentLanguage = useMemo(
        () =>
            settings.languages.find((item) => item.code === effectiveLocale) ??
            settings.languages[0] ?? {
                code: "zh-CN" as const,
                name: "简体中文",
                nativeName: "简体中文",
                badge: "中",
                direction: "ltr" as const,
                enabled: true,
                sortOrder: 1,
            },
        [effectiveLocale, settings.languages],
    );

    const t = useMemo(() => {
        return (keyOrText: string, params?: Record<string, string | number>, fallbackText?: string): string => {
            if (!enabled) {
                return fallbackText ?? keyOrText;
            }
            if (dictionary.byKey.has(keyOrText)) {
                return translateByKey(dictionary, keyOrText, effectiveLocale, settings.fallbackLocale, params, fallbackText);
            }
            return translateSourceText(dictionary, keyOrText, effectiveLocale, settings.fallbackLocale) ?? fallbackText ?? keyOrText;
        };
    }, [dictionary, effectiveLocale, enabled, settings.fallbackLocale]);

    return {
        enabled,
        locale: effectiveLocale,
        currentLanguage,
        enabledLanguages,
        settings,
        setLocale,
        t,
        builtinCount: BUILTIN_I18N_ENTRIES.length,
    };
}
