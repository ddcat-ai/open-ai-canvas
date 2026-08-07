import { useMemo } from "react";

type AudioWaveformProps = {
    waveform: number[];
    /** 波形颜色，默认使用 CSS 变量 */
    color?: string;
    /** 波形高度（像素），默认 48 */
    height?: number;
    /** 波形宽度（像素），默认 200 */
    width?: number;
    /** 是否动画，默认 true */
    animated?: boolean;
};

/**
 * 音频波形可视化组件
 * 使用 SVG 绘制实时波形
 */
export function AudioWaveform({
    waveform,
    color = "var(--cn-accent, #3b82f6)",
    height = 48,
    width = 200,
    animated = true,
}: AudioWaveformProps) {
    // 如果没有波形数据，显示占位波形
    const displayWaveform = useMemo(() => {
        if (waveform.length === 0) {
            // 生成静态占位波形
            return Array.from({ length: 32 }, (_, i) => {
                const x = i / 31;
                return 0.3 + 0.2 * Math.sin(x * Math.PI * 2);
            });
        }
        return waveform;
    }, [waveform]);

    const barWidth = width / displayWaveform.length;
    const gap = Math.max(1, barWidth * 0.2);
    const actualBarWidth = barWidth - gap;

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={animated ? "animate-pulse" : ""}
            style={{ overflow: "visible" }}
        >
            {displayWaveform.map((value, index) => {
                const barHeight = Math.max(2, value * height * 0.8);
                const x = index * barWidth + gap / 2;
                const y = (height - barHeight) / 2;
                return (
                    <rect
                        key={index}
                        x={x}
                        y={y}
                        width={actualBarWidth}
                        height={barHeight}
                        fill={color}
                        rx={actualBarWidth / 2}
                        opacity={0.6 + value * 0.4}
                    />
                );
            })}
        </svg>
    );
}
