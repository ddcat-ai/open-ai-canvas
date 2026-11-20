export function commerceCopyLayout(copy: string, width: number, height: number, measure: (text: string, size: number, heading: boolean) => number) {
    const paragraphs = copy
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const minSize = Math.max(12, Math.floor(width * 0.016));
    for (let size = Math.max(minSize, Math.round(width * 0.03)); size >= minSize; size--) {
        const lines: Array<{ text: string; heading: boolean; size: number; height: number }> = [];
        paragraphs.forEach((paragraph, index) => {
            const heading = index === 0;
            const fontSize = heading ? size * 1.15 : size;
            let text = "";
            for (const character of paragraph) {
                if (text && measure(text + character, fontSize, heading) > width * 0.88) {
                    lines.push({ text, heading, size: fontSize, height: fontSize * 1.45 });
                    text = "";
                }
                text += character;
            }
            if (text) lines.push({ text, heading, size: fontSize, height: fontSize * 1.45 });
        });
        const padding = size * 0.9;
        const barHeight = lines.length ? lines.reduce((sum, line) => sum + line.height, 0) + padding * 2 : 0;
        if (barHeight <= height * 0.42) return { lines, padding, barHeight };
    }
    throw new Error("文案超出当前画幅的可读排版空间，请缩短文案或选择更高的画幅；内容未被截断");
}
