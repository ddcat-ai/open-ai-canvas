import { expect, test } from "bun:test";
import { moveWebsiteKeyGroup } from "../src/pages/admin/channels/channel-key-order";

test("moving a website key down preserves every other website's slot", () => {
    const initial = ["other-a", "a", "other-b", "b", "c", "other-c"];
    expect(moveWebsiteKeyGroup(initial, ["a", "b", "c"], "a", "c")).toEqual(["other-a", "b", "other-b", "c", "a", "other-c"]);
    expect(initial).toEqual(["other-a", "a", "other-b", "b", "c", "other-c"]);
});

test("moving up preserves hidden key groups and same-target moves do nothing", () => {
    const initial = ["a", "hidden", "b", "c"];
    expect(moveWebsiteKeyGroup(initial, ["a", "b", "c"], "c", "a")).toEqual(["c", "hidden", "a", "b"]);
    expect(moveWebsiteKeyGroup(initial, ["a", "b", "c"], "b", "b")).toBe(initial);
});

test("missing, duplicate, cross-website and stale inputs cannot produce a save", () => {
    for (const [order, groups, source, target] of [
        [["b", "a"], ["a", "b"], "a", "b"],
        [["a"], ["a", "b"], "a", "b"],
        [["a", "b", "other"], ["a", "b"], "a", "other"],
        [["a", "b"], ["a", "a"], "a", "a"],
        [["a", "b", "b"], ["a", "b"], "a", "b"],
    ] as [string[], string[], string, string][]) {
        expect(() => moveWebsiteKeyGroup(order, groups, source, target)).toThrow("Key 分组顺序已变化");
    }
});
