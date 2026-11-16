import { Button, Input } from "antd";
import { Check, ChevronDown, Plus, Shirt, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useCharacterCoverSrc } from "@/components/canvas/canvas-character-reference-node";
import { type CharacterOutfit } from "@/components/canvas/character-outfits";
import { resourceFileUrl } from "@/services/api/resources";

function OutfitThumb({ resourceId, name }: { resourceId: string; name: string }) {
    const src = useCharacterCoverSrc(resourceId ? resourceFileUrl(resourceId) : undefined);
    return src ? (
        <img src={src} alt={name} className="size-10 shrink-0 rounded object-cover bg-black/20" draggable={false} />
    ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded bg-foreground/[.08] text-xs text-foreground/55">
            <Shirt className="size-4" />
        </span>
    );
}

export function CharacterStudioOutfitManager({
    outfits,
    activeOutfitId,
    addingNew,
    busy,
    onSelectOutfit,
    onStartAddNew,
    onCancelAddNew,
    onUpdateOutfitMeta,
    onDeleteOutfit,
}: {
    outfits: CharacterOutfit[];
    activeOutfitId: string;
    addingNew: boolean;
    busy: boolean;
    onSelectOutfit: (outfitId: string) => void;
    onStartAddNew: () => void;
    onCancelAddNew: () => void;
    onUpdateOutfitMeta: (outfitId: string, patch: { name?: string; clothing?: string }) => void;
    onDeleteOutfit: (outfitId: string) => void;
}) {
    const activeOutfit = outfits.find((item) => item.id === activeOutfitId) || outfits[0];
    const [nameDraft, setNameDraft] = useState(activeOutfit?.name || "");
    const [clothingDraft, setClothingDraft] = useState(activeOutfit?.clothing || "");

    useEffect(() => {
        setNameDraft(activeOutfit?.name || "");
        setClothingDraft(activeOutfit?.clothing || "");
    }, [activeOutfit?.id, activeOutfit?.name, activeOutfit?.clothing]);

    const metaDirty = Boolean(activeOutfit && (nameDraft.trim() !== activeOutfit.name.trim() || clothingDraft.trim() !== (activeOutfit.clothing || "").trim()));

    return (
        <div className="mb-5 space-y-3 rounded-lg bg-foreground/[.04] p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
                        <Shirt className="size-3.5 text-foreground/55" />
                        <span>人物造型库（{outfits.length}）</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-foreground/45">{addingNew ? "请从下方点选或上传一张图片，绑定为新造型" : "同一角色可绑定多套服装造型，引用时仅传当前选中造型的唯一图片"}</p>
                </div>
                <Button size="small" type={addingNew ? "default" : "primary"} disabled={busy} icon={addingNew ? <X className="size-3.5" /> : <Plus className="size-3.5" />} onClick={addingNew ? onCancelAddNew : onStartAddNew} className="shrink-0">
                    {addingNew ? "取消新增" : "新增造型"}
                </Button>
            </div>

            {outfits.length ? (
                <div className="flex flex-wrap gap-2">
                    {outfits.map((outfit) => {
                        const selected = !addingNew && outfit.id === activeOutfit?.id;
                        return (
                            <button
                                key={outfit.id}
                                type="button"
                                disabled={busy}
                                onClick={() => onSelectOutfit(outfit.id)}
                                className={`group flex items-center gap-2.5 rounded-lg border p-1.5 pr-3 text-left outline-none transition ${
                                    selected ? "border-foreground/45 bg-foreground/[.08] text-foreground ring-1 ring-foreground/25" : "border-border/60 bg-background/40 text-foreground/75 hover:border-foreground/25 hover:bg-foreground/[.05]"
                                }`}
                            >
                                <OutfitThumb resourceId={outfit.resourceId} name={outfit.name} />
                                <div className="min-w-0 max-w-[140px]">
                                    <div className="flex items-center gap-1.5 truncate text-xs font-medium">
                                        <span className="truncate">{outfit.name}</span>
                                        {selected ? (
                                            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[var(--workspace-accent)] text-background">
                                                <Check className="size-2.5" />
                                            </span>
                                        ) : null}
                                    </div>
                                    {outfit.clothing ? <div className="truncate text-[11px] text-foreground/45">{outfit.clothing}</div> : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {activeOutfit && !addingNew ? (
                <div className="grid items-center gap-2 border-t border-border/60 pt-3 sm:grid-cols-[148px_minmax(0,1fr)_auto]">
                    <Input variant="filled" value={nameDraft} maxLength={32} placeholder="造型名称" onChange={(event) => setNameDraft(event.target.value)} />
                    <Input variant="filled" value={clothingDraft} maxLength={300} placeholder="服装造型说明（选填，引用时替换默认服装）" onChange={(event) => setClothingDraft(event.target.value)} />
                    <div className="flex items-center gap-1.5">
                        {metaDirty ? (
                            <Button
                                size="small"
                                type="primary"
                                loading={busy}
                                onClick={() =>
                                    onUpdateOutfitMeta(activeOutfit.id, {
                                        name: nameDraft.trim() || activeOutfit.name,
                                        clothing: clothingDraft.trim(),
                                    })
                                }
                            >
                                保存
                            </Button>
                        ) : null}
                        {outfits.length > 1 ? (
                            <Button size="small" danger type="text" disabled={busy} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteOutfit(activeOutfit.id)}>
                                删除
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function CanvasNodeOutfitSelector({ outfits, activeOutfitId, onSelect }: { outfits: CharacterOutfit[]; activeOutfitId?: string; onSelect?: (outfit: CharacterOutfit) => void }) {
    if (outfits.length <= 1) return null;
    const current = (activeOutfitId ? outfits.find((item) => item.id === activeOutfitId) : undefined) || outfits[0];
    return (
        <div className="absolute left-3.5 top-8 z-10" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full border border-white/25 bg-black/65 px-2.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur hover:border-white/45 hover:bg-black/80">
                <Shirt className="size-3 text-white/75" />
                <span className="max-w-[88px] truncate">{current?.name || "默认造型"}</span>
                <ChevronDown className="size-3 text-white/65" />
                <select
                    aria-label="切换角色造型"
                    value={current?.id || ""}
                    onChange={(event) => {
                        const next = outfits.find((item) => item.id === event.target.value);
                        if (next) onSelect?.(next);
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                >
                    {outfits.map((item) => (
                        <option key={item.id} value={item.id} className="bg-[#18181b] text-white">
                            {item.name}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
}
