import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Checkbox, InputNumber } from "antd";

import { DEFAULT_SELECTED_CHAPTERS, toggleChapterRange } from "@/lib/drama/chapter-selection";

import { formatCount } from "./drama-shared";

export type ChapterPickItem = {
    key: string;
    title: string;
    words: number;
    /** 字数异常（过长或过短）时数字标黄。 */
    warn?: boolean;
    /** 不可选（例如已在制作中），note 说明原因。 */
    disabled?: boolean;
    note?: string;
};

const ROW_HEIGHT = 34;

/**
 * 章节勾选目录：勾选决定哪些章节先加入制作，点击标题只切换右侧原文预览。按住 Shift 勾选可连选；
 * “前 N 章”从第一个可选章节起连续选 N 章。长篇目录按可视区域渲染，几千章也能滚到底。
 */
export function ChapterPickList({
    items,
    selected,
    onChange,
    previewIndex,
    onPreview,
    quickLabel = "前",
    className = "",
}: {
    items: ChapterPickItem[];
    selected: ReadonlySet<number>;
    onChange: (next: Set<number>) => void;
    previewIndex?: number;
    onPreview?: (index: number) => void;
    quickLabel?: string;
    className?: string;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<number | null>(null);
    const [quickCount, setQuickCount] = useState(DEFAULT_SELECTED_CHAPTERS);
    const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => listRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });
    const selectable = items.flatMap((item, index) => (item.disabled ? [] : [index]));
    const pickedWords = items.reduce((sum, item, index) => (selected.has(index) ? sum + item.words : sum), 0);
    const toggle = (index: number, checked: boolean, range: boolean) => {
        const anchor = anchorRef.current;
        anchorRef.current = index;
        if (range && anchor !== null && anchor !== index) {
            const next = toggleChapterRange(selected, anchor, index, checked);
            for (let position = Math.min(anchor, index); position <= Math.max(anchor, index); position++) if (items[position]?.disabled) next.delete(position);
            onChange(next);
            return;
        }
        const next = new Set(selected);
        if (checked) next.add(index);
        else next.delete(index);
        onChange(next);
    };
    return (
        <div className={`drama-chapter-pick ${className}`}>
            <div className="drama-chapter-pick-bar">
                <span className="drama-chapter-pick-count" aria-live="polite">
                    已选 <b>{formatCount(selected.size)}</b> / {formatCount(selectable.length)} 章 · {formatCount(pickedWords)} 字
                </span>
                <span className="drama-chapter-pick-quick">
                    {quickLabel}
                    <InputNumber size="small" min={1} max={Math.max(1, selectable.length)} precision={0} value={quickCount} onChange={(value) => setQuickCount(value || 1)} aria-label={`${quickLabel}几章`} />章
                    <Button size="small" disabled={!selectable.length} onClick={() => onChange(new Set(selectable.slice(0, quickCount)))}>
                        选取
                    </Button>
                </span>
                <span className="drama-chapter-pick-actions">
                    <Button size="small" type="text" disabled={selected.size === selectable.length} onClick={() => onChange(new Set(selectable))}>
                        全选
                    </Button>
                    <Button size="small" type="text" disabled={!selected.size} onClick={() => onChange(new Set())}>
                        清空
                    </Button>
                </span>
            </div>
            <div ref={listRef} className="drama-chapter-list thin-scrollbar" aria-label="章节">
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => {
                        const item = items[row.index];
                        const index = row.index;
                        return (
                            <div key={item.key} className={`drama-chapter-pick-row ${selected.has(index) ? "is-picked" : ""}`} style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
                                <Checkbox
                                    checked={selected.has(index)}
                                    disabled={item.disabled}
                                    aria-label={`选择 ${item.title}`}
                                    onChange={(event) => toggle(index, event.target.checked, Boolean((event.nativeEvent as MouseEvent | undefined)?.shiftKey))}
                                />
                                <button type="button" className={`drama-chapter-row ${item.warn ? "is-warn" : ""}`} aria-current={previewIndex === index ? "true" : undefined} onClick={() => onPreview?.(index)}>
                                    <span className="is-num">{String(index + 1).padStart(3, "0")}</span>
                                    <span className="truncate text-left" title={item.title}>
                                        {item.title}
                                    </span>
                                    <span className="is-count">{item.note || formatCount(item.words)}</span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
