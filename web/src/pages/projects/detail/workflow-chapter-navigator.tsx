import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input, Modal } from "antd";
import { BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useNavigate } from "react-router";

import type { ProjectUnit } from "@/services/api/projects";

type Props = {
    projectId: string;
    units: ProjectUnit[];
    unitId?: string;
    stage?: string;
};

export function WorkflowChapterNavigator({ projectId, units, unitId, stage }: Props) {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));
    const listRef = useRef<HTMLDivElement>(null);
    const orderedUnits = useMemo(() => units.slice().sort((left, right) => left.position - right.position), [units]);
    const currentIndex = Math.max(0, orderedUnits.findIndex((unit) => unit.id === unitId));
    const current = orderedUnits[currentIndex];
    const visibleUnits = useMemo(() => {
        if (!deferredQuery) return orderedUnits;
        const numericQuery = /^\d+$/.test(deferredQuery) ? deferredQuery.replace(/^0+/, "") || "0" : "";
        return orderedUnits.filter((unit, index) => (numericQuery && String(index + 1).startsWith(numericQuery)) || unit.title.toLocaleLowerCase("zh-CN").includes(deferredQuery));
    }, [deferredQuery, orderedUnits]);
    const virtualizer = useVirtualizer({
        count: visibleUnits.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => 48,
        getItemKey: (index) => visibleUnits[index]?.id || index,
        overscan: 10,
    });

    useEffect(() => {
        if (!open || deferredQuery) return;
        const frame = window.requestAnimationFrame(() => virtualizer.scrollToIndex(currentIndex, { align: "center" }));
        return () => window.cancelAnimationFrame(frame);
    }, [currentIndex, deferredQuery, open, virtualizer]);

    const goTo = (target?: ProjectUnit) => {
        if (!target) return;
        setOpen(false);
        navigate(`/projects/${projectId}/workflow/${target.id}/${stage || "video"}`);
    };

    if (!current) return null;
    return (
        <>
            <div className="workflow-chapter-navigator">
                <button type="button" disabled={currentIndex === 0} onClick={() => goTo(orderedUnits[currentIndex - 1])} aria-label="上一章" title="上一章"><ChevronLeft /></button>
                <button type="button" className="workflow-chapter-current" onClick={() => { setQuery(""); setOpen(true); }} aria-haspopup="dialog" aria-label={`定位章节，当前第 ${currentIndex + 1} 章`}>
                    <span>第 {currentIndex + 1} 章</span><strong>{current.title}</strong><em>{currentIndex + 1}/{orderedUnits.length}</em><ChevronDown />
                </button>
                <button type="button" disabled={currentIndex >= orderedUnits.length - 1} onClick={() => goTo(orderedUnits[currentIndex + 1])} aria-label="下一章" title="下一章"><ChevronRight /></button>
            </div>
            <Modal open={open} footer={null} title={null} width={560} destroyOnHidden className="workspace-modal workflow-chapter-modal" onCancel={() => setOpen(false)} styles={{ body: { padding: 0 } }}>
                <div className="workflow-chapter-modal-head"><span><BookOpenText /><strong>定位章节</strong><em>共 {orderedUnits.length.toLocaleString("zh-CN")} 章</em></span><Input autoFocus allowClear prefix={<Search className="size-3.5" />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入章节序号或标题" /></div>
                <div ref={listRef} className="workflow-chapter-list thin-scrollbar">
                    {visibleUnits.length ? <div className="relative" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualItem) => {
                        const unit = visibleUnits[virtualItem.index];
                        const index = orderedUnits.findIndex((item) => item.id === unit.id);
                        const selected = unit.id === current.id;
                        return <button key={unit.id} type="button" className={selected ? "is-active" : ""} style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }} onClick={() => goTo(unit)}><span>{String(index + 1).padStart(Math.max(2, String(orderedUnits.length).length), "0")}</span><strong>{unit.title}</strong><em>{(unit.wordCount || 0).toLocaleString("zh-CN")} 字</em>{selected ? <small>当前</small> : null}</button>;
                    })}</div> : <div className="workflow-chapter-empty">没有匹配的章节</div>}
                </div>
            </Modal>
        </>
    );
}
