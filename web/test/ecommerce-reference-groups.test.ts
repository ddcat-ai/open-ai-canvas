import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, normalizeEcommerceReferenceGroups, projectDraft, type EcommerceProject, type EcommerceDraft } from "../src/services/api/ecommerce";

const restore = (draft: Partial<EcommerceDraft>) => projectDraft({ draftJson: JSON.stringify(draft) } as EcommerceProject);

describe("商品素材和借鉴图片的持久化分组", () => {
    test("旧项目只迁移风格与竞品素材，保留资源元数据及商品身份", () => {
        const references: EcommerceDraft["references"] = [
            { resourceId: "product", role: "primary", name: "商品.png" },
            { resourceId: "style", role: "style", name: "排版.png", width: 750, height: 4200 },
            { resourceId: "detail", role: "detail", name: "商品细节.png" },
            { resourceId: "competitor", role: "competitor", name: "借鉴.png", width: 800, height: 5000 },
            { resourceId: "model", role: "model", catalogId: "model-catalog" },
        ];
        const restored = restore({ references, referenceMode: "detail", layoutReferenceId: "style" });
        expect(restored.references).toEqual([references[0], references[2], references[4]]);
        expect(restored.layoutReferences).toEqual([references[1], references[3]]);
        expect(restored.layoutReferenceId).toBe("style");
        expect(new Set([...restored.references, ...restored.layoutReferences!].map((ref) => ref.resourceId)).size).toBe(references.length);
        expect(normalizeEcommerceReferenceGroups(restored)).toEqual(restored);
    });

    test("显式借鉴数组优先，不从旧混合列表重新添加已经移除的来源", () => {
        const references: EcommerceDraft["references"] = [
            { resourceId: "product", role: "primary" },
            { resourceId: "old-style", role: "style" },
        ];
        const current = { resourceId: "chosen", role: "competitor" as const, name: "新借鉴.png" };
        expect(restore({ references, layoutReferences: [current] }).layoutReferences).toEqual([current]);
        expect(restore({ references, layoutReferences: [] }).layoutReferences).toEqual([]);
        expect(restore({ references, layoutReferences: [] }).references).toEqual([references[0]]);
    });

    test("旧单张商品长图的选择字段不能把商品图自动变为借鉴图", () => {
        const primary = { resourceId: "old-primary", role: "primary" as const, height: 6000, width: 750 };
        const restored = restore({ referenceMode: "detail", references: [primary], layoutReferenceId: primary.resourceId });
        expect(restored.references).toEqual([primary]);
        expect(restored.layoutReferences).toEqual([]);
        expect(restored.layoutReferenceId).toBe(primary.resourceId);
    });

    test("只有借鉴素材时不推断商品主图，自主策划也保留独立借鉴数组", () => {
        const layout = { resourceId: "inspiration", role: "style" as const };
        const restored = restore({ referenceMode: "product", references: [layout] });
        expect(restored.references).toEqual([]);
        expect(restored.layoutReferences).toEqual([layout]);
        expect(restored.referenceMode).toBe("product");
        expect(restored.references.some((reference) => reference.role === "primary")).toBe(false);
    });

    test("空草稿显式区分两组，归一化不修改原始对象", () => {
        expect(emptyEcommerceDraft().layoutReferences).toEqual([]);
        const original = { ...emptyEcommerceDraft(), layoutReferences: undefined, references: [{ resourceId: "style", role: "style" as const }] };
        const snapshot = structuredClone(original);
        const normalized = normalizeEcommerceReferenceGroups(original);
        expect(original).toEqual(snapshot);
        expect(normalized.references).toEqual([]);
        expect(normalized.layoutReferences).toEqual(snapshot.references);
        expect(restore({}).references).toEqual([]);
        expect(restore({}).layoutReferences).toEqual([]);
    });
});
