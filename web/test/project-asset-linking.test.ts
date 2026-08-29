import { describe, expect, test } from "bun:test";

import { linkSelectedProjectAssets } from "@/pages/projects/detail/project-asset-linking";

describe("project asset batch linking", () => {
    test("links every selected asset instead of only the first one", async () => {
        const visited: string[] = [];
        const result = await linkSelectedProjectAssets(["asset-1", "asset-2", "asset-3"], async (id) => {
            visited.push(id);
            return { id };
        });

        expect(visited).toEqual(["asset-1", "asset-2", "asset-3"]);
        expect(result.linked.map((item) => item.id)).toEqual(["asset-1", "asset-2", "asset-3"]);
        expect(result.failedCount).toBe(0);
    });

    test("keeps successful links and reports partial failures", async () => {
        const result = await linkSelectedProjectAssets(["asset-1", "asset-2"], async (id) => {
            if (id === "asset-2") throw new Error("不可用");
            return id;
        });

        expect(result).toEqual({ linked: ["asset-1"], failedCount: 1 });
    });

    test("surfaces the failure when no asset can be linked", async () => {
        await expect(linkSelectedProjectAssets(["asset-1"], async () => {
            throw new Error("素材已失效");
        })).rejects.toThrow("素材已失效");
    });
});
