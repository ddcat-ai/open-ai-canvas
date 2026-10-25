import { http } from "./request";

export type ModelDisplayCollection = { id: string; name: string; members: Array<{ modelId: string; resolution: string }> };
export type ModelDisplayGroup = { id: string; name: string; modelIds: string[]; collections?: ModelDisplayCollection[]; rateVersion?: number };
export type ModelDisplayMember = {
    id: string;
    channelId: string;
    channelName: string;
    channelEnabled: boolean;
    modelKey: string;
    providerModelKey: string;
    displayName: string;
    channelLabel: string;
    capability: string;
    enabled: boolean;
};
export type ModelDisplayGroupsView = {
    groups: ModelDisplayGroup[];
    models: ModelDisplayMember[];
    snapshot: string;
    initialized: boolean;
};
export const getModelDisplayGroups = () => http.get<ModelDisplayGroupsView>("/admin/model-display-groups");
export const saveModelDisplayGroups = (groups: ModelDisplayGroup[], expectedSnapshot: string, memberLabels?: Record<string, string>) => http.put<{ saved: boolean }>("/admin/model-display-groups", { groups, expectedSnapshot, memberLabels });
