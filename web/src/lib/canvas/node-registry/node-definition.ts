import type { ReactNode } from "react";

import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId } from "@/types/canvas";
import type { PluginCanvasNodeContribution } from "@/lib/plugins/plugin-types";

/** 作为上游输入被容量校验计数时归入的类别 */
export type CanvasNodeInputKind = "image" | "video" | "audio" | "text";

/**
 * 节点定义——注册表的基本单元。
 *
 * 一种画布节点类型的静态知识（叫什么、长什么样、能拉多小、是否锁比例）集中在这里，
 * 避免同一份知识散落到创建菜单、搜索弹窗、拉伸逻辑等多处后各自漂移。
 */
export type CanvasNodeDefinition = {
    type: CanvasNodeTypeId;
    /** UI 短标签——创建菜单等处显示，如「文本」 */
    label: string;
    /** 列表/搜索标签，缺省派生为 `${label}节点` */
    listLabel?: string;
    /** 不带 className——由渲染处用 [&_svg]:size-* 统一控制尺寸 */
    icon: ReactNode;
    /** 新建节点的默认标题（与 label 分开：菜单叫「文本」，新建出来的节点名是「Note」） */
    defaultTitle: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    /** 手动拉伸的最小尺寸 */
    minSize: { width: number; height: number };
    /** 拉伸时是否锁定宽高比，缺省不锁 */
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    /** 是否出现在添加节点菜单（技能、生成配置由其他入口创建） */
    showInCreateMenu: boolean;
    /**
     * 作为 @ 引用素材时归入的类型；不设或返回 null 表示该节点不是可引用素材。
     * 判定依赖内容——空节点不构成素材。
     *
     * 注意：角色卡（workflowKind === "character"）是**跨类型覆盖**，不在这里表达，
     * 由 canvas-resource-references 在查注册表之前先行判定。
     */
    resourceKind?: (node: CanvasNodeData) => CanvasResourceKind | null;
    /** 作为生成节点时的生成模式；不设表示该类型不产生生成行为 */
    generationMode?: (node: CanvasNodeData) => CanvasGenerationMode | null;
    /** 是否显示右侧输出连接点；缺省为 true，消费型终点节点可关闭。 */
    showOutputConnection?: boolean;
    /**
     * 作为上游输入被参考素材容量校验计数时的类别；
     * 不设表示不参与计数（生成配置、背板）。与 resourceKind 不同，计数不看内容。
     */
    inputKind?: CanvasNodeInputKind;
    plugin?: {
        pluginId: string;
        renderer: PluginCanvasNodeContribution["renderer"];
        schema: Record<string, unknown>;
    };
};

export function canvasNodeDefinitionFromPlugin(pluginId: string, contribution: PluginCanvasNodeContribution): CanvasNodeDefinition {
    return {
        type: contribution.id,
        label: contribution.label,
        icon: null,
        defaultTitle: contribution.defaultTitle,
        defaultSize: contribution.defaultSize,
        defaultMetadata: { pluginId, pluginNodeId: contribution.id, pluginData: {}, content: "" },
        minSize: { width: Math.min(contribution.defaultSize.width, 220), height: Math.min(contribution.defaultSize.height, 160) },
        showInCreateMenu: true,
        plugin: { pluginId, renderer: contribution.renderer, schema: contribution.schema },
    };
}
