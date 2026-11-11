import { useMemo } from "react";
import type { EcommerceTextLayout } from "@/services/api/ecommerce";
import { commerceTextFontFor, layoutCommerceText, measureCommerceText } from "./text-layout";

export function CommerceTextOverlay({ copy, layout, ratio }: { copy: string; layout: EcommerceTextLayout; ratio: number }) {
    const result = useMemo(() => {
        try {
            const context = document.createElement("canvas").getContext("2d");
            if (!context) return { error: "浏览器无法预览文字排版" };
            return { geometry: layoutCommerceText(copy, layout, 1000, 1000 / ratio, measureCommerceText(context, layout.fontFamily)) };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "排版失败" };
        }
    }, [copy, layout, ratio]);
    if (!copy) return null;
    if (!result.geometry)
        return (
            <span className="commerce-text-error" role="alert">
                {result.error}
            </span>
        );
    const { geometry } = result;
    return (
        <svg className="commerce-text-overlay" viewBox={`0 0 1000 ${1000 / ratio}`} aria-label="可编辑文案">
            {layout.background !== "transparent" ? <rect x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} fill={layout.background} /> : null}
            {geometry.lines.map((line, index) => (
                <text
                    key={index}
                    x={line.x}
                    y={line.y}
                    fontSize={line.size}
                    fontFamily={commerceTextFontFor(layout.fontFamily)}
                    fontWeight={line.bold ? 700 : 400}
                    fill={layout.color}
                    textAnchor={layout.align === "center" ? "middle" : layout.align === "right" ? "end" : "start"}
                    xmlSpace="preserve"
                >
                    {line.text}
                </text>
            ))}
        </svg>
    );
}
