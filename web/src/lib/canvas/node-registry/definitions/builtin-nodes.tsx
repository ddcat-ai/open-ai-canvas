import { ChartColumn, Clapperboard, Code, Columns2, FileText, Globe, Image as ImageIcon, Music2, PanelTop, Palette, Pencil, Settings2, Shapes, Sparkles, Type, Video } from "lucide-react";

import { NODE_SPECS } from "@/constant/canvas";
import { MEDIA_NODE_MIN_SIZE } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasNodeDefinition } from "../node-definition";
import { registerNodeDefinitions } from "../node-registry";

/** 非媒体节点的拉伸下限 */
const DEFAULT_MIN_SIZE = { width: 220, height: 160 } as const;

/**
 * 每种内置节点的自有特征。
 *
 * 尺寸、默认标题与初始 metadata 不在这里重复——它们的数据源是 constant/canvas.ts 的
 * NODE_SPECS，下方装配时统一读取。
 *
 * 内置节点保持集中定义；第三方节点通过同一 registry 以命名空间 ID 动态注册。
 */
const BUILTIN_NODE_TRAITS = {
    [CanvasNodeType.Image]: {
        label: "图片",
        icon: <ImageIcon />,
        minSize: MEDIA_NODE_MIN_SIZE,
        keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "image" : null),
        generationMode: () => "image",
        inputKind: "image",
    },
    [CanvasNodeType.Text]: {
        label: "文本",
        icon: <Type />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content || node.metadata?.prompt ? "text" : null),
        generationMode: () => "text",
        inputKind: "text",
    },
    [CanvasNodeType.Drawing]: {
        label: "绘图",
        icon: <Pencil />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        // 绘图产出的是图像，所以作为素材与输入都按图片计。
        resourceKind: (node: CanvasNodeData) => (node.metadata?.drawingId ? "image" : null),
        inputKind: "image",
    },
    [CanvasNodeType.Script]: {
        label: "分镜脚本",
        icon: <Clapperboard />,
        // 分镜脚本的表格布局需要更宽的下限；高度仍由内容动态撑开（见 canvas-node.tsx）。
        minSize: { width: 800, height: DEFAULT_MIN_SIZE.height },
        showInCreateMenu: true,
        generationMode: () => "text",
        inputKind: "text",
    },
    [CanvasNodeType.Skill]: {
        label: "技能",
        icon: <Sparkles />,
        minSize: DEFAULT_MIN_SIZE,
        // 技能节点由技能库插入，不占创建菜单格位。
        showInCreateMenu: false,
        // 技能注入的是提示词文本，故按文本素材计。
        resourceKind: (node: CanvasNodeData) => (node.metadata?.skillSnapshot || node.metadata?.content ? "text" : null),
        inputKind: "text",
    },
    [CanvasNodeType.Config]: {
        label: "生成配置",
        icon: <Settings2 />,
        minSize: DEFAULT_MIN_SIZE,
        // 生成配置由连线时自动创建。
        showInCreateMenu: false,
        // 生成模式由用户在配置节点上选择，缺省按图片。
        generationMode: (node: CanvasNodeData) => node.metadata?.generationMode || "image",
        // 不设 inputKind：配置节点本身不是参考素材，不参与容量计数。
    },
    [CanvasNodeType.Video]: {
        label: "视频",
        icon: <Video />,
        minSize: MEDIA_NODE_MIN_SIZE,
        keepAspectRatio: () => true,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "video" : null),
        generationMode: () => "video",
        inputKind: "video",
    },
    [CanvasNodeType.Audio]: {
        label: "音频",
        icon: <Music2 />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "audio" : null),
        generationMode: () => "audio",
        inputKind: "audio",
    },
    [CanvasNodeType.Frame]: {
        label: "背板",
        // 背板在列表里就叫「背板」，不是「背板节点」——显式钉住，避免被 label 派生改写。
        listLabel: "背板",
        icon: <PanelTop />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        // 背板只是视觉容器，既不是素材也不参与计数。
    },
    [CanvasNodeType.Markdown]: {
        label: "Markdown",
        icon: <FileText />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        // 渲染的是 Markdown 源码，作为素材与输入都按文本计。
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "text" : null),
        inputKind: "text",
        // 不设 generationMode：它是展示节点，自身不发起生成。
    },
    [CanvasNodeType.Svg]: {
        label: "SVG",
        icon: <Shapes />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        // 内容是 SVG 源码，按文本素材计；渲染成图但不产出图片资源。
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "text" : null),
        inputKind: "text",
    },
    [CanvasNodeType.Html]: {
        label: "HTML",
        icon: <Code />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content ? "text" : null),
        inputKind: "text",
    },
    [CanvasNodeType.Panorama]: {
        label: "全景",
        icon: <Globe />,
        minSize: MEDIA_NODE_MIN_SIZE,
        showInCreateMenu: true,
        // 查看器：消费上游图片，自身不作为素材被引用，故不设 resourceKind。
        inputKind: "image",
    },
    [CanvasNodeType.Compare]: {
        label: "对比",
        icon: <Columns2 />,
        minSize: MEDIA_NODE_MIN_SIZE,
        showInCreateMenu: true,
        // 只看不产出：消费两张上游图片，自身不作为素材。
        inputKind: "image",
    },
    [CanvasNodeType.Chart]: {
        label: "图表",
        icon: <ChartColumn />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        inputKind: "text",
    },
    [CanvasNodeType.ColorGrade]: {
        label: "调色",
        icon: <Palette />,
        minSize: MEDIA_NODE_MIN_SIZE,
        showInCreateMenu: true,
        // 无条件返回 image：它的图来自上游而不是自身 metadata，用「有没有 content」判断
        // 会让它永远不被当成素材、从而进不了生成输入。没有上游时由
        // readReferenceImage 返回 null 跳过，不需要在这里提前判空。
        resourceKind: () => "image",
        inputKind: "image",
    },
} satisfies Record<string, Omit<CanvasNodeDefinition, "type" | "defaultTitle" | "defaultSize" | "defaultMetadata">>;

export const BUILTIN_NODE_DEFINITIONS: CanvasNodeDefinition[] = (Object.keys(BUILTIN_NODE_TRAITS) as CanvasNodeType[]).map((type) => {
    const spec = NODE_SPECS[type];
    return {
        type,
        ...BUILTIN_NODE_TRAITS[type],
        defaultTitle: spec.title,
        defaultSize: { width: spec.width, height: spec.height },
        defaultMetadata: spec.metadata,
    };
});

registerNodeDefinitions(BUILTIN_NODE_DEFINITIONS);
