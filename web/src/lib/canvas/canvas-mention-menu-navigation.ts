// @ 引用菜单的方向键导航。菜单按分组显示，网格分组一行多张卡片，列表分组一行一项。

export type MentionMenuNavigationSection = { count: number; columns: number };

export type MentionMenuDirection = "up" | "down" | "left" | "right";

/**
 * 返回按方向键后的高亮序号（按显示顺序平铺的全局序号），没有候选时返回 -1。
 * 上下键按可见行移动并尽量保持列位置；只有一行时退化为逐项移动，否则按键会原地不动。
 * 左右键按显示顺序逐项移动。两端循环；尚未高亮时下/右从第一项开始，上/左从最后一项开始。
 */
export function moveMentionMenuIndex(sections: readonly MentionMenuNavigationSection[], index: number, direction: MentionMenuDirection): number {
    const rows: Array<{ start: number; length: number }> = [];
    let total = 0;
    for (const section of sections) {
        const columns = Math.max(1, Math.floor(section.columns) || 1);
        for (let start = 0; start < section.count; start += columns) rows.push({ start: total + start, length: Math.min(columns, section.count - start) });
        total += section.count;
    }
    if (!total) return -1;
    const forward = direction === "down" || direction === "right";
    if (index < 0 || index >= total) return forward ? 0 : total - 1;
    if (direction === "left" || direction === "right" || rows.length === 1) return (index + (forward ? 1 : -1) + total) % total;
    const rowIndex = rows.findIndex((row) => index < row.start + row.length);
    const column = index - rows[rowIndex].start;
    const target = rows[(rowIndex + (forward ? 1 : -1) + rows.length) % rows.length];
    return target.start + Math.min(column, target.length - 1);
}
