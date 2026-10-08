import { Button } from "antd";
import { Copy, ExternalLink, Heart, Pencil, Trash2, Wand2 } from "lucide-react";

import { Tooltip } from "@/components/ui/base/tooltip";
import { AppModal } from "@/components/ui/product/app-modal";
import { catalogIdOf, inspirationSourceOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { isCustomInspiration } from "@/lib/inspirations/resolve";
import { modeLabels } from "@/pages/create/creation-types";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-baseline gap-3 text-xs leading-5">
            <span className="w-12 shrink-0 text-foreground/45">{label}</span>
            <span className="min-w-0 flex-1 text-foreground/78">{children}</span>
        </div>
    );
}

export function InspirationDetailModal({
    item,
    categoryLabel,
    favorite,
    onClose,
    onUse,
    onEdit,
    onDelete,
    onToggleFavorite,
    onCopy,
}: {
    item: CreationInspiration | null;
    categoryLabel: (item: CreationInspiration) => string;
    favorite: boolean;
    onClose: () => void;
    onUse: (item: CreationInspiration) => void;
    onEdit: (item: CreationInspiration) => void;
    onDelete: (item: CreationInspiration) => void;
    onToggleFavorite: (item: CreationInspiration) => void;
    onCopy: (text: string, label: string) => void;
}) {
    const source = item ? inspirationSourceOf(item) : null;
    const custom = item ? isCustomInspiration(catalogIdOf(item)) : false;

    return (
        <AppModal open={Boolean(item)} onCancel={onClose} width={880} title={null} footer={null}>
            {item ? (
                <div className="flex max-h-[76vh] flex-col">
                    <div className="relative shrink-0 overflow-hidden" style={{ borderRadius: "var(--r-xl, 14px)" }}>
                        <img src={item.image} alt="" className="h-56 w-full object-cover sm:h-64" referrerPolicy="no-referrer" />
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                                {item.description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{item.description}</p> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                    <button type="button" className="inspiration-icon-button" aria-pressed={favorite} onClick={() => onToggleFavorite(item)}>
                                        <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
                                    </button>
                                </Tooltip>
                                <Tooltip title="编辑">
                                    <button type="button" className="inspiration-icon-button" onClick={() => onEdit(item)}>
                                        <Pencil className="size-4" />
                                    </button>
                                </Tooltip>
                                <Tooltip title={custom ? "删除" : "从库中隐藏"}>
                                    <button type="button" className="inspiration-icon-button" onClick={() => onDelete(item)}>
                                        <Trash2 className="size-4" />
                                    </button>
                                </Tooltip>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <MetaRow label="来源">
                                {source?.name ?? "原创"}
                                {item.credit ? ` · ${item.credit}` : ""}
                            </MetaRow>
                            <MetaRow label="分类">{categoryLabel(item)}</MetaRow>
                            <MetaRow label="类型">
                                {modeLabels[item.mode]}
                                {item.ratio ? ` · ${item.ratio}` : ""}
                            </MetaRow>
                            {item.tags?.length ? (
                                <MetaRow label="标签">
                                    <span className="flex flex-wrap gap-1.5">
                                        {item.tags.map((tag) => (
                                            <span key={tag} className="inspiration-chip">
                                                {tag}
                                            </span>
                                        ))}
                                    </span>
                                </MetaRow>
                            ) : null}
                            {item.sourceUrl ? (
                                <MetaRow label="原页">
                                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                        查看上游内容 <ExternalLink className="size-3" />
                                    </a>
                                </MetaRow>
                            ) : null}
                        </div>

                        <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                        {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/8 px-5 py-3">
                        <Button onClick={onClose}>关闭</Button>
                        <Button type="primary" icon={<Wand2 className="size-4" />} onClick={() => onUse(item)}>
                            用这个创意创作
                        </Button>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

function PromptSection({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground/58">{label}</h3>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text, label)}>
                    复制
                </Button>
            </div>
            <div className="inspiration-prompt-block">{text}</div>
        </section>
    );
}
