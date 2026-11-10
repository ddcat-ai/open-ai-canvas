import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";

import { normalizeChannelCategory, openChannelWorkspace, selectChannelWorkspace } from "../src/pages/admin/channels/channel-workspace-state";
import { ChannelModelManager } from "../src/pages/admin/components/channel-model-manager";
import type { ModelChannel } from "../src/stores/use-config-store";

const channels: ModelChannel[] = [
    { id: "first", name: "主渠道", baseUrl: "https://first.example/v1", apiKey: "", apiFormat: "openai", models: ["model-a"], enabled: true },
    { id: "second", name: "备用渠道", baseUrl: "https://second.example/v1", apiKey: "", apiFormat: "openai", models: [], enabled: false },
];

test("channel workspace defaults to the first channel and restores a selected channel", () => {
    expect(selectChannelWorkspace(channels, "", "all", null).selectedChannel).toBe(channels[0]);
    expect(selectChannelWorkspace(channels, "", "all", "second").selectedChannel).toBe(channels[1]);
});

test("search and status keep selection inside the visible channel list", () => {
    const byAddress = selectChannelWorkspace(channels, " SECOND.EXAMPLE ", "all", "first");
    expect(byAddress.visibleChannels).toEqual([channels[1]!]);
    expect(byAddress.selectedChannel).toBe(channels[1]);
    expect(selectChannelWorkspace(channels, "主渠道", "all", "second").selectedChannel).toBe(channels[0]);
    expect(selectChannelWorkspace(channels, "", "enabled", "second").selectedChannel).toBe(channels[0]);
    expect(selectChannelWorkspace(channels, "", "disabled", "first").selectedChannel).toBe(channels[1]);
});

test("channel category combines with search/status and keeps mixed and disabled model categories", () => {
    const mixed: ModelChannel = { ...channels[0]!, capabilities: ["text", "image"] };
    const disabled: ModelChannel = { ...channels[1]!, capabilities: ["video", "image"] };
    const empty: ModelChannel = { ...channels[0]!, id: "empty", name: "video image", models: [] };
    const all = [mixed, disabled, empty];
    expect(selectChannelWorkspace(all, "", "all", "empty", "image").visibleChannels).toEqual([mixed, disabled]);
    expect(selectChannelWorkspace(all, "", "all", "empty", "text").selectedChannel).toBe(mixed);
    expect(selectChannelWorkspace(all, "", "disabled", "first", "video").selectedChannel).toBe(disabled);
    expect(selectChannelWorkspace(all, "SECOND.EXAMPLE", "all", null, "image").visibleChannels).toEqual([disabled]);
    expect(selectChannelWorkspace(all, "", "enabled", null, "video").selectedChannel).toBeUndefined();
    expect(selectChannelWorkspace(all, "", "all", null, "all").visibleChannels).toHaveLength(3);
    expect(normalizeChannelCategory("invalid")).toBe("all");
    expect(normalizeChannelCategory("video")).toBe("video");
});

test("deleted, missing and filtered-out channels do not leave a stale model pane", () => {
    expect(selectChannelWorkspace(channels.slice(1), "", "all", "first").selectedChannel).toBe(channels[1]);
    expect(selectChannelWorkspace(channels, "", "all", "missing").selectedChannel).toBe(channels[0]);
    expect(selectChannelWorkspace([], "", "all", "first").selectedChannel).toBeUndefined();
    expect(selectChannelWorkspace(channels, "not-found", "all", "first").selectedChannel).toBeUndefined();
});

test("opening a model's channel clears image/category filters and reaches a disabled video-only channel", async () => {
    const image: ModelChannel = { ...channels[0]!, capabilities: ["image"] };
    const video: ModelChannel = { ...channels[1]!, capabilities: ["video"] };
    const before = { view: "models", channel: image.id, filter: image.name, status: "enabled", category: "image" };
    const next = { ...before, ...openChannelWorkspace(video.id) };
    const workspace = selectChannelWorkspace([image, video], next.filter, next.status, next.channel, next.category);
    expect(next.view).toBe("");
    expect(workspace.selectedChannel).toBe(video);
    const page = await Bun.file(new URL("../src/pages/admin/channels/channels-page.tsx", import.meta.url)).text();
    expect(page).toContain("onOpenChannel={(channelId) => updateUrl(openChannelWorkspace(channelId))}");
});

test("selection uses refreshed channel data and can select a newly created channel", () => {
    const updated = { ...channels[0]!, name: "更新后的渠道", models: ["model-a", "model-b"] };
    expect(selectChannelWorkspace([updated], "", "all", "first").selectedChannel).toBe(updated);
    const created = { ...channels[0]!, id: "created" };
    expect(selectChannelWorkspace([...channels, created], "", "all", "created").selectedChannel).toBe(created);
});

test("real model manager renders inline without a second page or back navigation", () => {
    const html = renderToStaticMarkup(
        <App>
            <ChannelModelManager channel={channels[0]!} onChanged={() => {}} />
        </App>,
    );
    expect(html).toContain("模型管理");
    expect(html).toContain("读取模型");
    expect(html).toContain("新增模型");
    expect(html).toContain("自定义排序");
    expect(html).toContain("正在加载表格");
    expect(html).not.toContain("admin-page-root");
    expect(html).not.toContain("返回系统渠道");
});

test("channel navigation is persistent, keyed and responsive with all server pages loaded", async () => {
    const page = await Bun.file(new URL("../src/pages/admin/channels/channels-page.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/pages/admin/channels/channels-page.css", import.meta.url)).text();
    expect(page).toContain('aria-label="系统渠道"');
    expect(page).toContain("新增网站");
    expect(page).toContain("新增 Key");
    expect(page).toContain("key={channel.id}");
    expect(page).toContain('className="admin-channel-key-groups"');
    expect(page).toContain("channel={channel}");
    expect(page).toContain("aria-pressed={selectedWebsite?.id === website.id}");
    expect(page).toContain("listAdminChannels({ page: 1, pageSize: 100 })");
    expect(page).toContain("listAdminChannels({ page, pageSize: 100 })");
    expect(page).not.toContain("setManagingChannel");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 4fr)");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain(".admin-channel-item:focus-visible");
});
