import { expect, test } from "bun:test";
import { buildCharacterOutfitPersistence, parseCharacterOutfits, resolveLockedNodeOutfitId } from "../src/components/canvas/character-outfits";

test("形象重命名后保留来源与其他图像表达，其他节点继续锁定原造型", () => {
    const source = { taskId: "task-1", prompt: "换成红衣" };
    const definition = {
        outfits: [
            { id: "old", name: "旧形象", resourceId: "r1", source },
            { id: "new", name: "新形象", resourceId: "r2" },
        ],
    };
    const outfits = parseCharacterOutfits(definition);
    outfits[0].name = "重新命名";
    const next = buildCharacterOutfitPersistence(definition, outfits, "new", [{ role: "front", resourceId: "front-image", metadata: { preserved: true } }]);
    expect(parseCharacterOutfits(next.definition)[0].source).toEqual(source);
    expect(next.representations).toContainEqual({ role: "front", resourceId: "front-image", metadata: { preserved: true } });
    expect(resolveLockedNodeOutfitId("old", undefined, definition, next.definition)).toBe("old");
});
