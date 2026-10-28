import { useEffect, useRef } from "react";
import { usePluginStore } from "@/stores/use-plugin-store";
import { getPublicSupDanceI18nBundle } from "../api";
import { SupDanceDomTranslator } from "../engine/dom-observer";
import { SUPDANCE_I18N_CACHE_STORAGE_KEY, SUPDANCE_I18N_DISCOVERED_STORAGE_KEY, SUPDANCE_I18N_LOCALE_STORAGE_KEY, useSupDanceI18nEnabled, useSupDanceI18nStore } from "../store";
import { SUPDANCE_I18N_PLUGIN_ID } from "../types";

export function SupDanceI18nRuntimeHost() {
    const enabled = useSupDanceI18nEnabled();
    const locale = useSupDanceI18nStore((s) => s.locale);
    const settings = useSupDanceI18nStore((s) => s.settings);
    const dictionary = useSupDanceI18nStore((s) => s.dictionary);
    const revision = useSupDanceI18nStore((s) => s.revision);
    const applyBundle = useSupDanceI18nStore((s) => s.applyBundle);
    const recordUntranslatedText = useSupDanceI18nStore((s) => s.recordUntranslatedText);
    const syncFromStorage = useSupDanceI18nStore((s) => s.syncFromStorage);

    const translatorRef = useRef<SupDanceDomTranslator | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const controller = new AbortController();

        const syncBundle = async () => {
            try {
                const bundle = await getPublicSupDanceI18nBundle(controller.signal);
                if (!bundle) return;
                applyBundle(bundle);
                const pluginStore = usePluginStore.getState();
                const current = pluginStore.pluginStates[SUPDANCE_I18N_PLUGIN_ID];
                if (!current || current.platformAvailable !== bundle.pluginEnabled) {
                    usePluginStore.setState((state) => ({
                        pluginStates: {
                            ...state.pluginStates,
                            [SUPDANCE_I18N_PLUGIN_ID]: {
                                pluginId: SUPDANCE_I18N_PLUGIN_ID,
                                platformAvailable: bundle.pluginEnabled,
                                userEnabled: bundle.pluginEnabled,
                                userConfigured: true,
                                effectiveEnabled: bundle.pluginEnabled,
                                canToggle: false,
                                canConfigure: false,
                            },
                        },
                    }));
                }
            } catch {
                // Keep built-in dictionary and local state when offline
            }
        };

        void syncBundle();

        const handleFocus = () => {
            void syncBundle();
        };

        const handleStorage = (event: StorageEvent) => {
            if (event.key === SUPDANCE_I18N_LOCALE_STORAGE_KEY || event.key === SUPDANCE_I18N_CACHE_STORAGE_KEY || event.key === SUPDANCE_I18N_DISCOVERED_STORAGE_KEY) {
                syncFromStorage();
            }
        };

        window.addEventListener("focus", handleFocus);
        window.addEventListener("storage", handleStorage);
        return () => {
            controller.abort();
            window.removeEventListener("focus", handleFocus);
            window.removeEventListener("storage", handleStorage);
        };
    }, [applyBundle, syncFromStorage]);

    useEffect(() => {
        if (typeof document === "undefined" || !document.body) return;

        if (!translatorRef.current) {
            translatorRef.current = new SupDanceDomTranslator();
        }
        const translator = translatorRef.current;

        if (!enabled) {
            translator.restoreAndDetach();
            document.documentElement.lang = "zh-CN";
            return;
        }

        document.documentElement.lang = locale;
        translator.attach(document.body, dictionary, locale, settings.fallbackLocale, {
            translateAdminPages: settings.translateAdminPages,
            onUntranslatedText: (sourceText) => {
                recordUntranslatedText(sourceText);
            },
        });
    }, [dictionary, enabled, locale, recordUntranslatedText, revision, settings.fallbackLocale, settings.translateAdminPages]);

    useEffect(() => {
        return () => {
            translatorRef.current?.restoreAndDetach();
        };
    }, []);

    return null;
}
