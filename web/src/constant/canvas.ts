import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { t } from "@/i18n";

type CanvasNodeSpec = {
    width: number;
    height: number;
    titleKey: string;
    metadata?: CanvasNodeMetadata;
};

type ResolvedCanvasNodeSpec = Omit<CanvasNodeSpec, "titleKey"> & {
    title: string;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 720, height: 405, titleKey: "canvas:image-node" },
    [CanvasNodeType.Text]: { width: 340, height: 240, titleKey: "canvas:text-node" },
    [CanvasNodeType.Drawing]: { width: 440, height: 300, titleKey: "canvas:drawing-node" },
    [CanvasNodeType.Script]: { width: 920, height: 360, titleKey: "canvas:storyboard-script-node" },
    [CanvasNodeType.Skill]: { width: 360, height: 220, titleKey: "canvas:skill-node" },
    [CanvasNodeType.Config]: { width: 340, height: 300, titleKey: "canvas:generation-config-node" },
    [CanvasNodeType.Video]: { width: 720, height: 405, titleKey: "canvas:video-node" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, titleKey: "canvas:audio-node" },
    [CanvasNodeType.Frame]: { width: 760, height: 520, titleKey: "domain:untitled-frame" },
    [CanvasNodeType.Markdown]: { width: 420, height: 320, titleKey: "canvas:markdown" },
    [CanvasNodeType.Svg]: { width: 420, height: 320, titleKey: "canvas:svg" },
    [CanvasNodeType.Html]: { width: 520, height: 380, titleKey: "canvas:html" },
    [CanvasNodeType.Panorama]: { width: 520, height: 300, titleKey: "domain:360-panorama" },
    [CanvasNodeType.Compare]: { width: 520, height: 320, titleKey: "canvas:contrast" },
    [CanvasNodeType.Chart]: { width: 480, height: 320, titleKey: "canvas:chart" },
    [CanvasNodeType.ColorGrade]: { width: 420, height: 360, titleKey: "canvas:color-grade" },
} satisfies Record<CanvasNodeType, { width: number; height: number; titleKey: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Image],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Text],
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Drawing]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Drawing],
        metadata: { status: "success" },
    },
    [CanvasNodeType.Script]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Script],
        metadata: {
            status: "idle",
            workflowKind: "script",
            storyboard: {
                rows: [],
                visibleColumns: ["shotNumber", "plotDescription", "videoMotionPrompt", "dialogue"],
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
    [CanvasNodeType.Markdown]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Markdown],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Svg]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Svg],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Html]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Html],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Panorama]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Panorama],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Compare]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Compare],
        metadata: { status: "idle" },
    },
    [CanvasNodeType.Chart]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Chart],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.ColorGrade]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.ColorGrade],
        metadata: { status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: CanvasNodeType): ResolvedCanvasNodeSpec {
    const spec = NODE_SPECS[type];
    return { ...spec, title: t(spec.titleKey) };
}
