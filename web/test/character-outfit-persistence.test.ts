import { expect, test } from "bun:test";
import { buildCharacterOutfitPersistence, parseCharacterOutfits, resolveLockedNodeOutfitId } from "../src/components/canvas/character-outfits";
import { refreshCanvasCharacterReferenceNodes } from "../src/lib/canvas/canvas-character-reference";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { ProjectAsset } from "../src/services/api/projects";

test("长资源标识生成的造型使用短表达槽位，完整造型标识不截断也不碰撞", () => {
    const prefix = "a".repeat(40);
    const outfits = [
        { id: prefix + "-one", name: "冬装", resourceId: "a".repeat(32) },
        { id: prefix + "-two", name: "夏装", resourceId: "b".repeat(32) },
    ];
    const persisted = buildCharacterOutfitPersistence({}, outfits, outfits[1].id);
    expect(persisted.representations.every((item) => item.role.length <= 32)).toBe(true);
    expect(persisted.representations.filter((item) => item.role.startsWith("outfit:")).map((item) => item.metadata?.outfitId)).toEqual(outfits.map((item) => item.id));
    expect(parseCharacterOutfits(persisted.definition).map((item) => item.id)).toEqual(outfits.map((item) => item.id));
});

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

test("明确选用新形象时更新发起节点的固定版本，其他固定节点不变", () => {
    const first: CanvasNodeData = {
        id: "first",
        type: CanvasNodeType.Text,
        title: "人物",
        position: { x: 0, y: 0 },
        width: 200,
        height: 300,
        metadata: { workflowKind: "character", characterAssetId: "person", characterVersionId: "v1", characterVersionPolicy: "pinned", selectedOutfitId: "old" },
    };
    const second = { ...first, id: "second" };
    const asset = {
        id: "person",
        title: "人物",
        category: "character",
        character: {
            versionId: "v2",
            definition: {
                outfits: [
                    { id: "old", name: "旧形象", resourceId: "old-image" },
                    { id: "new", name: "新形象", resourceId: "new-image" },
                ],
            },
            representations: [],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } as unknown as ProjectAsset;
    const result = refreshCanvasCharacterReferenceNodes([first, second], [asset], { nodeId: "first", outfitId: "new" });
    expect(result[0].metadata?.characterVersionId).toBe("v2");
    expect(result[0].metadata?.selectedOutfitId).toBe("new");
    expect(result[0].metadata?.characterCoverUrl).toContain("new-image");
    expect(result[1]).toBe(second);
});

test("手动替换已生成形象的图片后清除旧来源，新增生成形象仍保留来源", () => {
    const source = { taskId: "task-1" };
    const definition = { outfits: [{ id: "generated", name: "生成形象", resourceId: "old-image", source }] };
    const replaced = parseCharacterOutfits(definition).map((item) => ({ ...item, resourceId: "manual-image" }));
    const next = buildCharacterOutfitPersistence(definition, [...replaced, { id: "new", name: "新生成", resourceId: "new-image", source }]);
    const saved = parseCharacterOutfits(next.definition);
    expect(saved[0].resourceId).toBe("manual-image");
    expect(saved[0].source).toBeUndefined();
    expect(saved[1].source).toEqual(source);
});
