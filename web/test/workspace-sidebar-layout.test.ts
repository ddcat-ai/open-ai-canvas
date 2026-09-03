import { describe, expect, test } from "bun:test";

import {
    WORKSPACE_SIDEBAR_ITEMS,
    defaultWorkspaceSidebarLayout,
    normalizeWorkspaceSidebarLayout,
    reorderWorkspaceSidebarLayout,
} from "@/lib/workspace-sidebar-layout";

describe("workspace sidebar layout", () => {
    test("drops unknown entries and restores missing defaults", () => {
        const layout = normalizeWorkspaceSidebarLayout({
            version: 99,
            order: ["unknown", WORKSPACE_SIDEBAR_ITEMS[2].id],
            hidden: ["unknown", WORKSPACE_SIDEBAR_ITEMS[0].id],
        });

        expect(layout.order[0]).toBe(WORKSPACE_SIDEBAR_ITEMS[2].id);
        expect(layout.order).toHaveLength(WORKSPACE_SIDEBAR_ITEMS.length);
        expect(layout.hidden).toEqual([WORKSPACE_SIDEBAR_ITEMS[0].id]);
    });

    test("moves an entry without losing the remaining order", () => {
        const layout = defaultWorkspaceSidebarLayout();
        const source = WORKSPACE_SIDEBAR_ITEMS[0].id;
        const target = WORKSPACE_SIDEBAR_ITEMS[2].id;
        const next = reorderWorkspaceSidebarLayout(layout, source, target);

        expect(next.order).toEqual([WORKSPACE_SIDEBAR_ITEMS[1].id, source, target, ...WORKSPACE_SIDEBAR_ITEMS.slice(3).map((item) => item.id)]);
    });

    test("supports placing an adjacent entry after its target", () => {
        const layout = defaultWorkspaceSidebarLayout();
        const source = WORKSPACE_SIDEBAR_ITEMS[1].id;
        const target = WORKSPACE_SIDEBAR_ITEMS[2].id;
        const next = reorderWorkspaceSidebarLayout(layout, source, target, "after");

        expect(next.order.slice(0, 4)).toEqual([WORKSPACE_SIDEBAR_ITEMS[0].id, target, source, WORKSPACE_SIDEBAR_ITEMS[3].id]);
    });
});
