import { nanoid } from "nanoid";

import { createDocumentChapter } from "@/lib/canvas/canvas-document";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { scopedLocalStorage } from "@/lib/user-scope";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

const SHORT_DRAMA_GUIDE_STORAGE_KEY = "canvas-short-drama-guide-v1";

export type CanvasShortDramaStepId = "style" | "story" | "storyboard" | "video" | "final";
export type CanvasShortDramaStepStatus = "pending" | "current" | "completed";
export type CanvasShortDramaStep = {
    id: CanvasShortDramaStepId;
    label: string;
    status: CanvasShortDramaStepStatus;
    nodeId?: string;
};

export type CanvasShortDramaProgress = {
    active: boolean;
    completed: boolean;
    completedCount: number;
    steps: CanvasShortDramaStep[];
};

export function createShortDramaPipeline(center: Position) {
    const styleNode = createCanvasNode(CanvasNodeType.Text, { x: center.x - 760, y: center.y - 170 }, {
        content: "",
        status: "idle",
        workflowKind: "styleboard",
        workflowTitle: "项目画风",
        workflowDescription: "待选择",
        fontSize: 14,
    });
    styleNode.title = "项目画风 · 待选择";
    styleNode.width = 360;
    styleNode.height = 220;

    const storyNode = createCanvasNode(CanvasNodeType.Text, { x: center.x - 760, y: center.y + 170 }, {
        content: "",
        status: "idle",
        workflowKind: "story_input",
        workflowTitle: "故事输入",
        workflowDescription: "小说或梗概",
        storyInputMode: "novel",
        fontSize: 14,
    });
    storyNode.title = "故事输入 · 小说";
    storyNode.width = 420;
    storyNode.height = 260;

    const scriptNode = createCanvasNode(CanvasNodeType.Script, { x: center.x + 180, y: center.y }, {
        status: "idle",
        workflowKind: "storyboard",
        workflowTitle: "分镜脚本",
        storyboard: {
            rows: [],
            visibleColumns: ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
            referenceNodeIds: [],
        },
    });
    scriptNode.title = "分镜脚本 · 待生成";

    const connections: CanvasConnection[] = [
        { id: nanoid(), fromNodeId: styleNode.id, toNodeId: scriptNode.id, toHandleId: "storyboard:context" },
        { id: nanoid(), fromNodeId: storyNode.id, toNodeId: scriptNode.id, toHandleId: "storyboard:context" },
    ];
    return { nodes: [styleNode, storyNode, scriptNode], connections, styleNodeId: styleNode.id, storyNodeId: storyNode.id, scriptNodeId: scriptNode.id };
}

export function deriveShortDramaProgress(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasShortDramaProgress {
    const storyInputNode = nodes.find((node) => node.metadata?.workflowKind === "story_input");
    const storyboardScripts = nodes.filter((node) => node.type === CanvasNodeType.Script && (node.metadata?.workflowKind === "storyboard" || Boolean(storyInputNode)));
    const agentScriptNode = nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "script");
    const shotNodes = nodes.filter((node) => node.metadata?.workflowKind === "shot");
    const finalNodes = nodes.filter((node) => node.metadata?.workflowKind === "final");
    const hasManualPipeline = Boolean(storyInputNode || storyboardScripts.some((node) => node.metadata?.workflowKind === "storyboard"));
    const hasAgentPipeline = Boolean(agentScriptNode && shotNodes.length && finalNodes.length);
    const active = hasManualPipeline || hasAgentPipeline;
    const scriptIds = new Set(storyboardScripts.map((node) => node.id));
    const isConnectedToStoryboard = (nodeId: string) => connections.some((connection) => connection.fromNodeId === nodeId && scriptIds.has(connection.toNodeId));
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    const linkedNovelNode = nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.document?.kind === "novel" && isConnectedToStoryboard(node.id));
    const storyNode = storyInputNode || linkedNovelNode || agentScriptNode;
    const scriptNode = storyboardScripts.find((node) => meaningfulStoryboardRows(node).length > 0) || storyboardScripts[0];
    const meaningfulRows = scriptNode ? meaningfulStoryboardRows(scriptNode) : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const successfulVideoNodeIds = new Set(nodes.filter(isSuccessfulVideoNode).map((node) => node.id));
    const completedShotVideos = nodes.filter((node) => isSuccessfulVideoNode(node) && (node.metadata?.workflowKind === "shot" || connections.some((connection) => shotNodes.some((shot) => shot.id === connection.fromNodeId) && connection.toNodeId === node.id)));
    const finalNode = finalNodes.find((node) => node.metadata?.status === "success" && Boolean(node.metadata.content));

    const storyText = (storyNode?.metadata?.document?.plainText || storyNode?.metadata?.content || "").trim();
    // 手工流水线要求输入真实连到分镜脚本；Agent 协议的风格板和剧本没有这条连线，按领域节点本身判断。
    const styleDone = Boolean((styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim() && (hasAgentPipeline || !scriptNode || isConnectedToStoryboard(styleNode!.id)));
    const storyDone = Boolean(storyText && storyNode && (storyNode === agentScriptNode || !scriptNode || isConnectedToStoryboard(storyNode.id)));
    const storyboardDone = meaningfulRows.length > 0 || shotNodes.length > 0;
    const rowsWithVideo = meaningfulRows.filter((row) => row.videoNodeId && nodeById.get(row.videoNodeId)?.type === CanvasNodeType.Video);
    const videoDone = meaningfulRows.length > 0
        ? rowsWithVideo.length === meaningfulRows.length && rowsWithVideo.every((row) => {
              const videoNode = nodeById.get(row.videoNodeId!);
              return videoNode?.metadata?.status === "success" && Boolean(videoNode.metadata.content);
          })
        : shotNodes.length > 0 && shotNodes.every((shot) => connections.some((connection) => connection.fromNodeId === shot.id && successfulVideoNodeIds.has(connection.toNodeId)));
    const done = [styleDone, storyDone, storyboardDone, videoDone, Boolean(finalNode)];
    const firstIncomplete = done.findIndex((value) => !value);
    const firstShotNode = shotNodes[0];
    const definitions: Array<{ id: CanvasShortDramaStepId; label: string; nodeId?: string }> = [
        { id: "style", label: "选择画风", nodeId: styleNode?.id },
        { id: "story", label: "输入故事", nodeId: storyNode?.id },
        { id: "storyboard", label: "生成分镜", nodeId: scriptNode?.id || firstShotNode?.id },
        { id: "video", label: "生成视频", nodeId: scriptNode?.id || firstShotNode?.id || completedShotVideos[0]?.id },
        { id: "final", label: "合并成片", nodeId: finalNode?.id || finalNodes[0]?.id || completedShotVideos[0]?.id },
    ];
    const steps = definitions.map((step, index): CanvasShortDramaStep => ({
        ...step,
        status: done[index] ? "completed" : index === firstIncomplete ? "current" : "pending",
    }));
    return {
        active,
        completed: done.every(Boolean),
        completedCount: done.filter(Boolean).length,
        steps,
    };
}

export function storyInputNodeWithMode(node: CanvasNodeData, mode: "novel" | "brief") {
    const content = (node.metadata?.document?.plainText || node.metadata?.content || "").trim();
    if (mode === "brief") {
        const metadata = { ...node.metadata, content, storyInputMode: mode, status: content ? "success" as const : "idle" as const };
        delete metadata.document;
        return { ...node, title: "故事输入 · 梗概", metadata };
    }
    const chapter = createDocumentChapter("第 1 章", content, 0);
    return {
        ...node,
        title: "故事输入 · 小说",
        metadata: {
            ...node.metadata,
            content,
            storyInputMode: mode,
            status: content ? "success" as const : "idle" as const,
            document: {
                kind: "novel" as const,
                format: "tiptap-json" as const,
                json: chapter.json,
                plainText: content,
                characterCount: Array.from(content).length,
                chapters: [chapter],
                activeChapterId: chapter.id,
                updatedAt: new Date().toISOString(),
            },
        },
    };
}

export function readShortDramaGuideDismissed() {
    try {
        return scopedLocalStorage.getItem(SHORT_DRAMA_GUIDE_STORAGE_KEY) === "dismissed";
    } catch (error) {
        console.warn("读取短剧导引状态失败", error);
        return false;
    }
}

export function persistShortDramaGuideDismissed() {
    try {
        scopedLocalStorage.setItem(SHORT_DRAMA_GUIDE_STORAGE_KEY, "dismissed");
    } catch (error) {
        console.warn("保存短剧导引状态失败", error);
    }
}

function meaningfulStoryboardRows(node: CanvasNodeData) {
    return (node.metadata?.storyboard?.rows || []).filter((row) => Boolean((row.plotDescription || row.imageGenerationPrompt || row.videoMotionPrompt).trim()));
}

function isSuccessfulVideoNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && node.metadata?.status === "success" && Boolean(node.metadata.content);
}
