// Use measured menu dimensions: available commands and text wrapping change its height.
export function canvasMenuPosition({ x, y, width, height, viewportWidth, viewportHeight }: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
}) {
    const inset = 12;
    return {
        left: Math.min(Math.max(x, inset), Math.max(inset, viewportWidth - width - inset)),
        top: Math.min(Math.max(y, inset), Math.max(inset, viewportHeight - height - inset)),
    };
}
