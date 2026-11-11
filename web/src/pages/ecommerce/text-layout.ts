import type { EcommerceTextLayout } from "@/services/api/ecommerce";

export const commerceTextFont = '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export function commerceTextFontFor(family?: EcommerceTextLayout["fontFamily"]) {
    return family === "serif" ? '"Songti SC", SimSun, "Noto Serif CJK SC", serif' : family === "rounded" ? '"Yuanti SC", "YouYuan", "Microsoft YaHei", sans-serif' : commerceTextFont;
}
export type CommerceTextLine = { text: string; x: number; y: number; size: number; bold: boolean };

export function sameCommerceTextLayout(a?: EcommerceTextLayout, b?: EcommerceTextLayout): boolean {
    if (!a || !b) return a === b;
    return (["x", "y", "width", "fontSize", "color", "background", "align"] as const).every((key) => a[key] === b[key]) && (a.fontFamily || "sans") === (b.fontFamily || "sans");
}

/** Shared geometry for the SVG preview and the full-resolution PNG export. Never truncate copy. */
export function layoutCommerceText(copy: string, layout: EcommerceTextLayout, width: number, height: number, measure: (text: string, size: number, bold: boolean) => number) {
    const x = (layout.x * width) / 100,
        y = (layout.y * height) / 100,
        boxWidth = (layout.width * width) / 100;
    const size = (layout.fontSize * width) / 100;
    const padding = size * 0.6;
    const lines: CommerceTextLine[] = [];
    let cursor = y + padding;
    const paragraphs = copy.replace(/\r\n?/g, "\n").split("\n");
    for (const [index, paragraph] of paragraphs.entries()) {
        const bold = index === 0,
            fontSize = bold ? size * 1.25 : size;
        let text = "";
        const emit = () => {
            cursor += fontSize;
            lines.push({ text, x: layout.align === "center" ? x + boxWidth / 2 : layout.align === "right" ? x + boxWidth - padding : x + padding, y: cursor, size: fontSize, bold });
            cursor += fontSize * 0.4;
            text = "";
        };
        for (const char of paragraph) {
            if (measure(char, fontSize, bold) > boxWidth - padding * 2) throw new Error("文字栏过窄，请加宽文字栏或减小字号");
            if (text && measure(text + char, fontSize, bold) > boxWidth - padding * 2) emit();
            text += char;
        }
        emit();
    }
    const boxHeight = cursor - y + padding;
    if (y + boxHeight > height * 0.98) throw new Error("文案超出画幅，请上移、调小字号或拆页；文字不会被截断");
    return { x, y, width: boxWidth, height: boxHeight, lines };
}

export function measureCommerceText(context: CanvasRenderingContext2D, family?: EcommerceTextLayout["fontFamily"]) {
    return (text: string, size: number, bold: boolean) => {
        context.font = `${bold ? 700 : 400} ${size}px ${commerceTextFontFor(family)}`;
        return context.measureText(text).width;
    };
}

export function paintCommerceText(context: CanvasRenderingContext2D, copy: string, layout: EcommerceTextLayout, width: number, height: number) {
    const result = layoutCommerceText(copy, layout, width, height, measureCommerceText(context, layout.fontFamily));
    if (layout.background !== "transparent") {
        context.fillStyle = layout.background;
        context.fillRect(result.x, result.y, result.width, result.height);
    }
    context.fillStyle = layout.color;
    context.textAlign = layout.align;
    context.textBaseline = "alphabetic";
    for (const line of result.lines) {
        context.font = `${line.bold ? 700 : 400} ${line.size}px ${commerceTextFontFor(layout.fontFamily)}`;
        context.fillText(line.text, line.x, line.y);
    }
}
