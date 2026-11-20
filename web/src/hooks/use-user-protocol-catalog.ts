import { useQuery } from "@tanstack/react-query";

import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog, USER_CUSTOM_CHANNEL_SCOPE } from "@/services/api/plugin-catalog";
import { useUserStore } from "@/stores/use-user-store";

const USER_PROTOCOL_CATALOG_STALE_MS = 5 * 60_000;
const EMPTY_PROTOCOLS: ModelProtocolDefinition[] = [];

/** 自定义渠道可选的协议插件目录；设置页多处共享同一个 Query。 */
export function useUserProtocolCatalog(enabled = true) {
    const userId = useUserStore((state) => state.user?.id) || "";
    const query = useQuery({
        queryKey: ["plugin-catalog", USER_CUSTOM_CHANNEL_SCOPE, userId],
        queryFn: () => fetchPluginProviderCatalog(USER_CUSTOM_CHANNEL_SCOPE),
        enabled: enabled && Boolean(userId),
        staleTime: USER_PROTOCOL_CATALOG_STALE_MS,
        refetchOnWindowFocus: false,
    });
    return query.data ?? EMPTY_PROTOCOLS;
}

/** 插件 auth 声明了第二把密钥的协议 ID；渠道里有这些协议的模型时必须填写 Secret Key。 */
export function secretKeyProtocolIds(protocols: ModelProtocolDefinition[]): ReadonlySet<string> {
    return new Set(protocols.filter((item) => item.requiresSecretKey).map((item) => item.value));
}
