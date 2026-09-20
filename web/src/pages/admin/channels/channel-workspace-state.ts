import type { ModelChannel } from "@/stores/use-config-store";

export function selectChannelWorkspace(channels: ModelChannel[], keyword: string, status: "all" | "enabled" | "disabled", selectedChannelId: string | null) {
    const query = keyword.trim().toLowerCase();
    const visibleChannels = channels.filter((channel) => {
        const matchesKeyword = `${channel.name} ${channel.baseUrl}`.toLowerCase().includes(query);
        return matchesKeyword && (status === "all" || (channel.enabled !== false) === (status === "enabled"));
    });
    return {
        visibleChannels,
        selectedChannel: visibleChannels.find((channel) => channel.id === selectedChannelId) || visibleChannels[0],
    };
}
