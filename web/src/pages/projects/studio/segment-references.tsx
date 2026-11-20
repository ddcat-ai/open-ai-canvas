import { useRef, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowDown, ArrowUp, Check, Library, Plus, RotateCcw, Search, Upload, ZoomIn } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import type { DramaCast, DramaSegment, DramaSegmentReferencePatch, DramaShot } from "@/services/api/drama";
import { uploadResourceFile } from "@/services/api/resources";
import { linkProjectAsset } from "@/services/api/projects";
import { MediaThumb, parseList } from "../drama-shared";
import { CastLibraryPicker } from "./cast-library-picker";
import { CastVoicePreview } from "./cast-voice";
import { referenceMissingReason } from "./segment-parts";
import { EpisodeReferencePicker, ProjectReferencePicker, type ReferenceImageAsset } from "./segment-project-images";
import "./asset-kind.css";

const ASSET_KINDS = ["character", "scene", "prop"] as const;
const KIND_LABEL = { character: "角色", scene: "环境", prop: "道具", image: "素材" };
type AssetKind = keyof typeof KIND_LABEL;
type Reference = DramaSegment["request"]["references"][number];

function moved<T>(items: T[], from: number, to: number) {
    const result = [...items];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}

function castName(cast: DramaCast) {
    return `${cast.name}${cast.lookName ? ` · ${cast.lookName}` : ""}`;
}

/** 分组只改变展示；保存的 ID 顺序仍是提示词编号和模型发送顺序。 */
export function ReferenceBoard({
    projectId,
    segment,
    shots,
    castById,
    busy: saving,
    onSave,
    onOpenCast,
    onOpenAssets,
}: {
    projectId: string;
    segment: DramaSegment;
    shots: DramaShot[];
    castById: Map<string, DramaCast>;
    busy: boolean;
    onSave: (patch: DramaSegmentReferencePatch) => Promise<unknown>;
    onOpenCast: (id: string) => void;
    onOpenAssets: () => void;
}) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [menuOpen, setMenuOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [projectSource, setProjectSource] = useState<"project" | "episode" | null>(null);
    const [uploading, setUploading] = useState(false);
    const [addingImage, setAddingImage] = useState(false);
    const [uploadDraft, setUploadDraft] = useState<{ resourceId: string; name: string }>();
    const [voiceDraft, setVoiceDraft] = useState<string[] | null>(null);
    const [preview, setPreview] = useState<{ resourceId: string; name: string }>();
    const fileRef = useRef<HTMLInputElement>(null);
    const busy = saving || uploading || addingImage;
    const openPreview = (image: { resourceId: string; name: string }) => {
        setMenuOpen(false);
        setPreview(image);
    };
    const { request } = segment;
    const ids = request.references.filter((ref) => ref.castId).map((ref) => ref.castId);
    const images = request.references.filter((ref) => !ref.castId && ref.resourceId).map((ref) => ({ resourceId: ref.resourceId!, name: ref.name }));
    const refsById = new Map(request.references.filter((ref) => ref.castId).map((ref) => [ref.castId, ref]));
    const selectedVoices = voiceDraft ?? (request.audioReferences || []).map((voice) => voice.castId);
    const audioLimit = request.modelMaxAudios || 0;
    const save = (patch: DramaSegmentReferencePatch) => {
        // 父层 mutation 显示错误；失败后保留服务端选择和本地尚未保存的音色。
        void onSave(patch).catch(() => {});
    };
    const saveIDs = (next: string[]) => save({ referenceCastIds: next });
    const toggleCast = (cast: DramaCast) => {
        if (ids.includes(cast.id)) saveIDs(ids.filter((id) => id !== cast.id));
        else {
            const last = ids.findLastIndex((id) => castById.get(id)?.kind === cast.kind);
            const next = [...ids];
            next.splice(last < 0 ? next.length : last + 1, 0, cast.id);
            saveIDs(next);
        }
    };
    const addImage = async (resourceId: string, name: string, asset?: ReferenceImageAsset) => {
        if (!projectId || !resourceId) throw new Error("项目或图片信息缺失，请刷新后重试");
        setAddingImage(true);
        try {
            await linkProjectAsset(projectId, { assetId: asset?.assetId || resourceId, category: asset?.category || "material", title: name, source: "uploaded" });
            void queryClient.invalidateQueries({ queryKey: ["project-asset-picker", projectId] });
            if (request.references.some((ref) => ref.resourceId === resourceId)) {
                message.info("本段已添加这张参考图");
                return;
            }
            await onSave({ referenceImages: [...images, { resourceId, name }] });
        } finally {
            setAddingImage(false);
        }
    };
    const upload = async (file: File) => {
        if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
            message.error("请选择不超过 20 MB 的图片");
            return;
        }
        setUploading(true);
        try {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            const draft = { resourceId: resource.id, name: file.name.replace(/\.[^.]+$/, "") };
            setUploadDraft(draft);
            await addImage(draft.resourceId, draft.name);
            setUploadDraft(undefined);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加参考图失败");
        } finally {
            setUploading(false);
        }
    };

    const activeKinds = [...new Set(ids.map((id) => castById.get(id)?.kind).filter((kind): kind is DramaCast["kind"] => Boolean(kind)))];
    const groupOrder = [...activeKinds, ...ASSET_KINDS.filter((kind) => !activeKinds.includes(kind))];
    const groupedIDs = (kind: DramaCast["kind"]) => ids.filter((id) => castById.get(id)?.kind === kind);
    const moveGroup = (kind: DramaCast["kind"], direction: number) => {
        const index = activeKinds.indexOf(kind);
        saveIDs(moved(activeKinds, index, index + direction).flatMap(groupedIDs));
    };
    const moveCast = (cast: DramaCast, direction: number) => {
        const group = groupedIDs(cast.kind);
        const reordered = moved(group, group.indexOf(cast.id), group.indexOf(cast.id) + direction);
        saveIDs(activeKinds.flatMap((kind) => (kind === cast.kind ? reordered : groupedIDs(kind))));
    };

    const visible = new Set(ids);
    for (const shot of shots) {
        for (const id of [...parseList(shot.castIdsJson), ...parseList(shot.lookCastIdsJson), ...parseList(shot.propIdsJson), shot.sceneCastId || ""]) {
            if (id) visible.add(id);
        }
    }
    // 没选参考图的说话人仍需保留人物卡，让音色可以独立关闭。
    for (const id of new Set([...selectedVoices, ...(request.audioReferences || []).map((voice) => voice.castId)])) {
        if (!ids.some((castId) => (castById.get(castId)?.parentId || castId) === id)) visible.add(id);
    }
    for (const id of visible) {
        const parentId = castById.get(id)?.parentId;
        if (parentId && !ids.includes(parentId)) visible.delete(parentId);
    }
    const voiceControls = (cast: DramaCast) => {
        const character = cast.parentId ? castById.get(cast.parentId) : cast;
        if (!character || character.kind !== "character") return null;
        const selected = selectedVoices.includes(character.id);
        const audio = request.audioReferences?.find((voice) => voice.castId === character.id);
        return (
            <div className="drama-sdx-asset-voice" aria-label={`${character.name}音色`}>
                <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "关闭" : "开启"}${character.name}的音色`}
                    disabled={busy || (!selected && (!character.voiceSampleResourceId || selectedVoices.length >= audioLimit))}
                    onClick={() => setVoiceDraft(selected ? selectedVoices.filter((id) => id !== character.id) : [...selectedVoices, character.id])}
                >
                    {selected ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}音色{selected ? "已开启" : "已关闭"}
                </button>
                <CastVoicePreview resourceId={character.voiceSampleResourceId} name={character.name} />
                <small>{voiceDraft !== null ? "音色调整未保存" : audio ? (audio.sent ? `${audio.label} · 随请求发送` : audio.note) : !character.voiceSampleResourceId ? "请在角色设定中绑定音频" : cast.parentId ? "沿用角色本体音色" : ""}</small>
            </div>
        );
    };
    const renderCast = (cast: DramaCast) => {
        const ref = refsById.get(cast.id);
        const group = groupedIDs(cast.kind);
        const index = group.indexOf(cast.id);
        return (
            <AssetCard
                key={cast.id}
                name={castName(cast)}
                kind={KIND_LABEL[cast.kind]}
                assetKind={cast.kind}
                resourceId={ref?.resourceId || cast.imageResourceId}
                badge={ref?.label}
                checked={Boolean(ref)}
                disabled={busy}
                note={ref ? (ref.sent ? "随请求发送" : `未附图：${referenceMissingReason(segment, cast, ref.resourceId)}`) : "未选用参考图"}
                onToggle={() => toggleCast(cast)}
                onOpen={() => onOpenCast(cast.id)}
                onPreview={openPreview}
                onRaise={index > 0 ? () => moveCast(cast, -1) : undefined}
                onLower={index >= 0 && index < group.length - 1 ? () => moveCast(cast, 1) : undefined}
            >
                {voiceControls(cast)}
            </AssetCard>
        );
    };
    const renderImage = (ref: Reference) => {
        const index = images.findIndex((image) => image.resourceId === ref.resourceId);
        return (
            <AssetCard
                key={ref.resourceId}
                name={ref.name}
                kind={KIND_LABEL.image}
                assetKind="image"
                resourceId={ref.resourceId}
                badge={ref.label}
                checked
                disabled={busy}
                note={ref.sent ? "随请求发送" : `未附图：${referenceMissingReason(segment, undefined, ref.resourceId)}`}
                onToggle={() => save({ referenceImages: images.filter((image) => image.resourceId !== ref.resourceId) })}
                onPreview={openPreview}
                onRaise={index > 0 ? () => save({ referenceImages: moved(images, index, index - 1) }) : undefined}
                onLower={index < images.length - 1 ? () => save({ referenceImages: moved(images, index, index + 1) }) : undefined}
            />
        );
    };
    const first = segment.index === 0 && !request.firstFrameResourceId && !request.firstFramePending;
    const voiceActions = (
        <>
            {segment.audioReferenceMode === "custom" ? (
                <Button size="small" type="text" disabled={busy || voiceDraft !== null} onClick={() => save({ autoAudioReferences: true })}>
                    恢复自动音色
                </Button>
            ) : null}
            {voiceDraft !== null ? (
                <>
                    <Button
                        size="small"
                        disabled={busy || selectedVoices.length > audioLimit}
                        onClick={() => {
                            void onSave({ audioCastIds: selectedVoices })
                                .then(() => setVoiceDraft(null))
                                .catch(() => {});
                        }}
                    >
                        保存音色选择
                    </Button>
                    <Button size="small" type="text" disabled={busy} onClick={() => setVoiceDraft(null)}>
                        取消调整
                    </Button>
                </>
            ) : null}
        </>
    );
    return (
        <section className="drama-sdx-section" aria-label="本段参考资产">
            <div className="drama-sdx-section-head">
                <strong>本段资产</strong>
                <span className="drama-sdx-count">
                    {request.references.length} 项 · 随请求发送 {request.references.filter((ref) => ref.sent).length} 张
                </span>
                <small>
                    {segment.referenceMode === "custom" ? "手动指定" : "按镜头自动取"} · 本段最多发送 {request.referenceCapacity} 张{request.modelMaxImages ? ` · 模型上限 ${request.modelMaxImages} 张（含首帧）` : ""}
                </small>
                {segment.referenceMode === "custom" ? (
                    <Button size="small" type="text" disabled={busy} icon={<RotateCcw className="size-3.5" />} onClick={() => save({ autoReferences: true })}>
                        恢复自动参考
                    </Button>
                ) : null}
            </div>
            <div className="drama-sdx-assets-foot">
                <Button size="small" icon={<Library className="size-3.5" />} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
                    项目资产窗口
                </Button>
                <AppDrawer
                    open={menuOpen}
                    onClose={() => setMenuOpen(false)}
                    title="项目资产 · 选择本段参考"
                    size="min(1040px, 100vw)"
                    rootClassName="drama-root drama-asset-drawer"
                    extra={
                        <Button
                            onClick={() => {
                                setMenuOpen(false);
                                onOpenAssets();
                            }}
                        >
                            按集核查
                        </Button>
                    }
                >
                    <AssetMenu
                        casts={[...castById.values()]}
                        images={request.references.filter((ref) => !ref.castId)}
                        ids={ids}
                        busy={busy}
                        renderCast={renderCast}
                        renderImage={renderImage}
                        voiceActions={
                            voiceDraft !== null ? (
                                <>
                                    <small>
                                        音色 {selectedVoices.length}/{audioLimit}
                                    </small>
                                    {voiceActions}
                                </>
                            ) : null
                        }
                        onLibrary={() => {
                            setMenuOpen(false);
                            setLibraryOpen(true);
                        }}
                        onUpload={() => fileRef.current?.click()}
                        onProject={(source) => {
                            setMenuOpen(false);
                            setProjectSource(source);
                        }}
                    />
                </AppDrawer>
                <Button size="small" icon={<Library className="size-3.5" />} disabled={busy} onClick={() => setLibraryOpen(true)}>
                    从素材库导入
                </Button>
                <Button size="small" icon={<Upload className="size-3.5" />} loading={uploading} disabled={busy} onClick={() => fileRef.current?.click()}>
                    上传图片
                </Button>
                <Button size="small" type="text" onClick={onOpenAssets}>
                    按集核查
                </Button>
            </div>
            {uploadDraft && !busy ? (
                <div className="drama-sdx-assets-foot" role="status">
                    <span>「{uploadDraft.name}」尚未添加到本段</span>
                    <Button
                        size="small"
                        onClick={() => {
                            void addImage(uploadDraft.resourceId, uploadDraft.name)
                                .then(() => setUploadDraft(undefined))
                                .catch((error) => message.error(error instanceof Error ? error.message : "添加参考图失败"));
                        }}
                    >
                        重试添加
                    </Button>
                    <Button size="small" type="text" onClick={() => setUploadDraft(undefined)}>
                        取消添加
                    </Button>
                </div>
            ) : null}
            {request.references.length ? (
                <div className="drama-reference-strip" aria-label="本段资产预览">
                    {request.references.map((ref) => {
                        const cast = castById.get(ref.castId);
                        const resourceId = ref.resourceId || cast?.imageResourceId;
                        const name = cast ? castName(cast) : ref.name;
                        return (
                            <button
                                type="button"
                                key={ref.castId || ref.resourceId || ref.label}
                                className="drama-reference-tile"
                                data-asset-kind={ref.kind}
                                disabled={!resourceId}
                                aria-label={`${name} · ${ref.label} · ${ref.sent ? "随请求发送" : "未附图"}`}
                                title={ref.sent ? `放大查看${name}` : referenceMissingReason(segment, cast, ref.resourceId)}
                                onClick={() => resourceId && openPreview({ resourceId, name })}
                            >
                                <span className="drama-reference-tile-image">
                                    <MediaThumb resourceId={resourceId} alt={name} fallback={<Library className="size-5" />} />
                                </span>
                                <strong>{name}</strong>
                                <span>
                                    <span className="drama-asset-kind">{KIND_LABEL[ref.kind]}</span>
                                    <span>{ref.label}</span>
                                </span>
                                {!ref.sent ? <small>未附图</small> : null}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <p className="drama-sdx-hint">本段尚未选择参考资产。打开项目资产窗口，或导入已有图片。</p>
            )}
            <div className="drama-sdx-frame-note">
                {request.firstFrameResourceId ? (
                    <button type="button" aria-label="预览上一段尾帧" onClick={() => setPreview({ resourceId: request.firstFrameResourceId!, name: "上一段尾帧" })}>
                        <MediaThumb resourceId={request.firstFrameResourceId} alt="上一段尾帧" />
                    </button>
                ) : null}
                <span>{first ? "开场段：无首帧，按提示词与参考图生成" : request.firstFrameResourceId ? `首帧：第 ${segment.index} 段尾帧` : `首帧：等待第 ${segment.index} 段视频生成`}</span>
            </div>
            <details className="drama-reference-settings">
                <summary>参考顺序与角色音色{voiceDraft !== null ? " · 音色调整未保存" : ""}</summary>
                {groupOrder.map((kind) => {
                    const group = [...ids.map((id) => castById.get(id)).filter((cast): cast is DramaCast => Boolean(cast)), ...[...castById.values()].filter((cast) => visible.has(cast.id) && !ids.includes(cast.id))].filter((cast) => cast.kind === kind);
                    const index = activeKinds.indexOf(kind);
                    return (
                        <section className="drama-sdx-asset-group" aria-label={`${KIND_LABEL[kind]}参考`} key={kind}>
                            <div className="drama-sdx-group-head">
                                <strong className="drama-asset-kind" data-asset-kind={kind}>
                                    {KIND_LABEL[kind]}
                                </strong>
                                <small>{groupedIDs(kind).length} 个参考</small>
                                <Button size="small" type="text" disabled={busy || index <= 0} aria-label={`提前${KIND_LABEL[kind]}分组`} icon={<ArrowUp className="size-3.5" />} onClick={() => moveGroup(kind, -1)} />
                                <Button size="small" type="text" disabled={busy || index < 0 || index === activeKinds.length - 1} aria-label={`后移${KIND_LABEL[kind]}分组`} icon={<ArrowDown className="size-3.5" />} onClick={() => moveGroup(kind, 1)} />
                            </div>
                            {kind === "character" ? (
                                <div className="drama-sdx-assets-foot">
                                    <small>
                                        音色 {selectedVoices.length}/{audioLimit} · {segment.audioReferenceMode === "custom" ? "手动选择" : "按对白自动开启"} · {audioLimit ? `当前模型音色不可多于 ${audioLimit} 个` : "当前模型不支持参考音色"}
                                    </small>
                                    {voiceActions}
                                </div>
                            ) : null}
                            {kind === "character" && selectedVoices.length > audioLimit ? <p className="drama-sdx-hint is-error">已选音色超过模型上限，请在人物卡片下关闭部分音色后保存。</p> : null}
                            {group.length ? <div className="drama-sdx-assets">{group.map(renderCast)}</div> : <p className="drama-sdx-hint">暂无{KIND_LABEL[kind]}参考，可在项目资产窗口中搜索添加。</p>}
                        </section>
                    );
                })}
                {images.length ? (
                    <section className="drama-sdx-asset-group" aria-label="附加图片参考">
                        <div className="drama-sdx-group-head">
                            <strong>附加图片</strong>
                            <small>排在设定参考之后</small>
                        </div>
                        <div className="drama-sdx-assets">{request.references.filter((ref) => !ref.castId).map(renderImage)}</div>
                    </section>
                ) : null}
                <small className="drama-sdx-hint">顺序变化会更新参考图编号。模型撰写的提示词需重新撰写；手写提示词请核对编号。</small>
            </details>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                }}
            />
            <CastLibraryPicker open={libraryOpen} cast={{ kind: "character", name: segment.title }} segment onClose={() => setLibraryOpen(false)} onPick={addImage} />
            {projectSource === "project" ? <ProjectReferencePicker projectId={projectId} onClose={() => setProjectSource(null)} onPick={addImage} /> : null}
            {projectSource === "episode" ? <EpisodeReferencePicker projectId={projectId} onClose={() => setProjectSource(null)} onPick={addImage} /> : null}
            {preview ? <CanvasImagePreview storageKey={`resource:${preview.resourceId}`} alt={preview.name} onClose={() => setPreview(undefined)} /> : null}
        </section>
    );
}

/** 二级资产菜单保留已选项；搜索角色名、别名或造型名后可直接添加或移除。 */
function AssetMenu({
    casts,
    images,
    ids,
    busy,
    renderCast,
    renderImage,
    voiceActions,
    onLibrary,
    onUpload,
    onProject,
}: {
    casts: DramaCast[];
    images: Reference[];
    ids: string[];
    busy: boolean;
    renderCast: (cast: DramaCast) => ReactNode;
    renderImage: (ref: Reference) => ReactNode;
    voiceActions: ReactNode;
    onLibrary: () => void;
    onUpload: () => void;
    onProject: (source: "project" | "episode") => void;
}) {
    const [kind, setKind] = useState<AssetKind | "all">("all");
    const [query, setQuery] = useState("");
    const needle = query.trim().toLocaleLowerCase();
    const matches = (text: string) => text.toLocaleLowerCase().includes(needle);
    const filteredCasts = casts.filter((cast) => (kind === "all" || cast.kind === kind) && matches(`${castName(cast)} ${parseList(cast.aliasesJson).join(" ")}`));
    const filteredImages = kind === "all" || kind === "image" ? images.filter((ref) => matches(ref.name)) : [];
    return (
        <div className="drama-root drama-sdx-asset-menu" aria-label="搜索参考资产">
            <Input allowClear value={query} prefix={<Search className="size-3.5" />} placeholder="搜索人物、别名、造型、场景或道具" aria-label="搜索资产" onChange={(event) => setQuery(event.target.value)} />
            <SegmentedControl<AssetKind | "all">
                ariaLabel="资产分类"
                value={kind}
                onChange={setKind}
                options={(["all", ...ASSET_KINDS, "image"] as const).map((value) => ({
                    value,
                    label: (
                        <>
                            <span data-asset-kind={value === "all" ? undefined : value} className={value === "all" ? undefined : "drama-asset-kind"}>
                                {value === "all" ? "全部" : KIND_LABEL[value]}
                            </span>
                            <span className="app-segmented-count">{value === "all" ? casts.length + images.length : value === "image" ? images.length : casts.filter((cast) => cast.kind === value).length}</span>
                        </>
                    ),
                }))}
            />
            <div className="drama-sdx-asset-menu-results">
                {filteredCasts.map(renderCast)}
                {filteredImages.map(renderImage)}
                {!filteredCasts.length && !filteredImages.length ? <p className="drama-sdx-hint">没有匹配的资产，请更换关键词或从素材库添加。</p> : null}
            </div>
            <div className="drama-sdx-assets-foot">
                <small>已添加 {ids.length + images.length} 项 · 点击卡片按钮添加或移除</small>
                <Button size="small" disabled={busy} onClick={() => onProject("project")}>
                    从本项目导入
                </Button>
                <Button size="small" disabled={busy} onClick={() => onProject("episode")}>
                    从分集图片导入
                </Button>
                <Button size="small" disabled={busy} onClick={onLibrary}>
                    从素材库导入
                </Button>
                <Button size="small" disabled={busy} onClick={onUpload}>
                    上传参考图
                </Button>
            </div>
            {voiceActions ? <div className="drama-sdx-assets-foot">{voiceActions}</div> : null}
        </div>
    );
}

function AssetCard({
    name,
    kind,
    assetKind,
    resourceId,
    badge,
    checked,
    disabled,
    note,
    onToggle,
    onOpen,
    onPreview,
    onRaise,
    onLower,
    children,
}: {
    name: string;
    kind: string;
    assetKind: AssetKind;
    resourceId?: string;
    badge?: string;
    checked: boolean;
    disabled: boolean;
    note: string;
    onToggle: () => void;
    onOpen?: () => void;
    onPreview: (image: { resourceId: string; name: string }) => void;
    onRaise?: () => void;
    onLower?: () => void;
    children?: ReactNode;
}) {
    return (
        <article className={`drama-sdx-asset ${checked ? "is-checked" : ""}`} data-asset-kind={assetKind} aria-label={`${name}资产`}>
            <button
                type="button"
                className="drama-sdx-asset-thumb"
                disabled={!resourceId}
                aria-label={`放大预览${name}`}
                onClick={() => {
                    if (resourceId) onPreview({ resourceId, name });
                }}
            >
                <MediaThumb resourceId={resourceId} alt={name} fallback={<span>{resourceId ? "图片暂不可用" : `暂无${kind}图片`}</span>} />
                {badge ? <em>{badge}</em> : null}
                {resourceId ? <ZoomIn className="drama-sdx-asset-zoom size-4" /> : null}
            </button>
            {onOpen ? (
                <button type="button" className="drama-sdx-asset-text" onClick={onOpen} aria-label={`查看${name}设定`}>
                    <b>{name}</b>
                </button>
            ) : (
                <strong className="drama-sdx-asset-text">{name}</strong>
            )}
            <span className="drama-asset-kind">{kind}</span>
            <small className="drama-sdx-asset-note">{note}</small>
            <div className="drama-sdx-asset-actions">
                <Button
                    size="small"
                    type="text"
                    icon={checked ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                    disabled={disabled}
                    aria-pressed={checked}
                    aria-label={checked ? `移除参考图${name}` : `添加参考图${name}`}
                    onClick={onToggle}
                >
                    {checked ? "已引用" : "引用到本段"}
                </Button>
                {checked ? (
                    <>
                        <Button size="small" type="text" disabled={disabled || !onRaise} icon={<ArrowUp className="size-3.5" />} aria-label={`提前${name}`} onClick={onRaise} />
                        <Button size="small" type="text" disabled={disabled || !onLower} icon={<ArrowDown className="size-3.5" />} aria-label={`后移${name}`} onClick={onLower} />
                    </>
                ) : null}
            </div>
            {children}
        </article>
    );
}
