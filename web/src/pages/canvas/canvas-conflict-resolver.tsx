import { App, Button, Input, Modal, Radio, Tag } from "antd";
import { ArrowLeft, GitMerge, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { applyCanvasConflictField, autoMergeIndependentCanvasChanges, type CanvasConflictField, type CanvasConflictSnapshot } from "@/services/canvas-conflicts";
import { resolveCanvasConflict } from "@/services/user-data-sync";

type ConflictChoice = "local" | "remote" | "custom";

type ResolverProps = {
    open: boolean;
    snapshot: CanvasConflictSnapshot | null;
    onCancel: () => void;
    onResolved: () => void;
};

type ResolverState = {
    choices: Record<string, ConflictChoice>;
    customValues: Record<string, string>;
    groupedFields: Array<[string, CanvasConflictField[]]>;
    mergedPreview: ReturnType<typeof autoMergeIndependentCanvasChanges> | null;
    unresolvedCount: number;
    submitting: boolean;
    submitError: string;
    setChoice: (field: CanvasConflictField, choice: ConflictChoice) => void;
    setCustomValue: (field: CanvasConflictField, value: string) => void;
    chooseAll: (choice: Exclude<ConflictChoice, "custom">) => void;
    submit: () => Promise<void>;
};

/** 快速入口：在当前画布上直接处理冲突。 */
export function CanvasConflictResolverModal({ open, snapshot, onCancel, onResolved }: ResolverProps) {
    const state = useConflictResolver(snapshot, onResolved);
    if (!snapshot) return null;
    return (
        <Modal
            open={open}
            title={
                <span className="flex items-center gap-2">
                    <GitMerge size={17} />
                    需要处理的修改
                </span>
            }
            width="min(1040px, calc(100vw - 24px))"
            centered
            zIndex={1250}
            maskClosable={false}
            onCancel={state.submitting ? undefined : onCancel}
            destroyOnClose={false}
            footer={<ResolverFooter state={state} onCancel={onCancel} />}
        >
            <ResolverBody snapshot={snapshot} state={state} compact />
        </Modal>
    );
}

/**
 * 完整的三方合并工作区。它仍然覆盖在当前真实画布上，避免用户跳到
 * 不相关的版本页面；顶部明确展示“共同起点 / 我的草稿 / 云端最新”，
 * 下方按字段处理冲突，适合复杂删除、改名、连线等场景。
 */
export function CanvasConflictResolverPage({ open, snapshot, onCancel, onResolved }: ResolverProps) {
    const state = useConflictResolver(snapshot, onResolved);
    if (!open || !snapshot) return null;
    return (
        <div className="fixed inset-0 z-[1300] flex min-h-0 flex-col bg-background text-foreground" data-canvas-no-zoom data-canvas-wheel-scroll>
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-5 py-3">
                <Button type="text" icon={<ArrowLeft size={16} />} onClick={state.submitting ? undefined : onCancel} disabled={state.submitting}>
                    返回画布
                </Button>
                <div className="min-w-0 flex-1">
                    <h1 className="m-0 flex items-center gap-2 text-base font-semibold">
                        <GitMerge size={18} />
                        处理本地修改
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">没有分歧的内容会自动保留，只需要确认发生分歧的部分。</p>
                </div>
                <Tag color="orange">{snapshot.fields.length ? `${snapshot.fields.length} 处待确认` : "可直接同步"}</Tag>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
                <div className="mx-auto max-w-6xl">
                    <ResolverBody snapshot={snapshot} state={state} />
                </div>
            </div>
            <footer className="flex shrink-0 flex-col items-stretch gap-3 border-t border-border bg-sidebar px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="max-w-2xl text-xs text-muted-foreground">提交时会再次检查云端内容；如果有人刚修改，系统会保留你的选择并提示重新确认。</span>
                <ResolverFooter state={state} onCancel={onCancel} showBack={false} />
            </footer>
        </div>
    );
}

function useConflictResolver(snapshot: CanvasConflictSnapshot | null, onResolved: () => void): ResolverState {
    const { message } = App.useApp();
    const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
    const [customValues, setCustomValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    useEffect(() => {
        if (!snapshot) return;
        const nextChoices: Record<string, ConflictChoice> = {};
        const nextCustom: Record<string, string> = {};
        for (const field of snapshot.fields) {
            if (field.valueType === "text") nextCustom[field.id] = String(field.localValue ?? "");
        }
        setChoices(nextChoices);
        setCustomValues(nextCustom);
        setSubmitError("");
    }, [snapshot]);

    const groupedFields = useMemo(() => {
        if (!snapshot) return [] as Array<[string, CanvasConflictField[]]>;
        const groups = new Map<string, CanvasConflictField[]>();
        for (const conflict of snapshot.fields) {
            const title = conflict.scope === "canvas" ? "画布设置" : conflict.scope === "connections" ? "画布连线" : `${conflict.nodeTitle || "未命名节点"}${conflict.nodeId ? ` · ${conflict.nodeId.slice(0, 6)}` : ""}`;
            groups.set(title, [...(groups.get(title) || []), conflict]);
        }
        return [...groups];
    }, [snapshot]);

    const setChoice = (field: CanvasConflictField, choice: ConflictChoice) => {
        setSubmitError("");
        setChoices((current) => ({ ...current, [field.id]: choice === "custom" && field.valueType !== "text" ? "remote" : choice }));
    };
    const setCustomValue = (field: CanvasConflictField, value: string) => {
        setSubmitError("");
        setCustomValues((current) => ({ ...current, [field.id]: value }));
    };
    const chooseAll = (choice: Exclude<ConflictChoice, "custom">) => {
        setSubmitError("");
        setChoices((current) => {
            const next = { ...current };
            for (const field of snapshot?.fields || []) next[field.id] = choice;
            return next;
        });
    };

    const mergedPreview = useMemo(() => {
        if (!snapshot) return null;
        let merged = autoMergeIndependentCanvasChanges(snapshot.base, snapshot.local, snapshot.remote);
        for (const field of snapshot.fields) {
            const choice = choices[field.id] || "local";
            const value = choice === "remote" ? field.remoteValue : choice === "custom" ? customValues[field.id] : field.localValue;
            merged = applyCanvasConflictField(merged, field, value);
        }
        return merged;
    }, [choices, customValues, snapshot]);

    const unresolvedCount = snapshot ? snapshot.fields.reduce((count, field) => count + (choices[field.id] ? 0 : 1), 0) : 0;

    const submit = async () => {
        if (!snapshot || !mergedPreview || unresolvedCount > 0) return;
        setSubmitting(true);
        try {
            await resolveCanvasConflict(snapshot, mergedPreview);
            message.success("冲突已合并并同步");
            onResolved();
        } catch (error) {
            const detail = error instanceof Error ? error.message : "合并失败，请重新确认内容";
            setSubmitError(/新修改|重新打开|409|冲突/.test(detail) ? "云端刚刚又有修改，你的选择已保留。请重新读取最新内容后再确认。" : detail);
            message.error(detail);
        } finally {
            setSubmitting(false);
        }
    };

    return { choices, customValues, groupedFields, mergedPreview, unresolvedCount, submitting, submitError, setChoice, setCustomValue, chooseAll, submit };
}

function ResolverBody({ snapshot, state, compact = false }: { snapshot: CanvasConflictSnapshot; state: ResolverState; compact?: boolean }) {
    const { choices, customValues, groupedFields, mergedPreview, unresolvedCount, submitError, setChoice, setCustomValue, chooseAll } = state;
    return (
        <div className={compact ? "space-y-4" : "space-y-6"} data-canvas-no-zoom data-canvas-wheel-scroll>
            {submitError ? (
                <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-700">
                    {submitError}
                </div>
            ) : null}
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6">
                <div className="flex items-start gap-2">
                    <ShieldAlert size={17} className="mt-0.5 shrink-0 text-amber-500" />
                    <div>
                        <strong>有几处内容同时被修改了。</strong>
                        <p className="mt-1 text-xs text-muted-foreground">其他内容会自动合并。你可以逐项确认，也可以先统一采用一方，再单独调整。</p>
                    </div>
                </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
                <BranchCard label="编辑前" detail="开始修改时的内容" meta={`${snapshot.base.nodes.length} 个节点 · ${snapshot.base.connections.length} 条连线`} tone="muted" />
                <BranchCard label="我的内容" detail="你这次保留的修改" meta={`${snapshot.local.nodes.length} 个节点 · ${snapshot.local.connections.length} 条连线`} tone="blue" />
                <BranchCard label="其他成员的内容" detail="云端刚保存的内容" meta={`${snapshot.remote.nodes.length} 个节点 · ${snapshot.remote.connections.length} 条连线`} tone="purple" />
            </div>
            {mergedPreview ? (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
                    当前预览会保留 <strong className="text-foreground">{mergedPreview.nodes.length} 个节点</strong> 和 <strong className="text-foreground">{mergedPreview.connections.length} 条有效连线</strong>。删除节点后相关连线会自动清理。
                </div>
            ) : null}
            {snapshot.fields.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <span className="mr-auto text-xs text-muted-foreground">{unresolvedCount ? `还有 ${unresolvedCount} 项需要确认` : "所有分歧都已确认"}</span>
                    <Button size="small" onClick={() => chooseAll("local")} disabled={!unresolvedCount}>
                        都用我的内容
                    </Button>
                    <Button size="small" onClick={() => chooseAll("remote")} disabled={!unresolvedCount}>
                        都用云端内容
                    </Button>
                </div>
            ) : (
                <div className="rounded-lg border px-4 py-5 text-sm text-muted-foreground">没有同一部分内容发生分歧，双方修改已经自动合并。确认后即可同步。</div>
            )}
            {groupedFields.map(([group, fields]) => (
                <section key={group} className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-border pb-2 text-sm font-medium">
                        <span>{group}</span>
                        <Tag>{fields.length} 处</Tag>
                    </div>
                    {fields.map((field) => {
                        const choice = choices[field.id];
                        const custom = field.valueType === "text";
                        return (
                            <div key={field.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                                <div className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="text-sm font-medium">{field.label}</span>
                                    <Radio.Group className="!flex !flex-wrap" size="small" value={choice} onChange={(event) => setChoice(field, event.target.value as ConflictChoice)}>
                                        <Radio.Button value="local">用我的</Radio.Button>
                                        <Radio.Button value="remote">用云端</Radio.Button>
                                        {custom ? <Radio.Button value="custom">自己合并</Radio.Button> : null}
                                    </Radio.Group>
                                </div>
                                <div className="grid gap-2 md:grid-cols-3">
                                    <ValueCard label="编辑前" value={field.baseValue} muted />
                                    <ValueCard label="我的内容" value={field.localValue} selected={choice === "local"} />
                                    <ValueCard label="其他成员的内容" value={field.remoteValue} selected={choice === "remote"} />
                                </div>
                                {custom ? (
                                    <div className="mt-3">
                                        {choice === "custom" ? <p className="mb-1 text-xs text-muted-foreground">已预填我的内容，你可以直接修改成最终版本。</p> : null}
                                        <Input.TextArea
                                            autoSize={{ minRows: 3, maxRows: 8 }}
                                            value={customValues[field.id] || ""}
                                            disabled={choice !== "custom"}
                                            onChange={(event) => setCustomValue(field, event.target.value)}
                                            placeholder="输入你希望保留的最终内容"
                                        />
                                    </div>
                                ) : (
                                    <p className="mt-2 text-xs text-muted-foreground">选择一方后，系统会自动检查节点和连线关系。</p>
                                )}
                            </div>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}

function BranchCard({ label, detail, meta, tone }: { label: string; detail: string; meta: string; tone: "muted" | "blue" | "purple" }) {
    const className = tone === "blue" ? "border-blue-500/30 bg-blue-500/5" : tone === "purple" ? "border-purple-500/30 bg-purple-500/5" : "border-border";
    return (
        <div className={`rounded-lg border px-3 py-3 ${className}`}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="mt-1 block text-sm">{detail}</strong>
            <span className="mt-1 block text-xs text-muted-foreground">{meta}</span>
        </div>
    );
}

function ResolverFooter({ state, onCancel, showBack = true }: { state: ResolverState; onCancel: () => void; showBack?: boolean }) {
    return (
        <div className="flex flex-wrap items-center justify-end gap-2">
            <Button className="min-w-24" disabled={state.submitting} onClick={onCancel}>
                {showBack ? "稍后处理" : "返回画布"}
            </Button>
            <Button className="min-w-32" type="primary" loading={state.submitting} disabled={state.unresolvedCount > 0} onClick={() => void state.submit()}>
                {state.unresolvedCount > 0 ? `还需确认 ${state.unresolvedCount} 项` : "确认并同步"}
            </Button>
        </div>
    );
}

function ValueCard({ label, value, selected, muted }: { label: string; value: unknown; selected?: boolean; muted?: boolean }) {
    const missing = value === null || value === undefined;
    return (
        <div className={`min-h-16 rounded-md border px-2.5 py-2 ${selected ? "border-blue-500/60 bg-blue-500/10" : "bg-muted/20"} ${muted ? "opacity-70" : ""}`}>
            <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
            {missing ? <span className="text-xs text-muted-foreground">（已删除）</span> : <ConflictValue value={value} />}
        </div>
    );
}

function ConflictValue({ value }: { value: unknown }) {
    const detail = typeof value === "string" ? value || "（空）" : JSON.stringify(value, null, 2);
    return (
        <details className="text-xs">
            <summary className="cursor-pointer list-inside text-foreground/80">{conflictValueSummary(value)}</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{detail}</pre>
        </details>
    );
}

function conflictValueSummary(value: unknown) {
    if (typeof value === "string") return value ? (value.length > 100 ? `${value.slice(0, 100)}…` : value) : "（空）";
    if (Array.isArray(value)) return `列表，共 ${value.length} 项`;
    if (value && typeof value === "object") {
        const keys = Object.keys(value);
        return keys.length ? `结构化内容，包含 ${keys.length} 个字段` : "空配置";
    }
    return String(value);
}
