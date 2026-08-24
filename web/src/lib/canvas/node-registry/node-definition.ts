import type { ReactNode } from "react";

import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasNodeType } from "@/types/canvas";

/** 作为上游输入被容量校验计数时归入的类别 */
export type CanvasNodeInputKind = "image" | "video" | "audio" | "text";

/**
 * 节点定义——注册表的基本单元。
 *
 * 一种画布节点类型的静态知识（叫什么、长什么样、能拉多小、是否锁比例）集中在这里，
 * 避免同一份知识散落到创建菜单、搜索弹窗、拉伸逻辑等多处后各自漂移。
 */
export type CanvasNodeDefinition = {
    type: CanvasNodeType;
    /** UI 短标签的 i18n key——创建菜单等处显示，如「文本」 */
    labelKey: string;
    /** 列表/搜索标签的 i18n key，缺省由 UI 短标签派生 */
    listLabelKey?: string;
    /** 不带 className——由渲染处用 [&_svg]:size-* 统一控制尺寸 */
    icon: ReactNode;
    /** 新建节点默认标题的 i18n key，创建时再翻译，避免模块加载期锁死语言 */
    defaultTitleKey: string;
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
    /**
     * 作为上游输入被参考素材容量校验计数时的类别；
     * 不设表示不参与计数（生成配置、背板）。与 resourceKind 不同，计数不看内容。
     */
    inputKind?: CanvasNodeInputKind;
};
