import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, InputNumber } from "antd";
import { AlertCircle, Check, Pencil, Plus, Shirt, Trash2, X } from "lucide-react";

import { addDramaCastLook, deleteDramaCastLook, updateDramaCastLook, type DramaCast } from "@/services/api/drama";

import { mediaBusy, MediaThumb } from "../drama-shared";

const MAX_LOOKS = 6;

function chapterLabel(from?: number, to?: number) {
    if (from && to) return `第 ${from}–${to} 章`;
    if (from) return `第 ${from} 章起`;
    if (to) return `第 ${to} 章前`;
    return "不限章节";
}

/** 一套造型的编辑表单（新增或修改共用）。 */
function LookForm({ initial, submitting, onCancel, onSubmit }: { initial?: DramaCast; submitting: boolean; onCancel: () => void; onSubmit: (value: { lookName: string; appearance: string; fromChapter?: number; toChapter?: number }) => void }) {
    const [name, setName] = useState(initial?.lookName || "");
    const [appearance, setAppearance] = useState(initial?.appearance || "");
    const [from, setFrom] = useState<number | null>(initial?.lookFromChapter || null);
    const [to, setTo] = useState<number | null>(initial?.lookToChapter || null);
    const valid = name.trim() && appearance.trim();
    return (
        <div className="drama-look-form">
            <Input value={name} maxLength={60} placeholder="造型名，如 外门弟子、霸道总裁" aria-label="造型名" onChange={(event) => setName(event.target.value)} />
            <Input.TextArea value={appearance} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="这套造型的服装、发型与妆容；五官脸型沿用角色本体" aria-label="造型外观" onChange={(event) => setAppearance(event.target.value)} />
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
                    onClick={() => onSubmit({ lookName: name.trim(), appearance: appearance.trim(), fromChapter: from ?? 0, toChapter: to ?? 0 })}
                >
                    保存
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
    const { message } = App.useApp();
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string>();
    const done = (text: string, affected?: number) => {
        message.success(affected ? `${text}；${affected} 个剧情段的视频需重新生成` : text);
        setAdding(false);
        setEditingId(undefined);
        onChanged();
    };
    const add = useMutation({
        mutationFn: (value: { lookName: string; appearance: string; fromChapter?: number; toChapter?: number }) => addDramaCastLook(projectId, character.id, value),
        onSuccess: () => done("已添加造型，正在以角色形象为底图生成参考图"),
        onError: (error) => message.error(error instanceof Error ? error.message : "添加失败"),
    });
    const update = useMutation({
        mutationFn: ({ id, value }: { id: string; value: { lookName: string; appearance: string; fromChapter?: number; toChapter?: number } }) => updateDramaCastLook(projectId, id, { ...value, restyleSegments: restyle }),
        onSuccess: (result) => done("已更新造型", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "更新失败"),
    });
    const remove = useMutation({
        mutationFn: (id: string) => deleteDramaCastLook(projectId, id, restyle),
        onSuccess: (result) => done("已删除造型，引用它的镜头回到角色本体", result.affectedSegments),
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });
    const busy = add.isPending || update.isPending || remove.isPending;
    return (
        <div className="drama-field">
            <div className="drama-field-label">
                <span>造型 · 妆造</span>
                <small>
                    不同时期 / 身份的服装妆造；最多 {MAX_LOOKS} 套（{looks.length}/{MAX_LOOKS}）
                </small>
            </div>
            <div className="drama-looks">
                {looks.map((look) =>
                    editingId === look.id ? (
                        <LookForm key={look.id} initial={look} submitting={update.isPending} onCancel={() => setEditingId(undefined)} onSubmit={(value) => update.mutate({ id: look.id, value })} />
                    ) : (
                        <div key={look.id} className="drama-look">
                            <span className="drama-look-thumb">
                                {look.imageResourceId ? <MediaThumb resourceId={look.imageResourceId} alt={look.lookName || "造型"} /> : <Shirt className="size-4 opacity-40" />}
                                {mediaBusy(look.imageStatus) ? <span className="drama-look-busy" aria-label="参考图生成中" /> : null}
                                {look.imageStatus === "failed" ? <AlertCircle className="size-3.5 text-[var(--status-error)]" aria-label="参考图生成失败" /> : null}
                            </span>
                            <span className="drama-look-body">
                                <b className="truncate">{look.lookName || "未命名造型"}</b>
                                <small>{chapterLabel(look.lookFromChapter, look.lookToChapter)}</small>
                            </span>
                            <span className="drama-look-actions">
                                <Button size="small" type="text" icon={<Pencil className="size-3.5" />} aria-label={`编辑造型 ${look.lookName}`} disabled={busy} onClick={() => setEditingId(look.id)} />
                                <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} aria-label={`删除造型 ${look.lookName}`} disabled={busy} onClick={() => remove.mutate(look.id)} />
                            </span>
                        </div>
                    ),
                )}
                {adding ? (
                    <LookForm submitting={add.isPending} onCancel={() => setAdding(false)} onSubmit={(value) => add.mutate(value)} />
                ) : looks.length < MAX_LOOKS ? (
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={busy} onClick={() => setAdding(true)}>
                        添加造型
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
