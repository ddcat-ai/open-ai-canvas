import { Clapperboard, Image as ImageIcon, Music2, PanelTop, Pencil, Settings2, Sparkles, Type, Video } from "lucide-react";

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
 * `satisfies Record<CanvasNodeType, …>` 是刻意的：往 CanvasNodeType 加成员后若不补定义，
 * 这里会编译失败，而不是在运行期悄悄回落成兜底值。
 */
const BUILTIN_NODE_TRAITS = {
    [CanvasNodeType.Image]: {
        label: "图片",
        icon: <ImageIcon />,
        minSize: MEDIA_NODE_MIN_SIZE,
        keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize,
        showInCreateMenu: true,
    },
    [CanvasNodeType.Text]: {
        label: "文本",
        icon: <Type />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
    },
    [CanvasNodeType.Drawing]: {
        label: "绘图",
        icon: <Pencil />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
    },
    [CanvasNodeType.Script]: {
        label: "分镜脚本",
        icon: <Clapperboard />,
        // 分镜脚本的表格布局需要更宽的下限；高度仍由内容动态撑开（见 canvas-node.tsx）。
        minSize: { width: 800, height: DEFAULT_MIN_SIZE.height },
        showInCreateMenu: true,
    },
    [CanvasNodeType.Skill]: {
        label: "技能",
        icon: <Sparkles />,
        minSize: DEFAULT_MIN_SIZE,
        // 技能节点由技能库插入，不占创建菜单格位。
        showInCreateMenu: false,
    },
    [CanvasNodeType.Config]: {
        label: "生成配置",
        icon: <Settings2 />,
        minSize: DEFAULT_MIN_SIZE,
        // 生成配置由连线时自动创建。
        showInCreateMenu: false,
    },
    [CanvasNodeType.Video]: {
        label: "视频",
        icon: <Video />,
        minSize: MEDIA_NODE_MIN_SIZE,
        keepAspectRatio: () => true,
        showInCreateMenu: true,
    },
    [CanvasNodeType.Audio]: {
        label: "音频",
        icon: <Music2 />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
    },
    [CanvasNodeType.Frame]: {
        label: "背板",
        // 背板在列表里就叫「背板」，不是「背板节点」——显式钉住，避免被 label 派生改写。
        listLabel: "背板",
        icon: <PanelTop />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
    },
} satisfies Record<CanvasNodeType, Omit<CanvasNodeDefinition, "type" | "defaultTitle" | "defaultSize" | "defaultMetadata">>;

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
