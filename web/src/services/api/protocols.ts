import { apiClient, request } from "@/services/api/request";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";

type ProtocolCatalogItem = {
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
};

export async function fetchProtocolCatalog(scope: string, capability?: ProtocolCapability) {
    const result = await request<{ protocols: ProtocolCatalogItem[] }>(apiClient.get("/protocols", { params: { scope, capability } }));
    return result.protocols.filter((item) => item.enabled && !item.unavailableReason).map(toProtocolDefinition);
}

function toProtocolDefinition(item: ProtocolCatalogItem): ModelProtocolDefinition {
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
    };
}
