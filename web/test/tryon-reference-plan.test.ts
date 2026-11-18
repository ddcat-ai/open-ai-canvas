import { describe, expect, test } from "bun:test";
import { TRYON_FUNCTIONS, tryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { agentReferenceIds, buildTryOnJobs, configViewReferences, defaultTryOnDraft, missingInput, needsAgentPlan, tryOnAgentPrompt, type TryOnDraft, type TryOnImage } from "@/pages/ecommerce/tryon/tryon-plan";
import { snapshotDraft } from "@/pages/ecommerce/tryon/tryon-store";

const image = (slot: TryOnImage["slot"], id: string, extra: Partial<TryOnImage> = {}): TryOnImage => ({ id, resourceId: id, slot, name: id, previewUrl: `/api/resources/${id}/file`, ...extra });
const market = { platform: "taobao", platformLabel: "淘宝", language: "zh-CN", languageLabel: "中文" };
const knowledge = { source: "builtin" as const, entries: [], knowledge: "人体关节应自然" };
const draft = (fn: TryOnDraft["fn"], images: TryOnImage[]): TryOnDraft => ({ ...defaultTryOnDraft(), fn, images: { [fn]: images } });

describe("模特三视图", () => {
    test("入口注册、仅人物必填，服装正背面与背景按实际顺序编号", () => {
        expect(TRYON_FUNCTIONS.some((item) => item.id === "model-views")).toBe(true);
        expect(
            tryOnFunction("model-views")
                .slots.filter((slot) => slot.min)
                .map((slot) => slot.key),
        ).toEqual(["model"]);
        expect(missingInput(draft("model-views", []))).toBe("请上传模特");
        const source = draft("model-views", [image("model", "person"), image("garment-back", "back"), image("background", "scene")]);
        expect(missingInput(source)).toBe("");
        expect(configViewReferences(source).map((item) => item.resourceId)).toEqual(["person", "back", "scene"]);
        const [job] = buildTryOnJobs(source);
        expect(job.references.map((item) => item.role)).toEqual(["model", "garment-back", "background"]);
        expect(job.prompt).toContain("第 2 张参考图用途：同一件服装的背面");
        expect(job.prompt).toContain("正面、45°侧面、背面");
        expect(job.prompt).not.toContain("不拼图");
    });
});

describe("Agent 理解姿势、身份与相机角度", () => {
    const metadata = { id: "YC-P002:above", title: "单手扶腰", category: "全身造型", angle: "俯视", instruction: "从上方俯拍，左手扶腰，保留肢体遮挡与透视" };
    const source = { ...draft("pose", [image("subject", "subject"), image("pose", "pose-above", { referenceInfo: metadata }), image("pose", "pose-side")]), count: 3, poses: ["双手叉腰"], notes: "右手拿包，保持脸和衣服" };
    test("上传未知姿势先读图，按主体与全部姿势顺序传给识图模型", () => {
        expect(needsAgentPlan({ ...source, agent: false })).toBe(true);
        expect(agentReferenceIds(source)).toEqual(["subject", "pose-above", "pose-side"]);
        const prompt = tryOnAgentPrompt(source, knowledge, market);
        expect(prompt).toContain("第 1 张：唯一主体");
        expect(prompt).toContain("第 2 张：姿势与机位参考");
        expect(prompt).toContain("俯视");
        expect(prompt).toContain(source.notes);
        expect(prompt).toContain("先按姿势参考图上传顺序");
        expect(prompt).not.toContain("场景与姿势不重复");
    });
    test("已知素材和文本姿势直接生图，保留机位与用户要求", () => {
        const known = { ...source, images: { pose: [image("subject", "subject"), image("pose", "pose-above", { referenceInfo: metadata })] } };
        expect(needsAgentPlan(known)).toBe(false);
        expect(needsAgentPlan({ ...known, images: { pose: [image("subject", "subject")] } })).toBe(false);
        const [job] = buildTryOnJobs(known);
        expect(job.prompt).toContain(metadata.instruction);
        expect(job.prompt).toContain(source.notes);
        expect(job.references.map((item) => item.resourceId)).toEqual(["subject", "pose-above"]);
        expect(needsAgentPlan({ ...known, images: { pose: [image("pose", "empty", { referenceInfo: { ...metadata, instruction: " " } })] } })).toBe(true);
    });
    test("每张只带对应姿势；参考角度和 Agent 的具体动作进入出图提示词", () => {
        const shots = Array.from({ length: 3 }, (_, i) => ({ scene: "原场景", pose: `动作${i + 1}：左手扶腰`, camera: i === 0 ? "俯视" : "侧面", lighting: "原光线" }));
        const jobs = buildTryOnJobs(source, { shots });
        expect(jobs.map((job) => job.references.map((item) => item.resourceId))).toEqual([["subject", "pose-above"], ["subject", "pose-side"], ["subject"]]);
        expect(jobs[0].prompt).toContain("【姿势与视角】单手扶腰；俯视");
        expect(jobs[0].prompt).toContain("动作1：左手扶腰");
        expect(jobs[1].prompt).toContain("动作2：左手扶腰");
        expect(jobs[2].prompt).toContain("双手叉腰");
        expect(jobs[0].prompt).toContain("不带入其中人物的长相、服装");
    });
    test("保存快照保留参考名称、角度和动作说明", () => {
        expect(snapshotDraft(source).images.pose?.[1].referenceInfo).toEqual(metadata);
    });
});

import { libraryReferenceEntry, searchReferences } from "@/pages/ecommerce/tryon/reference-catalog";

describe("站点素材目录", () => {
    test("按后台已开放角度创建引用，不填充不存在的角度", () => {
        const entry = libraryReferenceEntry({ key: "pose-1", code: "P1", name: "站姿", system: "基础", category: "全身", sourceKey: "own", items: [{ id: "item-1", angle: "背面", width: 600, height: 900, version: 3 }] }, "pose");
        expect(entry.views.front).toBeUndefined();
        expect(entry.views.back?.itemId).toBe("item-1");
        expect(entry.views.back?.thumbnail).toContain("/pose-library/items/item-1/thumb?v=3");
        expect(searchReferences([entry], "站姿", "全身")).toEqual([entry]);
    });
});
