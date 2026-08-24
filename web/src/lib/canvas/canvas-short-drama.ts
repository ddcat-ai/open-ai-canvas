import { t } from "@/i18n";
import { nanoid } from "nanoid";

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
    const styleNode = createCanvasNode(
        CanvasNodeType.Text,
        { x: center.x - 760, y: center.y - 170 },
        {
            content: "",
            status: "idle",
            workflowKind: "styleboard",
            workflowTitle: t("canvas:project-style-3"),
            workflowDescription: t("canvas:to-choose-3"),
            fontSize: 14,
        },
    );
    styleNode.title = t("canvas:project-style-to-choose");
    styleNode.width = 360;
    styleNode.height = 220;

    const storyNode = createCanvasNode(
        CanvasNodeType.Text,
        { x: center.x - 760, y: center.y + 170 },
        {
            content: "",
            status: "idle",
            workflowKind: "story_input",
            workflowTitle: t("canvas:story-input"),
            workflowDescription: t("canvas:genre-characters-conflict-ending-direction"),
            fontSize: 14,
        },
    );
    storyNode.title = t("canvas:story-synopsis-3");
    storyNode.width = 420;
    storyNode.height = 260;

    const scriptNode = createCanvasNode(
        CanvasNodeType.Script,
        { x: center.x + 180, y: center.y },
        {
            status: "idle",
            workflowKind: "storyboard",
            workflowTitle: t("canvas:storyboard-script"),
            storyboard: {
                rows: [],
                visibleColumns: ["shotNumber", "plotDescription", "videoMotionPrompt", "dialogue"],
                referenceNodeIds: [],
            },
        },
    );
    scriptNode.title = t("canvas:storyboard-to-generate");

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
    const storyNode = storyInputNode || agentScriptNode;
    const scriptNode = storyboardScripts.find((node) => meaningfulStoryboardRows(node).length > 0) || storyboardScripts[0];
    const meaningfulRows = scriptNode ? meaningfulStoryboardRows(scriptNode) : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const successfulVideoNodeIds = new Set(nodes.filter(isSuccessfulVideoNode).map((node) => node.id));
    const completedShotVideos = nodes.filter(
        (node) => isSuccessfulVideoNode(node) && (node.metadata?.workflowKind === "shot" || connections.some((connection) => shotNodes.some((shot) => shot.id === connection.fromNodeId) && connection.toNodeId === node.id)),
    );
    const finalNode = finalNodes.find((node) => node.metadata?.status === "success" && Boolean(node.metadata.content));

    const storyText = (storyNode?.metadata?.content || "").trim();
    // 手工流水线要求输入真实连到分镜脚本；Agent 协议的风格板和剧本没有这条连线，按领域节点本身判断。
    const styleDone = Boolean((styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim() && (hasAgentPipeline || !scriptNode || isConnectedToStoryboard(styleNode!.id)));
    const storyDone = Boolean(storyText && storyNode && (storyNode === agentScriptNode || !scriptNode || isConnectedToStoryboard(storyNode.id)));
    const storyboardDone = meaningfulRows.length > 0 || shotNodes.length > 0;
    const rowsWithVideo = meaningfulRows.filter((row) => row.videoNodeId && nodeById.get(row.videoNodeId)?.type === CanvasNodeType.Video);
    const videoDone =
        meaningfulRows.length > 0
            ? rowsWithVideo.length === meaningfulRows.length &&
              rowsWithVideo.every((row) => {
                  const videoNode = nodeById.get(row.videoNodeId!);
                  return videoNode?.metadata?.status === "success" && Boolean(videoNode.metadata.content);
              })
            : shotNodes.length > 0 && shotNodes.every((shot) => connections.some((connection) => connection.fromNodeId === shot.id && successfulVideoNodeIds.has(connection.toNodeId)));
    const done = [styleDone, storyDone, storyboardDone, videoDone, Boolean(finalNode)];
    const firstIncomplete = done.findIndex((value) => !value);
    const firstShotNode = shotNodes[0];
    const definitions: Array<{ id: CanvasShortDramaStepId; label: string; nodeId?: string }> = [
        { id: "style", label: t("canvas:select-style-2"), nodeId: styleNode?.id },
        { id: "story", label: t("canvas:enter-story"), nodeId: storyNode?.id },
        { id: "storyboard", label: t("canvas:generate-storyboard"), nodeId: scriptNode?.id || firstShotNode?.id },
        { id: "video", label: t("canvas:generate-video"), nodeId: scriptNode?.id || firstShotNode?.id || completedShotVideos[0]?.id },
        { id: "final", label: t("canvas:merge-videos-2"), nodeId: finalNode?.id || finalNodes[0]?.id || completedShotVideos[0]?.id },
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

export function readShortDramaGuideDismissed() {
    try {
        return scopedLocalStorage.getItem(SHORT_DRAMA_GUIDE_STORAGE_KEY) === "dismissed";
    } catch (error) {
        console.warn(t("canvas:failed-to-read-drama-guide-state"), error);
        return false;
    }
}

export function persistShortDramaGuideDismissed() {
    try {
        scopedLocalStorage.setItem(SHORT_DRAMA_GUIDE_STORAGE_KEY, "dismissed");
    } catch (error) {
        console.warn(t("canvas:failed-to-save-drama-guide-state"), error);
    }
}

function meaningfulStoryboardRows(node: CanvasNodeData) {
    return (node.metadata?.storyboard?.rows || []).filter((row) => Boolean((row.plotDescription || row.imageGenerationPrompt || row.videoMotionPrompt).trim()));
}

function isSuccessfulVideoNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && node.metadata?.status === "success" && Boolean(node.metadata.content);
}
