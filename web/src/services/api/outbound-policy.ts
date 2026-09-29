import { http } from "./request";

export type OutboundPolicy = {
    allowedModelOrigins: string[];
};

export function getOutboundPolicy() {
    return http.get<{ setting: OutboundPolicy }>("/admin/settings/outbound-policy");
}

export function updateOutboundPolicy(setting: Partial<OutboundPolicy>) {
    return http.patch<{ setting: OutboundPolicy }>("/admin/settings/outbound-policy", setting);
}
