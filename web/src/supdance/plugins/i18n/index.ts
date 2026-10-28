import { PLUGIN_API_VERSION, type RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerSupDancePlugin } from "@/supdance/adapters/compatibility";
import { useSupDanceI18nStore } from "./store";
import { SUPDANCE_I18N_PLUGIN_ID } from "./types";

export const supdanceI18nPlugin: RegisteredPlugin = {
    manifest: {
        id: SUPDANCE_I18N_PLUGIN_ID,
        name: "站点多语言与实时词条中心",
        version: "1.0.0",
        publishedAt: "2026-10-27",
        updatedAt: "2026-10-27",
        apiVersion: PLUGIN_API_VERSION,
        description: "为站点提供右上角语言切换图标与六大语种（简体中文、英语、繁体中文、日文、韩国语、西班牙语）实时切换能力，支持后台语言管理设置与在线字段词条热编辑。",
        author: "SupDance Team",
        surfaces: ["hybrid"],
        permissions: ["canvas.read"],
        trusted: true,
        contributes: {
            usageObservers: ["supdance-i18n"],
        },
    },
    activate: () => {
        useSupDanceI18nStore.getState().setPluginEnabled(true);
    },
    deactivate: () => {
        useSupDanceI18nStore.getState().setPluginEnabled(false);
    },
};

registerSupDancePlugin(supdanceI18nPlugin);

export * from "./types";
export * from "./api";
export * from "./locales";
export * from "./store";
export * from "./engine/translator";
export * from "./engine/dom-observer";
export * from "./engine/antd-locale";
export { TopbarLanguageSwitcher } from "./components/topbar-language-switcher";
export { SupDanceI18nRuntimeHost } from "./components/i18n-runtime-host";
