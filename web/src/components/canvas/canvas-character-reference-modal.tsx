import { App, Button, Input } from "antd";
import { AudioLines, IdCard, ImageIcon, Mic, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { CharacterImageLibrary, CharacterVoiceLibrary, type CanvasMediaTitles } from "@/components/canvas/character-media-library";
import { characterCoverResourceId, characterInitial, useCharacterCoverSrc } from "@/components/canvas/canvas-character-reference-node";
import { getResourceAccess, resolveResourceAccessURL, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { bindCharacterVoice, getCharacter, replaceCharacterRepresentations, unbindCharacterVoice, updateCharacter, type ProjectCharacterDetail } from "@/services/api/projects";
import type { CanvasNodeData } from "@/types/canvas";

type Tab = "profile" | "visual" | "voice";
type FieldKey = "role" | "aliases" | "appearance" | "physique" | "clothing" | "personality" | "props" | "consistencyPrompt" | "multiViewPrompt" | "voiceLanguage" | "voiceAge" | "voiceTimbre";
type Drafts = Record<FieldKey | "name", string>;

const FIELD_GROUPS: Array<{ title: string; fields: Array<{ key: FieldKey; label: string; placeholder: string; wide?: boolean }> }> = [
    { title: "身份", fields: [
        { key: "role", label: "剧情身份", placeholder: "例如：落魄剑客，主角的师兄" },
        { key: "aliases", label: "别名", placeholder: "多个别名用逗号分隔" },
        { key: "personality", label: "性格气质", placeholder: "冷静、克制、偶尔自嘲", wide: true },
    ] },
    { title: "外观", fields: [
        { key: "appearance", label: "外貌特征", placeholder: "脸型、五官、发型、年龄感", wide: true },
        { key: "physique", label: "体型姿态", placeholder: "身高、体态、习惯动作" },
        { key: "clothing", label: "服装造型", placeholder: "主服装与配色" },
        { key: "props", label: "标志道具", placeholder: "随身物品或武器", wide: true },
        { key: "consistencyPrompt", label: "一致性要求", placeholder: "生成时必须保持不变的特征", wide: true },
        { key: "multiViewPrompt", label: "多视图要求", placeholder: "三视图 / 多角度生成补充说明", wide: true },
    ] },
    { title: "声音画像", fields: [
        { key: "voiceLanguage", label: "语言口音", placeholder: "普通话，略带川音" },
        { key: "voiceAge", label: "年龄感", placeholder: "青年" },
        { key: "voiceTimbre", label: "音色气质", placeholder: "低沉、沙哑、语速偏慢", wide: true },
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
    const items = detail?.character.representations || [];
    return (items.find((item) => item.role === "turnaround_sheet") || items.find((item) => item.role === "primary") || items.find((item) => item.role === "front"))?.resourceId || "";
}

export function CanvasCharacterReferenceModal({ node, canvasNodes, open, onClose, onUpdated }: { node: CanvasNodeData | null; canvasNodes?: CanvasNodeData[]; open: boolean; onClose: () => void; onUpdated?: (detail: ProjectCharacterDetail) => void }) {
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
            {node?.metadata?.characterAssetId ? <CharacterStudio key={node.id} node={node} assetId={node.metadata.characterAssetId} canvasTitles={canvasTitles} onUpdated={onUpdated} /> : null}
        </AppModal>
    );
}

function CharacterStudio({ node, assetId, canvasTitles, onUpdated }: { node: CanvasNodeData; assetId: string; canvasTitles: CanvasMediaTitles; onUpdated?: (detail: ProjectCharacterDetail) => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const detailQuery = useQuery({ queryKey: ["character-studio", assetId], queryFn: () => getCharacter(assetId) });
    const detail = detailQuery.data;
    const metadata = node.metadata;
    const name = detail?.asset.title || metadata?.characterName || node.title || "未命名角色";
    const definition = detail?.character.definition || metadata?.characterDefinition || {};
    // 以序列化结果作依赖，避免每次渲染的新对象反复重置草稿。
    const definitionKey = JSON.stringify(definition);
    const baseline = useMemo(() => draftsFrom(name, JSON.parse(definitionKey) as Record<string, unknown>), [name, definitionKey]);
    const [drafts, setDrafts] = useState<Drafts>(baseline);
    const [tab, setTab] = useState<Tab>("profile");
    const [busyKey, setBusyKey] = useState("");
    // 服务端数据到达或保存成功后，用新基线覆盖草稿。
    useEffect(() => setDrafts(baseline), [baseline]);
    const dirty = (Object.keys(baseline) as Array<keyof Drafts>).some((key) => baseline[key].trim() !== drafts[key].trim());

    const coverResourceId = detail ? coverOf(detail) : characterCoverResourceId(metadata?.characterCoverUrl);
    const cover = useCharacterCoverSrc(coverResourceId ? resourceFileUrl(coverResourceId) : undefined);
    const voice = detail?.character.voice;
    const voiceSampleId = voice?.profile.sampleResourceId || "";
    // 已绑定的样本如果在画布上被重命名，展示时跟随画布名；重新绑定时会把新名字写回声音档案。
    const voiceName = (voiceSampleId && canvasTitles.get(voiceSampleId)) || voice?.profile.name || metadata?.characterVoiceName || "";

    const commit = async (key: string, work: () => Promise<ProjectCharacterDetail>, success: string) => {
        setBusyKey(key);
        try {
            const next = await work();
            queryClient.setQueryData(["character-studio", assetId], next);
            void queryClient.invalidateQueries({ queryKey: ["characters"] });
            onUpdated?.(next);
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "角色卡保存失败，请稍后重试");
        } finally {
            setBusyKey("");
        }
    };
    const bindImage = (resourceId: string) => commit(resourceId, () => replaceCharacterRepresentations(assetId, [{ role: "turnaround_sheet", resourceId }, { role: "primary", resourceId }]), "形象已更新");
    const bindVoice = (resourceId: string, title: string) => commit(resourceId, () => bindCharacterVoice(assetId, { sampleResourceId: resourceId, voiceName: title }), "声音已绑定");
    const upload = (file: File, kind: "image" | "audio") => commit("upload", async () => {
        const resource = await uploadResourceFile(file, kind, { fileName: file.name });
        return kind === "image"
            ? replaceCharacterRepresentations(assetId, [{ role: "turnaround_sheet", resourceId: resource.id }, { role: "primary", resourceId: resource.id }])
            : bindCharacterVoice(assetId, { sampleResourceId: resource.id, voiceName: file.name.replace(/\.[^.]+$/, "") });
    }, kind === "image" ? "形象已更新" : "声音已绑定");
    const saveProfile = () => {
        if (!drafts.name.trim()) {
            message.error("角色名称不能为空");
            return;
        }
        const nextDefinition: Record<string, unknown> = { ...definition };
        FIELD_KEYS.forEach((key) => {
            nextDefinition[key] = key === "aliases" ? drafts.aliases.split(/[，,、]/).map((item) => item.trim()).filter(Boolean) : drafts[key].trim();
        });
        void commit("profile", () => updateCharacter(assetId, { name: drafts.name.trim(), definition: nextDefinition }), "角色资料已保存");
    };

    return (
        <div className="grid h-[min(760px,calc(100dvh-48px))] min-h-0 grid-rows-[minmax(260px,40vh)_minmax(0,1fr)] overflow-hidden bg-background text-foreground md:grid-cols-[minmax(0,1fr)_minmax(420px,1.05fr)] md:grid-rows-1">
            <CharacterStage name={drafts.name.trim() || name} role={drafts.role.trim()} cover={cover} hasCover={Boolean(coverResourceId)} voiceName={voiceName} voiceSampleId={voiceSampleId} version={detail?.character.version} />
            <section className="flex min-h-0 flex-col">
                <CharacterTabs value={tab} onChange={setTab} />
                <div id={`character-tab-panel-${tab}`} role="tabpanel" aria-labelledby={`character-tab-${tab}`} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
                    {tab === "profile" ? <ProfileForm drafts={drafts} onChange={(key, value) => setDrafts((current) => ({ ...current, [key]: value }))} /> : null}
                    {tab === "visual" ? <CharacterImageLibrary currentResourceId={coverResourceId} busyKey={busyKey} canvasTitles={canvasTitles} onPick={(id) => void bindImage(id)} onUpload={(file) => void upload(file, "image")} /> : null}
                    {tab === "voice" ? (
                        <div className="space-y-5">
                            {voiceName ? (
                                <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[.04] px-4 py-3">
                                    <span className="min-w-0">
                                        <span className="block text-[11px] text-foreground/45">当前声音</span>
                                        <span className="block truncate text-sm font-medium">{voiceName}</span>
                                    </span>
                                    <button type="button" disabled={Boolean(busyKey)} onClick={() => void commit("unbind", () => unbindCharacterVoice(assetId), "声音绑定已解除")} className="shrink-0 rounded text-xs text-foreground/45 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] disabled:cursor-wait">
                                        解除绑定
                                    </button>
                                </div>
                            ) : null}
                            <CharacterVoiceLibrary currentResourceId={voiceSampleId} busyKey={busyKey} canvasTitles={canvasTitles} onPick={(id, title) => void bindVoice(id, title)} onUpload={(file) => void upload(file, "audio")} />
                        </div>
                    ) : null}
                </div>
                <footer className={`grid shrink-0 transition-[grid-template-rows] duration-200 [transition-timing-function:cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none ${dirty ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} aria-hidden={!dirty}>
                    <div className="overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-t border-border px-7 py-3.5">
                            <span className="text-xs text-foreground/45">资料有改动，保存后生成新版本</span>
                            <span className="flex gap-2">
                                <Button type="text" size="small" tabIndex={dirty ? 0 : -1} onClick={() => setDrafts(baseline)}>还原</Button>
                                <Button type="primary" size="small" tabIndex={dirty ? 0 : -1} loading={busyKey === "profile"} onClick={saveProfile}>保存资料</Button>
                            </span>
                        </div>
                    </div>
                </footer>
            </section>
        </div>
    );
}

const TABS: Array<{ value: Tab; label: string; icon: ReactNode }> = [
    { value: "profile", label: "资料", icon: <IdCard /> },
    { value: "visual", label: "形象", icon: <ImageIcon /> },
    { value: "voice", label: "声音", icon: <AudioLines /> },
];

/** 右侧主导航：等分整行、带图标和下划线指示，比分段控件更醒目；支持左右方向键切换。 */
function CharacterTabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
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
        <div role="tablist" aria-label="角色卡设置" onKeyDown={onKeyDown} className="grid shrink-0 grid-cols-3 border-b border-border pl-3 pr-14 pt-3">
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
                        className={`relative flex h-14 items-center justify-center gap-2 rounded-t-lg text-[15px] outline-none transition-colors duration-150 focus-visible:bg-foreground/[.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)] [&_svg]:size-[18px] ${active ? "font-semibold text-foreground" : "font-medium text-foreground/50 hover:bg-foreground/[.03] hover:text-foreground/80"}`}
                    >
                        {item.icon}
                        {item.label}
                        <span aria-hidden className={`absolute inset-x-5 -bottom-px h-[3px] rounded-full bg-[var(--workspace-accent)] transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`} />
                    </button>
                );
            })}
        </div>
    );
}

/** 左侧主视觉：模糊底 + 全幅立绘，名字压在底部；声音可直接试听。 */
function CharacterStage({ name, role, cover, hasCover, voiceName, voiceSampleId, version }: { name: string; role: string; cover: string; hasCover: boolean; voiceName: string; voiceSampleId: string; version?: number }) {
    return (
        <section className="relative isolate min-h-0 overflow-hidden bg-[#0f0f12] text-white" aria-label={`${name}角色形象`}>
            {cover ? (
                <>
                    <img src={cover} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-45 blur-3xl saturate-125" draggable={false} />
                    <img src={cover} alt={`${name}角色形象`} className="absolute inset-0 h-full w-full object-contain px-8 pb-32 pt-12 drop-shadow-[0_30px_60px_rgba(0,0,0,.5)]" draggable={false} />
                </>
            ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,.08),transparent_62%)] pb-24">
                    {hasCover ? null : (
                        <div className="text-center">
                            <span className="mx-auto grid size-28 place-items-center rounded-full border border-white/12 text-5xl font-extralight text-white/70">{characterInitial(name)}</span>
                            <p className="mt-4 text-xs text-white/40">在右侧「形象」中选择或上传立绘</p>
                        </div>
                    )}
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
            <span className="absolute left-7 top-6 text-[10px] font-medium uppercase tracking-[.28em] text-white/50">Character{version ? ` · v${version}` : ""}</span>
            <div className="absolute inset-x-0 bottom-0 px-7 pb-7">
                <h2 className="truncate text-[32px] font-semibold leading-tight tracking-tight">{name}</h2>
                <p className="mt-1 line-clamp-2 max-w-[46ch] text-sm leading-6 text-white/60">{role || "尚未填写剧情身份"}</p>
                <VoiceChip name={voiceName} sampleId={voiceSampleId} />
            </div>
        </section>
    );
}

function VoiceChip({ name, sampleId }: { name: string; sampleId: string }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    useEffect(() => () => audioRef.current?.pause(), []);
    useEffect(() => {
        audioRef.current?.pause();
        setPlaying(false);
    }, [sampleId]);
    if (!name) return <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/35"><Mic className="size-3.5" />未绑定声音</p>;
    const toggle = async () => {
        if (!sampleId) return;
        const audio = audioRef.current || (audioRef.current = new Audio());
        if (playing) {
            audio.pause();
            setPlaying(false);
            return;
        }
        setPlaying(true);
        try {
            audio.src = resolveResourceAccessURL((await getResourceAccess(resourceStorageKey(sampleId), "display", "playback")).url);
            audio.onended = () => setPlaying(false);
            await audio.play();
        } catch {
            setPlaying(false);
        }
    };
    return (
        <button type="button" disabled={!sampleId} onClick={() => void toggle()} aria-label={sampleId ? `${playing ? "暂停" : "试听"}声音 ${name}` : `声音 ${name}`} className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-1 pr-3.5 text-xs text-white/85 outline-none backdrop-blur transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-default">
            <span className="grid size-6 place-items-center rounded-full bg-white text-black">{playing ? <Pause className="size-3" /> : sampleId ? <Play className="size-3 translate-x-px" /> : <Mic className="size-3" />}</span>
            <span className="truncate">{name}</span>
        </button>
    );
}

function ProfileForm({ drafts, onChange }: { drafts: Drafts; onChange: (key: keyof Drafts, value: string) => void }) {
    return (
        <div className="space-y-8">
            <Field label="角色名称">
                <Input variant="filled" size="large" value={drafts.name} maxLength={80} placeholder="角色名称" onChange={(event) => onChange("name", event.target.value)} className="!text-base !font-medium" />
            </Field>
            {FIELD_GROUPS.map((group) => (
                <fieldset key={group.title} className="space-y-4">
                    <legend className="mb-4 flex w-full items-center gap-3 text-[11px] font-medium uppercase tracking-[.18em] text-foreground/40">
                        {group.title}
                        <span className="h-px flex-1 bg-border" />
                    </legend>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        {group.fields.map((field) => (
                            <Field key={field.key} label={field.label} wide={field.wide}>
                                <Input.TextArea variant="filled" autoSize={{ minRows: 1, maxRows: 6 }} value={drafts[field.key]} placeholder={field.placeholder} onChange={(event) => onChange(field.key, event.target.value)} />
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
            <span className="mb-1.5 block text-xs text-foreground/55">{label}</span>
            {children}
        </label>
    );
}
