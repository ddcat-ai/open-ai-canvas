import { apiClient, request } from "./request";
export type ChannelOrderItem = { id: string; name: string; enabled: boolean };
const pathFor = (channelId?: string) => (channelId ? `/admin/channels/${encodeURIComponent(channelId)}/models/order` : "/admin/channels/order");
export const getChannelOrder = (channelId?: string) => request<{ items: ChannelOrderItem[] }>(apiClient.get(pathFor(channelId)));
export const saveChannelOrder = (channelId: string | undefined, ids: string[], expectedIds: string[]) => request<{ saved: boolean }>(apiClient.put(pathFor(channelId), { ids, expectedIds }));
