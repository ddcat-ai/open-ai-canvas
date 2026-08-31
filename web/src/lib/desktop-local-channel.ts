import { useUserStore } from "@/stores/use-user-store";

export const DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL = "http://127.0.0.1:8000";

// 页面 host 只控制 UI 可见性；真正授权始终由后端 deployment capability 决定。
export function desktopLocalChannelUiVisible(desktopLocalChannelsEnabled: boolean, hostname: string) {
    if (!desktopLocalChannelsEnabled) return false;
    const normalized = hostname.trim().toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1";
}

export function desktopLocalChannelPayloadValue(desktopLocalChannelsEnabled: boolean, hostname: string, requested: boolean | undefined) {
    return desktopLocalChannelUiVisible(desktopLocalChannelsEnabled, hostname) && requested === true;
}

export function desktopLocalChannelFormState(desktopLocalChannelsEnabled: boolean, hostname: string, stored: boolean | undefined) {
    const visible = desktopLocalChannelUiVisible(desktopLocalChannelsEnabled, hostname);
    return { visible, checked: visible && stored === true };
}

export function projectDesktopLocalChannelRuntime<T extends { allowLocalChannel?: boolean }>(config: T): T {
    const desktopLocalChannelsEnabled = useUserStore.getState().features.desktopLocalChannelsEnabled;
    const hostname = typeof window === "undefined" ? "" : window.location?.hostname || "";
    const allowLocalChannel = desktopLocalChannelPayloadValue(desktopLocalChannelsEnabled, hostname, config.allowLocalChannel);
    return config.allowLocalChannel === allowLocalChannel ? config : { ...config, allowLocalChannel };
}
