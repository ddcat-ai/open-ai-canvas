import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, InputNumber } from "antd";
import { AlertCircle, Check, Pencil, Plus, Shirt, Trash2, X, Play, Upload, Library } from "lucide-react";

import { addDramaCastLook, deleteDramaCastLook, updateDramaCastLook, regenerateDramaCast, setDramaCastImage, updateDramaCast, type DramaCast, type DramaCastImageStyle } from "@/services/api/drama";
import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { CastImageFields, type CastImageFieldsValue } from "./cast-image-fields";
import { uploadResourceFile } from "@/services/api/resources";
import { CastLibraryPicker } from "./cast-library-picker";

import { mediaBusy, MediaThumb } from "../drama-shared";

const MAX_LOOKS = 6;
type LookInput = DramaCastImageStyle & { lookName: string; appearance: string; imagePrompt: string; fromChapter?: number; toChapter?: number };

function chapterLabel(from?: number, to?: number) {
    if (from && to) return `第 ${from}–${to} 章`;
    if (from) return `第 ${from} 章起`;
    if (to) return `第 ${to} 章前`;
    return "不限章节";
}

/** 一套造型的编辑表单（新增或修改共用）。 */
function LookForm({ projectId, initial, submitting, onCancel, onSubmit }: { projectId: string; initial?: DramaCast; submitting: boolean; onCancel: () => void; onSubmit: (value: LookInput) => void }) {
    const [name, setName] = useState(initial?.lookName || "");
    const [appearance, setAppearance] = useState(initial?.appearance || "");
    const [imageFields, setImageFields] = useState<CastImageFieldsValue>({
        imagePrompt: initial?.imagePrompt || "",
        imageStyleId: initial?.imageStyleId || "",
        imageStyleName: initial?.imageStyleName || "",
        imageStylePrompt: initial?.imageStylePrompt || "",
    });
    const [from, setFrom] = useState<number | null>(initial?.lookFromChapter || null);
    const [to, setTo] = useState<number | null>(initial?.lookToChapter || null);
    const valid = name.trim() && appearance.trim();
    return (
        <div className="drama-look-form">
            <Input value={name} maxLength={60} placeholder="造型名，如 外门弟子、霸道总裁" aria-label="造型名" onChange={(event) => setName(event.target.value)} />
            <Input.TextArea value={appearance} maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="这套造型的服装、发型与妆容；五官脸型沿用角色本体" aria-label="造型外观" onChange={(event) => setAppearance(event.target.value)} />
            <CastImageFields projectId={projectId} castId={initial?.id} appearance={appearance} value={imageFields} disabled={submitting} onChange={(patch) => setImageFields((current) => ({ ...current, ...patch }))} />
            <small>以角色本体图保持人物一致。确认只保存设定，点击“生成造型图”才调用模型。</small>
            <div className="drama-look-form-range">
                <span>默认适用</span>
                <InputNumber size="small" min={0} precision={0} value={from} placeholder="起始章" aria-label="起始章" onChange={(value) => setFrom(value)} />
                <span>至</span>
                <InputNumber size="small" min={0} precision={0} value={to} placeholder="结束章" aria-label="结束章" onChange={(value) => setTo(value)} />
                <small>0 或留空表示该端不限；对应章节的分集默认用这套造型</small>
            </div>
            <div className="drama-look-form-actions">
                <Button size="small" icon={<X className="size-3.5" />} onClick={onCancel}>
                    取消
                </Button>
                <Button
                    size="small"
                    type="primary"
                    icon={<Check className="size-3.5" />}
                    loading={submitting}
                    disabled={!valid}
                    onClick={() => onSubmit({ ...imageFields, lookName: name.trim(), appearance: appearance.trim(), imagePrompt: (imageFields.imagePrompt || "").trim(), fromChapter: from ?? 0, toChapter: to ?? 0 })}
                >
                    确认保存
                </Button>
            </div>
        </div>
    );
}

/**
 * 角色造型（多妆造）：一个角色可有多套造型（如散修 / 外门弟子 / 内门弟子 / 长老），每套有自己的外观与参考图，
 * 以角色本体参考图为底图生成以保持同一张脸。写剧本时按本集章节选默认造型，AI 也会按剧情在镜头里换造型。
 */
export function CastLooks({ projectId, character, looks, restyle, onChanged }: { projectId: string; character: DramaCast; looks: DramaCast[]; restyle: boolean; onChanged: () => void }) {
    const { message, modal } = App.useApp();
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string>();
    const [libraryLook, setLibraryLook] = useState<DramaCast>();
    const [previewLook, setPreviewLook] = useState<DramaCast>();
    const fileRef = useRef<HTMLInputElement>(null);
    const uploadLookRef = useRef<DramaCast | undefined>(undefined);
    const done = (text: string, affected?: number) => {
        message.success(affected ? `${text}；${affected} 个剧情段的视频需重新生成` : text);
        setAdding(false);
        setEditingId(undefined);
        onChanged();
    };
    const add = useMutation({
        mutationFn: (value: LookInput) => addDramaCastLook(projectId, character.id, value),
        onSuccess: () => done("造型已保存，可上传自定义图或单独生成造型图"),
        onError: (error) => message.error(error instanceof Error ? error.message : "添加失败"),
    });
    const update = useMutation({
        mutationFn: ({ id, value }: { id: string; value: LookInput }) => updateDramaCastLook(projectId, id, { ...value, restyleSegments: restyle }),
        onSuccess: (result) => done("已更新造型", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const remove = useMutation({
        mutationFn: (id: string) => deleteDramaCastLook(projectId, id, restyle),
        onSuccess: (result) => done("已删除造型，引用它的镜头回到角色本体", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });
    const generate = useMutation({
        mutationFn: async (look: DramaCast) => {
            if (look.locked) await updateDramaCast(projectId, look.id, { locked: false });
            return regenerateDramaCast(projectId, look.id, restyle);
        },
        onSuccess: (result) => done("已请求生成造型图", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "生成失败"),
    });
    const upload = useMutation({
        mutationFn: async ({ look, file }: { look: DramaCast; file: File }) => {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            return setDramaCastImage(projectId, look.id, resource.id, restyle);
        },
        onSuccess: (result) => done("自定义造型图已保存并锁定", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "上传失败"),
    });
    const busy = add.isPending || update.isPending || remove.isPending || generate.isPending || upload.isPending;
    return (
        <div className="drama-field">
            <div className="drama-field-label">
                <span>造型 · 妆造</span>
                <small>
                    角色本体即基础造型；额外妆造最多 {MAX_LOOKS} 套（{looks.length}/{MAX_LOOKS}）
                </small>
            </div>
            <div className="drama-looks">
                {looks.map((look) =>
                    editingId === look.id ? (
                        <LookForm projectId={projectId} key={look.id} initial={look} submitting={update.isPending} onCancel={() => setEditingId(undefined)} onSubmit={(value) => update.mutate({ id: look.id, value })} />
                    ) : (
                        <div key={look.id} className="drama-look-item">
                            <div className="drama-look">
                                <button type="button" className="drama-look-thumb" disabled={!look.imageResourceId} aria-label={`放大查看${look.lookName || "造型"}的参考图`} onClick={() => setPreviewLook(look)}>
                                    {look.imageResourceId ? <MediaThumb resourceId={look.imageResourceId} alt={look.lookName || "造型"} /> : <Shirt className="size-4 opacity-40" />}
                                    {mediaBusy(look.imageStatus) ? <span className="drama-look-busy" aria-label="参考图生成中" /> : null}
                                    {look.imageStatus === "failed" ? <AlertCircle className="size-3.5 text-[var(--status-error)]" aria-label="参考图生成失败" /> : null}
                                </button>
                                <span className="drama-look-body">
                                    <b className="truncate">{look.lookName || "未命名造型"}</b>
                                    <small>{chapterLabel(look.lookFromChapter, look.lookToChapter)}</small>
                                    <small>
                                        {look.imageStatus === "draft"
                                            ? "已保存，待生成或上传"
                                            : look.imageStatus === ""
                                              ? "还没有造型图，点右侧生成或上传"
                                              : look.imageStatus === "failed"
                                                ? "造型图失败，可重试生成"
                                                : look.locked
                                                  ? "自定义图已锁定"
                                                  : look.imagePrompt
                                                    ? "使用自定义提示词"
                                                    : "按外观描述生成"}
                                    </small>
                                </span>
                                <span className="drama-look-actions">
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={<Play className="size-3.5" />}
                                        loading={generate.isPending && generate.variables?.id === look.id}
                                        disabled={busy || mediaBusy(look.imageStatus) || character.imageStatus !== "ready" || !character.imageResourceId}
                                        title={!character.imageResourceId || character.imageStatus !== "ready" ? "请先生成或上传角色本体参考图，造型图需要以它为底图" : look.imageResourceId ? "按已保存提示词重新生成造型图" : "生成这套造型的参考图"}
                                        aria-label={`${look.imageResourceId ? "重新生成" : "生成"}造型图 ${look.lookName || ""}`}
                                        onClick={() => {
                                            if (look.locked) modal.confirm({ title: "重新生成造型图？", content: "将解锁当前自定义图，并按已保存的提示词生成新图。", okText: "解锁并生成", cancelText: "取消", onOk: () => generate.mutateAsync(look) });
                                            else generate.mutate(look);
                                        }}
                                    >
                                        {look.imageResourceId ? "重新生成" : "生成造型图"}
                                    </Button>
                                    <Button size="small" type="text" icon={<Pencil className="size-3.5" />} aria-label={`编辑造型 ${look.lookName}`} disabled={busy || mediaBusy(look.imageStatus)} onClick={() => setEditingId(look.id)} />
                                    <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} aria-label={`删除造型 ${look.lookName}`} disabled={busy} onClick={() => remove.mutate(look.id)} />
                                </span>
                            </div>
                            <div className="drama-look-form-actions">
                                <Button size="small" icon={<Library className="size-3.5" />} disabled={busy || mediaBusy(look.imageStatus)} onClick={() => setLibraryLook(look)}>
                                    素材库
                                </Button>
                                <Button
                                    size="small"
                                    icon={<Upload className="size-3.5" />}
                                    disabled={busy || mediaBusy(look.imageStatus)}
                                    onClick={() => {
                                        uploadLookRef.current = look;
                                        fileRef.current?.click();
                                    }}
                                >
                                    自定义图
                                </Button>
                            </div>
                        </div>
                    ),
                )}
                {adding ? (
                    <LookForm projectId={projectId} submitting={add.isPending} onCancel={() => setAdding(false)} onSubmit={(value) => add.mutate(value)} />
                ) : looks.length < MAX_LOOKS ? (
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={busy} onClick={() => setAdding(true)}>
                        添加造型
                    </Button>
                ) : null}
            </div>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    const look = uploadLookRef.current;
                    if (!file || !look) return;
                    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
                        message.error("请选择不超过 20 MB 的图片");
                        return;
                    }
                    modal.confirm({ title: `采用「${look.lookName}」的自定义图？`, content: "确认后保存并锁定这张图片，不调用模型生成。", okText: "确认保存", cancelText: "取消", onOk: () => upload.mutateAsync({ look, file }) });
                }}
            />
            {previewLook?.imageResourceId ? <CanvasImagePreview storageKey={`resource:${previewLook.imageResourceId}`} alt={previewLook.lookName || "造型"} onClose={() => setPreviewLook(undefined)} /> : null}
            {libraryLook ? (
                <CastLibraryPicker
                    open
                    cast={libraryLook}
                    onClose={() => setLibraryLook(undefined)}
                    onPick={async (resourceId) => {
                        const result = await setDramaCastImage(projectId, libraryLook.id, resourceId, restyle);
                        done("自定义造型图已保存并锁定", result.affectedSegments);
                    }}
                />
            ) : null}
        </div>
    );
}
