import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, title: "New Generation" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "Note" },
    [CanvasNodeType.Script]: { width: 920, height: 360, title: "分镜脚本" },
    [CanvasNodeType.Skill]: { width: 360, height: 220, title: "技能" },
    [CanvasNodeType.Config]: { width: 340, height: 300, title: "生成配置" },
    [CanvasNodeType.Video]: { width: 420, height: 236, title: "Video" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, title: "Audio" },
    [CanvasNodeType.Frame]: { width: 760, height: 520, title: "未命名背板" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Image],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Text],
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Script]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Script],
        metadata: {
            status: "idle",
            workflowKind: "script",
            storyboard: {
                rows: [],
                visibleColumns: ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                referenceNodeIds: [],
            },
        },
    },
    [CanvasNodeType.Skill]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Skill],
        metadata: { status: "success" },
    },
    [CanvasNodeType.Config]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Config],
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Video],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Audio],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Frame]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Frame],
        metadata: { frame: { collapsed: false, expandedWidth: NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, expandedHeight: NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height } },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: CanvasNodeType) {
    return NODE_SPECS[type];
}
