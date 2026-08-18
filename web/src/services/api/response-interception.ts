import { apiClient, request } from "@/services/api/request";

export type ResponseInterceptionRule = {
    contains: string;
    replace: string;
};

export type ResponseInterceptionSetting = {
    enabled: boolean;
    rules: ResponseInterceptionRule[];
};

export function getAdminResponseInterceptionSetting() {
    return request<{ setting: ResponseInterceptionSetting }>(apiClient.get("/admin/settings/response-interception"));
}

export function updateAdminResponseInterceptionSetting(setting: ResponseInterceptionSetting) {
    return request<{ setting: ResponseInterceptionSetting }>(apiClient.patch("/admin/settings/response-interception", setting));
}
