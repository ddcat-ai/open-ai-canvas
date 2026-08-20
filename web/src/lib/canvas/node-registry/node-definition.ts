import type { ReactNode } from "react";

import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeType } from "@/types/canvas";

/**
 * 节点定义——注册表的基本单元。
 *
 * 一种画布节点类型的静态知识（叫什么、长什么样、能拉多小、是否锁比例）集中在这里，
 * 避免同一份知识散落到创建菜单、搜索弹窗、拉伸逻辑等多处后各自漂移。
 */
export type CanvasNodeDefinition = {
    type: CanvasNodeType;
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
};
