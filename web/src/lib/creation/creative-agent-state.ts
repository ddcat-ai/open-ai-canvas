import type { CanvasOperation, CanvasSnapshot } from "@/lib/canvas/canvas-operation-contract";
import { buildCanvasWorkflowOps } from "@/lib/canvas/canvas-workflow-builder";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { ResponseInputMessage } from "@/services/api/image";
import { dynamicCreativePlan, type CreativeDynamicPlan } from "./creative-plan";
import { normalizeCreativeField } from "./creative-agent-contract";
import { CREATIVE_SCENARIOS, type CreativeAnswers, type CreativeBrief, type CreativeGenerationItem, type CreativePlan, type CreativeProposal, type CreativeQuestionRequest, type CreativeScenarioId } from "./creative-agent-contract";

export type CreativeReference = { id: string; title: string; kind: "image" | "text"; assetId?: string; storageKey?: string; text?: string; mimeType?: string; width?: number; height?: number };
export type CreativeMessage = { id: string; role: "user" | "assistant"; text: string; question?: CreativeQuestionRequest; answers?: CreativeAnswers; proposal?: CreativeProposal };
export type CreativeMediaState = { ref: string; nodeId: string; attempt: number; submissionId?: string; taskId?: string; status: "pending" | "queued" | "running" | "ready" | "failed" | "write_failed"; storageKey?: string; error?: string; failureKind?: "generation" | "observation" };
export type CreativeAgentState = {
    schemaVersion: 1; scene: CreativeScenarioId; brief: CreativeBrief; messages: CreativeMessage[];
    references: CreativeReference[]; selectedSkillIds: string[]; textModel?: string;
    questions?: CreativeQuestionRequest; answers?: CreativeAnswers; proposal?: CreativeProposal;
    operations?: CanvasOperation[]; canvasApplied?: boolean; pendingEdits?: CanvasOperation[];
    pendingRedo?: { ref: string; attempt: number; proposalVersion: number };
    media: CreativeMediaState[]; pendingPayment?: string[];
    planning?: { itemKey: string; submissionId?: string; protocol: ResponseInputMessage[]; model?: string; prompt?: string; consumed?: boolean };
    modelCalls: number; error?: string; externalInteractionPresented?: boolean;
    dynamicPlan?: CreativeDynamicPlan;
    modificationRequested?: boolean;
};
export const initialCreativeState = (): CreativeAgentState => ({ schemaVersion: 1, scene: "general", brief: {}, messages: [], references: [], selectedSkillIds: [], media: [], modelCalls: 0 });
export function readCreativeState(value: Record<string, unknown>): CreativeAgentState {
    if (value.schemaVersion !== 1 || !Array.isArray(value.messages) || !Array.isArray(value.media) || !Object.hasOwn(CREATIVE_SCENARIOS, String(value.scene))) throw new Error("创作会话版本或内容无效，不能自动恢复");
    return value as unknown as CreativeAgentState;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
function required(value: unknown, name: string) { const text = str(value); if (!text) throw new Error(`方案缺少${name}`); return text; }

export function mergeCreativeBrief(brief: CreativeBrief, raw: unknown, _scene: CreativeScenarioId, latestUserInput = ""): CreativeBrief {
    const next = { ...brief };
    for (const candidate of Array.isArray(raw) ? raw : []) {
        const field = record(candidate);
        const fieldName = normalizeCreativeField(field.field);
        if (!fieldName) continue;
        const value = field.value;
        if (!(typeof value === "string" || typeof value === "number" && Number.isFinite(value) || Array.isArray(value) && value.every((item) => typeof item === "string"))) continue;
        const source = ["user", "asset", "default"].includes(str(field.source)) ? field.source as "user" | "asset" | "default" : "inferred";
        const status = ["confirmed", "unparsed", "conflict"].includes(str(field.status)) ? field.status as "confirmed" | "unparsed" | "conflict" : "inferred";
        if (next[fieldName]?.status === "confirmed" && (source !== "user" || !["confirmed", "conflict"].includes(status))) continue;
        if (next[fieldName]?.status === "confirmed" && JSON.stringify(next[fieldName]!.value) !== JSON.stringify(value)) {
            const evidence = str(field.evidence);
            if (!evidence || !latestUserInput.includes(evidence)) continue;
        }
        next[fieldName] = { value, source, status: source === "inferred" && status === "confirmed" ? "inferred" : status };
    }
    return next;
}

export function normalizeCreativeProposal(raw: unknown, id: string, version: number, config: AiConfig, references: CreativeReference[] = []): CreativeProposal<{ existingAssets: Record<string, CreativeReference> }> {
    const data = record(raw), workflow = record(data.workflow);
    const existingAssets: Record<string, CreativeReference> = {};
    if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 1 || workflow.nodes.length > 20) throw new Error("方案应包含 1 至 20 个有明确用途的节点");
    const nodes = workflow.nodes.map((value) => {
        const node = record(value), kind = str(node.kind);
        if (!["text", "image", "video", "styleboard", "story_input", "script"].includes(kind)) throw new Error("方案节点类型不可用，请读取能力目录");
        const content = str(node.content), prompt = str(node.prompt);
        const assetId = str(node.assetId), ref = required(node.ref, "节点引用");
        if (assetId) {
            const asset = references.find((item) => item.id === assetId && item.kind === "image" && resourceIdFromStorageKey(item.storageKey));
            if (kind !== "image" || !asset) throw new Error("方案引用的已有图片不可用");
            existingAssets[ref] = asset;
        }
        if (!assetId && (["text", "story_input"].includes(kind) ? !content : ["image", "video"].includes(kind) && !prompt)) throw new Error("文本节点需要正文，媒体节点需要生成提示词");
        const shots = Array.isArray(node.shots) ? node.shots.map((value) => { const shot = record(value); const durationSeconds = Number(shot.durationSeconds); if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("分镜时长必须大于零"); return { durationSeconds, videoMotionPrompt: required(shot.videoMotionPrompt, "分镜视频提示词"), dialogue: str(shot.dialogue) }; }) : undefined;
        if (shots && shots.length > 100) throw new Error("分镜最多 100 行");
        if (kind === "script" && !shots?.length) throw new Error("分镜方案必须提供非空 script.shots，每镜填写 durationSeconds 和 videoMotionPrompt；请把已设计镜头转成真实行，不能只填 content 或 prompt");
        return { ref: required(node.ref, "节点引用"), kind: kind as "text" | "image" | "video" | "styleboard" | "story_input" | "script", title: required(node.title, "节点标题"), content, prompt, shots, runGeneration: false, referenceRefs: Array.isArray(node.referenceRefs) ? node.referenceRefs.map(String) : [], referenceNodeIds: Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds.map(String) : [] };
    });
    const refs = new Set(nodes.map((node) => node.ref));
    if (refs.size !== nodes.length) throw new Error("方案节点引用重复");
    const generationItems: CreativeGenerationItem[] = (Array.isArray(data.generationItems) ? data.generationItems : []).map((value) => {
        const item = record(value), ref = required(item.ref, "生成目标"), node = nodes.find((candidate) => candidate.ref === ref);
        if (!node || (node.kind !== "image" && node.kind !== "video") || node.kind !== item.mode || existingAssets[ref]) throw new Error("生成任务与媒体节点不匹配，已有素材不能重复计费");
        const model = required(item.model, "生成模型");
        if (!selectableModelsByCapability(config, node.kind).includes(model)) throw new Error(`节点“${node.title}”需要${node.kind === "video" ? "视频" : "图片"}模型，所选模型不支持该用途或已不可用：${model}。请从 availableModels 中选择 mode=${node.kind} 的模型重新提交方案。`);
        const referenceRefs: string[] = [];
        const referenceNodeIds = new Set<string>();
        const inputReferences = new Set([
            ...node.referenceRefs, ...node.referenceNodeIds,
            ...(Array.isArray(item.referenceRefs) ? item.referenceRefs.map(String) : []),
        ]);
        for (const reference of inputReferences) {
            const planned = nodes.find((candidate) => candidate.ref === reference);
            if (planned) {
                if (reference === ref || planned.kind !== "image") throw new Error(`节点“${node.title}”的参考 ${reference} 必须指向其他图片节点`);
                referenceRefs.push(reference);
            } else {
                const existing = references.find((asset) => asset.id === reference && asset.kind === "image" && resourceIdFromStorageKey(asset.storageKey));
                if (!existing) throw new Error(`节点“${node.title}”引用的图片 ${reference} 不在本方案或当前可用画布素材中，请重新读取真实图片节点`);
                referenceNodeIds.add(existing.id);
            }
        }
        // A model may repeat a real canvas ID in both reference fields. Keep one verified input.
        node.referenceNodeIds = [...referenceNodeIds];
        const seconds = item.seconds === undefined ? undefined : Number(item.seconds);
        const result = { ref, mode: node.kind, model, size: str(item.size) || undefined, seconds, quality: str(item.quality) || undefined, referenceRefs };
        assertCreativeMediaCapability(result, config, referenceRefs.length + node.referenceNodeIds.length);
        node.referenceRefs = referenceRefs;
        return result;
    });
    const mediaRefs = generationItems.map((item) => item.ref);
    if (new Set(mediaRefs).size !== mediaRefs.length) throw new Error("方案存在重复的 generationItems.ref，每个待生成媒体节点只能对应一个生成项");
    const missing = nodes.filter((node) => (node.kind === "image" || node.kind === "video") && !existingAssets[node.ref] && !mediaRefs.includes(node.ref));
    if (missing.length) throw new Error(`方案缺少媒体生成配置：${missing.map((node) => `${node.title}（ref=${node.ref}，mode=${node.kind}）`).join("、")}。请补齐 generationItems；配置用于方案校验与报价，不代表立即生成，仍需用户确认。`);
    // 引用图的循环依赖会造成永远没有可执行批次。
    const visited = new Set<string>(), visiting = new Set<string>();
    const visit = (ref: string) => { if (visiting.has(ref)) throw new Error("方案存在循环素材依赖"); if (visited.has(ref)) return; visiting.add(ref); generationItems.find((item) => item.ref === ref)?.referenceRefs?.forEach(visit); visiting.delete(ref); visited.add(ref); };
    mediaRefs.forEach(visit);
    const edges = (Array.isArray(workflow.edges) ? workflow.edges : []).map((value) => { const edge = record(value); const from = str(edge.from), to = str(edge.to); if (!refs.has(from) || !refs.has(to) || from === to) throw new Error("方案连线引用无效"); return { from, to }; });
    return { id, version, title: required(data.title, "标题"), summary: required(data.summary, "摘要"), markdown: required(data.markdown, "完整内容"), deliverables: Array.isArray(data.deliverables) ? data.deliverables.map(String) : [], workflow: { title: str(data.title), nodes: nodes.map((node) => existingAssets[node.ref] ? { ...node, prompt: `引用已有素材：${node.title}` } : node), edges, autoRun: false }, generationItems, extra: { existingAssets } };
}

export function assertCreativeMediaCapability(item: CreativeGenerationItem, config: AiConfig, referenceCount: number) {
    const capability = modelCapabilityConfigFor(config, item.model);
    if (item.mode === "video") {
        const video = capability.video;
        if (!video) throw new Error("当前视频模型缺少可验证的能力配置");
        const seconds = Number(item.seconds);
        const duration = video.duration;
        const allowed = duration.selection === "enum" ? duration.values?.includes(seconds) : seconds >= (duration.min ?? 0) && seconds <= (duration.max ?? 0) && (seconds - (duration.min ?? 0)) % (duration.step || 1) === 0;
        if (!Number.isFinite(seconds) || !allowed) throw new Error(`当前视频模型不支持 ${item.seconds ?? "未指定"} 秒，请调整方案或模型`);
        if (!item.size || !video.ratios.includes(item.size)) throw new Error(`当前视频模型不支持 ${item.size || "未指定"} 比例`);
        if (referenceCount < video.references.minImages || referenceCount > video.references.maxImages) throw new Error(`当前视频模型要求 ${video.references.minImages} 至 ${video.references.maxImages} 张参考图，本方案为 ${referenceCount} 张`);
    } else {
        if (!capability.image) throw new Error("当前图片模型缺少可验证的能力配置");
        if (referenceCount > capability.image.references.maxImages) throw new Error("参考图片数量超过模型能力");
        if (item.size && !capability.image.size.allowCustom && !capability.image.size.values.includes(item.size)) throw new Error(`当前图片模型不支持 ${item.size} 尺寸`);
    }
}

export function creativeProposalOps(runId: string, proposal: CreativeProposal, snapshot: CanvasSnapshot, config: AiConfig): CanvasOperation[] {
    const ops = buildCanvasWorkflowOps(proposal.workflow, snapshot, config, `creation:${runId}:v${proposal.version}`);
    const columns = new Map<string, number>();
    const visiting = new Set<string>();
    const column = (ref: string): number => {
        if (visiting.has(ref)) throw new Error("工作流连线存在循环，不能自动编排");
        if (columns.has(ref)) return columns.get(ref)!;
        visiting.add(ref);
        const parents = [...(proposal.workflow.edges || []).filter((edge) => edge.to === ref).map((edge) => edge.from), ...(proposal.workflow.nodes.find((node) => node.ref === ref)?.referenceRefs || [])];
        const value = parents.length ? Math.max(...parents.map((parent) => column(parent))) + 1 : 0;
        visiting.delete(ref); columns.set(ref, value); return value;
    };
    const originX = snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 160 : 80;
    const rows = new Map<number, number>();
    return ops.filter((op) => op.type !== "select_nodes").map((op) => {
        if (op.type !== "add_node") return op;
        const node = proposal.workflow.nodes.find((item) => op.id === creativeNodeId(runId, proposal.version, item.ref));
        const item = proposal.generationItems.find((item) => item.ref === node?.ref);
        const asset = (proposal.extra as { existingAssets?: Record<string, CreativeReference> } | undefined)?.existingAssets?.[node?.ref || ""];
        const depth = column(node!.ref), y = rows.get(depth) || 80;
        rows.set(depth, y + (op.height || 405) + 120);
        return { ...op, position: { x: originX + depth * 880, y }, ...(asset?.width && asset.height ? { width: Math.min(asset.width, 720), height: Math.min(asset.width, 720) * asset.height / asset.width } : {}), metadata: { ...op.metadata, creationRunId: runId, creationProposalVersion: proposal.version, ...(item ? { model: item.model, size: item.size, seconds: item.seconds === undefined ? undefined : String(item.seconds), ...(item.mode === "video" ? { vquality: item.quality } : { quality: item.quality }) } : {}), ...(asset ? { content: resourceFileUrl(resourceIdFromStorageKey(asset.storageKey)!), storageKey: asset.storageKey, assetId: asset.assetId || asset.id, mimeType: asset.mimeType, naturalWidth: asset.width, naturalHeight: asset.height, status: "success" } : {}) } };
    });
}
export function assertCreativeBriefSpecifications(proposal: CreativeProposal, brief: CreativeBrief) {
    const seconds = brief.seconds?.status === "confirmed" ? Number(String(brief.seconds.value).match(/\d+(?:\.\d+)?/)?.[0]) : undefined;
    const ratio = brief.aspectRatio?.status === "confirmed" ? String(brief.aspectRatio.value).match(/\d+\s*[:：]\s*\d+/)?.[0].replace(/[\s：]/g, (char) => char === "：" ? ":" : "") : undefined;
    for (const item of proposal.generationItems) {
        if (item.mode === "video" && seconds && item.seconds !== seconds) throw new Error(`方案时长与已确认的 ${seconds} 秒不符，请修改方案后再确认`);
        if (ratio) {
            const expected = ratio.split(":").map(Number);
            const actual = item.size?.trim().match(item.mode === "image" ? /^(\d+(?:\.\d+)?)\s*[:：x×]\s*(\d+(?:\.\d+)?)$/i : /^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
            const width = Number(actual?.[1]), height = Number(actual?.[2]);
            if (!(width > 0 && height > 0) || Math.abs(width * expected[1] - height * expected[0]) > 1e-6) throw new Error(`方案比例与已确认的 ${ratio} 不符，请修改方案后再确认`);
        }
    }
}
export const creativeNodeId = (runId: string, version: number, ref: string) => `creation:${runId}:v${version}:node:${encodeURIComponent(ref)}`;
export function creativeVideoSpecificationError(item: CreativeGenerationItem | undefined, output: { durationMs?: number; width?: number; height?: number }): string | undefined {
    if (item?.mode !== "video") return;
    if (item.seconds && output.durationMs && Math.abs(output.durationMs - item.seconds * 1000) > 250) return `实际视频为 ${(output.durationMs / 1000).toFixed(2)} 秒，与方案 ${item.seconds} 秒不符。已保留产物，请核对后选择是否重做。`;
    const ratio = item.size?.match(/^(\d+):(\d+)$/);
    if (ratio && output.width && output.height && Math.abs(output.width / output.height / (Number(ratio[1]) / Number(ratio[2])) - 1) > 0.02) return `实际视频为 ${output.width}×${output.height}，与方案 ${item.size} 比例不符。已保留产物，请核对后选择是否重做。`;
}
export function creativePlan(state: CreativeAgentState): CreativePlan | undefined {
    if (state.dynamicPlan) return dynamicCreativePlan(state);
    if (!state.proposal && !state.questions) return undefined;
    return { id: state.proposal?.id ?? state.questions!.interactionId, steps: [
        { id: "brief", title: "了解需求", status: state.questions?.status === "pending" ? "waiting" : "completed" },
        { id: "proposal", title: "确认创意方案", status: state.canvasApplied ? "completed" : state.proposal ? "waiting" : "pending" },
        ...state.media.map((item) => ({ id: item.ref, title: state.proposal?.workflow.nodes.find((node) => node.ref === item.ref)?.title || item.ref, status: item.status === "ready" ? "completed" as const : item.status === "failed" || item.status === "write_failed" ? "failed" as const : item.status === "running" || item.status === "queued" ? "running" as const : item.submissionId ? "waiting" as const : "pending" as const, nodeIds: [item.nodeId], detail: item.error })),
    ] };
}
