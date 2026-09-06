import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useLocalDreaminaModelBootstrap } from "@/stores/use-local-dreamina-model-store";
import { useLocalRuntimeBootstrap } from "@/stores/use-local-runtime-store";
import { initializeClientDiagnostics, setDiagnosticUserScope } from "@/services/diagnostics/client-diagnostics";
import { fetchPluginRuntimeState, setUserPluginEnabled } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";
import { appQueryClient } from "@/lib/query-client";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const config = useConfigStore((state) => state.config);
    const userId = useUserStore((state) => state.user?.id || "");
    // Runtime 模型渠道是临时投影，不写入持久化 config；应用启动时必须先主动探测，否则首页永远无法发现即梦模型。
    useLocalRuntimeBootstrap();
    useLocalDreaminaModelBootstrap();
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setRuntimeStatuses = usePluginStore((state) => state.setRuntimeStatuses);
    const setPluginStates = usePluginStore((state) => state.setPluginStates);
    const pluginStoreHydrated = usePluginStore((state) => state.hydrated);

    useEffect(() => () => {
        usePluginStore.getState().setRuntimeStatuses({});
        usePluginStore.getState().setPluginStates({});
    }, []);

    useEffect(() => {
        if (!userId || !pluginStoreHydrated) return;
        let cancelled = false;
        void appQueryClient.fetchQuery({ queryKey: ["plugin-runtime", userId], queryFn: fetchPluginRuntimeState, staleTime: 30_000 })
            .then(async (runtime) => {
                if (cancelled || useUserStore.getState().user?.id !== userId) return;
                const statuses = { ...runtime.statuses };
                const states = { ...runtime.states };
                const legacyEnabledIds = usePluginStore
                    .getState()
                    .installations.filter((installation) => installation.enabled && states[installation.manifest.id]?.canToggle && !states[installation.manifest.id]?.userConfigured)
                    .map((installation) => installation.manifest.id);
                if (legacyEnabledIds.length) {
                    try {
                        const migrated = await Promise.all(legacyEnabledIds.map((pluginId) => setUserPluginEnabled(pluginId, true)));
                        for (const state of migrated) states[state.pluginId] = state;
                        for (const pluginId of legacyEnabledIds) statuses[pluginId] = states[pluginId]?.effectiveEnabled ? "enabled" : "disabled";
                    } catch (error) {
                        console.warn("迁移用户插件启用状态失败，已保留服务端状态", error);
                    }
                }
                if (!cancelled && useUserStore.getState().user?.id === userId) {
                    setRuntimeStatuses(statuses);
                    setPluginStates(states);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRuntimeStatuses({});
                    setPluginStates({});
                }
            });
        return () => {
            cancelled = true;
        };
    }, [pluginStoreHydrated, setPluginStates, setRuntimeStatuses, userId]);

    useEffect(() => {
        initializeClientDiagnostics();
    }, []);

    useEffect(() => {
        setDiagnosticUserScope(userId);
    }, [userId]);

    useEffect(() => {
        const interactiveSelector = 'button, [role="button"], a, [class*="card"], [class*="Card"]';
        const blurPointerFocus = (event: PointerEvent) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>(interactiveSelector) : null;
            if (!target || target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
            // 浏览器可能把鼠标点击误判为 :focus-visible；下一帧只清掉这次指针点击产生的焦点。
            window.requestAnimationFrame(() => {
                if (document.activeElement === target) target.blur();
            });
        };
        document.addEventListener("pointerdown", blurPointerFocus, true);
        return () => document.removeEventListener("pointerdown", blurPointerFocus, true);
    }, []);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const ignoredApiKey = searchParams.has("apiKey") || searchParams.has("apikey");
        if (!baseUrl && !ignoredApiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        navigateToSettings({ section: "channels" });
        if (ignoredApiKey) message.warning("出于安全考虑，链接中的 API Key 已忽略，请在配置中手动填写");
        else message.success("已导入本地直连地址");
    }, [config.channels, message, updateConfig]);

    return <>{children}</>;
}
