import type { CSSProperties } from "react";

import type { SubtitleHighlight, SubtitleStyle } from "@/types/timeline";
import { SubtitleHighlightedText } from "./canvas-subtitle-text";

type CanvasSubtitleOverlayProps = {
    text: string;
    highlight?: SubtitleHighlight;
    style: SubtitleStyle;
};

const POSITION_STYLE: Record<SubtitleStyle["position"], CSSProperties> = {
    top: { top: "6%" },
    center: { top: "50%", transform: "translateY(-50%)" },
    bottom: { bottom: "8%" },
};

/**
 * 画布视频节点上的实时字幕叠加层：按字幕样式定位到视频画面内。
 * 纯展示层（pointer-events-none），不拦截画布拖拽与播放器控件。
 */
export function CanvasSubtitleOverlay({ text, highlight, style }: CanvasSubtitleOverlayProps) {
    return (
        <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center" style={{ ...POSITION_STYLE[style.position], paddingLeft: "4%", paddingRight: "4%" }}>
            <span
                className="max-w-full whitespace-pre-wrap text-center"
                style={{
                    fontSize: style.fontSize,
                    lineHeight: 1.4,
                    color: style.color,
                    textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)",
                }}
            >
                <SubtitleHighlightedText text={text} highlight={highlight} style={style} />
            </span>
        </div>
    );
}
