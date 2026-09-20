import type { CanvasOperation, CanvasSnapshot } from "./canvas-operation-contract";
import { createStoryboardRow } from "./canvas-project-domain";
import type { StoryboardRow } from "@/types/canvas";
import { inspectStoryboardReadiness } from "./canvas-storyboard-context";
import { createShortDramaPipeline } from "./canvas-short-drama";

export function buildAgentStoryboardDraft(input: { title: string; prompt: string; x: number; y: number }): CanvasOperation[] {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("待拆镜节点需要标题和原始剧本");
    const node = createShortDramaPipeline({ x: input.x - 180, y: input.y }).nodes[2];
    return [{ type: "add_node", id: node.id, nodeType: node.type, title: input.title, position: node.position, width: node.width, height: node.height,
        metadata: { ...node.metadata, composerContent: input.prompt, workflowDescription: "待专业拆镜，尚未生成镜头" } }];
}

const textFields = ["plotDescription", "dialogue", "videoMotionPrompt", "imageGenerationPrompt", "camera", "motion", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "narrativeIntent", "viewerPOV", "performanceBlocking", "timeBeats", "continuityOut", "negativePrompt"] as const;

export function validateAgentStoryboardCreation(ops: CanvasOperation[]) {
    for (const op of ops) {
        if (op.type !== "add_node" || op.nodeType !== "script") continue;
        const rows = op.metadata?.storyboard?.rows;
        if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some((row) => !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || !row.videoMotionPrompt?.trim())) throw new Error("分镜节点必须包含真实镜头行。请使用 canvas_create_workflow 的 script.shots 填写每镜时长和视频提示词，不能仅填正文；已有分镜使用 canvas_edit_storyboard");
    }
    return ops;
}

export function readAgentStoryboard(snapshot: CanvasSnapshot, nodeId: string) {
    const node = snapshot.nodes.find((item) => item.id === nodeId && item.type === "script");
    if (!node) throw new Error("未找到当前画布的分镜脚本节点，请先查找真实节点");
    return { node, rows: node.metadata?.storyboard?.rows || [], readiness: inspectStoryboardReadiness(snapshot.nodes) };
}

export function buildAgentStoryboardOperations(snapshot: CanvasSnapshot, input: Record<string, unknown>): CanvasOperation[] {
    if (typeof input.nodeId !== "string") throw new Error("需要分镜节点 nodeId");
    const { node, rows } = readAgentStoryboard(snapshot, input.nodeId);
    const action = input.action;
    const rowId = typeof input.rowId === "string" ? input.rowId : "";
    const index = rows.findIndex((row) => row.id === rowId);
    let next = rows.slice();
    if (action === "remove") {
        if (index < 0) throw new Error("分镜行不存在，请重新读取分镜表");
        // Removing a row never deletes its existing generated assets.
        next.splice(index, 1);
    } else if (action === "append" || action === "update") {
        if (action === "update" && index < 0) throw new Error("分镜行不存在，请重新读取分镜表");
        const raw = input.patch;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("需要分镜内容 patch");
        const data = raw as Record<string, unknown>;
        const patch: Partial<StoryboardRow> = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === "durationSeconds") {
                if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("分镜时长必须是大于零的数字");
                patch.durationSeconds = value;
            } else if (textFields.includes(key as typeof textFields[number])) {
                if (typeof value !== "string" || value.length > 20_000) throw new Error(`分镜字段 ${key} 需要不超过 20000 字符的文本`);
                patch[key as typeof textFields[number]] = value;
            } else throw new Error(`不能通过分镜编辑修改字段 ${key}；已有素材关联与任务状态由系统维护`);
        }
        if (!Object.keys(patch).length) throw new Error("未提供需要修改的分镜内容");
        if (action === "append") {
            if (rows.length >= 100) throw new Error("单个分镜表最多 100 行");
            if (!patch.videoMotionPrompt?.trim() && !patch.plotDescription?.trim()) throw new Error("新增镜头需要画面描述或视频提示词");
            next.push(createStoryboardRow(rows.length + 1, patch));
        } else next[index] = { ...rows[index], ...patch };
    } else throw new Error("分镜操作必须是 append、update 或 remove");
    next = next.map((row, i) => ({ ...row, shotNumber: i + 1 }));
    return [{ type: "update_node", id: node.id, metadata: { storyboard: {
        rows: next,
        visibleColumns: node.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
        referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [],
    } } }];
}
