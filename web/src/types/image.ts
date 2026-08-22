import type { CanvasColorGrade } from "@/lib/canvas/canvas-color-grade";

export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    // 参考图的来源：需要在真正生成时才落地成资源的那几类。
    // 判别字段是 kind——新增一类时，canvas-node-generation 里的分派也要跟着加分支，
    // 漏了会静默按普通图片处理（dataUrl 为空 → 参考图丢失）。
    source?:
        | {
            kind: "drawing";
            drawingId: string;
            revision: number;
            shapeCount: number;
        }
        | {
            kind: "colorgrade";
            /** 上游源图地址 */
            url: string;
            grade: CanvasColorGrade;
        };
};
