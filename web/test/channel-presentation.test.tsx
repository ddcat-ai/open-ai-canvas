import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";

import { systemChannelModelChannels } from "../src/lib/user-session";
import { ChannelOrderDialog, moveOrderItem } from "../src/pages/admin/components/channel-order-dialog";
import type { PublicChannelCatalog, PublicChannelModel } from "../src/services/api/logical-models";
import { defaultConfig, normalizeConfigSnapshot, selectableModelsByCapability } from "../src/stores/use-config-store";

test("public channel order, alias and model order survive session normalization and capability filtering", () => {
    const model = (key: string, available = true): PublicChannelModel => ({
        id: key,
        modelKey: key,
        displayName: key,
        icon: "",
        capability: "image",
        protocol: "openai-image",
        available,
        priceTiers: [],
        pricingMode: "fixed",
        displayPrice: 1,
        priceLabel: "1",
    });
    const catalog: PublicChannelCatalog[] = [
        { id: "z-channel", name: "前台精选", displayName: "前台精选", sortOrder: 1, models: [model("z-model"), model("hidden", false), model("a-model")] },
        { id: "a-channel", name: "默认名称", displayName: "默认名称", sortOrder: 20, models: [model("b-model")] },
    ];
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: systemChannelModelChannels(catalog), model: "z-channel::a-model", imageModels: undefined } }).config;
    expect(config.channels.map((channel) => [channel.id, channel.name, channel.sortOrder])).toEqual([
        ["z-channel", "前台精选", 1],
        ["a-channel", "默认名称", 20],
    ]);
    expect(config.channels[0]!.models).toEqual(["z-model", "a-model"]);
    expect(selectableModelsByCapability(config, "image")).toEqual(["z-channel::z-model", "z-channel::a-model", "a-channel::b-model"]);
    expect(config.model).toBe("z-channel::a-model");
});

test("sorting exposes a simple settings entry and moves items without changing their data", () => {
    const html = renderToStaticMarkup(
        <App>
            <ChannelOrderDialog onSaved={async () => {}} />
        </App>,
    );
    expect(html).toContain("设置排序");
    expect(html).not.toContain("spinbutton");
    const rows = [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
    ];
    expect(moveOrderItem(rows, "c", 0).map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(moveOrderItem(rows, "a", 2).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(moveOrderItem(rows, "a", -1)).toBe(rows);
    expect(rows.map((item) => item.id)).toEqual(["a", "b", "c"]);
});
