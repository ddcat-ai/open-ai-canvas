// SupDance 扩展模块统一注册表与功能开关。
//
// 所有 SupDance UI 扩展、插件扩展均通过独立开关受控启用，
// 支持随时禁用并无损回退到上游默认行为。

import { applySupDanceTheme, createSupDanceSkinDefinition, SUPDANCE_BRAND_DEFAULTS, SUPDANCE_SKIN_ID } from "@/supdance/theme/supdance-skin";
import {
    activateSupDancePluginSafely,
    compareSemVer,
    deactivateSupDancePluginSafely,
    mergeSupDanceRoutes,
    registerSupDancePlugin,
    SUPDANCE_HOST_VERSION,
    SUPDANCE_RESERVED_PLUGIN_PREFIX,
    SUPDANCE_UPSTREAM_PATCH_REGISTRY,
    unregisterSupDancePlugin,
    upgradeSupDancePlugin,
    validateSupDancePluginManifest,
} from "@/supdance/adapters/compatibility";

export type SupDanceFeatureFlags = {
    themeExtensionEnabled: boolean;
    codexConnectorEnabled: boolean;
    customPluginsEnabled: boolean;
};

export const DEFAULT_SUPDANCE_FEATURE_FLAGS: Readonly<SupDanceFeatureFlags> = Object.freeze({
    themeExtensionEnabled: true,
    codexConnectorEnabled: true,
    customPluginsEnabled: true,
});

export {
    activateSupDancePluginSafely,
    applySupDanceTheme,
    compareSemVer,
    createSupDanceSkinDefinition,
    deactivateSupDancePluginSafely,
    mergeSupDanceRoutes,
    registerSupDancePlugin,
    SUPDANCE_BRAND_DEFAULTS,
    SUPDANCE_HOST_VERSION,
    SUPDANCE_RESERVED_PLUGIN_PREFIX,
    SUPDANCE_SKIN_ID,
    SUPDANCE_UPSTREAM_PATCH_REGISTRY,
    unregisterSupDancePlugin,
    upgradeSupDancePlugin,
    validateSupDancePluginManifest,
};

export * from "@/supdance/plugins/i18n";
