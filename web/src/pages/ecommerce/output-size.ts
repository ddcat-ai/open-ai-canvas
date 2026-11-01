export function ecommerceOutputSize(size: string, sourceWidth: number, sourceHeight: number) {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
    if (!match) return { width: sourceWidth, height: sourceHeight };
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 80_000_000) throw new Error("目标导出尺寸超出浏览器可靠范围");
    return { width, height };
}
