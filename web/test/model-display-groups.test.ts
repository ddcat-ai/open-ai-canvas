import { expect, test } from "bun:test";
import { assignDisplayMembers, assignCollectionMembers, displayGroupEntries, moveDisplayEntry, moveDisplayEntryToGroup, moveCollectionMemberByDrop, moveDisplayGroupByDrop, moveDisplayItem } from "../src/lib/model-display-group-editor";
import { groupModelsForPicker } from "../src/lib/model-picker-groups";
import { systemChannelModelChannels } from "../src/lib/user-session";
import { defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";
import type { PublicChannelModel } from "../src/services/api/logical-models";

test("explicit group and member order survive channel reversal without rerouting", () => {
    const model = (key: string, group: string, order: number, memberOrder: number): PublicChannelModel => ({
        id: key,
        modelKey: key,
        displayName: `original-${key}`,
        channelLabel: "same label",
        icon: key === "a" ? "OpenAI" : "ByteDance",
        capability: "text",
        protocol: "chat_completion",
        displayGroup: { id: group, name: group || "未分组", order, memberOrder },
        priceTiers: [],
        pricingMode: "provider",
        priceLabel: "",
        available: true,
    });
    const channels = systemChannelModelChannels([
        { id: "one", name: "one", displayName: "one", models: [model("a", "Family", 1, 1), model("b", "First", 0, 0), model("new", "", 2, 0)] },
        { id: "two", name: "two", displayName: "two", models: [model("c", "Family", 1, 0)] },
    ]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const values = ["one::a", "one::b", "one::new", "two::c"];
    const groups = groupModelsForPicker(config, values);
    expect(groups.map((g) => g.label)).toEqual(["First", "Family", "未分组"]);
    expect(groups[1].models.map((m) => m.key)).toEqual(["two::c", "one::a"]);
    expect(groupModelsForPicker({ ...config, channels: [...config.channels].reverse() }, [...values].reverse())).toEqual(groups);
    for (const value of values) {
        expect(resolveModelRequestConfig(config, value)).toMatchObject({ channelId: value.split("::")[0], model: value.split("::")[1] });
    }
    config.channels[0].modelCosts![0].displayGroup!.name = "Renamed";
    config.channels[1].modelCosts![0].displayGroup!.name = "Renamed";
    const renamed = groupModelsForPicker(config, values)[1];
    expect(renamed.key).toBe(groups[1].key);
    expect(renamed.label).toBe("Renamed");
    expect(renamed.models).toEqual(groups[1].models);
});

test("dragged collection members are unique, can move out, and sort as one entry", () => {
    const original = [{ id: "g", name: "Videos", modelIds: ["a", "b", "c"], collections: [{ id: "collection", name: "MG", members: [] }] }];
    const grouped = assignCollectionMembers(original, ["a", "b"], "g", "collection", { a: "480p", b: "720p" });
    expect(displayGroupEntries(grouped[0]).map((entry) => entry.key)).toEqual(["collection", "c"]);
    const moved = moveDisplayEntry(grouped[0], "collection", 1);
    expect(moved.modelIds).toEqual(["c", "a", "b"]);
    expect(displayGroupEntries(moved).map((entry) => entry.key)).toEqual(["c", "collection"]);
    const released = assignCollectionMembers([moved], ["b"], "g", "", {});
    expect(released[0].collections![0].members).toEqual([{ modelId: "a", resolution: "480p" }]);
    expect(assignCollectionMembers(grouped, ["a"], "g", "missing", {})).toBe(grouped);
    expect(assignDisplayMembers(grouped, ["a"], "")[0].collections![0].members).toEqual([{ modelId: "b", resolution: "720p" }]);
    expect(original[0].collections[0].members).toEqual([]);
});

test("bulk membership preserves destination order, removes source memberships and can ungroup", () => {
    const groups = [
        { id: "a", name: "A", modelIds: ["1", "2"] },
        { id: "b", name: "B", modelIds: ["3", "4"] },
    ];
    const moved = assignDisplayMembers(groups, ["4", "2", "5", "2"], "b");
    expect(moved.map((group) => group.modelIds)).toEqual([["1"], ["3", "4", "2", "5"]]);
    expect(groups[0].modelIds).toEqual(["1", "2"]);
    expect(assignDisplayMembers(moved, ["1", "3"], "").map((group) => group.modelIds)).toEqual([[], ["4", "2", "5"]]);
    expect(assignDisplayMembers(groups, ["1"], "missing")).toBe(groups);
    expect(moveDisplayItem(moved[1].modelIds, 3, 0)).toEqual(["5", "3", "4", "2"]);
    expect(moveDisplayItem(groups, 0, 1).map((group) => group.id)).toEqual(["b", "a"]);
    expect(moveDisplayItem(groups, 0, 99)).toBe(groups);
});

test("group drop sorting inserts before or after the target without reversing adjacent groups", () => {
    const groups = [
        { id: "a", name: "A", modelIds: [] },
        { id: "b", name: "B", modelIds: [] },
        { id: "c", name: "C", modelIds: [] },
    ];
    expect(moveDisplayGroupByDrop(groups, "c", "a", true).map((group) => group.id)).toEqual(["c", "a", "b"]);
    expect(moveDisplayGroupByDrop(groups, "a", "c", false).map((group) => group.id)).toEqual(["b", "c", "a"]);
    expect(moveDisplayGroupByDrop(groups, "b", "c", true).map((group) => group.id)).toEqual(["a", "b", "c"]);
    expect(moveDisplayGroupByDrop(groups, "missing", "c", true)).toBe(groups);
});

test("collection member drop preserves resolutions and the surrounding directory order", () => {
    const group = { id: "g", name: "Video", modelIds: ["outside", "a", "b", "c", "last"], collections: [{ id: "set", name: "Versions", members: [{ modelId: "a", resolution: "480P" }, { modelId: "b", resolution: "720P" }, { modelId: "c", resolution: "1080P" }] }] };
    const reordered = moveCollectionMemberByDrop(group, "set", "c", "a", true);
    expect(reordered.modelIds).toEqual(["outside", "c", "a", "b", "last"]);
    expect(reordered.collections![0].members).toEqual([{ modelId: "c", resolution: "1080P" }, { modelId: "a", resolution: "480P" }, { modelId: "b", resolution: "720P" }]);
    expect(moveCollectionMemberByDrop(reordered, "set", "c", "b", false).modelIds).toEqual(group.modelIds);
    expect(moveCollectionMemberByDrop(group, "set", "outside", "a", true)).toBe(group);
    expect(group.modelIds).toEqual(["outside", "a", "b", "c", "last"]);
});

test("moving a whole collection retains its identity and resolutions, including empty collections", () => {
    const collection = { id: "set", name: "Renamed", members: [{ modelId: "a", resolution: "720P" }, { modelId: "b", resolution: "1080P" }] };
    const groups = [{ id: "g", name: "A", modelIds: ["a", "b", "c"], collections: [collection, { id: "empty", name: "Empty", members: [] }] }, { id: "h", name: "B", modelIds: ["d"] }];
    const moved = moveDisplayEntryToGroup(groups, "g", "set", "h");
    expect(moved[0].modelIds).toEqual(["c"]);
    expect(moved[1].modelIds).toEqual(["d", "a", "b"]);
    expect(moved[1].collections).toEqual([collection]);
    expect(moveDisplayEntryToGroup(moved, "g", "empty", "h")[1].collections?.map((item) => item.id)).toEqual(["set", "empty"]);
    expect(moveDisplayEntryToGroup(moved, "h", "set", "")[1].collections).toEqual([]);
    expect(groups[0].collections).toHaveLength(2);
});
