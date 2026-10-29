import { App, Button, Input } from "antd";
import { Check, Download, History, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { IconButton } from "@/components/ui/base/buttons";
import { Select } from "@/components/ui/base/select";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import {
    AGENT_MEMORY_MODES,
    AGENT_MEMORY_SECTIONS,
    decideAgentMemoryRevision,
    getAgentMemory,
    listAgentMemoryRevisions,
    saveAgentMemory,
    undoAgentMemoryRevision,
    updateAgentMemoryMode,
    type AgentMemoryDocRevision,
    type AgentMemoryDocument,
    type AgentMemoryEntryInput,
    type AgentMemoryMode,
    type AgentMemorySection,
} from "@/services/api/agent-memory";
import { exportAgentMemories } from "@/services/api/agent-memories";

const ENTRY_MAX_CHARS = 400;

const ACTOR_LABELS: Record<string, string> = { agent: "Agent", user: "你", restore: "撤销", seed: "导入" };
const CHANGE_LABELS: Record<string, string> = { add: "新增", replace: "改写", remove: "删除" };

function sectionLabel(section: string) {
    return AGENT_MEMORY_SECTIONS.find((item) => item.key === section)?.label || section;
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function RevisionChanges({ revision }: { revision: AgentMemoryDocRevision }) {
    if (!revision.changes.length) return null;
    return (
        <ul className="mt-1 space-y-0.5 text-caption leading-5 text-muted-foreground">
            {revision.changes.slice(0, 6).map((change, index) => (
                <li key={`${revision.id}-${index}`}>
                    <span className="text-foreground/60">
                        {CHANGE_LABELS[change.kind] || change.kind} · {sectionLabel(change.section)}：
                    </span>
                    {change.kind === "replace" ? `${change.before} → ${change.after}` : change.after || change.before}
                </li>
            ))}
        </ul>
    );
}

/** 编辑记忆：整份列表一起保存（服务端按 revision 防并发覆盖）。 */
function MemoryEditor({ open, doc, onClose, onSaved }: { open: boolean; doc: AgentMemoryDocument | null; onClose: () => void; onSaved: (next: AgentMemoryDocument) => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<AgentMemoryEntryInput[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setDraft((doc?.entries || []).map((entry) => ({ id: entry.id, section: entry.section, text: entry.text })));
    }, [doc, open]);

    const used = draft.reduce((total, entry) => total + Array.from(entry.text.trim()).length, 0);
    const capacity = doc?.capacity || 5000;
    const update = (index: number, patch: Partial<AgentMemoryEntryInput>) => setDraft((current) => current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));

    const save = async () => {
        if (!doc) return;
        const entries = draft.map((entry) => ({ ...entry, text: entry.text.trim() })).filter((entry) => entry.text);
        if (used > capacity) {
            message.warning(`记忆最多 ${capacity} 字，请先删减`);
            return;
        }
        setSaving(true);
        try {
            onSaved(await saveAgentMemory(doc.revision, entries));
            message.success("已保存，下一条消息起生效");
            onClose();
        } catch (error) {
            message.error(errorText(error, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal open={open} title="编辑长期记忆" okText="保存" confirmLoading={saving} onOk={() => void save()} onCancel={onClose} width={640}>
            <div className="space-y-3 pt-2">
                <p className={`text-caption ${used > capacity ? "text-status-error" : "text-muted-foreground"}`}>
                    已用 {used.toLocaleString()} / {capacity.toLocaleString()} 字。每条一两句话，只写跨会话仍成立的内容；链接、节点或任务 ID、密钥会被拒绝。
                </p>
                {draft.map((entry, index) => (
                    <div key={entry.id || `new-${index}`} className="flex items-start gap-2">
                        <div className="w-28 shrink-0">
                            <Select
                                value={entry.section}
                                options={AGENT_MEMORY_SECTIONS.map((section) => ({ value: section.key, label: section.label }))}
                                onChange={(value) => update(index, { section: value as AgentMemorySection })}
                                ariaLabel="记忆分区"
                            />
                        </div>
                        <Input.TextArea className="flex-1" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={ENTRY_MAX_CHARS} value={entry.text} onChange={(event) => update(index, { text: event.target.value })} aria-label={`第 ${index + 1} 条记忆`} />
                        <IconButton variant="danger" size="sm" icon={Trash2} aria-label={`删除第 ${index + 1} 条记忆`} onClick={() => setDraft((current) => current.filter((_, at) => at !== index))} />
                    </div>
                ))}
                <Button icon={<Plus className="size-4" />} onClick={() => setDraft((current) => [...current, { section: "user", text: "" }])}>
                    添加一条
                </Button>
            </div>
        </AppModal>
    );
}

/** 修改历史：Agent、你和导入的每次修改都留记录，已生效且之后没被改过的可以撤销。 */
function MemoryHistory({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: (next: AgentMemoryDocument) => void }) {
    const { message } = App.useApp();
    const [revisions, setRevisions] = useState<AgentMemoryDocRevision[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            try {
                const data = await listAgentMemoryRevisions(undefined, 50, signal);
                setRevisions(data.revisions || []);
            } catch (error) {
                if (!signal?.aborted) message.error(errorText(error, "读取修改历史失败"));
            } finally {
                if (!signal?.aborted) setLoading(false);
            }
        },
        [message],
    );

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load, open]);

    const undo = async (revision: AgentMemoryDocRevision) => {
        setBusyId(revision.id);
        try {
            onChanged(await undoAgentMemoryRevision(revision.id));
            message.success("已撤销");
            await load();
        } catch (error) {
            message.error(errorText(error, "撤销失败"));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <AppModal open={open} title="记忆修改历史" footer={null} onCancel={onClose} width={640}>
            <div className="thin-scrollbar max-h-[60vh] space-y-2 overflow-y-auto pt-2">
                {loading && !revisions.length ? <div className="h-16 animate-pulse rounded-2xl bg-surface-secondary" aria-busy="true" /> : null}
                {!loading && !revisions.length ? <p className="py-6 text-center text-caption text-muted-foreground">还没有修改记录</p> : null}
                {revisions.map((revision) => (
                    <article key={revision.id} className="rounded-2xl bg-surface-secondary/80 px-4 py-3">
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="font-medium text-foreground">{ACTOR_LABELS[revision.actor] || revision.actor}</span>
                                    {revision.status === "pending" ? <StatusBadge size="sm" tone="warning" label="待确认" /> : null}
                                    {revision.status === "rejected" ? <StatusBadge size="sm" tone="neutral" label="已拒绝" /> : null}
                                    {revision.restoredAt ? <StatusBadge size="sm" tone="neutral" label="已撤销" /> : null}
                                    <span className="text-[var(--fs-label)] text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span>
                                </div>
                                {revision.summary ? <p className="mt-0.5 text-caption text-muted-foreground">{revision.summary}</p> : null}
                                <RevisionChanges revision={revision} />
                            </div>
                            {revision.canUndo ? (
                                <Button size="small" icon={<Undo2 className="size-3.5" />} loading={busyId === revision.id} onClick={() => void undo(revision)}>
                                    撤销
                                </Button>
                            ) : null}
                        </div>
                    </article>
                ))}
            </div>
        </AppModal>
    );
}

export default function AgentMemoryPane({ compact = false }: { compact?: boolean }) {
    const { message, modal } = App.useApp();
    const [doc, setDoc] = useState<AgentMemoryDocument | null>(null);
    const [pending, setPending] = useState<AgentMemoryDocRevision[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [savingMode, setSavingMode] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const seqRef = useRef(0);

    const applyDoc = useCallback(async (next: AgentMemoryDocument) => {
        setDoc(next);
        if (!next.pendingCount) {
            setPending([]);
            return;
        }
        const data = await listAgentMemoryRevisions("pending", 20);
        setPending(data.revisions || []);
    }, []);

    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const next = await getAgentMemory();
            if (seq !== seqRef.current) return;
            setLoadError("");
            await applyDoc(next);
        } catch (error) {
            if (seq === seqRef.current) setLoadError(errorText(error, "读取长期记忆失败"));
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [applyDoc]);

    useEffect(() => {
        void load();
    }, [load]);

    const changeMode = async (mode: AgentMemoryMode) => {
        setSavingMode(true);
        try {
            await applyDoc(await updateAgentMemoryMode(mode));
            message.success(mode === "off" ? "已关闭长期记忆，已有内容会保留" : "已更新，下一条消息起生效");
        } catch (error) {
            message.error(errorText(error, "保存失败"));
        } finally {
            setSavingMode(false);
        }
    };

    const removeEntry = (entryId: string, text: string) => {
        if (!doc) return;
        modal.confirm({
            title: "删除这条记忆？",
            content: text,
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                const entries = doc.entries.filter((entry) => entry.id !== entryId).map((entry) => ({ id: entry.id, section: entry.section, text: entry.text }));
                await applyDoc(await saveAgentMemory(doc.revision, entries));
                message.success("已删除，可在修改历史里撤销");
            },
        });
    };

    const decide = async (revision: AgentMemoryDocRevision, decision: "approve" | "reject") => {
        setBusyId(revision.id);
        try {
            await applyDoc(await decideAgentMemoryRevision(revision.id, decision));
            message.success(decision === "approve" ? "已采纳，下一条消息起生效" : "已拒绝");
        } catch (error) {
            message.error(errorText(error, "处理失败"));
        } finally {
            setBusyId(null);
        }
    };

    const exportLegacy = async () => {
        try {
            const bundle = await exportAgentMemories();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `agent-lessons-${bundle.exportedAt.slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            message.error(errorText(error, "导出失败"));
        }
    };

    const usagePercent = doc ? Math.min(100, Math.round((doc.charCount * 100) / Math.max(1, doc.capacity))) : 0;
    const modeOption = AGENT_MEMORY_MODES.find((option) => option.value === doc?.mode);

    if (loadError && !doc) return <WorkspaceErrorState compact title="读取长期记忆失败" description={loadError} onRetry={() => void load()} />;

    return (
        <div className={compact ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" : "flex flex-col gap-5"}>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SegmentedControl
                    size="sm"
                    ariaLabel="长期记忆模式"
                    value={doc?.mode || "auto"}
                    options={AGENT_MEMORY_MODES.map(({ value, label }) => ({ value, label }))}
                    onChange={(value) => void changeMode(value as AgentMemoryMode)}
                    disabled={savingMode || !doc}
                />
                <div className="ml-auto flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" icon={History} aria-label="记忆修改历史" onClick={() => setHistoryOpen(true)} />
                    <Button icon={<Pencil className="size-4" />} onClick={() => setEditorOpen(true)} disabled={!doc}>
                        编辑
                    </Button>
                </div>
            </div>
            {modeOption ? <p className="-mt-1 shrink-0 text-caption text-muted-foreground">{modeOption.description}。Agent 会在你纠正它、说明偏好或要求记住时自己整理这份记忆。</p> : null}
            {doc ? (
                <div className="shrink-0" aria-label={`记忆用量 ${doc.charCount} / ${doc.capacity} 字`}>
                    <div className="flex items-center justify-between text-[var(--fs-label)] text-muted-foreground">
                        <span>用量</span>
                        <span>
                            {doc.charCount.toLocaleString()} / {doc.capacity.toLocaleString()} 字
                        </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-secondary" role="progressbar" aria-valuenow={usagePercent} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${usagePercent >= 80 ? "bg-status-warning" : "bg-primary"}`} style={{ width: `${usagePercent}%` }} />
                    </div>
                </div>
            ) : null}
            {pending.length ? (
                <Callout tone="warning" title={`Agent 有 ${pending.length} 处修改等你确认`}>
                    <div className="space-y-2">
                        {pending.map((revision) => (
                            <div key={revision.id} className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    {revision.summary ? <p className="text-caption text-foreground/80">{revision.summary}</p> : null}
                                    <RevisionChanges revision={revision} />
                                </div>
                                <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={busyId === revision.id} onClick={() => void decide(revision, "approve")}>
                                    采纳
                                </Button>
                                <Button size="small" icon={<X className="size-3.5" />} loading={busyId === revision.id} onClick={() => void decide(revision, "reject")}>
                                    拒绝
                                </Button>
                            </div>
                        ))}
                    </div>
                </Callout>
            ) : null}

            <div className={compact ? "thin-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" : "flex flex-col gap-4"}>
                {loading && !doc ? (
                    <div className="space-y-2" aria-busy="true" aria-live="polite">
                        {[0, 1].map((index) => (
                            <div key={index} className="h-[72px] animate-pulse rounded-2xl bg-surface-secondary" />
                        ))}
                    </div>
                ) : null}
                {doc && !doc.entries.length ? (
                    <WorkspaceState
                        compact
                        icon="empty"
                        className={compact ? "min-h-0 flex-1 py-8" : "min-h-[200px] py-10"}
                        title="还没有长期记忆"
                        description="和 Agent 说“以后都用竖屏”“叫我长官”这类偏好，或纠正它的做法，它会自己记下来。也可以手动添加。"
                        action={
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditorOpen(true)}>
                                添加记忆
                            </Button>
                        }
                    />
                ) : null}
                {doc?.entries.length
                    ? AGENT_MEMORY_SECTIONS.map((section) => {
                          const entries = doc.entries.filter((entry) => entry.section === section.key);
                          return (
                              <section key={section.key} aria-label={section.label}>
                                  <h3 className="text-sm font-medium text-foreground">
                                      {section.label}
                                      <span className="ml-2 text-[var(--fs-label)] font-normal text-muted-foreground">{section.hint}</span>
                                  </h3>
                                  {entries.length ? (
                                      <ul className="mt-2 space-y-1.5">
                                          {entries.map((entry) => (
                                              <li key={entry.id} className="group flex items-start gap-2 rounded-xl bg-surface-secondary/80 px-3 py-2">
                                                  <p className="min-w-0 flex-1 text-caption leading-5 text-foreground/85">{entry.text}</p>
                                                  <span className="shrink-0 pt-0.5 text-[var(--fs-label)] text-muted-foreground">{entry.source === "agent" ? "Agent" : entry.source === "lesson_import" ? "导入" : "你"}</span>
                                                  <IconButton variant="danger" size="sm" icon={Trash2} aria-label="删除这条记忆" onClick={() => removeEntry(entry.id, entry.text)} />
                                              </li>
                                          ))}
                                      </ul>
                                  ) : (
                                      <p className="mt-1 text-caption text-muted-foreground">暂无</p>
                                  )}
                              </section>
                          );
                      })
                    : null}
            </div>
            {compact ? null : (
                <p className="shrink-0 text-caption text-muted-foreground">
                    旧版“经验库”里已批准的条目会在第一次打开记忆时自动导入，Agent 不再单独读取经验库。
                    <Button type="link" size="small" icon={<Download className="size-3.5" />} onClick={() => void exportLegacy()}>
                        导出旧版经验
                    </Button>
                </p>
            )}
            <MemoryEditor open={editorOpen} doc={doc} onClose={() => setEditorOpen(false)} onSaved={(next) => void applyDoc(next)} />
            <MemoryHistory open={historyOpen} onClose={() => setHistoryOpen(false)} onChanged={(next) => void applyDoc(next)} />
        </div>
    );
}
