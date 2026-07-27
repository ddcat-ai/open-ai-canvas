export type SettingsSection = "channels" | "models" | "preferences" | "storage";

export function settingsPath(section: SettingsSection = "channels", continueCreation = false) {
    const params = new URLSearchParams({ section });
    if (continueCreation) params.set("continue", "1");
    return `/settings?${params.toString()}`;
}

/**
 * 画布深层组件没有路由上下文出口时统一跳转到正式设置页，避免重新引入全局配置弹窗。
 */
export function navigateToSettings(options?: { section?: SettingsSection; continueCreation?: boolean }) {
    const to = settingsPath(options?.section, options?.continueCreation);
    const event = new CustomEvent<{ to: string }>("workspace:navigate", { detail: { to }, cancelable: true });
    if (window.dispatchEvent(event)) window.location.assign(to);
}
