// 长篇导入时“先做几章”：选中的章节进入资产提取、分集与改编，其余章节保存为预留章节，之后在制作台加入。
// 新建页与制作台的选章弹窗共用这里的选择与分组规则，分组与服务端 groupDramaChapterEpisodes 一致。

/** 章节多于这个数时默认只选前几章，避免整本长篇一次跑完文本费用。 */
export const DEFAULT_SELECTED_CHAPTERS = 10;

/** 默认选择：章节不多时全选，否则选前 DEFAULT_SELECTED_CHAPTERS 章。 */
export function defaultChapterSelection(total: number) {
    return firstChapters(total, total > DEFAULT_SELECTED_CHAPTERS ? DEFAULT_SELECTED_CHAPTERS : total);
}

/** 从第 start 章（下标）起连续选 count 章。 */
export function firstChapters(total: number, count: number, start = 0) {
    const selection = new Set<number>();
    for (let index = Math.max(0, start); index < Math.min(total, start + Math.max(0, count)); index++) selection.add(index);
    return selection;
}

/** 勾选或取消 from 到 to（含两端，顺序不限）的连续章节，用于按住 Shift 连选。 */
export function toggleChapterRange(selection: ReadonlySet<number>, from: number, to: number, checked: boolean) {
    const next = new Set(selection);
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
        if (checked) next.add(index);
        else next.delete(index);
    }
    return next;
}

export type ChapterGroupInput = { position: number; chars: number };
export type ChapterGroup = { label: string; chars: number; count: number };

/**
 * 按章节顺序每 size 章合成一集；位置不相邻的章节（中间有没选的章）不合进同一集。
 * position 从 0 起，标签按“第 N 章”显示。
 */
export function groupChapterEpisodes(chapters: ChapterGroupInput[], size: number): ChapterGroup[] {
    const perEpisode = Math.max(1, Math.floor(size) || 1);
    const sorted = [...chapters].sort((left, right) => left.position - right.position);
    const groups: ChapterGroup[] = [];
    for (let start = 0; start < sorted.length;) {
        let end = start + 1;
        while (end < sorted.length && end - start < perEpisode && sorted[end].position === sorted[end - 1].position + 1) end++;
        const group = sorted.slice(start, end);
        const first = group[0].position + 1;
        const last = group[group.length - 1].position + 1;
        groups.push({ label: group.length > 1 ? `第 ${first}–${last} 章` : `第 ${first} 章`, chars: group.reduce((sum, chapter) => sum + chapter.chars, 0), count: group.length });
        start = end;
    }
    return groups;
}
