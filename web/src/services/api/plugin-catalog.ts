import { http } from "@/services/api/request";
import { isTextWire, type ModelProtocolDefinition, type ProtocolCapability } from "@/lib/model-protocols";

type PluginProviderCatalogItem = {
    imageParameters?: import("@/lib/image-parameters").ImageParameter[];
    id: string;
    version: string;
    name: string;
    vendor: string;
    categories: string[];
    scopes: string[];
    create?: string;
    poll?: string;
    contentType?: string;
    enabled: boolean;
    unavailableReason?: string;
    baseUrl?: string;
    parameters?: Array<{
        name: string;
        type: string;
        required?: boolean;
        description?: string;
        values?: string[];
        mapping?: string;
    }>;
    workflows?: Array<{
        id: string;
        label: string;
        providerId: string;
        capability: ProtocolCapability;
        parameters: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>;
        defaults?: Record<string, string | number | boolean>;
    }>;
    textWire?: string;
    requiresSecretKey?: boolean;
};

export const USER_CUSTOM_CHANNEL_SCOPE = "user.custom-channel";

export async function fetchPluginProviderCatalog(scope: string, capability?: ProtocolCapability) {
    const result = await http.get<{ providers: PluginProviderCatalogItem[] }>("/plugins/catalog", { params: { scope, capability } });
    return result.providers.filter((item) => item.enabled && !item.unavailableReason).map(toProviderDefinition);
}

let userProtocolCatalogRequest: Promise<ModelProtocolDefinition[]> | undefined;

/**
 * 浏览器直连自定义渠道时需要插件声明（例如文本请求格式）。插件目录不含账号数据，
 * 同一页面会话只拉一次；请求失败不缓存，下次调用重新拉取。
 */
export function loadUserProtocolCatalog() {
    userProtocolCatalogRequest ??= fetchPluginProviderCatalog(USER_CUSTOM_CHANNEL_SCOPE).catch((error: unknown) => {
        userProtocolCatalogRequest = undefined;
        throw error;
    });
    return userProtocolCatalogRequest;
}

function toProviderDefinition(item: PluginProviderCatalogItem): ModelProtocolDefinition {
    return {
        value: item.id,
        label: item.name,
        vendor: item.vendor,
        capability: (item.categories[0] || "text") as ProtocolCapability,
        create: item.create || "",
        poll: item.poll,
        contentType: item.contentType || "application/json",
        media: `${item.vendor} · ${item.version}`,
        enabled: item.enabled && !item.unavailableReason,
        baseUrl: item.baseUrl,
        parameters: item.parameters || [],
        imageParameters: item.imageParameters,
        workflows: item.workflows || [],
        textWire: isTextWire(item.textWire) ? item.textWire : undefined,
        requiresSecretKey: item.requiresSecretKey === true,
    };
}
