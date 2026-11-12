import { App, Button, Input } from "antd";
import { AudioLines, IdCard, ImageIcon, Mic, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { CharacterImageLibrary, CharacterVoiceLibrary, type CanvasMediaTitles } from "@/components/canvas/character-media-library";
import { characterCoverResourceId, characterInitial, useCharacterCoverSrc } from "@/components/canvas/canvas-character-reference-node";
import { getResourceAccess, resolveResourceAccessURL, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { bindCharacterVoice, getCharacter, replaceCharacterRepresentations, unbindCharacterVoice, updateCharacter, type ProjectCharacterDetail } from "@/services/api/projects";
import type { CanvasNodeData } from "@/types/canvas";
import { fetchOfficialAssetReference } from "@/services/api/official-assets";
import { CharacterStudioOutfitManager } from "@/components/canvas/character-outfit-bar";
import { buildCharacterOutfitPersistence, parseCharacterOutfits, resolveActiveCharacterOutfit, type CharacterOutfit } from "@/components/canvas/character-outfits";

type Tab = "profile" | "visual" | "voice";
type FieldKey = "role" | "aliases" | "appearance" | "physique" | "clothing" | "personality" | "props" | "consistencyPrompt" | "multiViewPrompt" | "voiceLanguage" | "voiceAge" | "voiceTimbre";
type Drafts = Record<FieldKey | "name", string>;

const FIELD_GROUPS: Array<{ id: "identity" | "appearance" | "voice"; fields: Array<{ key: FieldKey; wide?: boolean }> }> = [
    { id: "identity", fields: [
        { key: "role" },
        { key: "aliases" },
        { key: "personality", wide: true },
    ] },
    { id: "appearance", fields: [
        { key: "appearance", wide: true },
        { key: "physique" },
        { key: "clothing" },
        { key: "props", wide: true },
        { key: "consistencyPrompt", wide: true },
        { key: "multiViewPrompt", wide: true },
    ] },
    { id: "voice", fields: [
        { key: "voiceLanguage" },
        { key: "voiceAge" },
        { key: "voiceTimbre", wide: true },
    ] },
];
const FIELD_KEYS = FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));

function draftsFrom(name: string, definition: Record<string, unknown>): Drafts {
    const drafts = { name } as Drafts;
    FIELD_KEYS.forEach((key) => {
        const value = definition[key];
        drafts[key] = key === "aliases" ? (Array.isArray(value) ? value.filter((item) => typeof item === "string").join("，") : "") : typeof value === "string" ? value : "";
    });
    return drafts;
}

function coverOf(detail?: ProjectCharacterDetail) {
    const outfit = resolveActiveCharacterOutfit(detail?.character.definition, detail?.character.representations);
    if (outfit?.resourceId) return outfit.resourceId;
    const items = detail?.character.representations || [];
    return (items.find((item) => item.role === "turnaround_sheet") || items.find((item) => item.role === "primary") || items.find((item) => item.role === "front"))?.resourceId || "";
}

export function CanvasCharacterReferenceModal({ node, canvasNodes, open, onClose, onUpdated }: { node: CanvasNodeData | null; canvasNodes?: CanvasNodeData[]; open: boolean; onClose: () => void; onUpdated?: (detail: ProjectCharacterDetail, selectedOutfitId?: string) => void }) {
    // 资源 ID → 画布节点名：用户在画布上重命名过的图片/音频，选择时按新名字显示并作为声音名保存。
    const canvasTitles = useMemo<CanvasMediaTitles>(() => {
        const titles = new Map<string, string>();
        for (const item of canvasNodes || []) {
            const resourceId = resourceIdFromStorageKey(item.metadata?.storageKey);
            const title = item.title?.trim();
            if (resourceId && title && !titles.has(resourceId)) titles.set(resourceId, title);
        }
        return titles;
    }, [canvasNodes]);
    return (
        <AppModal open={open && Boolean(node)} title={null} footer={null} destroyOnHidden width="min(1120px, calc(100vw - 32px))" onCancel={onClose} flush>
            {node?.metadata?.sharedCharacter ? <SharedCharacterStudio node={node} /> : node?.metadata?.characterAssetId ? <CharacterStudio key={node.id} node={node} assetId={node.metadata.characterAssetId} canvasTitles={canvasTitles} onUpdated={onUpdated} /> : node?.metadata?.officialAssetId ? <OfficialCharacterStudio key={node.id} node={node} /> : null}
        </AppModal>
    );
}

function SharedCharacterStudio({ node }: { node: CanvasNodeData }) {
    const drafts = draftsFrom(node.metadata?.characterName || node.title, node.metadata?.characterDefinition || {});
    const cover = useCharacterCoverSrc(node.metadata?.characterCoverUrl);
    return <div className="grid h-[min(760px,calc(100dvh-48px))] min-h-0 grid-rows-[minmax(260px,40vh)_minmax(0,1fr)] overflow-hidden bg-background text-foreground md:grid-cols-[minmax(0,1fr)_minmax(420px,1.05fr)] md:grid-rows-1">
        <CharacterStage name={drafts.name} role={drafts.role} cover={cover} hasCover={Boolean(cover)} voiceName={node.metadata?.characterVoiceName || ""} voiceSampleId="" voiceSampleUrl={node.metadata?.characterVoiceSampleUrl} />
        <section className="flex min-h-0 flex-col"><div className="border-b border-border px-7 py-5 font-semibold">角色资料</div><div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-7 py-6"><p className="mb-5 text-sm text-foreground/55">分享画布中的角色资料仅供查看。</p><fieldset disabled><ProfileForm drafts={drafts} onChange={() => {}} /></fieldset></div></section>
    </div>;
}

function OfficialCharacterStudio({ node }: { node: CanvasNodeData }) {
    const definition = node.metadata?.characterDefinition || {};
    const drafts = draftsFrom(node.metadata?.characterName || node.title, definition);
    const coverId = characterCoverResourceId(node.metadata?.characterCoverUrl);
    const cover = useCharacterCoverSrc(node.metadata?.characterCoverUrl);
    const reference = useQuery({ queryKey: ["official-character-reference", node.metadata?.officialAssetId], queryFn: () => fetchOfficialAssetReference(node.metadata!.officialAssetId!), enabled: Boolean(node.metadata?.officialAssetId && !node.metadata?.characterVoiceSampleResourceId) });
    const sampleId = node.metadata?.characterVoiceSampleResourceId || reference.data?.character?.voice?.profile?.sampleResourceId || "";
    return <div className="grid h-[min(760px,calc(100dvh-48px))] min-h-0 grid-rows-[minmax(260px,40vh)_minmax(0,1fr)] overflow-hidden bg-background text-foreground md:grid-cols-[minmax(0,1fr)_minmax(420px,1.05fr)] md:grid-rows-1">
        <CharacterStage name={drafts.name || node.title} role={drafts.role} cover={cover} hasCover={Boolean(coverId)} voiceName={node.metadata?.characterVoiceName || reference.data?.character?.voice?.profile?.name || ""} voiceSampleId={sampleId} />
        <section className="flex min-h-0 flex-col"><div className="border-b border-border px-7 py-5 font-semibold">角色资料</div><div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-7 py-6"><p className="mb-5 text-sm text-foreground/55">官方角色资料仅供查看。</p><fieldset disabled><ProfileForm drafts={drafts} onChange={() => {}} /></fieldset></div></section>
    </div>;
}

function CharacterStudio({ node, assetId, canvasTitles, onUpdated }: { node: CanvasNodeData; assetId: string; canvasTitles: CanvasMediaTitles; onUpdated?: (detail: ProjectCharacterDetail, selectedOutfitId?: string) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const detailQuery = useQuery({ queryKey: ["character-studio", assetId], queryFn: () => getCharacter(assetId) });
    const detail = detailQuery.data;
    const metadata = node.metadata;
    const name = detail?.asset.title || metadata?.characterName || node.title || t("canvasA.characterNode.unnamed");
    const definition = detail?.character.definition || metadata?.characterDefinition || {};
    const [selectedOutfitId, setSelectedOutfitId] = useState<string | undefined>(metadata?.selectedOutfitId);
    useEffect(() => setSelectedOutfitId(metadata?.selectedOutfitId), [node.id, metadata?.selectedOutfitId]);
    const outfits = useMemo(
        () => parseCharacterOutfits(definition, detail?.character.representations, characterCoverResourceId(metadata?.characterCoverUrl)),
        [definition, detail?.character.representations, metadata?.characterCoverUrl],
    );
    const activeOutfit = useMemo(
        () => resolveActiveCharacterOutfit(definition, detail?.character.representations, selectedOutfitId, characterCoverResourceId(metadata?.characterCoverUrl)),
        [definition, detail?.character.representations, selectedOutfitId, metadata?.characterCoverUrl],
    );
    const effectiveDefinition = useMemo(
        () => (activeOutfit?.clothing !== undefined ? { ...definition, clothing: activeOutfit.clothing } : definition),
        [definition, activeOutfit?.clothing],
    );
    // 以序列化结果作依赖，避免每次渲染的新对象反复重置草稿。
    const definitionKey = JSON.stringify(effectiveDefinition);
    const baseline = useMemo(() => draftsFrom(name, JSON.parse(definitionKey) as Record<string, unknown>), [name, definitionKey]);
    const [drafts, setDrafts] = useState<Drafts>(baseline);
    const [tab, setTab] = useState<Tab>("profile");
    const [busyKey, setBusyKey] = useState("");
    const [addingNewOutfit, setAddingNewOutfit] = useState(false);
    // 服务端数据到达或保存成功后，用新基线覆盖草稿。
    useEffect(() => setDrafts(baseline), [baseline]);
    const dirty = (Object.keys(baseline) as Array<keyof Drafts>).some((key) => baseline[key].trim() !== drafts[key].trim());

    const coverResourceId = activeOutfit?.resourceId || (detail ? coverOf(detail) : characterCoverResourceId(metadata?.characterCoverUrl));
    const cover = useCharacterCoverSrc(coverResourceId ? resourceFileUrl(coverResourceId) : undefined);
    const voice = detail?.character.voice;
    const voiceSampleId = voice?.profile.sampleResourceId || "";
    // 已绑定的样本如果在画布上被重命名，展示时跟随画布名；重新绑定时会把新名字写回声音档案。
    const voiceName = (voiceSampleId && canvasTitles.get(voiceSampleId)) || voice?.profile.name || metadata?.characterVoiceName || "";

    const commit = async (key: string, work: () => Promise<ProjectCharacterDetail>, success: string, nextSelectedOutfitId?: string) => {
        setBusyKey(key);
        try {
            const next = await work();
            const targetOutfitId = nextSelectedOutfitId || selectedOutfitId || activeOutfit?.id;
            if (targetOutfitId) setSelectedOutfitId(targetOutfitId);
            queryClient.setQueryData(["character-studio", assetId], next);
            void queryClient.invalidateQueries({ queryKey: ["characters"] });
            onUpdated?.(next, targetOutfitId);
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasA.characterStudio.saveFailed"));
        } finally {
            setBusyKey("");
        }
    };
    const saveOutfits = (nextOutfits: CharacterOutfit[], nextActiveId: string, busyId = "outfit") => {
        const payload = buildCharacterOutfitPersistence(definition, nextOutfits, nextActiveId);
        setAddingNewOutfit(false);
        return commit(busyId, () => replaceCharacterRepresentations(assetId, payload.representations, payload.definition), t("canvasA.characterStudio.visualUpdated"), nextActiveId);
    };
    const bindImage = (resourceId: string) => {
        const imageTitle = canvasTitles.get(resourceId)?.trim();
        if (addingNewOutfit || !outfits.length) {
            const id = `outfit-${Date.now().toString(36)}`;
            const name = imageTitle || (outfits.length === 0 ? "默认造型" : `造型 ${outfits.length + 1}`);
            return saveOutfits([...outfits, { id, name, resourceId }], id, resourceId);
        }
        const currentId = activeOutfit?.id || outfits[0].id;
        const nextOutfits = outfits.map((item) => (item.id === currentId ? { ...item, resourceId } : item));
        return saveOutfits(nextOutfits, currentId, resourceId);
    };
    const bindVoice = (resourceId: string, title: string) => commit(resourceId, () => bindCharacterVoice(assetId, { sampleResourceId: resourceId, voiceName: title }), t("canvasA.characterLibrary.voiceBound"));
    const upload = (file: File, kind: "image" | "audio") => {
        const newOutfitId = `outfit-${Date.now().toString(36)}`;
        const targetOutfitId = kind === "image" ? (addingNewOutfit || !outfits.length ? newOutfitId : activeOutfit?.id || outfits[0].id) : undefined;
        return commit("upload", async () => {
            const resource = await uploadResourceFile(file, kind, { fileName: file.name });
            if (kind === "image") {
                const cleanName = file.name.replace(/\.[^.]+$/, "").trim();
                const nextOutfits = addingNewOutfit || !outfits.length
                    ? [...outfits, { id: newOutfitId, name: cleanName || (outfits.length === 0 ? "默认造型" : `造型 ${outfits.length + 1}`), resourceId: resource.id }]
                    : outfits.map((item) => (item.id === (activeOutfit?.id || outfits[0].id) ? { ...item, resourceId: resource.id } : item));
                const payload = buildCharacterOutfitPersistence(definition, nextOutfits, targetOutfitId);
                setAddingNewOutfit(false);
                return replaceCharacterRepresentations(assetId, payload.representations, payload.definition);
            }
            return bindCharacterVoice(assetId, { sampleResourceId: resource.id, voiceName: file.name.replace(/\.[^.]+$/, "") });
        }, kind === "image" ? t("canvasA.characterStudio.visualUpdated") : t("canvasA.characterLibrary.voiceBound"), targetOutfitId);
    };
    const saveProfile = () => {
        if (!drafts.name.trim()) {
            message.error(t("canvasA.characterStudio.nameRequired"));
            return;
        }
        const nextDefinition: Record<string, unknown> = { ...definition };
        FIELD_KEYS.forEach((key) => {
            nextDefinition[key] = key === "aliases" ? drafts.aliases.split(/[，,、]/).map((item) => item.trim()).filter(Boolean) : drafts[key].trim();
        });
        if (Array.isArray(nextDefinition.outfits) && activeOutfit) {
            nextDefinition.outfits = (nextDefinition.outfits as Array<Record<string, unknown>>).map((item) =>
                item?.id === activeOutfit.id ? { ...item, clothing: drafts.clothing.trim() } : item,
            );
        }
        void commit("profile", () => updateCharacter(assetId, { name: drafts.name.trim(), definition: nextDefinition }), t("canvasA.characterStudio.profileSaved"));
    };

    return (
        <div className="grid h-[min(760px,calc(100dvh-48px))] min-h-0 grid-rows-[minmax(260px,40vh)_minmax(0,1fr)] overflow-hidden bg-background text-foreground md:grid-cols-[minmax(0,1fr)_minmax(420px,1.05fr)] md:grid-rows-1">
            <CharacterStage name={drafts.name.trim() || name} role={drafts.role.trim()} cover={cover} hasCover={Boolean(coverResourceId)} voiceName={voiceName} voiceSampleId={voiceSampleId} version={detail?.character.version} />
            <section className="flex min-h-0 flex-col">
                <CharacterTabs value={tab} onChange={setTab} />
                <div id={`character-tab-panel-${tab}`} role="tabpanel" aria-labelledby={`character-tab-${tab}`} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
                    {tab === "profile" ? <ProfileForm drafts={drafts} onChange={(key, value) => setDrafts((current) => ({ ...current, [key]: value }))} /> : null}
                    {tab === "visual" ? (
                        <div>
                            <CharacterStudioOutfitManager
                                outfits={outfits}
                                activeOutfitId={activeOutfit?.id || ""}
                                addingNew={addingNewOutfit}
                                busy={Boolean(busyKey)}
                                onSelectOutfit={(id) => {
                                    setAddingNewOutfit(false);
                                    setSelectedOutfitId(id);
                                    if (detail) onUpdated?.(detail, id);
                                }}
                                onStartAddNew={() => setAddingNewOutfit(true)}
                                onCancelAddNew={() => setAddingNewOutfit(false)}
                                onUpdateOutfitMeta={(id, patch) => {
                                    const next = outfits.map((item) => (item.id === id ? { ...item, ...patch } : item));
                                    void saveOutfits(next, id);
                                }}
                                onDeleteOutfit={(id) => {
                                    const next = outfits.filter((item) => item.id !== id);
                                    if (!next.length) return;
                                    const nextActive = id === activeOutfit?.id ? next[0].id : activeOutfit?.id || next[0].id;
                                    void saveOutfits(next, nextActive);
                                }}
                            />
                            <CharacterImageLibrary currentResourceId={addingNewOutfit ? "" : coverResourceId} busyKey={busyKey} canvasTitles={canvasTitles} onPick={(id) => void bindImage(id)} onUpload={(file) => void upload(file, "image")} />
                        </div>
                    ) : null}
                    {tab === "voice" ? (
                        <div className="space-y-5">
                            {voiceName ? (
                                <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[.04] px-4 py-3">
                                    <span className="min-w-0">
                                        <span className="block text-[var(--fs-label)] text-foreground/45">{t("canvasA.characterStudio.currentVoice")}</span>
                                        <span className="block truncate text-sm font-medium">{voiceName}</span>
                                    </span>
                                    <button type="button" disabled={Boolean(busyKey)} onClick={() => void commit("unbind", () => unbindCharacterVoice(assetId), t("canvasA.characterStudio.voiceUnbound"))} className="shrink-0 rounded text-xs text-foreground/45 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] disabled:cursor-wait">
                                        {t("canvasA.characterStudio.unbind")}
                                    </button>
                                </div>
                            ) : null}
                            <CharacterVoiceLibrary currentResourceId={voiceSampleId} busyKey={busyKey} canvasTitles={canvasTitles} onPick={(id, title) => void bindVoice(id, title)} onUpload={(file) => void upload(file, "audio")} />
                        </div>
                    ) : null}
                </div>
                <footer className={`grid shrink-0 transition-[grid-template-rows] duration-200 [transition-timing-function:cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none ${dirty ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} aria-hidden={!dirty}>
                    <div className="overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-t border-border px-7 py-4">
                            <span className="text-xs text-foreground/45">{t("canvasA.characterStudio.dirtyHint")}</span>
                            <span className="flex gap-2">
                                <Button type="text" size="small" tabIndex={dirty ? 0 : -1} onClick={() => setDrafts(baseline)}>{t("canvasA.characterStudio.revert")}</Button>
                                <Button type="primary" size="small" tabIndex={dirty ? 0 : -1} loading={busyKey === "profile"} onClick={saveProfile}>{t("canvasA.characterStudio.saveProfile")}</Button>
                            </span>
                        </div>
                    </div>
                </footer>
            </section>
        </div>
    );
}

const TABS: Array<{ value: Tab; labelKey: string; icon: ReactNode }> = [
    { value: "profile", labelKey: "canvasA.characterStudio.tabProfile", icon: <IdCard /> },
    { value: "visual", labelKey: "canvasA.characterStudio.tabVisual", icon: <ImageIcon /> },
    { value: "voice", labelKey: "canvasA.characterStudio.tabVoice", icon: <AudioLines /> },
];

/** 右侧主导航：等分整行、带图标和下划线指示，比分段控件更醒目；支持左右方向键切换。 */
function CharacterTabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
    const { t } = useTranslation();
    const refs = useRef<Array<HTMLButtonElement | null>>([]);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = TABS.findIndex((item) => item.value === value);
        const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
        onChange(TABS[next].value);
        refs.current[next]?.focus();
    };
    return (
        <div role="tablist" aria-label={t("canvasA.characterStudio.tabsLabel")} onKeyDown={onKeyDown} className="grid shrink-0 grid-cols-3 border-b border-border pl-3 pr-14 pt-3">
            {TABS.map((item, index) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        ref={(element) => {
                            refs.current[index] = element;
                        }}
                        id={`character-tab-${item.value}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`character-tab-panel-${item.value}`}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(item.value)}
                        className={`relative flex h-14 items-center justify-center gap-2 rounded-t-lg text-[var(--fs-body)] outline-none transition-colors duration-150 focus-visible:bg-foreground/[.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)] [&_svg]:size-[18px] ${active ? "font-semibold text-foreground" : "font-medium text-foreground/50 hover:bg-foreground/[.03] hover:text-foreground/80"}`}
                    >
                        {item.icon}
                        {t(item.labelKey)}
                        <span aria-hidden className={`absolute inset-x-5 -bottom-px h-[3px] rounded-full bg-[var(--workspace-accent)] transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`} />
                    </button>
                );
            })}
        </div>
    );
}

/** 左侧主视觉：模糊底 + 全幅立绘，名字压在底部；声音可直接试听。 */
function CharacterStage({ name, role, cover, hasCover, voiceName, voiceSampleId, voiceSampleUrl, version }: { name: string; role: string; cover: string; hasCover: boolean; voiceName: string; voiceSampleId: string; voiceSampleUrl?: string; version?: number }) {
    const { t } = useTranslation();
    return (
        <section className="relative isolate min-h-0 overflow-hidden bg-[#0f0f12] text-white" aria-label={t("canvasA.characterStudio.stageLabel", { name })}>
            {cover ? (
                <>
                    <img src={cover} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-45 blur-3xl saturate-125" draggable={false} />
                    <img src={cover} alt={t("canvasA.characterStudio.stageLabel", { name })} className="absolute inset-0 h-full w-full object-contain px-8 pb-32 pt-12 drop-shadow-[0_30px_60px_rgba(0,0,0,.5)]" draggable={false} />
                </>
            ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,.08),transparent_62%)] pb-24">
                    {hasCover ? null : (
                        <div className="text-center">
                            <span className="mx-auto grid size-28 place-items-center rounded-full border border-white/12 text-5xl font-normal text-white/70">{characterInitial(name)}</span>
                            <p className="mt-4 text-xs text-white/40">{t("canvasA.characterStudio.noCoverHint")}</p>
                        </div>
                    )}
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
            <span className="absolute left-7 top-6 text-[var(--fs-label)] font-medium uppercase tracking-[.28em] text-white/50">Character{version ? ` · v${version}` : ""}</span>
            <div className="absolute inset-x-0 bottom-0 px-7 pb-7">
                <h2 className="truncate text-[var(--fs-display)] font-semibold leading-tight tracking-tight">{name}</h2>
                <p className="mt-1 line-clamp-2 max-w-[46ch] text-sm leading-6 text-white/60">{role || t("canvasA.characterStudio.noRole")}</p>
                <VoiceChip name={voiceName} sampleId={voiceSampleId} sampleUrl={voiceSampleUrl} />
            </div>
        </section>
    );
}

function VoiceChip({ name, sampleId, sampleUrl }: { name: string; sampleId: string; sampleUrl?: string }) {
    const { t } = useTranslation();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    useEffect(() => () => audioRef.current?.pause(), []);
    useEffect(() => {
        audioRef.current?.pause();
        setPlaying(false);
    }, [sampleId, sampleUrl]);
    if (!name) return <p className="mt-4 inline-flex items-center gap-2 text-xs text-white/35"><Mic className="size-3.5" />{t("canvasA.characterStudio.noVoice")}</p>;
    const toggle = async () => {
        if (!sampleId && !sampleUrl) return;
        const audio = audioRef.current || (audioRef.current = new Audio());
        if (playing) {
            audio.pause();
            setPlaying(false);
            return;
        }
        setPlaying(true);
        try {
            audio.src = sampleUrl || resolveResourceAccessURL((await getResourceAccess(resourceStorageKey(sampleId), "display", "playback")).url);
            audio.onended = () => setPlaying(false);
            await audio.play();
        } catch {
            setPlaying(false);
        }
    };
    return (
        <button type="button" disabled={!sampleId && !sampleUrl} onClick={() => void toggle()} aria-label={sampleId || sampleUrl ? t(playing ? "canvasA.characterStudio.pauseVoice" : "canvasA.characterStudio.previewVoice", { name }) : t("canvasA.characterStudio.voiceNamed", { name })} className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-1 pr-4 text-xs text-white/85 outline-none backdrop-blur transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-default">
            <span className="grid size-6 place-items-center rounded-full bg-white text-black">{playing ? <Pause className="size-3" /> : sampleId || sampleUrl ? <Play className="size-3 translate-x-px" /> : <Mic className="size-3" />}</span>
            <span className="truncate">{name}</span>
        </button>
    );
}

function ProfileForm({ drafts, onChange }: { drafts: Drafts; onChange: (key: keyof Drafts, value: string) => void }) {
    const { t } = useTranslation();
    return (
        <div className="space-y-8">
            <Field label={t("canvasA.characterLibrary.namePlaceholder")}>
                <Input variant="filled" size="large" value={drafts.name} maxLength={80} placeholder={t("canvasA.characterLibrary.namePlaceholder")} onChange={(event) => onChange("name", event.target.value)} className="!text-base !font-medium" />
            </Field>
            {FIELD_GROUPS.map((group) => (
                <fieldset key={group.id} className="space-y-4">
                    <legend className="mb-4 flex w-full items-center gap-3 text-[var(--fs-label)] font-medium uppercase tracking-[.18em] text-foreground/40">
                        {t(`canvasA.characterStudio.groups.${group.id}`)}
                        <span className="h-px flex-1 bg-border" />
                    </legend>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        {group.fields.map((field) => (
                            <Field key={field.key} label={t(`canvasA.characterStudio.fields.${field.key}.label`)} wide={field.wide}>
                                <Input.TextArea variant="filled" autoSize={{ minRows: 1, maxRows: 6 }} value={drafts[field.key]} placeholder={t(`canvasA.characterStudio.fields.${field.key}.placeholder`)} onChange={(event) => onChange(field.key, event.target.value)} />
                            </Field>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}

function Field({ label, wide = true, children }: { label: string; wide?: boolean; children: ReactNode }) {
    return (
        <label className={`block ${wide ? "col-span-2" : "col-span-2 sm:col-span-1"}`}>
            <span className="mb-2 block text-xs text-foreground/55">{label}</span>
            {children}
        </label>
    );
}
