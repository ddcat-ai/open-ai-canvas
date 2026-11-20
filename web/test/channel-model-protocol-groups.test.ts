import { expect, test } from "bun:test";
import { channelModelProtocolGroups, channelModelProtocolGroupUpdates } from "../src/pages/admin/components/channel-model-protocol-groups";
import { batchModel, batchProtocols } from "./fixtures/channel-model-batch-edit.fixtures";

const protocols = batchProtocols.flatMap((item) => [item, { ...item, value: `${item.value}-new` }]);
const models = batchProtocols.map((item) => batchModel({ id: item.capability, capability: item.capability, protocol: item.value }));

test("按原能力分组、默认不修改、只提交实际变化的部分组", () => {
    expect(channelModelProtocolGroups(models).map((group) => group.capability)).toEqual(["text", "image", "video", "audio"]);
    expect(channelModelProtocolGroupUpdates(models, {}, protocols)).toEqual([]);
    expect(channelModelProtocolGroupUpdates(models, { text: "text-protocol-new", image: "image-protocol", video: undefined }, protocols)).toEqual([{ modelIds: ["text"], protocol: "text-protocol-new" }]);
});

test("组内部分模型已用目标协议时不重发它，清空恢复不修改", () => {
    const items = [...models, batchModel({ id: "text-new", protocol: "text-protocol-new" })];
    expect(channelModelProtocolGroupUpdates(items, { text: "text-protocol-new", image: "image-protocol-new" }, protocols)).toEqual([
        { modelIds: ["text"], protocol: "text-protocol-new" },
        { modelIds: ["image"], protocol: "image-protocol-new" },
    ]);
    expect(channelModelProtocolGroupUpdates(items, { text: undefined, image: undefined }, protocols)).toEqual([]);
});

test("未配置类型不阻止其他组，不允许跨类型或失效协议", () => {
    const items = [...models, batchModel({ id: "unknown", capability: "" })];
    expect(channelModelProtocolGroupUpdates(items, { text: "text-protocol-new" }, protocols)).toEqual([{ modelIds: ["text"], protocol: "text-protocol-new" }]);
    expect(() => channelModelProtocolGroupUpdates(items, { text: "image-protocol-new" }, protocols)).toThrow("文本协议已失效");
    expect(() => channelModelProtocolGroupUpdates(items, { image: "removed" }, protocols)).toThrow("图片协议已失效");
    expect(() =>
        channelModelProtocolGroupUpdates(
            items,
            { audio: "audio-protocol-new" },
            protocols.map((item) => ({ ...item, enabled: false })),
        ),
    ).toThrow("音频协议已失效");
});

test("跨组总数上限和重复 ID 在提交前拒绝", () => {
    const many = [...Array.from({ length: 60 }, (_, index) => batchModel({ id: `text-${index}` })), ...Array.from({ length: 41 }, (_, index) => batchModel({ id: `image-${index}`, capability: "image", protocol: "image-protocol" }))];
    expect(() => channelModelProtocolGroupUpdates(many, { text: "text-protocol-new", image: "image-protocol-new" }, protocols)).toThrow("100");
    expect(() => channelModelProtocolGroupUpdates([models[0], models[0]], { text: "text-protocol-new" }, protocols)).toThrow("重复");
});
