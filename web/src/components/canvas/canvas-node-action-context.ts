import { createContext, useContext } from "react";

import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

// 批次子图操作条（下载/创建副本/删除）与主图位下载需要调用画布级动作，
// 但画布节点经 CanvasProjectWorldLayers 渲染、不便逐个透传 handler，
// 通过 Context 注入，避免改动 world-layers。无 Provider 时静默降级为 no-op。
export type CanvasNodeActionContextValue = {
    download?: (node: CanvasNodeData) => void;
    duplicate?: (node: CanvasNodeData) => void;
    deleteNode?: (node: CanvasNodeData) => void;
    /** 合并式更新节点 metadata；扩展节点（如调色）在自己的面板里改参数时用。 */
    updateMetadata?: (nodeId: string, patch: CanvasNodeMetadata) => void;
    /** 更新单个节点；媒体尺寸回写使用它，避免触发全量节点时间戳归并。 */
    updateNode?: (nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => void;
    /** 合并延迟提交媒体测量结果，避免首屏图片同时解码时反复刷新画布。 */
    updateMediaNode?: (nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => void;
    /** 改节点宽高；图片首次量到真实尺寸后按比例校正节点用。 */
    resizeNode?: (nodeId: string, size: { width: number; height: number }) => void;
    /** 打开节点级肖像排查工作台；任务生命周期由画布页面持有。 */
    openPortraitClearance?: (node: CanvasNodeData) => void;
    /** 打开节点级 AI 审美批改报告。 */
    openArtCritique?: (node: CanvasNodeData) => void;
};

export const CanvasNodeActionContext = createContext<CanvasNodeActionContextValue>({});

export function useCanvasNodeActions() {
    return useContext(CanvasNodeActionContext);
}
