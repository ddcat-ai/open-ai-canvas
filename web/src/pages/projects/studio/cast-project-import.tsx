import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Checkbox, Select } from "antd";
import { Link2 } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { importDramaCast, listDramaCast, listDramas, type DramaCast } from "@/services/api/drama";
import { CAST_KIND_LABEL, MediaThumb } from "../drama-shared";

// 与服务端 production.NormalizeName 对齐，预览不能把空格或标点差异误报为新增。
const normalizeCastName = (value: string) => value.toLowerCase().replace(/[\p{White_Space}\p{P}]/gu, "");

export function CastProjectImport({ projectId, currentCast, onClose, onImported }: { projectId: string; currentCast: DramaCast[]; onClose: () => void; onImported: () => void }) {
    const { message } = App.useApp();
    const [search, setSearch] = useState("");
    const query = useDeferredValue(search.trim());
    const [sourceProjectId, setSourceProjectId] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [matchByName, setMatchByName] = useState(true);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const projects = useQuery({ queryKey: ["dramas", "cast-import", query], queryFn: ({ signal }) => listDramas({ page: 1, pageSize: 100, q: query || undefined }, signal) });
    const source = useQuery({ queryKey: dramaKeys.cast(sourceProjectId), queryFn: ({ signal }) => listDramaCast(sourceProjectId, signal), enabled: Boolean(sourceProjectId) });
    const bases = useMemo(() => source.data?.cast.filter((item) => !item.parentId) || [], [source.data]);
    const picked = bases.filter((item) => selected.has(item.id));
    const importAssets = useMutation({
        mutationFn: () => importDramaCast(projectId, { sourceProjectId, castIds: picked.map((item) => item.id), matchByName, replaceExisting }),
        onSuccess: (result) => {
            onImported();
            if (result.imported) {
                message.success(`已关联 ${result.imported} 项素材${result.skipped ? `，跳过 ${result.skipped} 项` : ""}`);
                onClose();
            } else message.info("所选素材已关联或已有参考图，本次没有替换；需要替换时请勾选下方选项");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "关联素材失败"),
    });
    const changeSource = (id: string) => {
        setSourceProjectId(id);
        setSelected(new Set());
        setReplaceExisting(false);
    };
    const toggle = (id: string, checked: boolean) =>
        setSelected((previous) => {
            const next = new Set(previous);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    const description = (item: DramaCast) => {
        if (currentCast.some((target) => target.sourceProjectId === sourceProjectId && target.sourceCastId === item.id)) return replaceExisting ? "已关联，将按来源更新设定与参考图" : "已关联，重复选择会跳过";
        const matches = matchByName ? currentCast.filter((target) => !target.parentId && target.kind === item.kind && normalizeCastName(target.name) === normalizeCastName(item.name)) : [];
        if (matches.length > 1) return "本作品有多个同名设定，请先区分名称";
        if (!matches.length) return "作为新设定加入";
        if (matches[0].imageResourceId && !replaceExisting) return "保留本作品已有参考图";
        return replaceExisting && matches[0].imageResourceId ? "替换同名设定参考图，旧图保留版本" : "补全本作品同名设定";
    };
    return (
        <AppModal
            open
            title="关联已有作品素材"
            rootClassName="drama-root"
            width={720}
            onCancel={() => !importAssets.isPending && onClose()}
            onOk={() => importAssets.mutate()}
            okText={`关联 ${picked.length} 个设定`}
            cancelText="取消"
            confirmLoading={importAssets.isPending}
            okButtonProps={{ disabled: !picked.length || source.isFetching || source.isError }}
            cancelButtonProps={{ disabled: importAssets.isPending }}
            maskClosable={!importAssets.isPending}
            closable={!importAssets.isPending}
        >
            <div className="drama-cast-form">
                <p className="drama-editor-note">选择第一季或其他作品的角色、场景、道具；角色造型会一并带入。参考图直接复用，不重新生成。新作品可独立编辑，原作品保持不变。</p>
                <Select
                    aria-label="素材来源作品"
                    placeholder="选择来源作品，可输入作品名搜索"
                    showSearch
                    filterOption={false}
                    onSearch={setSearch}
                    value={sourceProjectId || undefined}
                    onChange={changeSource}
                    loading={projects.isFetching}
                    disabled={importAssets.isPending}
                    options={projects.data?.items.filter((item) => item.project.id !== projectId).map((item) => ({ value: item.project.id, label: item.project.name }))}
                />
                {projects.isError ? (
                    <p role="alert">
                        读取作品失败。
                        <Button size="small" onClick={() => void projects.refetch()}>
                            重试
                        </Button>
                    </p>
                ) : null}
                {projects.data?.hasMore ? <small className="drama-editor-note">作品较多，请输入名称缩小范围。</small> : null}
                {sourceProjectId ? (
                    <>
                        {source.isPending ? (
                            <p role="status">正在读取来源作品素材…</p>
                        ) : source.isError ? (
                            <p role="alert">
                                读取素材失败。
                                <Button size="small" onClick={() => void source.refetch()}>
                                    重试
                                </Button>
                            </p>
                        ) : (
                            <>
                                <div className="drama-editor-row">
                                    <span>{bases.length} 个基础设定</span>
                                    <Button size="small" disabled={importAssets.isPending || !bases.length} onClick={() => setSelected(picked.length === bases.length ? new Set() : new Set(bases.map((item) => item.id)))}>
                                        {picked.length === bases.length && bases.length ? "取消全选" : "全选"}
                                    </Button>
                                </div>
                                <div className="drama-cast-import-list thin-scrollbar" role="group" aria-label="选择要关联的素材">
                                    {bases.map((item) => {
                                        const lookCount = source.data?.cast.filter((look) => look.parentId === item.id).length || 0;
                                        return (
                                            <div key={item.id} className="drama-cast-import-item">
                                                <Checkbox aria-label={`关联${item.name}`} checked={selected.has(item.id)} disabled={importAssets.isPending} onChange={(event) => toggle(item.id, event.target.checked)} />
                                                <span className="drama-cast-import-thumb">{item.imageResourceId ? <MediaThumb resourceId={item.imageResourceId} alt={item.name} /> : <Link2 className="size-5 opacity-40" />}</span>
                                                <span className="drama-cast-import-description">
                                                    <strong>
                                                        {item.name}{" "}
                                                        <small>
                                                            {CAST_KIND_LABEL[item.kind]}
                                                            {lookCount ? ` · ${lookCount} 套造型` : ""}
                                                        </small>
                                                    </strong>
                                                    <small>{description(item)}</small>
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {!bases.length ? <p className="drama-editor-note">此作品还没有可关联的设定。</p> : null}
                                </div>
                            </>
                        )}
                    </>
                ) : null}
                <Checkbox
                    checked={matchByName}
                    disabled={importAssets.isPending}
                    onChange={(event) => {
                        setMatchByName(event.target.checked);
                        setReplaceExisting(false);
                    }}
                >
                    匹配本作品中同类型、同名称的设定，缺少的设定新增
                </Checkbox>
                <Checkbox checked={replaceExisting} disabled={!matchByName || importAssets.isPending} onChange={(event) => setReplaceExisting(event.target.checked)}>
                    替换同名设定已有的参考图，旧图保留在版本记录中
                </Checkbox>
                <p className="drama-editor-note">造型的适用章节会重置，请按本季剧情重新设置。导入不会自动启动生成；重复关联同一来源素材不会创建副本。</p>
            </div>
        </AppModal>
    );
}
