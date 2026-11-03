import type { ModelChannel } from "@/stores/use-config-store";

export function groupChannelsByUpstream(channels: ModelChannel[]) {
    const groups = new Map<string, { address: string; channels: ModelChannel[] }>();
    for (const channel of channels) {
        let address = channel.baseUrl.trim().replace(/\/+$/, "");
        try {
            const url = new URL(address);
            address = `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
        } catch {
            /* Invalid legacy addresses remain separate and editable. */
        }
        const key = address || channel.id;
        const group = groups.get(key) || { address, channels: [] };
        group.channels.push(channel);
        groups.set(key, group);
    }
    return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
}

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
