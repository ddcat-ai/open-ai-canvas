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
    /** 改节点宽高；图片首次量到真实尺寸后按比例校正节点用。 */
    resizeNode?: (nodeId: string, size: { width: number; height: number }) => void;
    /** 打开节点级肖像排查工作台；任务生命周期由画布页面持有。 */
    openPortraitClearance?: (node: CanvasNodeData) => void;
};

export const CanvasNodeActionContext = createContext<CanvasNodeActionContextValue>({});

export function useCanvasNodeActions() {
    return useContext(CanvasNodeActionContext);
}
