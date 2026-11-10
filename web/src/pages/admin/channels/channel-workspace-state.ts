import type { ModelChannel } from "@/stores/use-config-store";

export type ChannelCategory = "all" | "text" | "video" | "image";
export const channelCategories: { value: ChannelCategory; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "text", label: "文本" },
    { value: "video", label: "视频" },
    { value: "image", label: "图片" },
];
export function normalizeChannelCategory(value: string | null): ChannelCategory {
    return value === "text" || value === "video" || value === "image" ? value : "all";
}

export function openChannelWorkspace(channelId: string) {
    return { view: "", website: "", channel: channelId, filter: "", status: "all" as const, category: "all" as const };
}

export function selectChannelWorkspace(channels: ModelChannel[], keyword: string, status: "all" | "enabled" | "disabled", selectedChannelId: string | null, category: ChannelCategory = "all") {
    const query = keyword.trim().toLowerCase();
    const visibleChannels = channels.filter((channel) => {
        const matchesKeyword = `${channel.name} ${channel.baseUrl}`.toLowerCase().includes(query);
        return matchesKeyword && (status === "all" || (channel.enabled !== false) === (status === "enabled")) && (category === "all" || channel.capabilities?.includes(category));
    });
    return {
        visibleChannels,
        selectedChannel: visibleChannels.find((channel) => channel.id === selectedChannelId) || visibleChannels[0],
    };
}
