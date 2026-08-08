import type { SubtitleHighlight, SubtitleStyle } from "@/types/timeline";

type SubtitleHighlightedTextProps = {
    text: string;
    highlight?: SubtitleHighlight;
    style: SubtitleStyle;
};

/**
 * 字幕文本的统一样式渲染：未启用高亮或没有高亮数据时原样输出，否则给重点词上底色。
 * 字幕弹窗与画布视频节点叠加层共用，保证两处高亮效果一致。
 */
export function SubtitleHighlightedText({ text, highlight, style }: SubtitleHighlightedTextProps) {
    if (!style.highlightEnabled || !highlight) return text;
    return (
        <>
            {text.slice(0, highlight.start)}
            <span
                style={{
                    background: style.highlightBackgroundColor,
                    color: style.highlightTextColor,
                    borderRadius: style.highlightRadius,
                    padding: `${style.highlightPaddingY}px ${style.highlightPaddingX}px`,
                }}
            >
                {text.slice(highlight.start, highlight.end)}
            </span>
            {text.slice(highlight.end)}
        </>
    );
}
