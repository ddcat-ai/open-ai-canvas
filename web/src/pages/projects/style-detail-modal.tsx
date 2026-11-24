import { useEffect } from "react";
import { App, Button } from "antd";
import { Check, ChevronLeft, ChevronRight, Copy, Flame, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { DRAMA_STYLE_CATEGORIES, DRAMA_STYLE_FORMS, findDramaStyle, parseDramaStyleId, styleCoverBackground } from "@/lib/drama/drama-styles";

const DETAIL_ROWS = [
    { key: "medium", label: "画面媒介" },
    { key: "world", label: "题材场景" },
    { key: "look", label: "色彩光影" },
    { key: "wardrobe", label: "服化道" },
    { key: "forbid", label: "避免出现" },
] as const;

/** 风格详情：大图 + 分项美术基线 + 完整提示词；左右键在当前筛选结果里切换。 */
export function DramaStyleDetailModal({
    styleId,
    selectedId,
    navigationIds,
    onNavigate,
    onUse,
    onClose,
    disabled = false,
}: {
    styleId: string | null;
    selectedId: string;
    navigationIds: string[];
    onNavigate: (id: string) => void;
    onUse: (id: string) => void;
    onClose: () => void;
    disabled?: boolean;
}) {
    const { message } = App.useApp();
    const style = styleId ? findDramaStyle(styleId) : undefined;
    const index = styleId ? navigationIds.indexOf(styleId) : -1;
    const prevId = index > 0 ? navigationIds[index - 1] : undefined;
    const nextId = index >= 0 && index < navigationIds.length - 1 ? navigationIds[index + 1] : undefined;

    useEffect(() => {
        if (!style) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
            if (event.key === "ArrowLeft" && prevId) onNavigate(prevId);
            if (event.key === "ArrowRight" && nextId) onNavigate(nextId);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [style, prevId, nextId, onNavigate]);

    const copyPrompt = async () => {
        if (!style) return;
        try {
            await navigator.clipboard.writeText(style.prompt);
            message.success("已复制风格提示词");
        } catch {
            message.error("复制失败，请手动选择文本复制");
        }
    };

    const active = style?.id === selectedId;
    const composition = style ? parseDramaStyleId(style.id) : undefined;
    const categoryLabel = composition ? `${DRAMA_STYLE_FORMS.find((form) => form.id === composition.formId)?.name} · 自由组合` : style ? DRAMA_STYLE_CATEGORIES.find((item) => item.key === style.category)?.label : "";

    return (
        <AppModal open={Boolean(style)} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(880px, calc(100vw - 48px))" rootClassName="drama-root" aria-label="风格详情">
            {style ? (
                <div className="drama-style-detail">
                    <div className="drama-style-detail-cover" style={{ background: styleCoverBackground(style) }}>
                        {!style.cover ? (
                            <span className="drama-style-detail-glyph" aria-hidden>
                                {style.name.replace(/^3D\s*/, "").slice(0, 2)}
                            </span>
                        ) : null}
                        <div className="drama-style-detail-palette" aria-label="主色">
                            {style.palette.map((color) => (
                                <span key={color} style={{ background: color }} title={color} />
                            ))}
                        </div>
                    </div>
                    <div className="drama-style-detail-body">
                        <header className="drama-style-detail-head">
                            <div className="min-w-0">
                                <div className="drama-style-detail-meta">
                                    <span>{categoryLabel}</span>
                                    {style.hot ? (
                                        <span className="is-hot">
                                            <Flame className="size-3" />
                                            爆款
                                        </span>
                                    ) : null}
                                    {index >= 0 ? (
                                        <span className="drama-style-detail-index">
                                            {index + 1} / {navigationIds.length}
                                        </span>
                                    ) : null}
                                </div>
                                <h3>{style.name}</h3>
                                <p>{style.description}</p>
                            </div>
                            <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                        </header>
                        <div className="drama-style-detail-tags">
                            {style.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                            ))}
                        </div>
                        <dl className="drama-style-detail-rows thin-scrollbar">
                            {DETAIL_ROWS.map((row) => (
                                <div key={row.key}>
                                    <dt>{row.label}</dt>
                                    <dd>{style.detail[row.key]}</dd>
                                </div>
                            ))}
                            <div>
                                <dt>
                                    完整提示词
                                    <button type="button" className="drama-style-detail-copy" onClick={() => void copyPrompt()}>
                                        <Copy className="size-3" />
                                        复制
                                    </button>
                                </dt>
                                <dd className="is-prompt">{style.prompt}</dd>
                            </div>
                        </dl>
                        <p className="drama-style-detail-note">风格只锁定全剧的画风、色调与服化道，具体构图和动作由分镜决定。{style.cover ? "" : "该风格暂无样图，左侧为主色示意。"}</p>
                        <footer className="drama-style-detail-foot">
                            <Button icon={<ChevronLeft className="size-4" />} disabled={!prevId} onClick={() => prevId && onNavigate(prevId)} aria-label="上一个风格" />
                            <Button icon={<ChevronRight className="size-4" />} disabled={!nextId} onClick={() => nextId && onNavigate(nextId)} aria-label="下一个风格" />
                            <span className="flex-1" />
                            <Button onClick={onClose}>关闭</Button>
                            <Button type="primary" icon={active ? <Check className="size-4" /> : undefined} disabled={active || disabled} title={disabled ? "正在保存，请稍候再调整风格" : undefined} onClick={() => onUse(style.id)}>
                                {active ? "当前已选" : "使用此风格"}
                            </Button>
                        </footer>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}
