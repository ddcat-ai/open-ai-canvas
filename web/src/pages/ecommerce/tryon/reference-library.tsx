import { App, Button, Input, Select } from "antd";
import { Check, FolderOpen, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state";
import { libraryReferenceEntry, REFERENCE_ANGLES, referenceImageUrl, referenceSelectionKey, type ReferenceAngle, type ReferenceEntry, type ReferenceKind, type ReferenceSelection } from "./reference-catalog";
import { listPoseLibrary } from "@/services/api/pose-library";
import "./reference-library.css";

function ReferenceCard({ entry, angle, onAngle, selected, onToggle, disabled, busy }: { entry: ReferenceEntry; angle: ReferenceAngle; onAngle: (angle: ReferenceAngle) => void; selected: boolean; onToggle: () => void; disabled: boolean; busy: boolean }) {
    return (
        <article className="ecr-card" data-kind={entry.kind} data-selected={selected || undefined}>
            <button
                className="ecr-card-image"
                type="button"
                onClick={onToggle}
                aria-pressed={selected}
                aria-label={`选择${entry.title}${entry.kind === "pose" ? ` · ${REFERENCE_ANGLES.find((item) => item.id === angle)!.label}` : ""}`}
                disabled={busy || (disabled && !selected)}
            >
                <img src={referenceImageUrl(entry, angle)} alt={entry.title} loading="lazy" decoding="async" />
                <span className="ecr-code">{entry.id}</span>
                <span className="ecr-check" aria-hidden="true">
                    {selected ? <Check size={14} /> : <Plus size={14} />}
                </span>
            </button>
            <div className="ecr-card-info">
                <strong>{entry.title}</strong>
                <span>{entry.category}</span>
            </div>
            {entry.kind === "pose" ? (
                <div className="ecr-angles" role="group" aria-label={`${entry.title}的拍摄角度`}>
                    {REFERENCE_ANGLES.map((view) => (
                        <button key={view.id} type="button" aria-pressed={angle === view.id} disabled={busy || !entry.views[view.id]} onClick={() => onAngle(view.id)} aria-label={`${entry.title} · ${view.label}`}>
                            {entry.views[view.id] ? <img src={referenceImageUrl(entry, view.id)} alt="" loading="lazy" /> : <span className="ecr-missing-angle">未提供</span>}
                            <span>{view.label}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </article>
    );
}

/** Select first, confirm once. Angle changes never silently add an image to the draft. */
export function TryOnReferenceLibrary({ kind, room, onClose, onPersonal, onPick }: { kind: ReferenceKind; room: number; onClose: () => void; onPersonal: () => void; onPick: (selections: ReferenceSelection[]) => Promise<void> }) {
    const { message } = App.useApp();
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [filterAngle, setFilterAngle] = useState<ReferenceAngle>("front");
    const [angles, setAngles] = useState<Record<string, ReferenceAngle>>({});
    const [selected, setSelected] = useState<ReferenceSelection[]>([]);
    const [adding, setAdding] = useState(false);
    const [page, setPage] = useState(1);
    const [visible, setVisible] = useState<ReferenceEntry[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        const timer = window.setTimeout(() => {
            void listPoseLibrary({ library: kind, keyword: query, category, page, pageSize: 40 }, controller.signal)
                .then((result) => {
                    if (controller.signal.aborted) return;
                    const entries = result.poses.map((pose) => libraryReferenceEntry(pose, kind)).filter((entry) => Object.keys(entry.views).length);
                    setVisible((previous) => (page === 1 ? entries : [...previous, ...entries]));
                    setTotal(result.total);
                    setCategories(result.facets.categories.map((item) => item.name));
                })
                .catch((cause) => {
                    if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取素材库失败");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        }, 200);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [kind, query, category, page]);
    const label = kind === "pose" ? "姿势" : "服装";
    const toggle = (selection: ReferenceSelection) =>
        setSelected((current) => {
            const key = referenceSelectionKey(selection);
            if (current.some((item) => referenceSelectionKey(item) === key)) return current.filter((item) => referenceSelectionKey(item) !== key);
            return current.length < room ? [...current, selection] : current;
        });
    const confirm = async () => {
        if (!selected.length || selected.length > room) return;
        setAdding(true);
        try {
            await onPick(selected);
            onClose();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "添加素材失败，请重试");
        } finally {
            setAdding(false);
        }
    };
    return (
        <AppModal
            open
            onCancel={adding ? undefined : onClose}
            title={`${label}素材库`}
            width="min(1080px, calc(100vw - 32px))"
            centered
            className="ecr-modal"
            footer={
                <div className="ecr-footer">
                    <span role="status">
                        已选 {selected.length} / {room} 张{kind === "pose" ? " · 确认后添加到图二姿势位" : " · 确认后添加到服装位"}
                    </span>
                    <div>
                        <Button onClick={onClose} disabled={adding}>
                            取消
                        </Button>
                        <Button type="primary" loading={adding} disabled={!selected.length || selected.length > room} onClick={() => void confirm()}>
                            确认添加{selected.length ? ` ${selected.length} 张` : ""}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="ecr-toolbar">
                <Input
                    allowClear
                    prefix={<Search size={16} />}
                    placeholder={kind === "pose" ? "搜索姿势、动作或编号，例如：叉腰、坐姿、抬手" : "搜索服装、季节或编号，例如：衬衫、裙、冬季"}
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                    }}
                    aria-label={`搜索${label}素材`}
                />
                <Button icon={<FolderOpen size={15} />} onClick={onPersonal} disabled={adding}>
                    我的素材
                </Button>
            </div>
            <div className="ecr-filters" role="group" aria-label={`${label}分类`}>
                {["", ...categories].map((value) => (
                    <button
                        key={value}
                        type="button"
                        className="ecs-chip"
                        aria-pressed={category === value}
                        onClick={() => {
                            setCategory(value);
                            setPage(1);
                        }}
                    >
                        {value || "全部"}
                    </button>
                ))}
            </div>
            <div className="ecr-meta">
                <span>
                    {total} {kind === "pose" ? "个姿势 · 按已导入角度展示" : "套服装搭配"}
                </span>
                {kind === "pose" ? (
                    <Select
                        aria-label="默认拍摄角度"
                        size="small"
                        value={filterAngle}
                        options={REFERENCE_ANGLES.map((view) => ({ value: view.id, label: view.label }))}
                        onChange={(value) => {
                            setFilterAngle(value);
                            setAngles({});
                        }}
                    />
                ) : null}
            </div>
            <div className="ecr-grid" aria-label={`${label}素材列表`}>
                {visible.map((entry) => {
                    const preferred = kind === "pose" ? angles[entry.id] || filterAngle : "front";
                    const angle = entry.views[preferred] ? preferred : REFERENCE_ANGLES.find((view) => entry.views[view.id])!.id;
                    const selection = { entry, angle };
                    return (
                        <ReferenceCard
                            key={entry.id}
                            entry={entry}
                            angle={angle}
                            onAngle={(value) => setAngles((current) => ({ ...current, [entry.id]: value }))}
                            selected={selected.some((item) => referenceSelectionKey(item) === referenceSelectionKey(selection))}
                            disabled={selected.length >= room}
                            busy={adding}
                            onToggle={() => toggle(selection)}
                        />
                    );
                })}
                {total > visible.length ? (
                    <div className="ecr-more">
                        <Button loading={loading} onClick={() => setPage((value) => value + 1)}>
                            加载更多
                        </Button>
                    </div>
                ) : null}
                {error ? <p role="alert">{error}</p> : null}
                {!visible.length && !loading && !error ? (
                    <EmptyState
                        title="暂无可用素材"
                        description="可从我的素材选用图片，或联系管理员在后台添加并开放素材。"
                        action={
                            <Button
                                onClick={() => {
                                    setQuery("");
                                    setCategory("");
                                    setPage(1);
                                }}
                            >
                                清除筛选
                            </Button>
                        }
                    />
                ) : null}
            </div>
            {selected.length ? (
                <div className="ecr-selected" aria-label="已选素材">
                    {selected.map((item) => (
                        <button key={referenceSelectionKey(item)} type="button" onClick={() => toggle(item)} disabled={adding} aria-label={`移除已选${item.entry.title}`}>
                            <img src={referenceImageUrl(item.entry, item.angle)} alt="" />
                            <span>
                                {item.entry.title}
                                {kind === "pose" ? ` · ${REFERENCE_ANGLES.find((view) => view.id === item.angle)!.label}` : ""}
                            </span>
                            <X size={12} />
                        </button>
                    ))}
                </div>
            ) : null}
            <div className="ecr-source">
                <span>{kind === "pose" ? "单人人偶参考，仅迁移动作与机位，保留你上传的主体。" : "使用本站管理员已开放的服装参考。"}</span>
            </div>
        </AppModal>
    );
}
