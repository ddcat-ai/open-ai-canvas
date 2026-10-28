import { PLUGIN_API_VERSION, type RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerSupDancePlugin } from "@/supdance/adapters/compatibility";
import { SUPDANCE_SOCIAL_AUTH_PLUGIN_ID } from "./types";

export const supdanceSocialAuthPlugin: RegisteredPlugin = {
    manifest: {
        id: SUPDANCE_SOCIAL_AUTH_PLUGIN_ID,
        name: "全站统一第三方社交登录",
        version: "1.0.0",
        publishedAt: "2026-10-27",
        updatedAt: "2026-10-27",
        apiVersion: PLUGIN_API_VERSION,
        description: "支持八大主流平台（国内 QQ、微信、抖音、B站；海外 Google、X、Instagram、TikTok）社交登录，基于访客真实 IP 智能分区展示，集成暗黑/浅色双端 UI 与后台可视化配置中心。",
        author: "SupDance Team",
        surfaces: ["hybrid"],
        permissions: ["canvas.read"],
        trusted: true,
        contributes: {
            usageObservers: ["supdance-social-auth"],
        },
    },
    activate: () => {},
    deactivate: () => {},
};

registerSupDancePlugin(supdanceSocialAuthPlugin);

export * from "./types";
export * from "./api";
export * from "./components/social-provider-icons";
export * from "./components/social-login-buttons";
export { default as SocialAuthSettingsPage } from "./admin/social-auth-settings-page";
