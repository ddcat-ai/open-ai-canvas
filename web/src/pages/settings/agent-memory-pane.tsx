import { App, Button, Input } from "antd";
import { Check, Download, History, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { currentLocale, translate } from "@/i18n";

const ENTRY_MAX_CHARS = 400;

/** 修改者与修改类型的文案键，未知值原样显示。 */
const ACTOR_KEYS: Record<string, string> = { agent: "account.settings.memory.actors.agent", user: "account.settings.memory.actors.user", restore: "account.settings.memory.actors.restore", seed: "account.settings.memory.actors.seed" };
const CHANGE_KEYS: Record<string, string> = { add: "account.settings.memory.changes.add", replace: "account.settings.memory.changes.replace", remove: "account.settings.memory.changes.remove" };

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
                    <span className="text-foreground/60">{translate("account.settings.memory.changeLine", { kind: CHANGE_KEYS[change.kind] ? translate(CHANGE_KEYS[change.kind]) : change.kind, section: sectionLabel(change.section) })}</span>
                    {change.kind === "replace" ? `${change.before} → ${change.after}` : change.after || change.before}
                </li>
            ))}
        </ul>
    );
}

/** 编辑记忆：整份列表一起保存（服务端按 revision 防并发覆盖）。 */
function MemoryEditor({ open, doc, onClose, onSaved }: { open: boolean; doc: AgentMemoryDocument | null; onClose: () => void; onSaved: (next: AgentMemoryDocument) => void }) {
    const { t } = useTranslation();
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
            message.warning(t("account.settings.memory.overCapacity", { capacity }));
            return;
        }
        setSaving(true);
        try {
            onSaved(await saveAgentMemory(doc.revision, entries));
            message.success(t("account.settings.memory.saved"));
            onClose();
        } catch (error) {
            message.error(errorText(error, t("account.settings.memory.saveFailed")));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal open={open} title={t("account.settings.memory.editTitle")} okText={t("common.save")} confirmLoading={saving} onOk={() => void save()} onCancel={onClose} width={640}>
            <div className="space-y-3 pt-2">
                <p className={`text-caption ${used > capacity ? "text-status-error" : "text-muted-foreground"}`}>
                    {t("account.settings.memory.editorHint", { used: used.toLocaleString(currentLocale()), capacity: capacity.toLocaleString(currentLocale()) })}
                </p>
                {draft.map((entry, index) => (
                    <div key={entry.id || `new-${index}`} className="flex items-start gap-2">
                        <div className="w-28 shrink-0">
                            <Select
                                value={entry.section}
                                options={AGENT_MEMORY_SECTIONS.map((section) => ({ value: section.key, label: section.label }))}
                                onChange={(value) => update(index, { section: value as AgentMemorySection })}
                                ariaLabel={t("account.settings.memory.section")}
                            />
                        </div>
                        <Input.TextArea
                            className="flex-1"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            maxLength={ENTRY_MAX_CHARS}
                            value={entry.text}
                            onChange={(event) => update(index, { text: event.target.value })}
                            aria-label={t("account.settings.memory.entryLabel", { index: index + 1 })}
                        />
                        <IconButton variant="danger" size="sm" icon={Trash2} aria-label={t("account.settings.memory.deleteEntryLabel", { index: index + 1 })} onClick={() => setDraft((current) => current.filter((_, at) => at !== index))} />
                    </div>
                ))}
                <Button icon={<Plus className="size-4" />} onClick={() => setDraft((current) => [...current, { section: "user", text: "" }])}>
                    {t("account.settings.memory.addOne")}
                </Button>
            </div>
        </AppModal>
    );
}

/** 修改历史：Agent、你和导入的每次修改都留记录，已生效且之后没被改过的可以撤销。 */
function MemoryHistory({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: (next: AgentMemoryDocument) => void }) {
    const { t } = useTranslation();
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
                if (!signal?.aborted) message.error(errorText(error, t("account.settings.memory.historyFailed")));
            } finally {
                if (!signal?.aborted) setLoading(false);
            }
        },
        [message, t],
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
            message.success(t("account.settings.memory.undone"));
            await load();
        } catch (error) {
            message.error(errorText(error, t("account.settings.memory.undoFailed")));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <AppModal open={open} title={t("account.settings.memory.historyTitle")} footer={null} onCancel={onClose} width={640}>
            <div className="thin-scrollbar max-h-[60vh] space-y-2 overflow-y-auto pt-2">
                {loading && !revisions.length ? <div className="h-16 animate-pulse rounded-2xl bg-surface-secondary" aria-busy="true" /> : null}
                {!loading && !revisions.length ? <p className="py-6 text-center text-caption text-muted-foreground">{t("account.settings.memory.historyEmpty")}</p> : null}
                {revisions.map((revision) => (
                    <article key={revision.id} className="rounded-2xl bg-surface-secondary/80 px-4 py-3">
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="font-medium text-foreground">{ACTOR_KEYS[revision.actor] ? t(ACTOR_KEYS[revision.actor]) : revision.actor}</span>
                                    {revision.status === "pending" ? <StatusBadge size="sm" tone="warning" label={t("account.settings.memory.statusPending")} /> : null}
                                    {revision.status === "rejected" ? <StatusBadge size="sm" tone="neutral" label={t("account.settings.memory.statusRejected")} /> : null}
                                    {revision.restoredAt ? <StatusBadge size="sm" tone="neutral" label={t("account.settings.memory.statusUndone")} /> : null}
                                    <span className="text-[var(--fs-label)] text-muted-foreground">{new Date(revision.createdAt).toLocaleString(currentLocale())}</span>
                                </div>
                                {revision.summary ? <p className="mt-0.5 text-caption text-muted-foreground">{revision.summary}</p> : null}
                                <RevisionChanges revision={revision} />
                            </div>
                            {revision.canUndo ? (
                                <Button size="small" icon={<Undo2 className="size-3.5" />} loading={busyId === revision.id} onClick={() => void undo(revision)}>
                                    {t("account.settings.memory.undo")}
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
    const { t } = useTranslation();
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
            if (seq === seqRef.current) setLoadError(errorText(error, translate("account.settings.memory.loadFailed")));
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
            message.success(mode === "off" ? t("account.settings.memory.modeOff") : t("account.settings.memory.modeUpdated"));
        } catch (error) {
            message.error(errorText(error, t("account.settings.memory.saveFailed")));
        } finally {
            setSavingMode(false);
        }
    };

    const removeEntry = (entryId: string, text: string) => {
        if (!doc) return;
        modal.confirm({
            title: t("account.settings.memory.deleteTitle"),
            content: text,
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            onOk: async () => {
                const entries = doc.entries.filter((entry) => entry.id !== entryId).map((entry) => ({ id: entry.id, section: entry.section, text: entry.text }));
                await applyDoc(await saveAgentMemory(doc.revision, entries));
                message.success(t("account.settings.memory.deleted"));
            },
        });
    };

    const decide = async (revision: AgentMemoryDocRevision, decision: "approve" | "reject") => {
        setBusyId(revision.id);
        try {
            await applyDoc(await decideAgentMemoryRevision(revision.id, decision));
            message.success(decision === "approve" ? t("account.settings.memory.approved") : t("account.settings.memory.statusRejected"));
        } catch (error) {
            message.error(errorText(error, t("account.settings.memory.decideFailed")));
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
            message.error(errorText(error, t("account.settings.memory.exportFailed")));
        }
    };

    const usagePercent = doc ? Math.min(100, Math.round((doc.charCount * 100) / Math.max(1, doc.capacity))) : 0;
    const modeOption = AGENT_MEMORY_MODES.find((option) => option.value === doc?.mode);

    if (loadError && !doc) return <WorkspaceErrorState compact title={t("account.settings.memory.loadFailed")} description={loadError} onRetry={() => void load()} />;

    return (
        <div className={compact ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" : "flex flex-col gap-5"}>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SegmentedControl
                    size="sm"
                    ariaLabel={t("account.settings.memory.mode")}
                    value={doc?.mode || "auto"}
                    options={AGENT_MEMORY_MODES.map(({ value, label }) => ({ value, label }))}
                    onChange={(value) => void changeMode(value as AgentMemoryMode)}
                    disabled={savingMode || !doc}
                />
                <div className="ml-auto flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" icon={History} aria-label={t("account.settings.memory.historyTitle")} onClick={() => setHistoryOpen(true)} />
                    <Button icon={<Pencil className="size-4" />} onClick={() => setEditorOpen(true)} disabled={!doc}>
                        {t("account.settings.channels.edit")}
                    </Button>
                </div>
            </div>
            {modeOption ? <p className="-mt-1 shrink-0 text-caption text-muted-foreground">{t("account.settings.memory.modeHint", { description: modeOption.description })}</p> : null}
            {doc ? (
                <div className="shrink-0" aria-label={t("account.settings.memory.usageLabel", { used: doc.charCount, capacity: doc.capacity })}>
                    <div className="flex items-center justify-between text-[var(--fs-label)] text-muted-foreground">
                        <span>{t("account.settings.memory.usage")}</span>
                        <span>{t("account.settings.memory.usageValue", { used: doc.charCount.toLocaleString(currentLocale()), capacity: doc.capacity.toLocaleString(currentLocale()) })}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-secondary" role="progressbar" aria-valuenow={usagePercent} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${usagePercent >= 80 ? "bg-status-warning" : "bg-primary"}`} style={{ width: `${usagePercent}%` }} />
                    </div>
                </div>
            ) : null}
            {pending.length ? (
                <Callout tone="warning" title={t("account.settings.memory.pendingTitle", { count: pending.length })}>
                    <div className="space-y-2">
                        {pending.map((revision) => (
                            <div key={revision.id} className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    {revision.summary ? <p className="text-caption text-foreground/80">{revision.summary}</p> : null}
                                    <RevisionChanges revision={revision} />
                                </div>
                                <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={busyId === revision.id} onClick={() => void decide(revision, "approve")}>
                                    {t("account.settings.memory.approve")}
                                </Button>
                                <Button size="small" icon={<X className="size-3.5" />} loading={busyId === revision.id} onClick={() => void decide(revision, "reject")}>
                                    {t("account.settings.memory.reject")}
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
                        title={t("account.settings.memory.emptyTitle")}
                        description={t("account.settings.memory.emptyDescription")}
                        action={
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditorOpen(true)}>
                                {t("account.settings.memory.add")}
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
                                                  <span className="shrink-0 pt-0.5 text-[var(--fs-label)] text-muted-foreground">
                                                      {entry.source === "agent" ? t("account.settings.memory.actors.agent") : entry.source === "lesson_import" ? t("account.settings.memory.actors.seed") : t("account.settings.memory.actors.user")}
                                                  </span>
                                                  <IconButton variant="danger" size="sm" icon={Trash2} aria-label={t("account.settings.memory.deleteEntry")} onClick={() => removeEntry(entry.id, entry.text)} />
                                              </li>
                                          ))}
                                      </ul>
                                  ) : (
                                      <p className="mt-1 text-caption text-muted-foreground">{t("account.settings.memory.none")}</p>
                                  )}
                              </section>
                          );
                      })
                    : null}
            </div>
            {compact ? null : (
                <p className="shrink-0 text-caption text-muted-foreground">
                    {t("account.settings.memory.legacyHint")}
                    <Button type="link" size="small" icon={<Download className="size-3.5" />} onClick={() => void exportLegacy()}>
                        {t("account.settings.memory.legacyExport")}
                    </Button>
                </p>
            )}
            <MemoryEditor open={editorOpen} doc={doc} onClose={() => setEditorOpen(false)} onSaved={(next) => void applyDoc(next)} />
            <MemoryHistory open={historyOpen} onClose={() => setHistoryOpen(false)} onChanged={(next) => void applyDoc(next)} />
        </div>
    );
}
