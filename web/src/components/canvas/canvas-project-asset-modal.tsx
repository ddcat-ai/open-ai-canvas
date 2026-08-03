import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "antd";
import { Check, FileText, Image as ImageIcon, Music2, UserRound, Video } from "lucide-react";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { compileCharacterReferencePrompt } from "@/lib/canvas/canvas-character-reference";
import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const categoryLabels: Record<string, string> = { all: "全部资产", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };
type ProjectPickerItem = { id: string; category: string; character?: ProjectAsset; media?: Asset };

export function CanvasProjectAssetModal({ open, detail, initialCategory = "all", onClose, onInsert }: { open: boolean; detail?: ProjectDetail; initialCategory?: string; onClose: () => void; onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void }) {
    const mediaAssets = useAssetStore((state) => state.assets);
    const [category, setCategory] = useState("all");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [inserting, setInserting] = useState(false);
    const items = useMemo(() => {
        const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
        return (detail?.assets || []).flatMap((asset): ProjectPickerItem[] => {
            if (asset.category === "character" && asset.character) return [{ id: asset.id, category: "character", character: asset }];
            const media = mediaById.get(asset.id);
            return media && media.kind !== "model" && media.kind !== "entity" ? [{ id: asset.id, category: asset.category || media.category || "other", media }] : [];
        });
    }, [detail?.assets, mediaAssets]);
    const categories = useMemo(() => ["all", ...Array.from(new Set(items.map((item) => item.category)))], [items]);
    const visible = category === "all" ? items : items.filter((item) => item.category === category);

    useEffect(() => {
        setSelectedIds(new Set());
        setInserting(false);
        setCategory(open ? initialCategory : "all");
    }, [initialCategory, open]);
    const toggle = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const insert = async () => {
        const payloads = items.filter((item) => selectedIds.has(item.id)).map(toInsertPayload);
        if (!payloads.length) return;
        setInserting(true);
        try { await onInsert(payloads); onClose(); } finally { setInserting(false); }
    };

    return <Modal open={open} title={null} footer={null} destroyOnHidden onCancel={onClose} width="min(920px, calc(100vw - 24px))" styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
        <div className="flex h-[min(620px,calc(100vh-80px))] min-h-[440px] flex-col overflow-hidden">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border py-0 pl-4 pr-12"><h2 className="text-sm font-semibold">引用项目角色与资产</h2><span className="text-[var(--fs-label)] text-foreground/42">已选 {selectedIds.size} 项</span></header>
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] sm:grid-rows-1">
                <nav className="thin-scrollbar flex min-w-0 gap-1 overflow-x-auto border-b border-border p-2 sm:block sm:overflow-y-auto sm:border-b-0 sm:border-r" aria-label="项目资产分类">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`flex h-11 min-w-[104px] shrink-0 items-center justify-between rounded-md px-2 text-xs sm:w-full sm:min-w-0 ${category === item ? "bg-foreground/[.08] font-medium" : "text-foreground/55 hover:bg-foreground/[.04]"}`}><span>{categoryLabels[item] || "其他"}</span><span className="min-w-5 rounded bg-foreground/[.05] px-1 text-center text-[var(--fs-tiny)] tabular-nums">{item === "all" ? items.length : items.filter((asset) => asset.category === item).length}</span></button>)}</nav>
                <div className="thin-scrollbar min-h-0 overflow-y-auto p-3">{visible.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{visible.map((item) => <ProjectAssetCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={() => toggle(item.id)} />)}</div> : <WorkspaceState icon="assets" compact className="h-full" title="此分类没有可引用资产" description="先在项目角色与资产中完成角色确认或素材关联。" />}</div>
            </div>
            <footer className="flex h-12 shrink-0 items-center justify-between border-t border-border px-3"><span className="text-[var(--fs-tiny)] text-foreground/42">角色引用会在生成时解析当前角色版本</span><div className="flex gap-2"><Button size="small" onClick={onClose}>取消</Button><Button size="small" type="primary" disabled={!selectedIds.size} loading={inserting} onClick={() => void insert()}>引入 {selectedIds.size || ""} 项</Button></div></footer>
        </div>
    </Modal>;
}

function ProjectAssetCard({ item, selected, onToggle }: { item: ProjectPickerItem; selected: boolean; onToggle: () => void }) {
    const character = item.character;
    const media = item.media;
    const coverRepresentation = character?.character?.representations.find((representation) => representation.role === "turnaround_sheet") || character?.character?.representations.find((representation) => representation.role === "primary") || character?.character?.representations.find((representation) => representation.role === "front");
    const cover = coverRepresentation ? resourceFileUrl(coverRepresentation.resourceId) : "";
    const Icon = character ? UserRound : media?.kind === "video" ? Video : media?.kind === "audio" ? Music2 : media?.kind === "text" ? FileText : ImageIcon;
    const label = character ? "角色卡" : media?.kind === "video" ? "视频" : media?.kind === "audio" ? "音频" : media?.kind === "text" ? "文本" : "图片";
    const title = character?.title || media?.title || "未命名资产";
    return <button type="button" onClick={onToggle} className={`relative min-w-0 overflow-hidden rounded-md border text-left transition-colors ${selected ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent-soft)]" : "border-border/80 hover:border-foreground/30"}`}><div className="relative aspect-[4/3] overflow-hidden bg-foreground/[.04]">{cover ? <img src={cover} alt={title} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" /> : <AssetMediaPreview asset={media} alt={title} className="h-full w-full bg-black object-cover" fallback={<div className="grid h-full place-items-center text-foreground/25"><Icon className="size-7" /></div>} />}<span className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded border ${selected ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent)] text-white" : "border-white/60 bg-black/25 text-transparent backdrop-blur"}`}><Check className="size-3" /></span><span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[var(--fs-micro)] text-white">{label}</span></div><div className="px-2 py-1.5"><div className="truncate text-[var(--fs-label)] font-medium">{title}</div>{character ? <div className="mt-0.5 truncate text-[var(--fs-micro)] text-foreground/42">{character.character?.visualStatus === "ready" ? "形象就绪" : "形象待完善"} · {character.character?.voiceStatus === "ready" ? "声音已绑定" : "声音未绑定"}</div> : null}</div></button>;
}

function toInsertPayload(item: ProjectPickerItem): InsertAssetPayload {
    if (item.character?.character) {
        return projectCharacterToInsertPayload(item.character);
    }
    const asset = item.media;
    if (!asset) throw new Error("项目资产不可用");
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "image") return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id };
    throw new Error("当前项目资产不能直接插入画布");
}

export function projectCharacterToInsertPayload(asset: ProjectAsset): InsertAssetPayload {
    if (!asset.character) throw new Error("项目角色信息不完整");
    const card = asset.character;
    const definition = card.definition;
    const cover = card.representations.find((representation) => representation.role === "turnaround_sheet") || card.representations.find((representation) => representation.role === "primary") || card.representations.find((representation) => representation.role === "front");
    return {
        kind: "character",
        title: asset.title,
        assetId: asset.id,
        versionId: card.versionId,
        prompt: compileCharacterReferencePrompt(asset.title, definition),
        aliases: Array.isArray(definition.aliases) ? definition.aliases.filter((alias): alias is string => typeof alias === "string") : [],
        definition,
        coverUrl: cover ? resourceFileUrl(cover.resourceId) : undefined,
        visualStatus: card.visualStatus,
        voiceStatus: card.voiceStatus,
        voiceName: card.voice?.profile.name,
        voiceProfile: card.voice ? {
            name: card.voice.profile.name,
            provider: card.voice.profile.provider,
            language: card.voice.profile.language,
            timbre: card.voice.profile.timbre,
        } : undefined,
        voiceInstructions: card.voice?.instructions,
    };
}
