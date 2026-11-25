import { expect, test } from "bun:test";
import { buildNodeToolbarEntries, resolvePinnedToolbarEntries, visibleToolbarEntryCount } from "@/lib/canvas/node-toolbar-entries";

test("固定具体工具与分类菜单相互独立，保留原分类完整清单", () => {
    const calls: string[] = [];
    const entries = buildNodeToolbarEntries(
        [
            { id: "annotate", label: "区域标注", icon: null, group: "primary", order: 1, onClick: () => calls.push("annotate") },
            { id: "upscale", label: "调整尺寸", icon: null, group: "process", order: 2, onClick: () => calls.push("upscale") },
        ],
        [{ group: "process", label: "图片工具", icon: null }],
    );
    const pinned = resolvePinnedToolbarEntries(entries, ["upscale", "annotate"]);
    expect(pinned.map((entry) => entry.id)).toEqual(["upscale", "annotate"]);
    const menu = entries.find((entry) => entry.id === "menu:process");
    expect(menu?.kind === "menu" && menu.tools.map((tool) => tool.id)).toEqual(["upscale"]);
    const direct = pinned[0];
    if (direct?.kind !== "tool") throw new Error("调整尺寸应为具体工具入口");
    direct.tool.onClick();
    expect(calls).toEqual(["upscale"]);
    expect(resolvePinnedToolbarEntries(entries, []).map((entry) => entry.id)).toEqual([]);
    expect(resolvePinnedToolbarEntries(entries).map((entry) => entry.id)).toEqual(["annotate", "menu:process"]);
});

test("宽度不足时只收纳末尾入口，恢复宽度后可按原顺序全部展示", () => {
    const widths = [80, 60, 40];
    expect(visibleToolbarEntryCount(widths, 200, 48, 2)).toBe(2);
    expect(visibleToolbarEntryCount(widths, 100, 48, 2)).toBe(0);
    expect(visibleToolbarEntryCount(widths, 234, 48, 2)).toBe(3);
    expect(widths).toEqual([80, 60, 40]);
});
