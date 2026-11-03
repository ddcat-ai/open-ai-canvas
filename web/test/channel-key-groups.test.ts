import { expect, test } from "bun:test";
import { groupChannelsByUpstream, selectChannelWorkspace } from "../src/pages/admin/channels/channel-workspace-state";
import type { ModelChannel } from "../src/stores/use-config-store";

test("same upstream keys group together without merging different API paths", () => {
    const channels = [
        { id: "cheap", name: "特惠", baseUrl: "https://API.example.com/v1/", enabled: true },
        { id: "stable", name: "稳定", baseUrl: "https://api.example.com/v1", enabled: true },
        { id: "video", name: "视频", baseUrl: "https://api.example.com/video/v1", enabled: false },
    ] as ModelChannel[];
    const groups = groupChannelsByUpstream(channels);
    expect(groups).toHaveLength(2);
    expect(groups[0].channels.map((channel) => channel.id)).toEqual(["cheap", "stable"]);
    expect(selectChannelWorkspace(channels, "稳定", "enabled", "cheap").selectedChannel?.id).toBe("stable");
    expect(channels[0].baseUrl).toBe("https://API.example.com/v1/");
});
