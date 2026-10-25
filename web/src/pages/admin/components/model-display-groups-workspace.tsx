import { createClientId } from "@/lib/client-id";
import { App, Alert, Button, Checkbox, Input, Select, Table, Tag, Tooltip } from "antd";
import { GripVertical, Layers, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { ModelDisplayDetailModal } from "./model-display-detail-modal";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { assignDisplayMembers, assignCollectionMembers, displayGroupEntries, moveDisplayEntry, moveDisplayEntryToGroup, moveDisplayGroupByDrop, moveCollectionMemberByDrop } from "@/lib/model-display-group-editor";
import { suggestedVideoModelResolution } from "@/lib/video-model-collection";
import { getModelDisplayGroups, saveModelDisplayGroups, type ModelDisplayCollection, type ModelDisplayGroup, type ModelDisplayGroupsView, type ModelDisplayMember } from "@/services/api/model-display-groups";
import "./model-display-groups-workspace.css";

const capabilityNames: Record<string, string> = { video: "视频", image: "图片", text: "文本", audio: "音频" };

export function ModelDisplayGroupsWorkspace({ active, onSaved }: { active: boolean; onSaved: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const [view, setView] = useState<ModelDisplayGroupsView>();
    const [groups, setGroups] = useState<ModelDisplayGroup[]>([]);
    const [labels, setLabels] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [destination, setDestination] = useState<string>();
    const [expanded, setExpanded] = useState<string[]>([]);
    const pending = useRef(false);
    const dragIds = useRef<string[]>([]);
    const pointerDrag = useRef<{ x: number; y: number; active: boolean } | undefined>(undefined);
    const suppressDetailClickUntil = useRef(0);
    const [dropTarget, setDropTarget] = useState("");
    const [draggingModelIds, setDraggingModelIds] = useState<string[]>([]);
    const displayEntryDrag = useRef<{ groupId: string; key: string; modelIds: string[]; collectionId?: string } | undefined>(undefined);
    const [entryDropTarget, setEntryDropTarget] = useState<{ groupId: string; key: string; before: boolean }>();
    const [draggingGroupId, setDraggingGroupId] = useState("");
    const [groupDropTarget, setGroupDropTarget] = useState<{ id: string; before: boolean }>();
    const busy = loading || saving;
    const changed = !!view && (JSON.stringify(groups) !== JSON.stringify(view.groups) || Object.entries(labels).some(([id, label]) => label !== view.models.find((m) => m.id === id)?.channelLabel));
    const changedRef = useRef(changed);
    changedRef.current = changed;
    const names = groups.map((group) => group.name.trim());
    const valid = names.every(Boolean) && new Set(names).size === names.length;
    const members = new Map(view?.models.map((member) => [member.id, member]));
    const assigned = new Set(groups.flatMap((group) => group.modelIds));
    const ungrouped = (view?.models || []).filter((member) => !assigned.has(member.id));
    const allRows: ModelDisplayGroup[] = [...groups, { id: "", name: "未分组", modelIds: ungrouped.map((member) => member.id) }];
    const needle = query.trim().toLowerCase();
    const matches = (member: ModelDisplayMember) => [member.modelKey, member.providerModelKey, labels[member.id] ?? member.channelLabel, member.channelName].some((value) => value.toLowerCase().includes(needle));
    const groupMembers = (group: ModelDisplayGroup) =>
        group.modelIds
            .map((id) => members.get(id)!)
            .filter(Boolean)
            .filter((member) => !needle || group.name.toLowerCase().includes(needle) || matches(member) || group.collections?.some((collection) => collection.name.toLowerCase().includes(needle) && collection.members.some((item) => item.modelId === member.id)));
    const visibleGroups = allRows.filter((group) => !needle || group.name.toLowerCase().includes(needle) || groupMembers(group).length > 0 || group.collections?.some((collection) => collection.name.toLowerCase().includes(needle)));
    const secondaryEntries = (group: ModelDisplayGroup) => displayGroupEntries(group).map((entry) => {
        if (entry.collection) {
            return { key: entry.key, modelIds: entry.modelIds, title: entry.collection.name, detail: `${entry.modelIds.length} 个模型`, collection: true };
        }
        const member = members.get(entry.modelIds[0]);
        if (!member) return { key: entry.key, modelIds: entry.modelIds, title: entry.key, detail: "", collection: false };
        const title = labels[member.id]?.trim() || member.channelLabel?.trim() || member.displayName?.trim() || member.modelKey;
        return { key: entry.key, modelIds: entry.modelIds, title, detail: title === member.modelKey ? member.channelName : member.modelKey, collection: false };
    });

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await getModelDisplayGroups();
            setView(result);
            setGroups(result.groups);
            setLabels({});
            setSelected([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "读取模型分组失败");
        } finally {
            setLoading(false);
        }
    }, []);
    // Switching views preserves drafts. Clean views reload after model imports or edits.
    useEffect(() => {
        if (active && !changedRef.current) void load();
    }, [active, load]);
    useEffect(() => {
        if (!changed) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [changed]);
    const reload = () => {
        if (!changed) {
            void load();
            return;
        }
        modal.confirm({ title: "放弃未保存的分组修改？", okText: "放弃修改", cancelText: "继续编辑", onOk: load });
    };
    const save = async () => {
        if (!view || !valid || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError("");
        try {
            await saveModelDisplayGroups(groups, view.snapshot, labels);
            // Keep the workspace and open detail window in place after saving.
            changedRef.current = false;
            await load();
            message.success("分组、倍率和顺序已保存");
            try {
                await onSaved();
            } catch {
                message.warning("已保存，请刷新页面更新模型目录");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "保存分组失败");
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };
    const move = (ids: string[], target: string) => {
        setGroups((current) => assignDisplayMembers(current, ids, target));
        setSelected([]);
        setQuery("");
    };
    const moveToCollection = (ids: string[], group: ModelDisplayGroup, collectionId: string) => {
        if (busy || !ids.length) return;
        if (collectionId && ids.some((id) => members.get(id)?.capability !== "video")) { message.warning("分辨率集合仅支持视频模型"); return; }
        const resolutions = Object.fromEntries(ids.map((id) => [id, suggestedVideoModelResolution(members.get(id)?.modelKey || "") || suggestedVideoModelResolution(members.get(id)?.providerModelKey || "") || ""]));
        setGroups((current) => group.id ? assignCollectionMembers(current, ids, group.id, collectionId, resolutions) : assignDisplayMembers(current, ids, ""));
        setSelected([]);
    };
    const clearModelDrag = () => {
        dragIds.current = [];
        pointerDrag.current = undefined;
        displayEntryDrag.current = undefined;
        setDraggingModelIds([]);
        setDropTarget("");
        setEntryDropTarget(undefined);
    };
    const beginEntryDrag = (groupId: string, key: string, modelIds: string[], collectionId?: string) => {
        displayEntryDrag.current = { groupId, key, modelIds, collectionId };
        dragIds.current = modelIds;
        setDraggingModelIds(modelIds);
        setDropTarget("dragging");
    };
    const moveEntryToGroup = (entry: { groupId: string; key: string; modelIds: string[] }, destinationId: string) => {
        if (busy) return;
        setGroups((current) => current.find((group) => group.id === entry.groupId)?.collections?.some((collection) => collection.id === entry.key)
            ? moveDisplayEntryToGroup(current, entry.groupId, entry.key, destinationId)
            : destinationId ? assignCollectionMembers(current, entry.modelIds, destinationId, "", {}) : assignDisplayMembers(current, entry.modelIds, ""));
        clearModelDrag();
    };
    const moveEntryByDrop = (targetGroup: ModelDisplayGroup, targetKey: string, before: boolean) => {
        const source = displayEntryDrag.current;
        if (!source || busy || source.key === targetKey && source.groupId === targetGroup.id) return;
        const target = displayGroupEntries(targetGroup).find((entry) => entry.key === targetKey);
        if (!target) return;
        setGroups((current) => {
            const moved = source.collectionId
                ? moveDisplayEntryToGroup(current, source.groupId, source.key, targetGroup.id)
                : targetGroup.id ? assignCollectionMembers(current, source.modelIds, targetGroup.id, "", {}) : assignDisplayMembers(current, source.modelIds, "");
            const destination = moved.find((group) => group.id === targetGroup.id);
            if (!destination) return moved;
            const sourceIndex = displayGroupEntries(destination).findIndex((entry) => entry.key === source.key);
            const targetIndex = displayGroupEntries(destination).findIndex((entry) => entry.key === targetKey);
            if (sourceIndex < 0 || targetIndex < 0) return moved;
            let to = targetIndex + (before ? 0 : 1);
            if (sourceIndex < to) to -= 1;
            return moved.map((group) => group.id === targetGroup.id ? moveDisplayEntry(group, source.key, to) : group);
        });
        clearModelDrag();
    };
    const moveGroupByDrop = (targetId: string, before: boolean) => {
        if (!draggingGroupId || draggingGroupId === targetId || busy) return;
        setGroups((current) => moveDisplayGroupByDrop(current, draggingGroupId, targetId, before));
        setGroupDropTarget(undefined);
    };
    const pointerDropTarget = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-model-drop-group]");
    const dropDockGroups = groups.map((group) => ({
        group,
        collections: group.collections || [],
    }));
    const createCollection = (groupId: string, ids: string[] = [], open = true) => {
        if (busy || ids.some((id) => members.get(id)?.capability !== "video")) return;
        const id = `collection-${createClientId()}`;
        const resolutions = Object.fromEntries(ids.map((modelId) => [modelId, suggestedVideoModelResolution(members.get(modelId)?.modelKey || "") || suggestedVideoModelResolution(members.get(modelId)?.providerModelKey || "") || ""]));
        setGroups((current) => {
            const created = current.map((group) => group.id === groupId ? { ...group, collections: [...(group.collections || []), { id, name: `模型集合 ${(group.collections?.length || 0) + 1}`, members: [] }] } : group);
            return ids.length ? assignCollectionMembers(created, ids, groupId, id, resolutions) : created;
        });
        if (open) setExpanded([id]);
    };
    const entryPointerTarget = (event: PointerEvent<HTMLElement>, commit = false) => {
        const source = displayEntryDrag.current;
        if (!source) return;
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const dock = element?.closest<HTMLElement>("[data-model-drop-group]");
        setEntryDropTarget(undefined);
        setDropTarget("");
        if (dock) {
            if (dock.getAttribute("aria-disabled") === "true") return;
            const groupId = dock.dataset.modelDropGroup || "";
            const collectionId = dock.dataset.modelDropCollection || "";
            const group = allRows.find((item) => item.id === groupId);
            if (!group) return;
            setDropTarget(JSON.stringify([groupId, collectionId]));
            if (commit) {
                if (collectionId === "__new__") createCollection(groupId, source.modelIds, false);
                else if (collectionId) moveToCollection(source.modelIds, group, collectionId);
                else moveEntryToGroup(source, groupId);
            }
            return;
        }
        const item = element?.closest<HTMLElement>("[data-model-entry-key]");
        const row = element?.closest<HTMLElement>("tr[data-row-key]");
        const group = allRows.find((value) => value.id === row?.dataset.rowKey);
        if (!group) return;
        if (item) {
            const key = item.dataset.modelEntryKey!;
            if (group.id === source.groupId && key === source.key) return;
            const rect = item.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            const collection = group.collections?.find((value) => value.id === key);
            if (collection && !source.collectionId && x > 0.2 && x < 0.8) {
                if (source.modelIds.some((id) => members.get(id)?.capability !== "video")) return;
                setDropTarget(JSON.stringify([group.id, key]));
                if (commit) moveToCollection(source.modelIds, group, key);
            } else {
                setEntryDropTarget({ groupId: group.id, key, before: x < 0.5 });
                if (commit) moveEntryByDrop(group, key, x < 0.5);
            }
        } else {
            setDropTarget(JSON.stringify([group.id, ""]));
            if (commit) moveEntryToGroup(source, group.id);
        }
    };
    const entryPointerHandlers = (groupId: string, key: string, modelIds: string[], collectionId?: string) => ({
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0 || busy) return;
            event.preventDefault(); event.stopPropagation();
            pointerDrag.current = { x: event.clientX, y: event.clientY, active: false };
            displayEntryDrag.current = { groupId, key, modelIds, collectionId };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
            const drag = pointerDrag.current;
            if (!drag) return;
            if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) {
                drag.active = true;
                beginEntryDrag(groupId, key, modelIds, collectionId);
            }
            if (drag.active) entryPointerTarget(event);
        },
        onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
            if (pointerDrag.current?.active) {
                suppressDetailClickUntil.current = performance.now() + 200;
                entryPointerTarget(event, true);
            }
            clearModelDrag();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: clearModelDrag,
    });
    const detailKey = expanded[0];
    const detailGroup = allRows.find((group) => group.modelIds.includes(detailKey) || group.collections?.some((collection) => collection.id === detailKey));
    const detailCollection = detailGroup?.collections?.find((collection) => collection.id === detailKey);
    const detailMember = !detailCollection ? members.get(detailKey) : undefined;
    const detailTitle = detailCollection?.name || (detailMember && (labels[detailMember.id]?.trim() || detailMember.channelLabel || detailMember.modelKey)) || "";
    const memberIdentity = (member: ModelDisplayMember) => <div className="model-display-identity">
        <Input aria-label={`模型显示名称 ${member.modelKey}`} value={labels[member.id] ?? member.channelLabel} placeholder={member.modelKey} maxLength={80} disabled={busy}
            onChange={(event) => setLabels((current) => ({ ...current, [member.id]: event.target.value }))} />
        <code>{member.modelKey}</code>
        {member.providerModelKey && member.providerModelKey !== member.modelKey && <code>上游：{member.providerModelKey}</code>}
    </div>;
    const memberStatus = (member: ModelDisplayMember) => <div className="model-display-identity">
        <span>{member.channelName}</span>
        <span>{capabilityNames[member.capability] || member.capability} <Tag>{member.enabled && member.channelEnabled ? "已启用" : "已停用"}</Tag></span>
    </div>;
    const detailDestination = detailCollection ? JSON.stringify([detailGroup?.id || "", ""]) : JSON.stringify([detailGroup?.id || "", detailGroup?.collections?.find((collection) => collection.members.some((item) => item.modelId === detailKey))?.id || ""]);
    const detailDestinations = [{ value: JSON.stringify(["", ""]), label: "未分组" }, ...groups.flatMap((group) => [
        { value: JSON.stringify([group.id, ""]), label: group.name },
        ...(!detailCollection && detailMember?.capability === "video" ? [
            ...(group.collections || []).map((collection) => ({ value: JSON.stringify([group.id, collection.id]), label: `${group.name} / ${collection.name}` })),
            { value: JSON.stringify([group.id, "__new__"]), label: `${group.name} / 新建模型集合` },
        ] : []),
    ])];
    const memberTable = (group: ModelDisplayGroup, collection: ModelDisplayCollection) => <div className="model-display-collection">
        <div className="model-display-collection-header">
            <Layers size={16} />
            <Input aria-label={`集合名称 ${collection.name}`} value={collection.name} maxLength={160} disabled={busy}
                onChange={(event) => setGroups((current) => current.map((item) => item.id === group.id ? { ...item, collections: item.collections?.map((entry) => entry.id === collection.id ? { ...entry, name: event.target.value } : entry) } : item))} />
            <Tooltip title="加入所选视频模型"><Button aria-label="加入所选模型" icon={<Plus size={14} />} disabled={busy || !selected.length} onClick={() => moveToCollection(selected, group, collection.id)} /></Tooltip>
            <Tooltip title="解散集合，保留所有模型"><Button aria-label={`解散集合 ${collection.name}`} icon={<Trash2 size={14} />} disabled={busy}
                onClick={() => { setGroups((current) => current.map((item) => item.id === group.id ? { ...item, collections: item.collections?.filter((entry) => entry.id !== collection.id) } : item)); setExpanded([]); }} /></Tooltip>
        </div>
        <Table<ModelDisplayMember>
            size="small"
            rowKey="id"
            dataSource={collection.members.map((item) => members.get(item.modelId)!).filter(Boolean)}
            pagination={false}
            scroll={{ x: 620, y: 360 }}
            locale={{ emptyText: "暂无模型" }}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected((current) => [...current.filter((id) => !collection.members.some((item) => item.modelId === id)), ...keys.map(String)]), getCheckboxProps: () => ({ disabled: busy }) }}
            onRow={(member) => ({
                "data-entry-drop-target": entryDropTarget?.groupId === group.id && entryDropTarget.key === member.id ? (entryDropTarget.before ? "before" : "after") : undefined,
                draggable: !busy,
                onDragStart: (event) => {
                    beginEntryDrag(group.id, member.id, selected.includes(member.id) ? selected : [member.id]);
                    event.dataTransfer.setData("text/plain", member.id);
                    event.dataTransfer.effectAllowed = "move";
                },
                onDragEnd: clearModelDrag,
                onDragOver: (event) => {
                    if (!displayEntryDrag.current || displayEntryDrag.current.collectionId || busy) return;
                    event.preventDefault(); event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setEntryDropTarget({ groupId: group.id, key: member.id, before: event.clientY < rect.top + rect.height / 2 });
                },
                onDrop: (event) => {
                    event.preventDefault(); event.stopPropagation();
                    const source = displayEntryDrag.current;
                    if (!source || source.collectionId || busy) return;
                    const before = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2;
                    const resolutions = Object.fromEntries(source.modelIds.map((id) => [id, suggestedVideoModelResolution(members.get(id)?.modelKey || "") || ""]));
                    if (source.modelIds.some((id) => members.get(id)?.capability !== "video")) { message.warning("分辨率集合仅支持视频模型"); clearModelDrag(); return; }
                    setGroups((current) => {
                        // Keep existing members' resolutions and only assign incoming members.
                        const incoming = source.modelIds.filter((id) => !collection.members.some((item) => item.modelId === id));
                        const assigned = incoming.length ? assignCollectionMembers(current, incoming, group.id, collection.id, resolutions) : current;
                        const ordered = before ? source.modelIds : [...source.modelIds].reverse();
                        return assigned.map((item) => item.id === group.id ? ordered.reduce((value, id) => moveCollectionMemberByDrop(value, collection.id, id, member.id, before), item) : item);
                    });
                    clearModelDrag();
                },
            })}
            columns={[
                { title: "", width: 28, render: (_, member) => <button type="button" className="model-display-drag-handle" aria-label={`拖动模型 ${member.modelKey}`} disabled={busy}
                    onPointerDown={(event) => {
                        if (event.button !== 0 || busy) return;
                        event.preventDefault(); event.stopPropagation();
                        dragIds.current = selected.includes(member.id) ? selected : [member.id];
                        pointerDrag.current = { x: event.clientX, y: event.clientY, active: false };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const drag = pointerDrag.current;
                        if (!drag) return;
                        drag.active ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5;
                        if (!drag.active) return;
                        setDraggingModelIds(dragIds.current);
                        const target = pointerDropTarget(event.clientX, event.clientY);
                        setDropTarget(target ? JSON.stringify([target.dataset.modelDropGroup, target.dataset.modelDropCollection]) : "");
                        const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("tr[data-row-key]");
                        if (row?.dataset.rowKey) setEntryDropTarget({ groupId: group.id, key: row.dataset.rowKey, before: event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 });
                    }}
                    onPointerUp={(event) => {
                        if (pointerDrag.current?.active) {
                            const movingIds = [...dragIds.current];
                            const target = pointerDropTarget(event.clientX, event.clientY);
                            const targetGroup = allRows.find((item) => item.id === target?.dataset.modelDropGroup);
                            if (targetGroup && target?.getAttribute("aria-disabled") !== "true") {
                                if (target?.dataset.modelDropCollection === "__new__") createCollection(targetGroup.id, movingIds, false);
                                else moveToCollection(movingIds, targetGroup, target?.dataset.modelDropCollection || "");
                            } else {
                                const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("tr[data-row-key]");
                                if (row?.dataset.rowKey && collection.members.some((item) => item.modelId === row.dataset.rowKey)) {
                                    const targetId = row.dataset.rowKey;
                                    const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
                                    if (!movingIds.includes(targetId)) setGroups((current) => current.map((item) => item.id === group.id ? (before ? movingIds : [...movingIds].reverse()).reduce((value, id) => moveCollectionMemberByDrop(value, collection.id, id, targetId, before), item) : item));
                                }
                            }
                        }
                        clearModelDrag();
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onPointerCancel={clearModelDrag}
                ><GripVertical size={14} /></button> },
                { title: "分辨率", width: 96, render: (_, member) => <Input aria-label={`集合分辨率 ${member.modelKey}`} placeholder="720P" value={collection.members.find((item) => item.modelId === member.id)?.resolution} disabled={busy}
                    onChange={(event) => setGroups((current) => current.map((item) => item.id === group.id ? { ...item, collections: item.collections?.map((entry) => entry.id === collection.id ? { ...entry, members: entry.members.map((value) => value.modelId === member.id ? { ...value, resolution: event.target.value } : value) } : entry) } : item))} /> },
                { title: "模型", width: 230, render: (_, member) => memberIdentity(member) },
                { title: "渠道 / 能力 / 状态", width: 160, render: (_, member) => memberStatus(member) },
                { title: "", width: 76, render: (_, member) => <Button size="small" disabled={busy} onClick={() => moveToCollection([member.id], group, "")}>移出</Button> },
            ]}
        />
    </div>;
    return (
        <section className="model-display-workspace" aria-label="分组与倍率工作区">
            <div className="model-display-toolbar">
                <Input aria-label="新分组名称" placeholder="新分组名称" value={name} maxLength={160} disabled={busy || !view} onChange={(event) => setName(event.target.value)} />
                <Button
                    icon={<Plus size={16} />}
                    disabled={busy || !view || !name.trim() || names.includes(name.trim())}
                    onClick={() => {
                        const id = `group-${createClientId()}`;
                        setGroups((current) => [...current, { id, name: name.trim(), modelIds: [], multiplierBasisPoints: 10000 }]);
                        setName("");
                        setQuery("");
                    }}
                >
                    新建分组
                </Button>
                <span className="model-display-footer-spacer" />
                <Button icon={<RefreshCw size={16} />} disabled={busy} onClick={reload}>
                    重新加载
                </Button>
                <Button type="primary" icon={<Save size={16} />} disabled={busy || !view || !changed || !valid} loading={saving} onClick={() => void save()}>
                    保存修改
                </Button>
            </div>
            {error && <Alert type="error" showIcon title={error} />}
            {!valid && <Alert type="warning" showIcon title="分组名称不能为空或重复" />}
            <div className="model-display-toolbar">
                <Input.Search aria-label="搜索分组和模型" placeholder="搜索分组、原始模型、调用名称、渠道" value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
                <span className="model-display-summary">
                    {groups.length} 个分组 · {view?.models.length || 0} 个模型 · 未分组 {ungrouped.length}
                    {changed ? " · 未保存" : ""}
                </span>

            </div>
            <div className="model-display-toolbar">
                <span>已选 {selected.length} 个模型</span>
                <Select
                    aria-label="批量移入分组"
                    placeholder="选择目标分组"
                    value={destination}
                    disabled={busy}
                    showSearch={{ optionFilterProp: "label" }}
                    onChange={setDestination}
                    options={[{ value: "", label: "未分组" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
                />
                <Button disabled={busy || !selected.length || destination === undefined} onClick={() => move(selected, destination!)}>
                    批量移入
                </Button>
                {!!selected.length && (
                    <Button type="text" disabled={busy} onClick={() => setSelected([])}>
                        取消选择
                    </Button>
                )}
            </div>
            <div className="model-display-tree">
                <Table<ModelDisplayGroup>
                    size="small"
                    rowKey="id"
                    loading={loading}
                    dataSource={visibleGroups}
                    pagination={false}
                    scroll={{ x: 760 }}
                    locale={{ emptyText: "没有匹配的分组或模型" }}
                    onRow={(group) => ({
                        "data-group-drop-id": group.id || undefined,
                        "data-group-drop-position": groupDropTarget?.id === group.id ? (groupDropTarget.before ? "before" : "after") : undefined,
                        onDragOver: (event) => {
                            const entry = displayEntryDrag.current;
                            if (entry && !busy && !(entry.groupId === group.id && !group.id)) {
                                event.preventDefault();
                                event.stopPropagation();
                                setEntryDropTarget(undefined);
                                return;
                            }
                            if (!draggingGroupId || !group.id || draggingGroupId === group.id || busy) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const rect = event.currentTarget.getBoundingClientRect();
                            setGroupDropTarget({ id: group.id, before: event.clientY < rect.top + rect.height / 2 });
                        },
                        onDragLeave: () => {
                            if (groupDropTarget?.id === group.id) setGroupDropTarget(undefined);
                        },
                        onDrop: (event) => {
                            const entry = displayEntryDrag.current;
                            if (entry && !busy) {
                                event.preventDefault();
                                event.stopPropagation();
                                moveEntryToGroup(entry, group.id);
                                return;
                            }
                            if (!draggingGroupId || !group.id || draggingGroupId === group.id) return;
                            event.preventDefault();
                            event.stopPropagation();
                            moveGroupByDrop(group.id, groupDropTarget?.id === group.id ? groupDropTarget.before : event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2);
                            setDraggingGroupId("");
                        },
                    })}
                    columns={[
                        {
                            title: "分组",
                            width: 190,
                            render: (_, group) =>
                                (
                                    <div className="model-display-group-cell">
                                        <button
                                            type="button"
                                            className="model-display-group-drag-handle"
                                            draggable={!busy && Boolean(group.id)}
                                            aria-label={`拖动分组 ${group.name}`}
                                            onDragStart={(event) => {
                                                event.stopPropagation();
                                                event.dataTransfer.setData("text/plain", group.id);
                                                event.dataTransfer.effectAllowed = "move";
                                                setDraggingGroupId(group.id);
                                                setGroupDropTarget(undefined);
                                            }}
                                            onDragEnd={() => {
                                                setDraggingGroupId("");
                                                setGroupDropTarget(undefined);
                                            }}
                                            onPointerDown={(event) => {
                                                if (event.button !== 0 || busy || !group.id) return;
                                                event.preventDefault(); event.stopPropagation();
                                                pointerDrag.current = { x: event.clientX, y: event.clientY, active: false };
                                                event.currentTarget.setPointerCapture(event.pointerId);
                                            }}
                                            onPointerMove={(event) => {
                                                const drag = pointerDrag.current;
                                                if (!drag) return;
                                                drag.active ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5;
                                                if (!drag.active) return;
                                                setDraggingGroupId(group.id);
                                                const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-group-drop-id]");
                                                setGroupDropTarget(row?.dataset.groupDropId && row.dataset.groupDropId !== group.id ? { id: row.dataset.groupDropId, before: event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 } : undefined);
                                            }}
                                            onPointerUp={(event) => {
                                                const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-group-drop-id]");
                                                if (pointerDrag.current?.active && row?.dataset.groupDropId) {
                                                    const targetId = row.dataset.groupDropId;
                                                    const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
                                                    setGroups((current) => moveDisplayGroupByDrop(current, group.id, targetId, before));
                                                }
                                                pointerDrag.current = undefined;
                                                setDraggingGroupId(""); setGroupDropTarget(undefined);
                                                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                                            }}
                                            onPointerCancel={() => { pointerDrag.current = undefined; setDraggingGroupId(""); setGroupDropTarget(undefined); }}
                                        >
                                            <GripVertical size={14} aria-hidden="true" />
                                        </button>
                                        <div className="model-display-group-main">
                                            {group.id ? (
                                                <Input
                                                    aria-label={`分组名称 ${group.name}`}
                                                    value={group.name}
                                                    maxLength={160}
                                                    disabled={busy}
                                                    onChange={(event) => setGroups((current) => current.map((item) => (item.id === group.id ? { ...item, name: event.target.value } : item)))}
                                                />
                                            ) : <strong>未分组</strong>}
                                            <div className="model-display-group-meta">
                                                <span>{group.modelIds.length} 个模型</span>
                                                <span>{group.modelIds.filter((id) => members.get(id)?.enabled && members.get(id)?.channelEnabled).length} 个启用</span>
                                            </div>
                                        </div>
                                    </div>
                                ),
                        },
                        {
                            title: "二级目录",
                            width: 520,
                            render: (_, group) => {
                                const entries = secondaryEntries(group);
                                return (
                                    <div className="model-display-secondary-area">
                                    <div className="model-display-secondary-directory" aria-label={`${group.name} 二级目录`}>
                                        {entries.length ? entries.map((entry) => (
                                            <div className="model-display-secondary-row" key={entry.key}>
                                            <Checkbox aria-label={`选择 ${entry.title}`} disabled={busy || !entry.modelIds.length}
                                                checked={!!entry.modelIds.length && entry.modelIds.every((id) => selected.includes(id))}
                                                indeterminate={entry.modelIds.some((id) => selected.includes(id)) && !entry.modelIds.every((id) => selected.includes(id))}
                                                onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...entry.modelIds])] : current.filter((id) => !entry.modelIds.includes(id)))} />
                                            <button
                                                type="button"
                                                className={`model-display-secondary-item${entry.collection ? " is-collection" : ""}`}
                                                title={entry.detail ? `${entry.title} · ${entry.detail}；点击查看详情，拖动移动` : `${entry.title}；点击展开编辑，拖动移动`}
                                                draggable={!busy}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    if (performance.now() < suppressDetailClickUntil.current) return;
                                                    setExpanded([entry.key]);
                                                }}
                                                {...entryPointerHandlers(group.id, entry.key, !entry.collection && selected.includes(entry.key) ? selected : entry.modelIds, entry.collection ? entry.key : undefined)}
                                                data-model-entry-key={entry.key}
                                                onDragOver={(event) => {
                                                    const source = displayEntryDrag.current;
                                                    if (!source || busy || (source.groupId === group.id && source.key === entry.key)) return;
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    const relativeX = (event.clientX - rect.left) / rect.width;
                                                    if (entry.collection && !source.collectionId && relativeX > 0.2 && relativeX < 0.8) {
                                                        setDropTarget(JSON.stringify([group.id, entry.key]));
                                                        setEntryDropTarget(undefined);
                                                    } else {
                                                        setDropTarget("");
                                                        setEntryDropTarget({ groupId: group.id, key: entry.key, before: relativeX < 0.5 });
                                                    }
                                                }}
                                                onDrop={(event) => {
                                                    const source = displayEntryDrag.current;
                                                    if (!source || busy || (source.groupId === group.id && source.key === entry.key)) return;
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    if (entry.collection && !source.collectionId && dropTarget === JSON.stringify([group.id, entry.key])) moveToCollection(source.modelIds, group, entry.key);
                                                    else moveEntryByDrop(group, entry.key, entryDropTarget?.groupId === group.id && entryDropTarget.key === entry.key ? entryDropTarget.before : event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2);
                                                    clearModelDrag();
                                                }}
                                                onDragStart={(event) => {
                                                    if (busy) return;
                                                    event.stopPropagation();
                                                    beginEntryDrag(group.id, entry.key, !entry.collection && selected.includes(entry.key) ? selected : entry.modelIds, entry.collection ? entry.key : undefined);
                                                    event.dataTransfer.setData("text/plain", entry.key);
                                                    event.dataTransfer.effectAllowed = "move";
                                                }}
                                                data-entry-drop-target={entryDropTarget?.groupId === group.id && entryDropTarget.key === entry.key ? (entryDropTarget.before ? "before" : "after") : undefined}
                                                data-drop-active={dropTarget === JSON.stringify([group.id, entry.key])}
                                                onDragEnd={clearModelDrag}
                                            >
                                                <GripVertical size={12} aria-hidden="true" />
                                                {entry.collection && <Layers size={13} aria-hidden="true" />}
                                                <span className="model-display-secondary-item-copy">
                                                    <span className="model-display-secondary-item-title">{entry.title}</span>
                                                    <small>{entry.collection ? entry.detail : `${entry.detail} · ${capabilityNames[members.get(entry.key)?.capability || ""] || ""} · ${members.get(entry.key)?.enabled && members.get(entry.key)?.channelEnabled ? "已启用" : "已停用"}`}</small>
                                                </span>
                                            </button>
                                            </div>
                                        )) : <span className="model-display-secondary-empty">暂无二级目录</span>}
                                    </div>
                                    {group.id && <Tooltip title="新建模型集合"><Button aria-label={`新建模型集合 ${group.name}`} icon={<Plus size={14} />} disabled={busy} onClick={() => createCollection(group.id)} /></Tooltip>}
                                    </div>
                                );
                            },
                        },
                        {
                            title: "操作",
                            width: 64,
                            render: (_, group) =>
                                group.id ? (
                                    <Tooltip title="删除目录，成员转为未分组">
                                        <Button
                                            aria-label={`删除分组 ${group.name}`}
                                            icon={<Trash2 size={14} />}
                                            disabled={busy}
                                            onClick={() => {
                                                setGroups((current) => current.filter((item) => item.id !== group.id));
                                                if (destination === group.id) setDestination(undefined);
                                            }}
                                        />
                                    </Tooltip>
                                ) : null,
                        },
                    ]}
                />
                {(!!draggingModelIds.length || !!displayEntryDrag.current?.collectionId) && createPortal(
                    <aside className="model-display-drop-dock" aria-label="拖入目标分组">
                        <div className="model-display-drop-dock-header">
                            <strong>移动到分组</strong>
                            <span>{draggingModelIds.length} 个模型</span>
                        </div>
                        <div className="model-display-drop-dock-list">
                            <div
                                className="model-display-drop-target"
                                data-model-drop-group=""
                                data-model-drop-collection=""
                                data-drop-active={dropTarget === JSON.stringify(["", ""])}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "move";
                                    setDropTarget(JSON.stringify(["", ""]));
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (displayEntryDrag.current) moveEntryToGroup(displayEntryDrag.current, "");
                                    else moveToCollection(dragIds.current, allRows[allRows.length - 1], "");
                                    clearModelDrag();
                                }}
                            >
                                <span>未分组</span>
                                <small>移出当前一级目录</small>
                            </div>
                            {dropDockGroups.map(({ group, collections }) => (
                                <div className="model-display-drop-group" key={group.id}>
                                    <div
                                        className="model-display-drop-target"
                                        data-model-drop-group={group.id}
                                        data-model-drop-collection=""
                                        data-drop-active={dropTarget === JSON.stringify([group.id, ""])}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "move";
                                            setDropTarget(JSON.stringify([group.id, ""]));
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (displayEntryDrag.current) moveEntryToGroup(displayEntryDrag.current, group.id);
                                            else moveToCollection(dragIds.current, group, "");
                                            clearModelDrag();
                                        }}
                                    >
                                        <span>{group.name}</span>
                                        <small>{group.modelIds.length} 个模型</small>
                                    </div>
                                    {collections.map((collection) => {
                                        const accepts = !displayEntryDrag.current?.collectionId && draggingModelIds.every((id) => members.get(id)?.capability === "video");
                                        return (
                                            <div
                                                className={`model-display-drop-target model-display-drop-target-nested${accepts ? "" : " is-disabled"}`}
                                                key={collection.id}
                                                data-model-drop-group={group.id}
                                                data-model-drop-collection={collection.id}
                                                data-drop-active={dropTarget === JSON.stringify([group.id, collection.id])}
                                                aria-disabled={!accepts}
                                                onDragOver={(event) => {
                                                    if (!accepts) return;
                                                    event.preventDefault();
                                                    event.dataTransfer.dropEffect = "move";
                                                    setDropTarget(JSON.stringify([group.id, collection.id]));
                                                }}
                                                onDrop={(event) => {
                                                    if (!accepts) return;
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    moveToCollection(dragIds.current, group, collection.id);
                                                    clearModelDrag();
                                                }}
                                            >
                                                <span>{collection.name}</span>
                                                <small>{accepts ? `${collection.members.length} 个型号` : "仅支持视频模型"}</small>
                                            </div>
                                        );
                                    })}
                                    {!displayEntryDrag.current?.collectionId && draggingModelIds.every((id) => members.get(id)?.capability === "video") && <div
                                        className="model-display-drop-target model-display-drop-target-nested"
                                        data-model-drop-group={group.id}
                                        data-model-drop-collection="__new__"
                                        data-drop-active={dropTarget === JSON.stringify([group.id, "__new__"])}
                                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(JSON.stringify([group.id, "__new__"])); }}
                                        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); createCollection(group.id, dragIds.current, false); clearModelDrag(); }}
                                    ><span><Plus size={12} /> 新建模型集合</span></div>}
                                </div>
                            ))}
                        </div>
                    </aside>, document.body
                )}
            </div>
            {detailGroup && (detailCollection || detailMember) && <ModelDisplayDetailModal
                key={detailKey}
                title={detailTitle}
                onClose={() => setExpanded([])}
                footer={<><Button onClick={() => setExpanded([])}>关闭</Button><Button type="primary" icon={<Save size={14} />} disabled={busy || !changed || !valid} loading={saving} onClick={() => void save()}>保存修改</Button></>}
            >
                {error && <Alert type="error" showIcon title={error} />}
                <div className="model-display-detail-location">
                    <span>位置</span>
                    <Select aria-label="移动到目录或集合" value={detailDestination} disabled={busy} options={detailDestinations} showSearch={{ optionFilterProp: "label" }}
                        onChange={(value) => {
                            const [groupId, collectionId] = JSON.parse(value) as [string, string];
                            if (detailCollection) moveEntryToGroup({ groupId: detailGroup.id, key: detailCollection.id, modelIds: detailCollection.members.map((item) => item.modelId) }, groupId);
                            else if (collectionId === "__new__") createCollection(groupId, [detailKey]);
                            else {
                                const target = allRows.find((group) => group.id === groupId);
                                if (target) moveToCollection([detailKey], target, collectionId);
                            }
                        }} />
                </div>
                {detailCollection ? memberTable(detailGroup, detailCollection) : detailMember && <div className="model-display-detail-fields">
                    <label><span>显示名称 / 模型标识</span>{memberIdentity(detailMember)}</label>
                    <div><span>渠道 / 能力 / 状态</span>{memberStatus(detailMember)}</div>
                </div>}
            </ModelDisplayDetailModal>}
        </section>
    );
}
