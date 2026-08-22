import { useRef, useState } from "react";
import { Columns2 } from "lucide-react";

import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

type CompareNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * A/B 对比节点：吃两个图片上游，中间一根滑杆左右拖动对比。
 *
 * 分割位置只存组件内 state，不落 metadata——它是「看的时候临时挪一下」，
 * 不是画布内容；CanvasNodeContentProps 也只给了 onContentChange(content)，
 * 为它另开一条写元数据的通道不值得。
 */
export function CompareNodeContent({ node, theme }: CompareNodeContentProps) {
    const upstream = useUpstreamNodes(node.id);
    const images = upstream.filter((item) => getNodeResourceKind(item) === "image");
    const [split, setSplit] = useState(50);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const draggingRef = useRef(false);

    const before = images[0]?.metadata?.content || "";
    const after = images[1]?.metadata?.content || "";

    if (!before || !after) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <Columns2 className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>{images.length === 1 ? "再连一张图片即可对比" : "连接两张图片进行对比"}</span>
            </div>
        );
    }

    const moveTo = (clientX: number) => {
        const rect = hostRef.current?.getBoundingClientRect();
        if (!rect?.width) return;
        setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    };

    return (
        <div
            ref={hostRef}
            className="relative h-full w-full select-none overflow-hidden"
            data-canvas-no-zoom
            style={{ background: theme.node.fill, cursor: "ew-resize" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
                draggingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                moveTo(event.clientX);
            }}
            onPointerMove={(event) => { if (draggingRef.current) moveTo(event.clientX); }}
            onPointerUp={(event) => {
                draggingRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
        >
            <img src={after} alt="B" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            {/* 上层按分割位置裁切，露出下层的 B */}
            <img src={before} alt="A" className="absolute inset-0 h-full w-full object-contain" draggable={false} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ left: `${split}%` }} />
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-white" style={{ fontSize: "var(--fs-tiny)" }}>A</span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-white" style={{ fontSize: "var(--fs-tiny)" }}>B</span>
        </div>
    );
}
