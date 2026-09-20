import { describe, expect, test } from "bun:test";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { assertCreativeBriefSpecifications, creativeProposalOps, creativeVideoSpecificationError, mergeCreativeBrief, normalizeCreativeProposal } from "../src/lib/creation/creative-agent-state";
import { applyCanvasOperations, type CanvasSnapshot } from "../src/lib/canvas/canvas-operation-contract";

const image = defaultModelCapabilityConfig("openai-image", "image-model");
const video = defaultModelCapabilityConfig("volcengine-ark-video", "video-model");
const config: AiConfig = { ...defaultConfig, model: "managed::image-model", imageModel: "managed::image-model", videoModel: "managed::video-model", models: ["managed::image-model", "managed::video-model"], imageModels: ["managed::image-model"], videoModels: ["managed::video-model"], channels: [{ ...defaultConfig.channels[0]!, id: "managed", models: ["image-model", "video-model"], modelCosts: [{ model: "image-model", capability: "image", capabilityConfig: image }, { model: "video-model", capability: "video", capabilityConfig: video }] }] };
const empty: CanvasSnapshot = { projectId: "canvas", title: "test", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
function shortFilm() {
    return { title: "悬疑短片", summary: "一个电梯故事", markdown: "完整故事大纲", deliverables: ["15 秒竖屏短片"], workflow: { nodes: [{ ref: "outline", kind: "text", title: "大纲", content: "叙事节奏" }, ...["character", "scene", "prop"].map((ref) => ({ ref, kind: "image", title: ref, prompt: ref })), { ref: "film", kind: "video", title: "短片", prompt: "电梯内发生异常", referenceRefs: ["character", "scene", "prop"] }], edges: ["character", "scene", "prop"].map((ref) => ({ from: "outline", to: ref })) }, generationItems: [...["character", "scene", "prop"].map((ref) => ({ ref, mode: "image", model: "managed::image-model" })), { ref: "film", mode: "video", model: "managed::video-model", seconds: 15, size: "9:16", referenceRefs: ["character", "scene", "prop"] }] };
}
describe("创作方案执行合同", () => {
    test("实际视频元数据不符不能按方案宣称成功", () => {
        const item = { ref: "film", mode: "video" as const, model: "video", seconds: 15, size: "9:16" };
        expect(creativeVideoSpecificationError(item, { durationMs: 6000, width: 720, height: 1280 })).toContain("6.00 秒");
        expect(creativeVideoSpecificationError(item, { durationMs: 15000, width: 1280, height: 720 })).toContain("比例不符");
        expect(creativeVideoSpecificationError(item, { durationMs: 15033, width: 720, height: 1280 })).toBeUndefined();
    });
    test("单段短片为5节点6真实连线，参考图并排分层，ID跨恢复稳定", () => {
        const proposal = normalizeCreativeProposal(shortFilm(), "p", 1, config);
        const ops = creativeProposalOps("run", proposal, empty, config);
        const next = applyCanvasOperations(empty, ops);
        expect(next.nodes).toHaveLength(5); expect(next.connections).toHaveLength(6);
        expect(ops.some((op) => op.type === "run_generation")).toBe(false);
        expect(next.nodes.filter((node) => node.type === "video")).toHaveLength(1);
        const refs = next.nodes.filter((node) => node.type === "image");
        expect(new Set(refs.map((node) => node.position.x)).size).toBe(1);
        expect(new Set(refs.map((node) => node.position.y)).size).toBe(3);
        expect(creativeProposalOps("run", proposal, empty, config)).toEqual(ops);
    });
    test("不能静默缩短已确认时长，也不能忽略模型输入上限", () => {
        const raw = shortFilm(); raw.generationItems[3]!.seconds = 10;
        const proposal = normalizeCreativeProposal(raw, "p", 1, config);
        expect(() => assertCreativeBriefSpecifications(proposal, { seconds: { value: 15, source: "user", status: "confirmed" } })).toThrow("15 秒");
        const limited = structuredClone(config); limited.channels[0]!.modelCosts![1]!.capabilityConfig!.video!.references.maxImages = 1;
        expect(() => normalizeCreativeProposal(shortFilm(), "p", 1, limited)).toThrow("参考图");
    });
    test("已有商品图进入正式引用节点但不进入收费生成项", () => {
        const proposal = normalizeCreativeProposal({ title: "海报", summary: "产品海报", markdown: "两版卖点设计", deliverables: ["营销图"], workflow: { nodes: [{ ref: "product", kind: "image", title: "商品", assetId: "asset" }, { ref: "poster", kind: "image", title: "海报", prompt: "保持商品实物", referenceRefs: ["product"] }], edges: [] }, generationItems: [{ ref: "poster", mode: "image", model: "managed::image-model", referenceRefs: ["product"] }] }, "p", 1, config, [{ id: "asset", assetId: "asset", title: "商品实物", kind: "image", storageKey: "resource:product" }]);
        expect(proposal.generationItems).toHaveLength(1);
        const nodes = applyCanvasOperations(empty, creativeProposalOps("run", proposal, empty, config)).nodes;
        expect(nodes[0]!.metadata?.assetId).toBe("asset"); expect(nodes[0]!.metadata?.status).toBe("success");
        expect(nodes[1]!.metadata?.referenceNodeIds).toEqual([nodes[0]!.id]);
    });
    test("模型推断不能降低程序已确认字段的状态", () => {
        const known = { seconds: { value: 15, source: "user" as const, status: "confirmed" as const } };
        expect(mergeCreativeBrief(known, [{ field: "seconds", value: 15, source: "user", status: "inferred" }], "short-film")).toEqual(known);
        expect(mergeCreativeBrief(known, [{ field: "seconds", value: 6, source: "user", status: "confirmed" }], "short-film", "请继续")).toEqual(known);
        expect(mergeCreativeBrief(known, [{ field: "seconds", value: 30, source: "user", status: "confirmed", evidence: "改为30秒" }], "short-film", "时长改为30秒").seconds?.value).toBe(30);
    });
});
